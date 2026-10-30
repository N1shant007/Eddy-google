/*
 * Eddy v3 server: one container for Cloud Run.
 *   /api/session, /api/users, /api/me   sign-in and user accounts (admin manages users)
 *   /api/folders, /projects, /versions, /categories, /assets, /guidelines   data (Firestore)
 *   /api/audio, /api/uploads                                                 audio (Cloud Storage)
 *   /api/ai                                                                  Gemini on Vertex AI
 *   /api/pipeline/*, /api/projects/:id/final                                 hand-off with the pipeline
 * Everything else serves the React app (Vite middleware in development, ./dist in production).
 */
import './server/env.js'; // first: loads .env before config is read
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { checkConfig, config } from './server/config.js';
import { ensureAdmin, requireUser, sessionRoutes } from './server/auth.js';
import { userRoutes } from './server/routes/users.js';
import { makeStore, type Store } from './server/store.js';
import { makeBlobs, type Blobs } from './server/blobs.js';
import { dataRoutes, errorHandler } from './server/routes/data.js';
import { audioRoutes } from './server/routes/audio.js';
import { aiMode, aiRoutes, aiReady, transcribeRoutes } from './server/routes/ai.js';
import { pipelineRoutes } from './server/routes/pipeline.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApi(store: Store = makeStore(), blobs: Blobs = makeBlobs()) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops); // real client address for the passcode limiter
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  // Cloud Run reserves some paths ending in "z" (like /healthz), so /api/health is the one to use there
  const health = (_req: express.Request, res: express.Response) => res.json({ ok: true, storage: config.storage, ai: aiReady() });
  app.get('/healthz', health);
  app.get('/api/health', health);
  app.use('/api', sessionRoutes(store));
  app.use('/api', requireUser(store), userRoutes(store), dataRoutes(store), audioRoutes(blobs), aiRoutes(), transcribeRoutes(blobs), pipelineRoutes(store, blobs));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}

async function main() {
  for (const p of checkConfig()) console.warn('[eddy] ' + p);
  const store = makeStore();
  const app = createApi(store);
  await ensureAdmin(store).catch((e) => console.warn('[eddy] could not create the admin account yet:', e?.message || e));
  // the API's error handler sits before the UI on purpose; UI routes below
  const root = config.production ? path.resolve(here, '..') : here;
  if (config.production) {
    const dist = path.join(root, 'dist');
    app.use(express.static(dist, { index: false, maxAge: '1y', setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
    // a missing file (anything with an extension, e.g. an old /assets/*.js) is a 404, not the app page
    app.get(/^(?!\/api\/).*/, (req, res) => {
      if (/\.[a-z0-9]+$/i.test(req.path)) return void res.status(404).type('text').send('Not found');
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.listen(config.port, () => console.log(`[eddy] listening on :${config.port} (${config.production ? 'production' : 'development'}, storage: ${config.storage}, AI: ${aiReady() ? [config.project || config.geminiApiKey ? `Gemini via ${aiMode()}` : '', config.openaiApiKey ? 'ChatGPT' : ''].filter(Boolean).join(' + ') : 'off'})`));
}

// run when started directly (Windows paths compare case-insensitively)
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(fileURLToPath(import.meta.url), path.resolve(process.argv[1]))) main();
