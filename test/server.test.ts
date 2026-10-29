import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* API tests against the real Express app with local storage (no Google Cloud needed). */

const FAKE_KEY = 'AIza' + 'Sy' + 'X'.repeat(33);
const FAKE_OPENAI = 'sk-' + 'proj-' + 'Y'.repeat(40);
/* EDDY_TEST_STORAGE=gcp runs the same tests against Firestore + Cloud Storage
   (the emulators started by scripts/test-gcp.mjs, or real ones). */
const dir = mkdtempSync(path.join(tmpdir(), 'eddy-test-'));
const gcp = process.env.EDDY_TEST_STORAGE === 'gcp';
Object.assign(process.env, gcp
  ? { EDDY_STORAGE: 'gcp', EDDY_BUCKET: process.env.EDDY_BUCKET || 'eddy-test', FIRESTORE_PREFIX: `t${Date.now().toString(36)}_` }
  : { EDDY_STORAGE: 'local', EDDY_DATA_DIR: dir });
Object.assign(process.env, {
  ADMIN_PASSWORD: 'open-sesame-admin', SESSION_SECRET: 'x'.repeat(40),
  PIPELINE_TOKEN: 'pipe-token-123', GOOGLE_CLOUD_PROJECT: 'test-project', ALLOWED_AUDIO_HOSTS: 'cdn.example.com',
  GEMINI_API_KEY: FAKE_KEY, OPENAI_API_KEY: FAKE_OPENAI, OPENAI_MODELS: 'gpt-4.1-mini,gpt-4.1', OPENAI_MODEL: 'gpt-4.1-mini',
});

