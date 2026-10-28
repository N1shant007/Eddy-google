import { openDB, type IDBPDatabase } from 'idb';
import type { Asset, Category, Guideline, ProjectDoc } from '@eddy/rules';
import type { Backend, Folder, Project, ProjectMeta, UserInfo, Version, VersionMeta } from './types';
import { nowIso, sha256, uid } from './util';
import { descendants } from '../projects/folderOps';

/* Demo mode (VITE_DEMO=1): the whole app runs in the browser with IndexedDB instead of the Eddy server.
   Used only for the hosted test build; production uses ApiBackend. */
type DB = IDBPDatabase<unknown>;

export class DemoBackend implements Backend {
  readonly kind = 'cloud' as const;
  readonly demo = true;
  private dbp: Promise<DB>;

  constructor(name = 'eddy-v3-demo') {
    this.dbp = openDB(name, 1, {
      upgrade(db) {
        db.createObjectStore('folders', { keyPath: 'id' });
        db.createObjectStore('projects', { keyPath: 'id' });
        const v = db.createObjectStore('versions', { keyPath: 'id' });
        v.createIndex('byProject', 'projectId');
        db.createObjectStore('categories', { keyPath: 'id' });
        db.createObjectStore('assets', { keyPath: 'hash' });
        db.createObjectStore('blobs');
        db.createObjectStore('guidelines', { keyPath: 'id' });
      },
    });
  }

  async user(): Promise<UserInfo | null> {
    try { const n = sessionStorage.getItem('eddy.demo.user'); return n ? { id: n, email: '', name: n } : null; } catch { return null; }
  }
  async signIn(passcode: string, name: string): Promise<UserInfo> {
    if (passcode.trim().toLowerCase() !== 'demo') throw new Error('That passcode is not right. In this demo the passcode is “demo”.');
    const n = name.trim() || 'Team member';
    try { sessionStorage.setItem('eddy.demo.user', n); } catch { /* ignore */ }
    return { id: n, email: '', name: n };
  }
  async signOut() { try { sessionStorage.removeItem('eddy.demo.user'); } catch { /* ignore */ } }
  async markAutoEdited(_id: string) { /* demo projects don't come from the pipeline */ }
  /** demo: no Cloud Storage or Drive, so the final mix is downloaded instead */
  async sendFinal(_projectId: string, mp3: Blob, filename: string) {
    const { saveFile } = await import('./host');
    await saveFile(filename, mp3);
    const u = await this.user();
    return { final: { uri: 'downloaded (demo)', filename, size: mp3.size, savedAt: new Date().toISOString(), savedBy: u?.name ?? null, versionNo: 0, drive: null, callback: null }, warnings: ['Demo mode: the final mix was downloaded. On Google Cloud it is saved to Cloud Storage and handed to the pipeline.'] };
  }

  /* ---------- folders ---------- */
  async listFolders(): Promise<Folder[]> {
    return (await (await this.dbp).getAll('folders')) as Folder[];
  }
  async createFolder(name: string, parentId: string | null): Promise<Folder> {
    const f: Folder = { id: uid('f_'), parentId, name, createdAt: nowIso(), updatedAt: nowIso() };
    await (await this.dbp).put('folders', f);
    return f;
  }
  async renameFolder(id: string, name: string) {
    await this.patch<Folder>('folders', id, { name, updatedAt: nowIso() });
  }
  async moveFolder(id: string, parentId: string | null) {
    const all = await this.listFolders();
    if (parentId && descendants(all, id).has(parentId)) throw new Error('A folder can’t go inside itself.');
    await this.patch<Folder>('folders', id, { parentId, updatedAt: nowIso() });
  }
  async deleteFolder(id: string) {
    const db = await this.dbp;
    const all = await this.listFolders();
    const ids = descendants(all, id);
    ids.add(id);
    const projects = (await db.getAll('projects')) as Project[];
    for (const p of projects) if (p.folderId && ids.has(p.folderId)) await this.deleteProject(p.id);
    for (const f of ids) await db.delete('folders', f);
  }

