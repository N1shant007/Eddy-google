import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* API tests against the real Express app with local storage (no Google Cloud needed). */

const dir = mkdtempSync(path.join(tmpdir(), 'eddy-test-'));
Object.assign(process.env, {
  EDDY_STORAGE: 'local', EDDY_DATA_DIR: dir, EDDY_PASSCODE: 'open-sesame', SESSION_SECRET: 'x'.repeat(40),
  PIPELINE_TOKEN: 'pipe-token-123', GOOGLE_CLOUD_PROJECT: 'test-project', ALLOWED_AUDIO_HOSTS: 'cdn.example.com',
});

let base = '', cookie = '', close: () => void = () => {};
const call = (p: string, init: RequestInit & { json?: unknown; auth?: 'cookie' | 'pipeline' | 'none' } = {}) => {
  const { json, auth = 'cookie', ...rest } = init;
  const headers: Record<string, string> = { ...(rest.headers as Record<string, string>) };
  if (json !== undefined) headers['Content-Type'] = 'application/json';
  if (auth === 'cookie' && cookie) headers.Cookie = cookie;
  if (auth === 'pipeline') headers.Authorization = 'Bearer pipe-token-123';
  return fetch(base + p, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
};
const doc = (extra: Record<string, unknown> = {}) => ({ schema: 2, product: '', scriptText: '', lines: [], dialogueHash: null, tracks: [], clips: [], cues: [], settings: {}, guidelineId: null, ...extra });

beforeAll(async () => {
  const { createApi } = await import('../server');
  const ai = await import('../server/routes/ai');
  ai.setGenerate(async (p) => JSON.stringify({ echo: p.length }));
  const srv = createApi().listen(0);
  await new Promise((r) => srv.once('listening', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  close = () => srv.close();
});
afterAll(() => close());

describe('passcode gate', () => {
  it('refuses the API without a session', async () => {
    expect((await call('/api/projects', { auth: 'none' })).status).toBe(401);
  });
  it('rejects a wrong passcode and accepts the right one', async () => {
    expect((await call('/api/session', { method: 'POST', json: { passcode: 'nope', name: 'A' }, auth: 'none' })).status).toBe(401);
    const r = await call('/api/session', { method: 'POST', json: { passcode: 'open-sesame', name: 'Nishant' }, auth: 'none' });
    expect(r.status).toBe(200);
    cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    expect(cookie).toMatch(/^eddy_session=/);
    expect(await (await call('/api/session')).json()).toEqual({ name: 'Nishant' });
  });
  it('rejects a tampered cookie', async () => {
    const bad = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const r = await fetch(base + '/api/projects', { headers: { Cookie: bad } });
    expect(r.status).toBe(401);
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

describe('Gemini', () => {
  it('reports the model and answers team members', async () => {
    expect(await (await call('/api/ai')).json()).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash' });
    expect(await (await call('/api/ai', { method: 'POST', json: { prompt: 'hello' } })).json()).toEqual({ text: '{"echo":5}' });
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
