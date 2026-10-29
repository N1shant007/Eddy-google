import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { config } from './config.js';

/* Team passcode gate: one shared passcode (EDDY_PASSCODE). People add their name when they sign in,
   so version history shows who saved what. The session is an HMAC-signed cookie (SESSION_SECRET). */

const COOKIE = 'eddy_session';
const MAX_AGE_S = 7 * 24 * 3600;

export interface SessionUser { name: string; via: 'passcode' | 'pipeline' }
declare module 'express-serve-static-core' {
  interface Request { user?: SessionUser }
}

const b64u = (s: string) => Buffer.from(s).toString('base64url');
const sign = (data: string) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function makeToken(name: string, now = Date.now()) {
  const body = b64u(JSON.stringify({ n: name, exp: Math.floor(now / 1000) + MAX_AGE_S }));
  return `${body}.${sign(body)}`;
}

export function readToken(token: string | undefined): SessionUser | null {
  if (!token || !config.sessionSecret) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac || !safeEqual(sign(body), mac)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (typeof o.exp !== 'number' || o.exp * 1000 < Date.now()) return null;
    return { name: String(o.n || 'Team member').slice(0, 60), via: 'passcode' };
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

/** signed-in team member (cookie), or the pipeline (bearer token) */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = readToken(cookieOf(req, COOKIE));
  if (u) { req.user = u; return next(); }
  if (pipelineBearer(req)) { req.user = { name: 'Pipeline', via: 'pipeline' }; return next(); }
  res.status(401).json({ error: 'Sign in with the team passcode.' });
}

export function requirePipeline(req: Request, res: Response, next: NextFunction) {
  if (pipelineBearer(req)) { req.user = { name: 'Pipeline', via: 'pipeline' }; return next(); }
  res.status(401).json({ error: config.pipelineToken ? 'Invalid pipeline token.' : 'PIPELINE_TOKEN is not set on the server.' });
}

/* failed-attempt limiter: 10 wrong passcodes per address per 15 minutes */
const fails = new Map<string, { n: number; until: number }>();
function limited(ip: string) {
  const f = fails.get(ip);
  return !!f && f.n >= 10 && f.until > Date.now();
}
function fail(ip: string) {
  const f = fails.get(ip);
  const fresh = !f || f.until < Date.now();
  fails.set(ip, { n: fresh ? 1 : f!.n + 1, until: Date.now() + 15 * 60_000 });
}

export function sessionRoutes(): Router {
  const r = express.Router();
  r.get('/session', (req, res) => {
    const u = readToken(cookieOf(req, COOKIE));
    if (!u) return void res.status(401).json({ error: 'Not signed in' });
    res.json({ name: u.name });
  });
  r.post('/session', express.json({ limit: '10kb' }), (req, res) => {
    const ip = req.ip || 'unknown';
    if (limited(ip)) return void res.status(429).json({ error: 'Too many wrong passcodes. Try again in 15 minutes.' });
    if (!config.passcode || !config.sessionSecret) return void res.status(503).json({ error: 'The passcode gate is not set up on the server (EDDY_PASSCODE, SESSION_SECRET).' });
    const { passcode, name } = req.body || {};
    if (typeof passcode !== 'string' || !safeEqual(passcode, config.passcode)) {
      fail(ip);
      return void res.status(401).json({ error: 'That passcode is not right.' });
    }
    fails.delete(ip);
    const nm = String(name || '').trim().slice(0, 60) || 'Team member';
    res.cookie(COOKIE, makeToken(nm), { httpOnly: true, secure: config.production, sameSite: 'lax', maxAge: MAX_AGE_S * 1000, path: '/' });
    res.json({ name: nm });
  });
  r.delete('/session', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });
  return r;
}
