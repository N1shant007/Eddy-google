/*
 * Eddy v3 server: one container for Cloud Run.
 *   /api/session            team passcode gate
 *   /api/folders, /projects, /versions, /categories, /assets, /guidelines   data (Firestore)
 *   /api/audio, /api/uploads                                                 audio (Cloud Storage)
 *   /api/ai                                                                  Gemini on Vertex AI
 *   /api/pipeline/*, /api/projects/:id/final                                 hand-off with the pipeline
 * Everything else serves the React app (Vite middleware in development, ./dist in production).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { checkConfig, config } from './server/config.js';
import { requireUser, sessionRoutes } from './server/auth.js';
import { makeStore, type Store } from './server/store.js';
import { makeBlobs, type Blobs } from './server/blobs.js';
import { dataRoutes, errorHandler } from './server/routes/data.js';
import { audioRoutes } from './server/routes/audio.js';
import { aiRoutes, aiReady } from './server/routes/ai.js';
import { pipelineRoutes } from './server/routes/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApi(store: Store = makeStore(), blobs: Blobs = makeBlobs()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ ok: true, storage: config.storage, ai: aiReady() }));
  app.use('/api', sessionRoutes());
  app.use('/api', requireUser, dataRoutes(store), audioRoutes(blobs), aiRoutes(), pipelineRoutes(store, blobs));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}

async function main() {
  for (const p of checkConfig()) console.warn('[eddy] ' + p);
  const app = createApi();
  // the API's error handler sits before the UI on purpose; UI routes below
  const root = config.production ? path.resolve(here, '..') : here;
  if (config.production) {
    const dist = path.join(root, 'dist');
    app.use(express.static(dist, { index: false, maxAge: '1y', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.listen(config.port, () => console.log(`[eddy] listening on :${config.port} (${config.production ? 'production' : 'development'}, storage: ${config.storage}, AI: ${aiReady() ? config.geminiModel : 'off'})`));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
