import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import type { Store } from '../store.js';

/* Projects, folders, version history and the shared library. */

const now = () => new Date().toISOString();
const MAX_DOC = 900_000; // Firestore documents are capped at 1 MiB
const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const wrap = (fn: (req: Request<Record<string, string>>, res: Response) => Promise<unknown>) => (req: Request<Record<string, string>>, res: Response, next: NextFunction) => fn(req, res).catch(next);

function docJson(doc: unknown) {
  if (!doc || typeof doc !== 'object') throw new HttpError(400, 'Missing edit data.');
  const s = JSON.stringify(doc);
  if (s.length > MAX_DOC) throw new HttpError(413, 'This edit is too large to save (over 900 KB). Remove unused cues or script text.');
  return s;
}
const meta = (p: any) => ({
  id: p.id, folderId: p.folderId ?? null, name: p.name, product: p.product || '', createdAt: p.createdAt, updatedAt: p.updatedAt,
  updatedBy: p.updatedBy ?? null, headVersion: p.headVersion || 0, duration: p.duration ?? undefined,
  pipeline: p.pipeline ? { externalId: p.pipeline.externalId ?? null, final: p.pipeline.final ?? null } : undefined,
});
const PROJECT_FIELDS = ['folderId', 'name', 'product', 'createdAt', 'updatedAt', 'updatedBy', 'headVersion', 'duration', 'pipeline'];

