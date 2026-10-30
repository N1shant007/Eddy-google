/* One self-contained HTML file of the browser-only (demo) build: npm run build:single → dist-single/Eddy.html.
   Everything runs in the browser (projects in IndexedDB, starter library embedded); no server needed. */
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config';

// the MP3 encoder worker can't load from a separate file next to a single HTML file: inline it
const inlineWorker: Plugin = {
  name: 'eddy-inline-mp3-worker',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/src/audio/engine.ts')) return;
    const from = "new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' })";
    if (!code.includes(from)) throw new Error('engine.ts: worker line changed; update vite.single.config.ts');
    return "import EddyMp3Worker from './mp3.worker.ts?worker&inline';\n" + code.replace(from, 'new EddyMp3Worker()');
  },
};

export default defineConfig((env) => {
  const c: any = (base as any)({ ...env, mode: 'demo' });
  return {
    ...c,
    mode: 'demo',
    plugins: [inlineWorker, ...c.plugins, viteSingleFile()],
    build: { ...c.build, outDir: 'dist-single', sourcemap: false, rollupOptions: {} },
    worker: { format: 'iife' },
  };
});