let aiMod: any;
let base = '', cookie = '', adminCookie = '', close: () => void = () => {};
const login = async (username: string, password: string) => {
  const r = await call('/api/session', { method: 'POST', json: { username, password }, auth: 'none' });
  return { status: r.status, body: await r.json(), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
const as = (c: string) => ({ headers: { Cookie: c } });
const call = (p: string, init: RequestInit & { json?: unknown; auth?: 'cookie' | 'pipeline' | 'none' } = {}) => {
  const { json, auth = 'cookie', ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (auth === 'cookie' && cookie && !headers.Cookie) headers.Cookie = cookie;
  if (auth === 'pipeline') headers.Authorization = 'Bearer pipe-token-123';
  return fetch(base + p, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
};
const doc = (extra: Record<string, unknown> = {}) => ({ schema: 2, product: '', scriptText: '', lines: [], dialogueHash: null, tracks: [], clips: [], cues: [], settings: {}, guidelineId: null, ...extra });

beforeAll(async () => {
  const { createApi } = await import('../server');
  const ai = await import('../server/routes/ai');
  aiMod = ai;
  ai.setGenerate(async (prov, model, p) => JSON.stringify({ prov, model, echo: p.length }));
  const srv = createApi().listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  close = () => srv.close();
});
afterAll(() => close());

describe('health', () => {
  it('answers on /api/health (Cloud Run) and /healthz without signing in', async () => {
    for (const p of ['/api/health', '/healthz']) expect((await (await call(p, { auth: 'none' })).json()).ok).toBe(true);
  });
});

describe('user accounts', () => {
  it('refuses the API without a session', async () => {
    expect((await call('/api/projects', { auth: 'none' })).status).toBe(401);
  });
  it('creates admin from ADMIN_PASSWORD and refuses wrong passwords', async () => {
    expect((await login('admin', 'nope-nope')).status).toBe(401);
    expect((await login('nobody', 'open-sesame-admin')).status).toBe(401);
    const a = await login('Admin', 'open-sesame-admin'); // usernames are not case sensitive
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ username: 'admin', name: 'Admin', role: 'admin' });
    adminCookie = a.cookie;
    expect(adminCookie).toMatch(/^eddy_session=/);
  });
  it('lets the admin add users, with checks', async () => {
    const add = (json: unknown) => call('/api/users', { method: 'POST', json, ...as(adminCookie) });
    expect((await add({ username: 'nishant', name: 'Nishant', password: 'short' })).status).toBe(400);
    expect((await add({ username: 'Bad Name!', name: 'X', password: 'long-enough-1' })).status).toBe(400);
    const r = await add({ username: 'nishant', name: 'Nishant', password: 'nishant-pass-1', role: 'editor' });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ username: 'nishant', name: 'Nishant', role: 'editor', disabled: false, createdBy: 'admin' });
    expect((await add({ username: 'nishant', name: 'Again', password: 'nishant-pass-1' })).status).toBe(409);
    const list = await (await call('/api/users', as(adminCookie))).json();
    expect(list.map((u: any) => u.username)).toEqual(['admin', 'nishant']);
    expect(JSON.stringify(list)).not.toMatch(/passHash|scrypt/);
  });
  it('signs a user in; editors cannot manage users', async () => {
    const n = await login('nishant', 'nishant-pass-1');
    expect(n.body).toEqual({ username: 'nishant', name: 'Nishant', role: 'editor' });
    cookie = n.cookie;
    expect(await (await call('/api/session')).json()).toEqual({ username: 'nishant', name: 'Nishant', role: 'editor' });
    expect((await call('/api/users')).status).toBe(403);
    expect((await call('/api/users', { method: 'POST', json: { username: 'x1', password: 'long-enough-1' } })).status).toBe(403);
  });
  it('rejects a tampered cookie', async () => {
    const bad = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const r = await fetch(base + '/api/projects', { headers: { Cookie: bad } });
    expect(r.status).toBe(401);
  });
  it('lets people change their own password', async () => {
    expect((await call('/api/me/password', { method: 'POST', json: { current: 'wrong-one', next: 'nishant-pass-2' } })).status).toBe(400);
    expect((await call('/api/me/password', { method: 'POST', json: { current: 'nishant-pass-1', next: 'nishant-pass-2' } })).status).toBe(200);
    expect((await login('nishant', 'nishant-pass-1')).status).toBe(401);
    expect((await login('nishant', 'nishant-pass-2')).status).toBe(200);
  });
  it('admin can reset a password and disable an account at once', async () => {
    const patch = (json: unknown) => call('/api/users/nishant', { method: 'PATCH', json, ...as(adminCookie) });
    expect((await patch({ password: 'reset-by-admin' })).status).toBe(200);
    expect((await login('nishant', 'reset-by-admin')).status).toBe(200);
    expect((await patch({ disabled: true })).status).toBe(200);
    expect((await call('/api/projects')).status).toBe(401); // existing session stops working
    expect((await login('nishant', 'reset-by-admin')).status).toBe(403);
    expect((await patch({ disabled: false })).status).toBe(200);
    expect((await call('/api/projects')).status).toBe(200);
  });
  it('always keeps one active admin', async () => {
    const patchAdmin = (json: unknown) => call('/api/users/admin', { method: 'PATCH', json, ...as(adminCookie) });
    expect((await patchAdmin({ role: 'editor' })).status).toBe(400);
    expect((await patchAdmin({ disabled: true })).status).toBe(400);
    expect((await call('/api/users/admin', { method: 'DELETE', ...as(adminCookie) })).status).toBe(400);
    const tmp = await call('/api/users', { method: 'POST', json: { username: 'temp.user', password: 'temporary-1' }, ...as(adminCookie) });
    expect(tmp.status).toBe(201);
    expect((await call('/api/users/temp.user', { method: 'DELETE', ...as(adminCookie) })).status).toBe(200);
    expect((await login('temp.user', 'temporary-1')).status).toBe(401);
  });
});