export function dataRoutes(db: Store) {
  const r = express.Router();
  r.use(express.json({ limit: '2mb' }));

  /* ---------- folders ---------- */
  const descendants = async (id: string) => {
    const all = await db.list('folders');
    const out = new Set<string>();
    const walk = (pid: string) => { for (const f of all) if (f.parentId === pid && !out.has(f.id)) { out.add(f.id); walk(f.id); } };
    walk(id);
    return out;
  };
  r.get('/folders', wrap(async (_q, res) => res.json(await db.list('folders'))));
  r.post('/folders', wrap(async (req, res) => {
    const name = str(req.body?.name, 120);
    if (!name) throw new HttpError(400, 'Give the folder a name.');
    const f = { id: randomUUID(), parentId: req.body?.parentId || null, name, createdAt: now(), updatedAt: now() };
    await db.set('folders', f.id, f);
    res.status(201).json(f);
  }));
  r.patch('/folders/:id', wrap(async (req, res) => {
    const patch: Record<string, any> = { updatedAt: now() };
    if (req.body?.name != null) patch.name = str(req.body.name, 120);
    if (req.body?.parentId !== undefined) {
      const pid = req.body.parentId || null;
      if (pid && (pid === req.params.id || (await descendants(req.params.id)).has(pid))) throw new HttpError(400, 'A folder can’t go inside itself.');
      patch.parentId = pid;
    }
    if (!(await db.update('folders', req.params.id, patch))) throw new HttpError(404, 'Folder not found');
    res.json({ ok: true });
  }));
  r.delete('/folders/:id', wrap(async (req, res) => {
    const ids = await descendants(req.params.id);
    ids.add(req.params.id);
    const projects = await db.list('projects', { select: ['folderId'] });
    for (const p of projects) if (p.folderId && ids.has(p.folderId)) await deleteProject(p.id);
    for (const id of ids) await db.del('folders', id);
    res.json({ ok: true });
  }));

  /* ---------- projects ---------- */
  const deleteProject = async (id: string) => {
    for (const v of await db.list('versions', { where: ['projectId', id], select: ['projectId'] })) await db.del('versions', v.id);
    await db.del('projects', id);
  };
  r.get('/projects', wrap(async (_q, res) => {
    const ps = await db.list('projects', { select: PROJECT_FIELDS });
    res.json(ps.map(meta).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
  }));
  r.post('/projects', wrap(async (req, res) => {
    const name = str(req.body?.name, 160);
    if (!name) throw new HttpError(400, 'Give the project a name.');
    const doc = docJson(req.body?.doc);
    const p = {
      id: randomUUID(), folderId: req.body?.folderId || null, name, product: str(req.body?.doc?.product, 80),
      createdAt: now(), updatedAt: now(), updatedBy: req.user?.name ?? null, headVersion: 0, doc,
    };
    await db.set('projects', p.id, p);
    res.status(201).json(meta(p));
  }));
  r.get('/projects/:id', wrap(async (req, res) => {
    const p = await db.get('projects', req.params.id);
    if (!p) throw new HttpError(404, 'Project not found');
    res.json({ ...meta(p), draft: JSON.parse(p.doc), pipeline: p.pipeline || null });
  }));
  r.patch('/projects/:id', wrap(async (req, res) => {
    const patch: Record<string, any> = { updatedAt: now() };
    if (req.body?.name != null) patch.name = str(req.body.name, 160);
    if (req.body?.folderId !== undefined) patch.folderId = req.body.folderId || null;
    if (req.body?.autoEditDone) patch['pipeline.autoEditPending'] = false;
    if (!(await db.update('projects', req.params.id, patch))) throw new HttpError(404, 'Project not found');
    res.json({ ok: true });
  }));
  r.put('/projects/:id/draft', wrap(async (req, res) => {
    const doc = docJson(req.body?.doc);
    const patch: Record<string, any> = { doc, product: str(req.body?.doc?.product, 80), updatedAt: now(), updatedBy: req.user?.name ?? null };
    if (typeof req.body?.duration === 'number') patch.duration = req.body.duration;
    if (!(await db.update('projects', req.params.id, patch))) throw new HttpError(404, 'Project not found');
    res.json({ ok: true });
  }));
  r.delete('/projects/:id', wrap(async (req, res) => { await deleteProject(req.params.id); res.json({ ok: true }); }));

  /* ---------- versions ---------- */
  const vmeta = (v: any) => ({ id: v.id, projectId: v.projectId, versionNo: v.versionNo, note: v.note, createdAt: v.createdAt, createdBy: v.createdBy ?? null });
  r.post('/projects/:id/versions', wrap(async (req, res) => {
    const doc = docJson(req.body?.doc);
    const at = now(), by = req.user?.name ?? null;
    let note = str(req.body?.note, 300);
    const n = await db.addVersion(req.params.id, (no) => {
      note = note || `Version ${no}`;
      return { projectId: req.params.id, versionNo: no, note, doc, createdAt: at, createdBy: by };
    }, { doc, updatedAt: at, updatedBy: by, product: str(req.body?.doc?.product, 80) });
    res.status(201).json({ id: `${req.params.id}_${n}`, projectId: req.params.id, versionNo: n, note, createdAt: at, createdBy: by });
  }));
  r.get('/projects/:id/versions', wrap(async (req, res) => {
    const vs = await db.list('versions', { where: ['projectId', req.params.id], select: ['projectId', 'versionNo', 'note', 'createdAt', 'createdBy'] });
    res.json(vs.map(vmeta).sort((a, b) => b.versionNo - a.versionNo));
  }));
  r.get('/versions/:id', wrap(async (req, res) => {
    const v = await db.get('versions', req.params.id);
    if (!v) throw new HttpError(404, 'Version not found');
    res.json({ ...vmeta(v), doc: JSON.parse(v.doc) });
  }));

  /* ---------- library ---------- */
  r.get('/categories', wrap(async (_q, res) => res.json((await db.list('categories')).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)))));
  r.put('/categories/:id', wrap(async (req, res) => {
    const c = { id: req.params.id, name: str(req.body?.name, 80), role: str(req.body?.role, 30), sort: Number(req.body?.sort ?? 0) };
    if (!c.name || !c.role) throw new HttpError(400, 'A category needs a name and a role.');
    await db.set('categories', c.id, c);
    res.json(c);
  }));
  r.delete('/categories/:id', wrap(async (req, res) => { await db.del('categories', req.params.id); res.json({ ok: true }); }));

  const assetOut = (a: any) => ({ hash: a.id, name: a.name, categoryId: a.categoryId, role: a.role, tags: a.tags || [], dur: a.dur || 0, size: a.size || 0, mime: a.mime, product: a.product || undefined, createdAt: a.createdAt });
  r.get('/assets', wrap(async (_q, res) => res.json((await db.list('assets')).map(assetOut))));
  r.put('/assets/:hash', wrap(async (req, res) => {
    if (!/^[0-9a-f]{64}$/.test(req.params.hash)) throw new HttpError(400, 'Bad audio id');
    const b = req.body || {};
    const a = {
      id: req.params.hash, name: str(b.name, 120), categoryId: str(b.categoryId, 80), role: str(b.role, 30),
      tags: Array.isArray(b.tags) ? b.tags.map((t: unknown) => str(t, 40)).slice(0, 30) : [], dur: Number(b.dur) || 0,
      size: Number(b.size) || 0, mime: str(b.mime, 80) || 'audio/mpeg', product: b.product ? str(b.product, 80) : null,
      createdAt: now(), createdBy: req.user?.name ?? null,
    };
    await db.set('assets', a.id, a);
    res.json(assetOut(a));
  }));
  r.patch('/assets/:hash', wrap(async (req, res) => {
    const b = req.body || {}, patch: Record<string, any> = {};
    if (b.name != null) patch.name = str(b.name, 120);
    if (b.categoryId != null) patch.categoryId = str(b.categoryId, 80);
    if (b.role != null) patch.role = str(b.role, 30);
    if (Array.isArray(b.tags)) patch.tags = b.tags.map((t: unknown) => str(t, 40)).slice(0, 30);
    if (b.product !== undefined) patch.product = b.product ? str(b.product, 80) : null;
    if (!(await db.update('assets', req.params.hash, patch))) throw new HttpError(404, 'Sound not found');
    res.json({ ok: true });
  }));
  r.delete('/assets/:hash', wrap(async (req, res) => { await db.del('assets', req.params.hash); res.json({ ok: true }); })); // audio kept: old versions may use it

  r.get('/guidelines', wrap(async (_q, res) => res.json((await db.list('guidelines')).map((g) => ({ id: g.id, name: g.name, text: g.text, isDefault: !!g.isDefault, updatedAt: g.updatedAt })))));
  r.put('/guidelines/:id', wrap(async (req, res) => {
    const g = { id: req.params.id, name: str(req.body?.name, 120), text: String(req.body?.text ?? '').slice(0, 30_000), isDefault: !!req.body?.isDefault, updatedAt: now(), updatedBy: req.user?.name ?? null };
    if (!g.name) throw new HttpError(400, 'Give the guidelines a name.');
    await db.set('guidelines', g.id, g);
    res.json(g);
  }));

  return r;
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const status = err?.status || (err?.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server. Try again.' : err.message });
}
export { HttpError };
