import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { config } from './config.js';
import type { Store } from './store.js';

/* User accounts. Everyone signs in with a username and password; passwords are stored only as scrypt hashes
   (collection eddy_users). The first account, "admin", is created from the ADMIN_PASSWORD secret the first
   time it is needed; admins add people, set or reset their passwords and disable or remove them.
   The session is an HMAC-signed cookie (SESSION_SECRET) naming the user; every request checks the account is
   still active (cached for 30 s per instance). The pipeline uses its own bearer token (PIPELINE_TOKEN). */

const COOKIE = 'eddy_session';
const MAX_AGE_S = 7 * 24 * 3600;
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export type Role = 'admin' | 'editor';
export interface SessionUser { name: string; username: string; role: Role | 'pipeline'; via: 'password' | 'pipeline' }
export interface UserDoc { id: string; name: string; role: Role; passHash: string; disabled?: boolean; createdAt: string; createdBy: string | null; updatedAt?: string }
declare module 'express-serve-static-core' {
  interface Request { user?: SessionUser }
}

export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;
export const MIN_PASSWORD = 8;
export const normUser = (u: unknown) => String(u ?? '').trim().toLowerCase();

/* ---------- passwords ---------- */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function checkPassword(pw: string, stored: string) {
  const [kind, s, k] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !s || !k) return false;
  const want = Buffer.from(k, 'base64');
  const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}
/** an equal-cost check for unknown usernames, so response time does not reveal which accounts exist */
const DUMMY = hashPassword(randomBytes(12).toString('hex'));

/* ---------- session cookie ---------- */
const b64u = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url');
function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function makeToken(username: string, now = Date.now()) {
  const body = b64u(JSON.stringify({ u: username, exp: Math.floor(now / 1000) + MAX_AGE_S }));
  return `${body}.${sign(body)}`;
}
/** the username in a valid, unexpired cookie */
export function readToken(token: string | undefined): string | null {
  if (!token || !config.sessionSecret) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac || !safeEqual(sign(body), mac)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof o.exp !== 'number' || o.exp * 1000 < Date.now() || typeof o.u !== 'string') return null;
    return o.u;
  } catch { return null; }
}
function cookieOf(req: Request, name: string) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
function pipelineBearer(req: Request) {
  const h = req.headers.authorization || '';
  return !!config.pipelineToken && h.startsWith('Bearer ') && safeEqual(h.slice(7), config.pipelineToken);
}

/* ---------- accounts ---------- */
const cache = new Map<string, { at: number; u: UserDoc | null }>();
export const forgetUser = (username: string) => cache.delete(username);

/** creates "admin" from ADMIN_PASSWORD when no admin account exists yet */
export async function ensureAdmin(store: Store) {
  if (await store.get('users', 'admin')) return;
  if (!config.adminPassword) return;
  const now = new Date().toISOString();
  await store.set('users', 'admin', { name: 'Admin', role: 'admin', passHash: await hashPassword(config.adminPassword), disabled: false, createdAt: now, createdBy: null });
  forgetUser('admin');
  console.log('[eddy] created the admin account');
}

export async function loadUser(store: Store, username: string): Promise<UserDoc | null> {
  const hit = cache.get(username);
  if (hit && Date.now() - hit.at < 30_000) return hit.u;
  const u = (await store.get('users', username)) as UserDoc | null;
  cache.set(username, { at: Date.now(), u });
  return u;
}
const sessionOf = (u: UserDoc): SessionUser => ({ name: u.name || u.id, username: u.id, role: u.role, via: 'password' });

/** signed-in, active user (cookie), or the pipeline (bearer token) */
export function requireUser(store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    const username = readToken(cookieOf(req, COOKIE));
    if (username) {
      loadUser(store, username).then((u) => {
        if (u && !u.disabled) { req.user = sessionOf(u); return next(); }
        res.status(401).json({ error: 'Your account is not active. Ask an admin.' });
      }).catch(next);
      return;
    }
    if (pipelineBearer(req)) { req.user = { name: 'Pipeline', username: 'pipeline', role: 'pipeline', via: 'pipeline' }; return next(); }
    res.status(401).json({ error: 'Sign in with your username and password.' });
  };
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Only an admin can do this.' });
}
export function requirePipeline(req: Request, res: Response, next: NextFunction) {
  if (pipelineBearer(req)) { req.user = { name: 'Pipeline', username: 'pipeline', role: 'pipeline', via: 'pipeline' }; return next(); }
  res.status(401).json({ error: config.pipelineToken ? 'Invalid pipeline token.' : 'PIPELINE_TOKEN is not set on the server.' });
}

/* failed-attempt limiter: 10 wrong sign-ins per address per 15 minutes */
const fails = new Map<string, { n: number; until: number }>();
const limited = (ip: string) => { const f = fails.get(ip); return !!f && f.n >= 10 && f.until > Date.now(); };
function fail(ip: string) {
  const f = fails.get(ip);
  const fresh = !f || f.until < Date.now();
  fails.set(ip, { n: fresh ? 1 : f!.n + 1, until: Date.now() + 15 * 60_000 });
}

export function sessionRoutes(store: Store): Router {
  const r = express.Router();
  r.get('/session', (req, res, next) => {
    const username = readToken(cookieOf(req, COOKIE));
    if (!username) return void res.status(401).json({ error: 'Not signed in' });
    loadUser(store, username).then((u) => {
      if (!u || u.disabled) return void res.status(401).json({ error: 'Not signed in' });
      res.json({ username: u.id, name: u.name || u.id, role: u.role });
    }).catch(next);
  });
  r.post('/session', express.json({ limit: '10kb' }), (req, res, next) => {
    (async () => {
      const ip = req.ip || 'unknown';
      if (limited(ip)) return void res.status(429).json({ error: 'Too many wrong sign-ins. Try again in 15 minutes.' });
      if (!config.sessionSecret) return void res.status(503).json({ error: 'Sign-in is not set up on the server (SESSION_SECRET).' });
      const username = normUser(req.body?.username), password = req.body?.password;
      if (username === 'admin') await ensureAdmin(store);
      const u = USERNAME.test(username) ? await loadUser(store, username) : null;
      const ok = typeof password === 'string' && password.length <= 200 && (u ? await checkPassword(password, u.passHash) : (await checkPassword('x', await DUMMY), false));
      if (!u || !ok) { fail(ip); return void res.status(401).json({ error: 'That username or password is not right.' }); }
      if (u.disabled) return void res.status(403).json({ error: 'This account is disabled. Ask an admin.' });
      fails.delete(ip);
      res.cookie(COOKIE, makeToken(u.id), { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: MAX_AGE_S * 1000, path: '/' });
      res.json({ username: u.id, name: u.name || u.id, role: u.role });
    })().catch(next);
  });
  r.delete('/session', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  return r;
}