describe('projects, folders and versions', () => {
  let folder = '', sub = '', project = '';
  it('creates nested folders and refuses a cycle', async () => {
    folder = (await (await call('/api/folders', { method: 'POST', json: { name: 'Home Loan', parentId: null } })).json()).id;
    sub = (await (await call('/api/folders', { method: 'POST', json: { name: 'Season 1', parentId: folder } })).json()).id;
    const r = await call(`/api/folders/${folder}`, { method: 'PATCH', json: { parentId: sub } });
    expect(r.status).toBe(400);
  });
  it('creates a project, autosaves and keeps numbered versions', async () => {
    project = (await (await call('/api/projects', { method: 'POST', json: { name: 'Ep 1', folderId: sub, doc: doc() } })).json()).id;
    await call(`/api/projects/${project}/draft`, { method: 'PUT', json: { doc: doc({ product: 'Home Loan' }), duration: 200 } });
    const v1 = await (await call(`/api/projects/${project}/versions`, { method: 'POST', json: { doc: doc({ scriptText: 'A: one' }), note: 'first cut' } })).json();
    const v2 = await (await call(`/api/projects/${project}/versions`, { method: 'POST', json: { doc: doc({ scriptText: 'A: two' }), note: '' } })).json();
    expect([v1.versionNo, v2.versionNo]).toEqual([1, 2]);
    expect(v1.createdBy).toBe('Nishant');
    const list = await (await call(`/api/projects/${project}/versions`)).json();
    expect(list.map((v: any) => v.note)).toEqual(['Version 2', 'first cut']);
    const full = await (await call(`/api/versions/${encodeURIComponent(v1.id)}`)).json();
    expect(full.doc.scriptText).toBe('A: one');
    const p = await (await call(`/api/projects/${project}`)).json();
    expect(p.headVersion).toBe(2);
    expect(p.draft.scriptText).toBe('A: two');
  });
  it('lists projects without their edit data', async () => {
    const ps = await (await call('/api/projects')).json();
    expect(ps[0].name).toBe('Ep 1');
    expect(ps[0].draft).toBeUndefined();
  });
  it('deleting a folder deletes its sub-folders, projects and versions', async () => {
    await call(`/api/folders/${folder}`, { method: 'DELETE' });
    expect(await (await call('/api/projects')).json()).toEqual([]);
    expect(await (await call('/api/folders')).json()).toEqual([]);
    expect((await call(`/api/versions/${project}_1`)).status).toBe(404);
  });
});

