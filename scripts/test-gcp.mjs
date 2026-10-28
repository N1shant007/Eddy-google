/* Runs the API tests against Firestore + Cloud Storage emulators (EDDY_STORAGE=gcp), so the Google Cloud code
   paths are tested without a GCP project. Needs: pip install gcp-storage-emulator
   Usage: npm run test:gcp            (fresh emulators, then vitest)
          npm run test:gcp -- --serve (keep the emulators running and print the env to use with npm run dev) */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { FirestoreServer } from '@firestore-emulator/server';

const freePort = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const waitFor = async (url, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if ((await fetch(url)).ok) return; } catch { /* not yet */ } await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('Cloud Storage emulator did not start. Install it with: pip install gcp-storage-emulator');
};

const fsPort = await freePort(), gcsPort = await freePort();
const firestore = new FirestoreServer();
await firestore.start(fsPort);
const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const gcs = spawn(py, ['-m', 'gcp_storage_emulator', 'start', '--host=127.0.0.1', `--port=${gcsPort}`, '--in-memory', '--default-bucket=eddy-test'], { stdio: ['ignore', 'ignore', 'inherit'] });
const stop = () => { gcs.kill(); firestore.stop?.(); };
process.on('exit', stop);
await waitFor(`http://127.0.0.1:${gcsPort}/storage/v1/b`);

const env = {
  ...process.env, EDDY_TEST_STORAGE: 'gcp', EDDY_STORAGE: 'gcp', EDDY_BUCKET: 'eddy-test', GOOGLE_CLOUD_PROJECT: 'eddy-emulator',
  FIRESTORE_EMULATOR_HOST: `127.0.0.1:${fsPort}`, STORAGE_EMULATOR_HOST: `http://127.0.0.1:${gcsPort}`,
};
if (process.argv.includes('--serve')) {
  console.log(`Emulators running. In another terminal:\n  FIRESTORE_EMULATOR_HOST=${env.FIRESTORE_EMULATOR_HOST} STORAGE_EMULATOR_HOST=${env.STORAGE_EMULATOR_HOST} EDDY_STORAGE=gcp EDDY_BUCKET=eddy-test GOOGLE_CLOUD_PROJECT=eddy-emulator npm run dev`);
} else {
  const args = process.argv.slice(2).filter((a) => a !== '--serve');
  const t = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...(args.length ? args : ['test/server.test.ts'])], { env, stdio: 'inherit' });
  t.on('exit', (code) => { stop(); process.exit(code ?? 1); });
}
