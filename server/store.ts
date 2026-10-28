import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Firestore } from '@google-cloud/firestore';
import { config } from './config.js';

/* A tiny document store: Firestore in production, JSON files in ./.data for local development.
   Collections: folders, projects, versions, categories, assets, guidelines (names get FIRESTORE_PREFIX). */

export type Doc = Record<string, any> & { id: string };
export type Col = 'folders' | 'projects' | 'versions' | 'categories' | 'assets' | 'guidelines';

export interface Store {
  list(col: Col, opts?: { where?: [string, any]; select?: string[] }): Promise<Doc[]>;
  get(col: Col, id: string): Promise<Doc | null>;
  set(col: Col, id: string, data: Record<string, any>): Promise<void>;
  update(col: Col, id: string, patch: Record<string, any>): Promise<boolean>;
  del(col: Col, id: string): Promise<void>;
  /** atomically bumps projects/<id>.headVersion and writes the version; returns the new number */
  addVersion(projectId: string, build: (n: number) => Record<string, any>, projectPatch: Record<string, any>): Promise<number>;
}

/* ---------------- Firestore ---------------- */
class FirestoreStore implements Store {
  private db = new Firestore({ projectId: config.project || undefined, databaseId: config.firestoreDatabase, ignoreUndefinedProperties: true });
  private c(col: Col) { return this.db.collection(config.prefix + col); }

  async list(col: Col, opts: { where?: [string, any]; select?: string[] } = {}) {
    let q: FirebaseFirestore.Query = this.c(col);
    if (opts.where) q = q.where(opts.where[0], '==', opts.where[1]);
    if (opts.select) q = q.select(...opts.select);
    const snap = await q.get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  }
  async get(col: Col, id: string) {
    const d = await this.c(col).doc(id).get();
    return d.exists ? { ...d.data()!, id: d.id } : null;
  }
  async set(col: Col, id: string, data: Record<string, any>) {
    const { id: _i, ...rest } = data;
    await this.c(col).doc(id).set(rest);
  }
  async update(col: Col, id: string, patch: Record<string, any>) {
    try { await this.c(col).doc(id).update(patch); return true; }
    catch (e: any) { if (e?.code === 5) return false; throw e; } // 5 = NOT_FOUND
  }
  async del(col: Col, id: string) { await this.c(col).doc(id).delete(); }
  async addVersion(projectId: string, build: (n: number) => Record<string, any>, projectPatch: Record<string, any>) {
    return this.db.runTransaction(async (tx) => {
      const pref = this.c('projects').doc(projectId);
      const p = await tx.get(pref);
      if (!p.exists) throw Object.assign(new Error('Project not found'), { status: 404 });
      const n = (p.data()!.headVersion || 0) + 1;
      tx.set(this.c('versions').doc(`${projectId}_${n}`), build(n));
      tx.update(pref, { ...projectPatch, headVersion: n });
      return n;
    });
  }
}

/* ---------------- local JSON files (development) ---------------- */
class LocalStore implements Store {
  private cache = new Map<Col, Map<string, Doc>>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private dir: string) {}

  private file(col: Col) { return path.join(this.dir, `${col}.json`); }
  private async load(col: Col) {
    let m = this.cache.get(col);
    if (!m) {
      m = new Map();
      try { for (const d of JSON.parse(await fs.readFile(this.file(col), 'utf8')) as Doc[]) m.set(d.id, d); } catch { /* new */ }
      this.cache.set(col, m);
    }
    return m;
  }
  private async save(col: Col) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = this.file(col) + '.tmp';
    await fs.writeFile(tmp, JSON.stringify([...(await this.load(col)).values()]));
    await fs.rename(tmp, this.file(col));
  }
  /** one write at a time, so concurrent requests can't interleave */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => {});
    return p;
  }
  async list(col: Col, opts: { where?: [string, any]; select?: string[] } = {}) {
    let all = [...(await this.load(col)).values()];
    if (opts.where) all = all.filter((d) => d[opts.where![0]] === opts.where![1]);
    if (opts.select) all = all.map((d) => Object.fromEntries([['id', d.id], ...opts.select!.filter((k) => k in d).map((k) => [k, d[k]])]) as Doc);
    return structuredClone(all);
  }
  async get(col: Col, id: string) {
    const d = (await this.load(col)).get(id);
    return d ? structuredClone(d) : null;
  }
  set(col: Col, id: string, data: Record<string, any>) {
    return this.serial(async () => { (await this.load(col)).set(id, { ...structuredClone(data), id }); await this.save(col); });
  }
  update(col: Col, id: string, patch: Record<string, any>) {
    return this.serial(async () => {
      const m = await this.load(col), d = m.get(id);
      if (!d) return false;
      const next: Record<string, any> = structuredClone(d);
      for (const [k, v] of Object.entries(structuredClone(patch))) {
        // dotted keys update nested fields, like Firestore
        const ks = k.split('.');
        let o = next;
        for (const kk of ks.slice(0, -1)) o = (o[kk] = o[kk] && typeof o[kk] === 'object' ? o[kk] : {});
        o[ks[ks.length - 1]] = v;
      }
      m.set(id, { ...next, id } as Doc);
      await this.save(col);
      return true;
    });
  }
  del(col: Col, id: string) {
    return this.serial(async () => { (await this.load(col)).delete(id); await this.save(col); });
  }
  addVersion(projectId: string, build: (n: number) => Record<string, any>, projectPatch: Record<string, any>) {
    return this.serial(async () => {
      const pm = await this.load('projects'), p = pm.get(projectId);
      if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
      const n = (p.headVersion || 0) + 1;
      (await this.load('versions')).set(`${projectId}_${n}`, { ...build(n), id: `${projectId}_${n}` });
      pm.set(projectId, { ...p, ...projectPatch, headVersion: n });
      await this.save('versions');
      await this.save('projects');
      return n;
    });
  }
}

export function makeStore(): Store {
  return config.storage === 'gcp' ? new FirestoreStore() : new LocalStore(path.join(config.dataDir, 'db'));
}