describe('audio storage', () => {
  const small = Buffer.from('ID3 small audio file');
  const smallHash = createHash('sha256').update(small).digest('hex');
  it('stores once by SHA-256 and refuses a wrong checksum', async () => {
    expect((await call(`/api/audio/${smallHash}`, { method: 'HEAD' })).status).toBe(404);
    expect((await call(`/api/audio/${'0'.repeat(64)}`, { method: 'PUT', body: small, headers: { 'Content-Type': 'audio/mpeg' } })).status).toBe(400);
    expect((await call(`/api/audio/${smallHash}`, { method: 'PUT', body: small, headers: { 'Content-Type': 'audio/mpeg' } })).status).toBe(201);
    const g = await call(`/api/audio/${smallHash}`);
    expect(Buffer.from(await g.arrayBuffer()).equals(small)).toBe(true);
    expect(g.headers.get('content-type')).toBe('audio/mpeg');
  });
  it('serves byte ranges', async () => {
    const r = await call(`/api/audio/${smallHash}`, { headers: { Range: 'bytes=4-8' } });
    expect(r.status).toBe(206);
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('small');
  });
  it('joins a multi-part upload and verifies it', async () => {
    const big = Buffer.alloc(9 * 1024 * 1024, 7);
    const hash = createHash('sha256').update(big).digest('hex');
    const up = await (await call('/api/uploads', { method: 'POST', json: { hash, parts: 2 } })).json();
    await call(`/api/uploads/${up.uploadId}/0`, { method: 'PUT', body: big.subarray(0, 8 * 1024 * 1024) });
    await call(`/api/uploads/${up.uploadId}/1`, { method: 'PUT', body: big.subarray(8 * 1024 * 1024) });
    const done = await call(`/api/uploads/${up.uploadId}/complete`, { method: 'POST', json: { hash, parts: 2, contentType: 'audio/wav' } });
    expect(done.status).toBe(201);
    const head = await call(`/api/audio/${hash}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
  });
});

describe('AI providers (Gemini and ChatGPT)', () => {
  it('lists each configured provider with its models, never the keys', async () => {
    const r = await (await call('/api/ai')).json();
    expect(r.providers.map((p: any) => [p.id, p.defaultModel, p.models])).toEqual([
      ['gemini', 'gemini-2.5-flash', ['gemini-2.5-flash', 'gemini-2.5-pro']],
      ['openai', 'gpt-4.1-mini', ['gpt-4.1-mini', 'gpt-4.1']],
    ]);
    const raw = JSON.stringify(r);
    expect(raw).not.toContain(FAKE_KEY);
    expect(raw).not.toContain(FAKE_OPENAI);
  });
  it('sends the prompt to the chosen provider and model', async () => {
    const g = await (await call('/api/ai', { method: 'POST', json: { prompt: 'hello' } })).json();
    expect(JSON.parse(g.text)).toEqual({ prov: 'gemini', model: 'gemini-2.5-flash', echo: 5 });
    const o = await (await call('/api/ai', { method: 'POST', json: { prompt: 'hello', provider: 'openai', model: 'gpt-4.1' } })).json();
    expect(JSON.parse(o.text)).toEqual({ prov: 'openai', model: 'gpt-4.1', echo: 5 });
  });
  it('refuses a model the server has not enabled', async () => {
    const r = await call('/api/ai', { method: 'POST', json: { prompt: 'x', provider: 'openai', model: 'some-other-model' } });
    expect(r.status).toBe(400);
  });
});

describe('API key stays secret', () => {
  it('is never in API responses, even when Gemini fails with it in the message', async () => {
    const info = await (await call('/api/ai')).text();
    expect(info).not.toContain(FAKE_KEY);
    aiMod.setGenerate(async () => { throw new Error(`request with key=${FAKE_KEY} / ${FAKE_OPENAI} was rejected`); });
    for (const provider of ['gemini', 'openai']) {
      const r = await call('/api/ai', { method: 'POST', json: { prompt: 'x', provider } });
      const body = await r.text();
      expect(r.status).toBe(502);
      expect(body).not.toContain(FAKE_KEY);
      expect(body).not.toContain(FAKE_OPENAI);
      expect(body).toContain('[key]');
    }
    aiMod.setGenerate(async (prov: string, model: string, p: string) => JSON.stringify({ prov, model, echo: p.length }));
  });
  it('is refused without a signed-in session', async () => {
    expect((await call('/api/ai', { method: 'POST', json: { prompt: 'x' }, auth: 'none' })).status).toBe(401);
  });
});

describe('pipeline hand-off', () => {
  let id = '';
  it('needs the pipeline token', async () => {
    expect((await call('/api/pipeline/episodes', { method: 'POST', json: { title: 'x' }, auth: 'none' })).status).toBe(401);
  });
  it('refuses audio from hosts that are not allowed', async () => {
    const r = await call('/api/pipeline/episodes', { method: 'POST', auth: 'pipeline', json: { title: 'Ep', audioUrl: 'https://evil.example.org/a.mp3' } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/not allowed/);
  });
  it('creates a project in a folder path from script + uploaded audio', async () => {
    const audio = Buffer.from('pipeline audio');
    const hash = createHash('sha256').update(audio).digest('hex');
    await call(`/api/audio/${hash}`, { method: 'PUT', body: audio, auth: 'pipeline' });
    const r = await call('/api/pipeline/episodes', { method: 'POST', auth: 'pipeline', json: { title: 'Ep 7', folder: 'Home Loan/Season 2', product: 'Home Loan', script: 'A: hi\nB: hello', subtitles: '1\n00:00:00,000 --> 00:00:01,000\nhi\n', audioHash: hash, externalId: 'wc-77' } });
    expect(r.status).toBe(201);
    const j = await r.json();
    id = j.projectId;
    expect(j.editorPath).toBe(`/#/p/${id}`);
    const p = await (await call(`/api/projects/${id}`)).json();
    expect(p.draft.dialogueHash).toBe(hash);
    expect(p.pipeline.autoEditPending).toBe(true);
    const folders = await (await call('/api/folders')).json();
    expect(folders.map((f: any) => f.name).sort()).toEqual(['Home Loan', 'Season 2']);
  });
  it('takes the final mix back and reports it to the pipeline', async () => {
    const mix = Buffer.from('final mp3 bytes');
    const hash = createHash('sha256').update(mix).digest('hex');
    await call(`/api/audio/${hash}`, { method: 'PUT', body: mix, headers: { 'Content-Type': 'audio/mpeg' } });
    const r = await call(`/api/projects/${id}/final`, { method: 'POST', json: { hash, filename: 'Ep 7.mp3' } });
    expect(r.status).toBe(200);
    const st = await (await call(`/api/pipeline/episodes/${id}`, { auth: 'pipeline' })).json();
    expect(st.status).toBe('final');
    expect(st.externalId).toBe('wc-77');
    expect(st.final.savedBy).toBe('Nishant');
    const f = await call(`/api/pipeline/episodes/${id}/final`, { auth: 'pipeline' });
    expect(Buffer.from(await f.arrayBuffer()).equals(mix)).toBe(true);
  });
});

describe('.env parser', () => {
  it('reads keys, quotes, comments and Windows line endings', async () => {
    const { parseEnv } = await import('../server/env');
    expect(parseEnv('﻿# c\r\nA=1\r\nB="two words"\r\nexport C=x # note\r\nD=\r\nE=\'s#q\'\r\n')).toEqual({ A: '1', B: 'two words', C: 'x', D: '', E: 's#q' });
  });
});

describe('Firestore limits', () => {
  let id = '';
  it('stores a long episode edit compressed and gives it back intact', async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => ({ speaker: i % 2 ? 'KARAN' : 'SHWETA', text: `Line ${i}: ` + 'home loan EMI tenure savings '.repeat(12), t0: i * 2, t1: i * 2 + 1.8 }));
    const big = doc({ scriptText: lines.map((l) => `${l.speaker}: ${l.text}`).join('\n'), lines });
    expect(JSON.stringify(big).length).toBeGreaterThan(1_000_000); // would not fit in one Firestore document uncompressed
    id = (await (await call('/api/projects', { method: 'POST', json: { name: 'Long ep', folderId: null, doc: big } })).json()).id;
    const v = await call(`/api/projects/${id}/versions`, { method: 'POST', json: { doc: big, note: 'long' } });
    expect(v.status).toBe(201);
    const p = await (await call(`/api/projects/${id}`)).json();
    expect(p.draft.lines.length).toBe(1500);
    expect(p.draft.scriptText).toBe(big.scriptText);
    const full = await (await call(`/api/versions/${encodeURIComponent(id + '_1')}`)).json();
    expect(full.doc.lines[1499].text).toBe(lines[1499].text);
  });
  it('refuses data Firestore cannot hold, with a clear message instead of a server error', async () => {
    const { assertStorable } = await import('../server/store');
    expect(() => assertStorable({ grid: [[1, 2]] })).toThrow(/list inside a list/);
    expect(() => assertStorable({ __name__: 1 })).toThrow(/field name/);
    expect(() => assertStorable({ s: 'x'.repeat(1_100_000) })).toThrow(/too large/);
    expect(() => assertStorable({ ok: [{ a: [1, 2] }], n: null })).not.toThrow();
  });
  it('keeps big pipeline subtitles compressed and returns them to the editor', async () => {
    const srt = Array.from({ length: 2500 }, (_, i) => `${i + 1}\n00:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')},000 --> 00:00:01,000\nSubtitle line number ${i} about savings\n`).join('\n');
    const r = await call('/api/pipeline/episodes', { method: 'POST', auth: 'pipeline', json: { title: 'Subs ep', script: 'A: hi', subtitles: srt } });
    expect(r.status).toBe(201);
    const p = await (await call(`/api/projects/${(await r.json()).projectId}`)).json();
    expect(p.pipeline.subtitles).toBe(srt);
  });
});
