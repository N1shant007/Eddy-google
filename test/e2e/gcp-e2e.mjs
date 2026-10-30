/* End-to-end check of a running Eddy (production build) in a real browser.
   BASE=https://<your Cloud Run URL> ADMIN_PASSWORD=… PIPELINE_TOKEN=… npm run e2e:remote   (AUDIO=episode.wav optional)
   Signs in, waits for the starter library, creates a folder and project, uploads a >8 MB episode (multi-part),
   runs the rules auto-edit, saves a version, saves the final mix, checks history after a reload, and tests the
   pipeline hand-off (episode in → auto-edit on open), then deletes its test folder. Exits non-zero on any failure.
   Safe against the live service: everything it creates lives in one "E2E test <time>" folder. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright'); // installed globally or as a dev dependency

const BASE = process.env.BASE || 'http://localhost:8090';
const ADMIN = process.env.ADMIN_USER || 'admin', PASS = process.env.ADMIN_PASSWORD || process.env.PASSCODE, PIPE = process.env.PIPELINE_TOKEN, SHOTS = process.env.SHOTS || '.';
if (!PASS || !PIPE) { console.error('Set ADMIN_PASSWORD and PIPELINE_TOKEN (and BASE for a deployed Eddy).'); process.exit(2); }
/* a throw-away editor account the test creates through the Users page and removes at the end */
const TESTER = `e2e-${Date.now().toString(36)}`, TESTER_PW = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
/* test episode: 150 s of speech-like bursts, 26 MB WAV (so it uploads in 4 parts) */
const AUDIO = process.env.AUDIO || (() => {
  const rate = 44100, secs = 150, n = rate * secs, data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const t = i / rate, on = t % 3.6 < 3;
    const v = on ? Math.round(0.3 * Math.sin(2 * Math.PI * (180 + 40 * Math.sin(2 * Math.PI * 3 * t)) * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 5 * t)) * 32767) : 0;
    data.writeInt16LE(v, i * 4); data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  const f = path.join(mkdtempSync(path.join(tmpdir(), 'eddy-e2e-')), 'E2E episode.wav');
  writeFileSync(f, Buffer.concat([h, data]));
  return f;
})();
const ROOT = `E2E test ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`; // own folder, deleted at the end
const SCRIPT = [
  'SHWETA: Welcome to Money Matters by Bajaj. Today we talk about home loans for your parents.',
  'KARAN: Thanks Shweta. Many families ask how to plan a home loan with a lower interest rate.',
  'SHWETA: So what should a first-time buyer check before applying?',
  'KARAN: Look at the tenure, the EMI and your savings. A small change in interest saves a lot.',
  'SHWETA: That is a big relief for many of us.',
  'KARAN: Exactly. Compare offers and read the terms carefully.',
  'SHWETA: Before we wrap up, what is one thing listeners should do today?',
  'KARAN: Check your eligibility online and talk to an advisor.',
  'SHWETA: To know more, visit the Bajaj app and apply for a home loan today.',
  'KARAN: Thank you for listening.',
].join('\n');

const log = (...a) => console.log('•', ...a);
const fail = (m) => { console.error('✗', m); process.exitCode = 1; throw new Error(m); };
const errors = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const external = [];
page.on('requestfailed', (r) => { if (!r.url().startsWith(BASE)) external.push(r.url()); });
page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|404)|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY/.test(m.text())) errors.push('console: ' + m.text()); });
page.on('dialog', (d) => d.dismiss());
const api = (p, init) => page.evaluate(async ([p, init]) => { const r = await fetch(p, init); return { status: r.status, body: await r.json().catch(() => null) }; }, [p, init]);
const pipe = async (p, init = {}) => { const r = await fetch(BASE + p, { ...init, headers: { Authorization: `Bearer ${PIPE}`, ...(init.headers || {}) } }); return { status: r.status, body: await r.json().catch(() => null) }; };
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

