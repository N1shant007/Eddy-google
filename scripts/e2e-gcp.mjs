/* Full-stack check in Google Cloud mode without a GCP project:
   fresh Firestore + Cloud Storage emulators → production build of Eddy → browser test (test/e2e/gcp-e2e.mjs).
   Needs: npm run build, pip install gcp-storage-emulator, Playwright with Chromium.
   Usage: npm run e2e:gcp            (APP_DIR=folder to test another build, AUDIO=episode.wav, SHOTS=folder for screenshots) */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { FirestoreServer } from '@firestore-emulator/server';

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const waitFor = async (url, what, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`${what} did not start`);
};
const APP_DIR = process.env.APP_DIR || '.'; // e.g. a folder laid out like the container image
if (!existsSync(path.join(APP_DIR, 'dist-server/server.js'))) throw new Error('Run npm run build first.');

const work = mkdtempSync(path.join(tmpdir(), 'eddy-e2e-'));
const [fsPort, gcsPort, appPort] = [await freePort(), await freePort(), await freePort()];
const firestore = new FirestoreServer();
await firestore.start(fsPort);
const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const kids = [spawn(py, ['-m', 'gcp_storage_emulator', 'start', '--host=127.0.0.1', `--port=${gcsPort}`, '--in-memory', '--default-bucket=eddy-e2e'], { stdio: 'ignore' })];
await waitFor(`http://127.0.0.1:${gcsPort}/storage/v1/b`, 'Cloud Storage emulator (pip install gcp-storage-emulator)');

const ADMIN_PASSWORD = 'e2e-' + randomBytes(9).toString('hex'), PIPELINE_TOKEN = randomBytes(24).toString('hex');
const app = spawn(process.execPath, ['dist-server/server.js', '--production'], {
  cwd: APP_DIR,
  env: { ...process.env, NODE_ENV: 'production', PORT: String(appPort), EDDY_STORAGE: 'gcp', EDDY_BUCKET: 'eddy-e2e', GOOGLE_CLOUD_PROJECT: 'eddy-emulator', EDDY_AI: 'off',
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${fsPort}`, STORAGE_EMULATOR_HOST: `http://127.0.0.1:${gcsPort}`,
    ADMIN_PASSWORD, SESSION_SECRET: randomBytes(32).toString('hex'), PIPELINE_TOKEN },
  stdio: ['ignore', 'inherit', 'inherit'],
});
kids.push(app);
const stop = () => { for (const k of kids) k.kill(); firestore.stop?.(); };
process.on('exit', stop);
await waitFor(`http://localhost:${appPort}/api/health`, 'Eddy');

const t = spawn(process.execPath, ['test/e2e/gcp-e2e.mjs'], {
  env: { ...process.env, BASE: `http://localhost:${appPort}`, ADMIN_PASSWORD, PIPELINE_TOKEN, SHOTS: process.env.SHOTS || work },
  stdio: 'inherit',
});
t.on('exit', (code) => { console.log(`Screenshots: ${process.env.SHOTS || work}`); stop(); process.exit(code ?? 1); });
