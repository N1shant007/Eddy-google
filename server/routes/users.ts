import express, { type Request, type Response, type NextFunction } from 'express';
import type { Store } from '../store.js';
import { forgetUser, hashPassword, checkPassword, loadUser, MIN_PASSWORD, normUser, requireAdmin, USERNAME, type Role, type UserDoc } from '../auth.js';
import { HttpError } from './data.js';

/* Account management. Admins list, add, edit (name, role, password, disabled) and remove users.
   Everyone can change their own password. The last active admin can't be removed, disabled or demoted. */

const wrap = (fn: (req: Request<Record<string, string>>, res: Response) => Promise<unknown>) => (req: Request<Record<string, string>>, res: Response, next: NextFunction) => fn(req, res).catch(next);
const now = () => new Date().toISOString();
const out = (u: UserDoc) => ({ username: u.id, name: u.name || u.id, role: u.role, disabled: !!u.disabled, createdAt: u.createdAt, createdBy: u.createdBy ?? null, updatedAt: u.updatedAt ?? null });
const role = (r: unknown): Role => { if (r === 'admin' || r === 'editor') return r; throw new HttpError(400, 'Role must be admin or editor.'); };
const password = (p: unknown) => {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD || p.length > 200) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  return p;
};

export function userRoutes(store: Store) {
  const r = express.Router();
  r.use('/users', express.json({ limit: '10kb' }));
  r.use('/me', express.json({ limit: '10kb' }));

  const activeAdmins = async () => (await store.list('users')).filter((u) => u.role === 'admin' && !u.disabled).length;

  r.get('/users', requireAdmin, wrap(async (_req, res) => {
    const list = (await store.list('users')) as UserDoc[];
    res.json(list.map(out).sort((a, b) => a.username.localeCompare(b.username)));
  }));

  r.post('/users', requireAdmin, wrap(async (req, res) => {
    const username = normUser(req.body?.username);
    if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 2–32 characters: lowercase letters, digits, dot, dash or underscore.');
    if (await store.get('users', username)) throw new HttpError(409, `“${username}” already exists.`);
    const u = {
      name: String(req.body?.name || username).trim().slice(0, 60) || username, role: role(req.body?.role ?? 'editor'),
      passHash: await hashPassword(password(req.body?.password)), disabled: false, createdAt: now(), createdBy: req.user?.username ?? null,
    };
    await store.set('users', username, u);
    forgetUser(username);
    res.status(201).json(out({ ...u, id: username }));
  }));

  r.patch('/users/:username', requireAdmin, wrap(async (req, res) => {
    const username = normUser(req.params.username);
    const u = (await store.get('users', username)) as UserDoc | null;
    if (!u) throw new HttpError(404, 'User not found');
    const patch: Record<string, unknown> = { updatedAt: now() };
    if (req.body?.name != null) patch.name = String(req.body.name).trim().slice(0, 60) || username;
    if (req.body?.password != null) patch.passHash = await hashPassword(password(req.body.password));
    const demote = req.body?.role != null && role(req.body.role) !== 'admin' && u.role === 'admin';
    const disable = req.body?.disabled === true && !u.disabled;
    if ((demote || disable) && u.role === 'admin' && !u.disabled && (await activeAdmins()) <= 1) throw new HttpError(400, 'Keep at least one active admin.');
    if (req.body?.role != null) patch.role = role(req.body.role);
    if (req.body?.disabled != null) patch.disabled = !!req.body.disabled;
    await store.update('users', username, patch);
    forgetUser(username);
    res.json(out({ ...u, ...patch } as UserDoc));
  }));

  r.delete('/users/:username', requireAdmin, wrap(async (req, res) => {
    const username = normUser(req.params.username);
    const u = (await store.get('users', username)) as UserDoc | null;
    if (!u) throw new HttpError(404, 'User not found');
    if (username === req.user?.username) throw new HttpError(400, 'You can’t remove your own account.');
    if (u.role === 'admin' && !u.disabled && (await activeAdmins()) <= 1) throw new HttpError(400, 'Keep at least one active admin.');
    await store.del('users', username);
    forgetUser(username);
    res.json({ ok: true });
  }));

  /* anyone signed in: change your own password */
  r.post('/me/password', wrap(async (req, res) => {
    if (req.user?.via !== 'password') throw new HttpError(403, 'Sign in as a user to change a password.');
    const u = await loadUser(store, req.user.username);
    if (!u || !(await checkPassword(String(req.body?.current ?? ''), u.passHash))) throw new HttpError(400, 'Your current password is not right.');
    await store.update('users', u.id, { passHash: await hashPassword(password(req.body?.next)), updatedAt: now() });
    forgetUser(u.id);
    res.json({ ok: true });
  }));
  return r;
}