try {
  /* 0. health and static files */
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  if (!h.ok) fail('health check failed');
  for (const p of ['/assets/missing.js', '/assets/index.js.map']) if ((await fetch(BASE + p)).status !== 404) fail(`${p} should be 404`);
  log(`health ok (storage: ${h.storage}, AI: ${h.ai ? 'on' : 'off'}); missing files and source maps return 404`);

  /* 1. sign in as admin, add an editor on the Users page, sign in as that editor */
  const signIn = async (u, pw) => {
    await page.fill('#si-user', u);
    await page.fill('#si-pass', pw);
    await page.getByRole('button', { name: 'Sign in' }).click();
  };
  await page.goto(BASE);
  await signIn(ADMIN, 'wrong-password');
  await page.getByText(/not right/i).waitFor({ timeout: 10000 });
  log('wrong password refused');
  await signIn(ADMIN, PASS);
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: /Add user/ }).click();
  await page.fill('#nu-user', TESTER);
  await page.fill('#nu-name', 'E2E Tester');
  await page.fill('#nu-pass', TESTER_PW);
  await page.locator('.modal button[type=submit]').click();
  await page.getByText(TESTER, { exact: true }).waitFor({ timeout: 10000 });
  log(`admin signed in and added the editor "${TESTER}" on the Users page`);
  await shot('0-users-page');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#si-pass').waitFor();
  await signIn(TESTER, TESTER_PW);
  await page.getByRole('button', { name: /New project/ }).first().waitFor({ timeout: 15000 });
  if (await page.getByRole('button', { name: 'Users', exact: true }).count()) fail('an editor sees the Users page');
  if ((await api('/api/users')).status !== 403) fail('an editor can list users');
  log('editor signed in; no Users page and no access to /api/users');

  /* 2. starter library imports itself */
  let assets = 0;
  for (let i = 0; i < 120 && assets < 24; i++) { assets = (await api('/api/assets')).body?.length || 0; if (assets < 24) await page.waitForTimeout(1000); }
  if (assets < 24) fail(`starter library: ${assets}/24 sounds`);
  const cats = (await api('/api/categories')).body.length, gls = (await api('/api/guidelines')).body.length;
  log(`starter library in Firestore + Cloud Storage: ${assets} sounds, ${cats} categories, ${gls} guidelines`);

  /* 3. folder + project */
  await page.getByRole('button', { name: /New folder/ }).first().click();
  await page.locator('.modal input').fill(ROOT);
  await page.locator('.modal button[type=submit]').click();
  await page.getByText(ROOT).first().dblclick();
  await page.getByRole('button', { name: /New project/ }).first().click();
  await page.locator('.modal input').fill('E2E episode');
  await page.locator('.modal button[type=submit]').click();
  await page.getByRole('button', { name: /Import episode audio/ }).waitFor({ timeout: 15000 });
  const projectId = decodeURIComponent((page.url().match(/#\/p\/(.+)$/) || [])[1] || '');
  if (!projectId) fail('editor did not open the new project');
  const meta = (await api(`/api/projects/${projectId}`)).body;
  const folder = (await api('/api/folders')).body.find((f) => f.name === ROOT);
  if (meta.folderId !== folder?.id) fail('project not inside the folder');
  log('folder and project created; editor open');

  /* 4. upload a 26 MB episode (4 parts) */
  const buf = readFileSync(AUDIO), hash = createHash('sha256').update(buf).digest('hex');
  await page.locator('input[type=file][accept^="audio"]').setInputFiles(AUDIO);
  let head = 404;
  for (let i = 0; i < 90 && head !== 200; i++) { head = (await page.evaluate((h) => fetch('/api/audio/' + h, { method: 'HEAD' }).then((r) => r.status), hash)); if (head !== 200) await page.waitForTimeout(1000); }
  if (head !== 200) fail('episode audio did not reach Cloud Storage');
  await page.getByRole('button', { name: /Replace audio/ }).waitFor({ timeout: 60000 }); // the editor has the audio
  const range = await page.evaluate(async (h) => { const r = await fetch('/api/audio/' + h, { headers: { Range: 'bytes=0-3' } }); return [r.status, await r.text()]; }, hash);
  if (range[0] !== 206 || range[1] !== 'RIFF') fail('range read of episode audio failed');
  log(`episode uploaded in ${Math.ceil(buf.length / 8388608)} parts, verified by SHA-256, streams with ranges`);

  /* 5. rules auto-edit */
  // with Gemini on the server, the import dialog transcribes and auto-edits first: wait until it closes
  await page.locator('.overlay').waitFor({ state: 'detached', timeout: 300000 });
  await page.locator('textarea').first().fill(SCRIPT);
  await page.getByRole('radio', { name: /Rules/ }).click();
  await page.locator('button.btn.primary', { hasText: /^\s*Auto-edit( again)?\s*$/ }).click();
  await page.getByText(/sounds placed/).waitFor({ timeout: 60000 });
  const report = await page.getByText(/sounds placed/).first().innerText();
  log('auto-edit:', report.replace(/\s+/g, ' '));
  await page.waitForTimeout(2500); // autosave
  await shot('1-editor-after-auto-edit');

  /* 6. save version */
  await page.getByRole('button', { name: /^Save version$/ }).click();
  await page.locator('.modal input').fill('E2E first cut');
  await page.locator('.modal button[type=submit]').click();
  let versions = [];
  for (let i = 0; i < 20 && !versions.length; i++) { versions = (await api(`/api/projects/${projectId}/versions`)).body || []; if (!versions.length) await page.waitForTimeout(500); }
  if (versions[0]?.note !== 'E2E first cut' || versions[0]?.createdBy !== 'E2E Tester') fail('version not saved: ' + JSON.stringify(versions));
  const saved = (await api(`/api/projects/${projectId}`)).body.draft;
  if (!saved.clips.length || !saved.cues.length || saved.dialogueHash !== hash) fail('draft in Firestore is missing the edit');
  log(`version 1 saved; Firestore draft has ${saved.clips.length} clips and ${saved.cues.length} cues`);

  /* 7. save final mix (renders MP3 in the browser, uploads, stores under exports/) */
  await page.getByRole('button', { name: /Save final mix/ }).click();
  let st = null;
  for (let i = 0; i < 180 && st?.status !== 'final'; i++) { st = (await pipe(`/api/pipeline/episodes/${projectId}`)).body; if (st?.status !== 'final') await page.waitForTimeout(1000); }
  if (st?.status !== 'final') fail('final mix was not saved');
  const mp3 = await fetch(`${BASE}/api/pipeline/episodes/${projectId}/final`, { headers: { Authorization: `Bearer ${PIPE}` } });
  const mp3buf = Buffer.from(await mp3.arrayBuffer());
  if (mp3.status !== 200 || mp3buf.length < 100_000) fail(`final mix download: ${mp3.status}, ${mp3buf.length} bytes`);
  log(`final mix saved by ${st.final.savedBy}: ${st.final.uri} (${(mp3buf.length / 1048576).toFixed(1)} MB MP3)`);

  /* 8. reload: everything comes back from Firestore */
  await page.reload();
  await page.getByRole('button', { name: /Replace audio/ }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: /History/ }).click();
  await page.getByText('E2E first cut').waitFor({ timeout: 10000 });
  await shot('2-history-after-reload');
  log('after reload: project, audio and version history load from Firestore');

  /* 9. pipeline hand-off: episode in → auto-edit on first open */
  const srt = '1\n00:00:00,000 --> 00:00:05,000\nWelcome to Money Matters by Bajaj.\n\n2\n00:00:07,200 --> 00:00:12,000\nThanks Shweta.\n';
  const ep = await pipe('/api/pipeline/episodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Pipeline ep', folder: `${ROOT}/Season 1`, product: 'Home Loan', script: SCRIPT, subtitles: srt, audioHash: hash, externalId: 'wc-e2e' }) });
  if (ep.status !== 201) fail('pipeline create: ' + JSON.stringify(ep));
  await page.goto(`${BASE}${ep.body.editorPath}`);
  let pd = null;
  for (let i = 0; i < 60 && !(pd?.draft?.clips?.length && pd?.pipeline?.autoEditPending === false); i++) { await page.waitForTimeout(1000); pd = (await api(`/api/projects/${ep.body.projectId}`)).body; }
  if (!pd?.draft?.clips?.length || pd.pipeline.autoEditPending !== false) fail('pipeline episode was not auto-edited on open');
  const exact = pd.draft.lines.filter((l) => l.exact).length;
  log(`pipeline episode auto-edited on open: ${pd.draft.clips.length} clips, ${exact} lines timed by subtitles, folder "${ROOT}/Season 1"`);
  await shot('3-pipeline-episode');

  /* 10. clean up: deleting the test folder deletes its sub-folders, projects and versions */
  if (process.env.KEEP !== '1') {
    const del = await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
    const left = (await api('/api/projects')).body.filter((p) => p.id === projectId || p.id === ep.body.projectId);
    if (del.status !== 200 || left.length) fail('clean-up did not remove the test projects');
    log(`removed the "${ROOT}" folder and its projects (set KEEP=1 to keep them)`);
  }

  /* 11. sign out; admin removes the test editor, who can then no longer sign in */
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#si-pass').waitFor();
  if ((await api('/api/projects')).status !== 401) fail('still signed in after sign out');
  await signIn(ADMIN, PASS);
  await page.getByRole('button', { name: 'Users', exact: true }).click();
  await page.locator('tr', { hasText: TESTER }).getByRole('button', { name: 'Remove' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Delete' }).click();
  await page.getByText(TESTER, { exact: true }).waitFor({ state: 'detached', timeout: 10000 });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#si-pass').waitFor();
  const gone = await api('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: TESTER, password: TESTER_PW }) });
  if (gone.status !== 401) fail('a removed user can still sign in');
  log('signed out; admin removed the test editor, who can no longer sign in');
} catch (e) {
  await shot('failure').catch(() => {});
  if (!process.exitCode) { console.error('✗', e.message); process.exitCode = 1; }
} finally {
  if (external.length) console.log('(outside requests that failed, e.g. fonts blocked on this test machine: ' + [...new Set(external)].join(', ') + ')');
  if (errors.length) { console.error('Browser errors:\n  ' + [...new Set(errors)].join('\n  ')); process.exitCode = 1; }
  await browser.close();
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E PASSED');
}