  /* ---------- projects ---------- */
  async listProjects(): Promise<ProjectMeta[]> {
    const all = (await (await this.dbp).getAll('projects')) as Project[];
    return all.map(({ draft: _d, pipeline: _p, ...m }) => m as ProjectMeta);
  }
  async createProject(name: string, folderId: string | null, doc: ProjectDoc): Promise<ProjectMeta> {
    const p: Project = {
      id: uid('p_'), folderId, name, product: doc.product || '', createdAt: nowIso(), updatedAt: nowIso(),
      headVersion: 0, draft: doc, updatedBy: null, pipeline: null,
    };
    await (await this.dbp).put('projects', p);
    const { draft: _d, pipeline: _p, ...m } = p;
    return m as ProjectMeta;
  }
  async getProject(id: string): Promise<Project | null> {
    const p = (await (await this.dbp).get('projects', id)) as Project | undefined;
    return p ? { ...p, pipeline: null } : null;
  }
  async renameProject(id: string, name: string) {
    await this.patch<Project>('projects', id, { name, updatedAt: nowIso() });
  }
  async moveProject(id: string, folderId: string | null) {
    await this.patch<Project>('projects', id, { folderId, updatedAt: nowIso() });
  }
  async deleteProject(id: string) {
    const db = await this.dbp;
    const vs = (await db.getAllFromIndex('versions', 'byProject', id)) as Version[];
    for (const v of vs) await db.delete('versions', v.id);
    await db.delete('projects', id);
  }
  async saveDraft(id: string, doc: ProjectDoc, duration?: number) {
    await this.patch<Project>('projects', id, { draft: doc, product: doc.product || '', updatedAt: nowIso(), ...(duration != null ? { duration } : {}) });
  }

  /* ---------- versions ---------- */
  async saveVersion(projectId: string, doc: ProjectDoc, note: string): Promise<VersionMeta> {
    const db = await this.dbp;
    const tx = db.transaction(['projects', 'versions'], 'readwrite');
    const p = (await tx.objectStore('projects').get(projectId)) as Project;
    if (!p) throw new Error('Project not found');
    const versionNo = (p.headVersion || 0) + 1;
    const v: Version = { id: uid('v_'), projectId, versionNo, note: note || `Version ${versionNo}`, createdAt: nowIso(), createdBy: null, doc };
    await tx.objectStore('versions').put(v);
    await tx.objectStore('projects').put({ ...p, headVersion: versionNo, draft: doc, updatedAt: nowIso() });
    await tx.done;
    const { doc: _d, ...m } = v;
    return m;
  }
  async listVersions(projectId: string): Promise<VersionMeta[]> {
    const vs = (await (await this.dbp).getAllFromIndex('versions', 'byProject', projectId)) as Version[];
    return vs.map(({ doc: _d, ...m }) => m).sort((a, b) => b.versionNo - a.versionNo);
  }
  async getVersion(versionId: string): Promise<Version | null> {
    return ((await (await this.dbp).get('versions', versionId)) as Version) || null;
  }

  /* ---------- library ---------- */
  async listCategories(): Promise<Category[]> {
    return ((await (await this.dbp).getAll('categories')) as Category[]).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  }
  async saveCategory(c: Category) {
    await (await this.dbp).put('categories', c);
  }
  async deleteCategory(id: string) {
    await (await this.dbp).delete('categories', id);
  }
  async listAssets(): Promise<Asset[]> {
    return (await (await this.dbp).getAll('assets')) as Asset[];
  }
  async putAsset(meta: Omit<Asset, 'hash' | 'size' | 'mime'>, file: Blob): Promise<Asset> {
    const hash = await this.putAudio(file);
    const a: Asset = { ...meta, hash, size: file.size, mime: file.type || 'audio/mpeg', createdAt: nowIso() };
    await (await this.dbp).put('assets', a);
    return a;
  }
  async updateAsset(hash: string, patch: Partial<Asset>) {
    await this.patch<Asset>('assets', hash, patch, 'hash');
  }
  async deleteAsset(hash: string) {
    await (await this.dbp).delete('assets', hash); // bytes stay: old versions may still use them
  }
  async getAudio(hash: string): Promise<Blob | null> {
    return ((await (await this.dbp).get('blobs', hash)) as Blob) || null;
  }
  async putAudio(file: Blob, _onProgress?: (p: number) => void): Promise<string> {
    const hash = await sha256(file);
    const db = await this.dbp;
    if (!(await db.getKey('blobs', hash))) await db.put('blobs', file, hash);
    return hash;
  }

  async listGuidelines(): Promise<Guideline[]> {
    return (await (await this.dbp).getAll('guidelines')) as Guideline[];
  }
  async saveGuideline(g: Guideline) {
    await (await this.dbp).put('guidelines', { ...g, updatedAt: nowIso() });
  }

  private async patch<T>(store: string, id: string, patch: Partial<T>, _key = 'id') {
    const db = await this.dbp;
    const cur = await db.get(store, id);
    if (!cur) throw new Error('Not found');
    await db.put(store, { ...(cur as object), ...patch });
  }
}

