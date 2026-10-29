/* Eddy in Google Cloud mode on your own PC, without a Google Cloud project.
   Starts the Firestore and Cloud Storage emulators, then the production build of Eddy with EDDY_STORAGE=gcp,
   so it uses exactly the same Firestore and Cloud Storage code as on Cloud Run.

   Data is kept between runs in .data-gcp/ (git-ignored):
     firestore.json      Firestore documents (saved every 15 s and when you stop Eddy)
     .cloudstorage/      Cloud Storage objects (audio, uploads, exports)
   Settings and secrets come from .env as usual (ADMIN_PASSWORD, SESSION_SECRET, GEMINI_API_KEY, OPENAI_API_KEY...).

   Needs: Node 20+, Python 3 with `pip install gcp-storage-emulator` (installed automatically), npm run build.
   Usage: npm run local:gcp            (PORT=8080, opens the browser)
          npm run local:gcp -- --fresh (start with empty Firestore and Cloud Storage) */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const DATA = path.join(root, '.data-gcp');
const FS_FILE = path.join(DATA, 'firestore.json');
const PROJECT = 'eddy-local', BUCKET = 'eddy-local';
const PORT = Number(process.env.PORT || 8080), FS_PORT = 8181, GCS_PORT = 9023;
const say = (m) => console.log(`[eddy-gcp-local] ${m}`);
const die = (m) => { console.error(`\n[eddy-gcp-local] ${m}\n`); process.exit(1); };

if (process.argv.includes('--fresh')) { rmSync(DATA, { recursive: true, force: true }); say('starting fresh: removed .data-gcp'); }
mkdirSync(DATA, { recursive: true });
if (!existsSync('dist-server/server.js') || !existsSync('dist/index.html')) die('Build Eddy first: npm run build');

const portFree = (port) => new Promise((ok) => { const s = net.createServer().once('error', () => ok(false)).listen(port, '127.0.0.1', () => s.close(() => ok(true))); });
for (const [p, what] of [[PORT, 'Eddy'], [FS_PORT, 'the Firestore emulator'], [GCS_PORT, 'the Cloud Storage emulator']]) {
  if (!(await portFree(p))) die(`Port ${p} (for ${what}) is busy. Close the other Eddy window (or whatever uses it) and try again.`);
}

/* ---------- Python + Cloud Storage emulator ---------- */
function findPython() {
  const home = os.homedir();
  const candidates = [process.env.PYTHON, 'python', 'python3', 'py',
    path.join(home, 'anaconda3', 'python.exe'), path.join(home, 'miniconda3', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe')].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', shell: false });
    if (r.status === 0 && r.stdout.trim() === '3') return c;
  }
  return null;
}
const py = findPython();
if (!py) die('Python 3 was not found. Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and run this again.');
if (spawnSync(py, ['-c', 'import gcp_storage_emulator'], { encoding: 'utf8' }).status !== 0) {
  say('installing the Cloud Storage emulator (pip install gcp-storage-emulator)...');
  const r = spawnSync(py, ['-m', 'pip', 'install', '--disable-pip-version-check', 'gcp-storage-emulator'], { stdio: 'inherit' });
  if (r.status !== 0) die('Could not install gcp-storage-emulator with pip.');
}
const kids = [];
const gcs = spawn(py, ['-m', 'gcp_storage_emulator', '-d', DATA, 'start', '--host=127.0.0.1', `--port=${GCS_PORT}`, `--default-bucket=${BUCKET}`], { stdio: ['ignore', 'ignore', 'pipe'] });
kids.push(gcs);
let gcsErr = '';
gcs.stderr.on('data', (d) => { gcsErr = (gcsErr + d).slice(-2000); });
const waitFor = async (url, what, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 300)); }
  die(`${what} did not start.\n${gcsErr.split('\n').filter((l) => !/HTTP\/1\.1"/.test(l)).slice(-8).join('\n')}`);
};
await waitFor(`http://127.0.0.1:${GCS_PORT}/storage/v1/b`, 'The Cloud Storage emulator');
say(`Cloud Storage emulator on 127.0.0.1:${GCS_PORT} (bucket ${BUCKET})`);

/* ---------- Firestore emulator, with save/restore ---------- */
const { FirestoreServer } = await import('@firestore-emulator/server');
const firestore = new FirestoreServer();
await firestore.start(FS_PORT);
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FS_PORT}`;
const { Firestore } = await import('@google-cloud/firestore');
const db = new Firestore({ projectId: PROJECT });
// Eddy's collections (the emulator cannot list collections)
const COLLECTIONS = ['folders', 'projects', 'versions', 'categories', 'assets', 'guidelines', 'users'].map((c) => 'eddy_' + c);

async function restore() {
  if (!existsSync(FS_FILE)) return 0;
  const data = JSON.parse(readFileSync(FS_FILE, 'utf8'));
  let n = 0;
  for (const [col, docs] of Object.entries(data)) {
    const ids = Object.keys(docs);
    for (let i = 0; i < ids.length; i += 400) {
      const b = db.batch();
      for (const id of ids.slice(i, i + 400)) { b.set(db.collection(col).doc(id), docs[id]); n++; }
      await b.commit();
    }
  }
  return n;
}
let lastSaved = '';
async function save() {
  const out = {};
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    if (snap.empty) continue;
    out[name] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
  }
  const text = JSON.stringify(out);
  if (text === lastSaved) return;
  writeFileSync(FS_FILE + '.tmp', text);
  renameSync(FS_FILE + '.tmp', FS_FILE);
  lastSaved = text;
}
const restored = await restore();
lastSaved = existsSync(FS_FILE) ? readFileSync(FS_FILE, 'utf8') : '';
say(`Firestore emulator on 127.0.0.1:${FS_PORT}${restored ? ` (restored ${restored} documents)` : ' (empty)'}`);
const timer = setInterval(() => save().catch((e) => say(`could not save Firestore: ${e.message}`)), 15_000);

/* ---------- Eddy ---------- */
const app = spawn(process.execPath, ['dist-server/server.js', '--production'], {
  env: {
    ...process.env, NODE_ENV: 'production', PORT: String(PORT),
    EDDY_STORAGE: 'gcp', EDDY_BUCKET: BUCKET, GOOGLE_CLOUD_PROJECT: PROJECT, FIRESTORE_DATABASE: '(default)', FIRESTORE_PREFIX: 'eddy_',
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${FS_PORT}`, STORAGE_EMULATOR_HOST: `http://127.0.0.1:${GCS_PORT}`,
    GEMINI_VERTEX: 'off', // no service account on a PC: Gemini needs GEMINI_API_KEY in .env here
  },
  stdio: 'inherit',
});
kids.push(app);
await waitFor(`http://localhost:${PORT}/api/health`, 'Eddy');
const url = `http://localhost:${PORT}`;
say(`Eddy (Google Cloud mode) is running: ${url}`);
say('Sign in as admin with ADMIN_PASSWORD from .env. Keep this window open; press Ctrl+C to stop (data is saved).');
if (!process.argv.includes('--no-open')) {
  const open = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(open[0], open[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  say('saving Firestore and stopping...');
  await save().catch((e) => say(`could not save Firestore: ${e.message}`));
  for (const k of kids) { try { k.kill(); } catch { /* gone */ } }
  try { firestore.stop(); } catch { /* gone */ }
  process.exit(code);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, () => void stop(0));
app.on('exit', (code) => { if (!stopping) { say(`Eddy stopped (code ${code}).`); void stop(code ?? 1); } });
gcs.on('exit', (code) => { if (!stopping) { say(`The Cloud Storage emulator stopped (code ${code}).`); void stop(1); } });
