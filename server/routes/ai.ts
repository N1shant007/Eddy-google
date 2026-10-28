import express, { type Request, type Response, type NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/* Gemini through @google/genai. Three ways to authenticate, all server-side only:
   - Vertex AI with the Cloud Run service account (no key): GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
   - Vertex AI express mode with an API key:                GEMINI_API_KEY
   - Gemini API (Google AI Studio key):                     GEMINI_API_KEY + GEMINI_BACKEND=gemini-api
   The key is read from the environment (.env locally, Secret Manager on Cloud Run) and never sent to browsers.
   Only signed-in team members can call it, up to AI_DAILY_LIMIT requests each per day. */

const SYSTEM = 'You are the sound designer for an AI-voice podcast editor. Follow the house guidelines exactly. Reply with JSON only, no prose.';
const MAX_PROMPT = 400_000;
const usage = new Map<string, { day: string; n: number }>();
let client: GoogleGenAI | null = null;

export const aiReady = () => config.aiEnabled && (!!config.geminiApiKey || !!config.project);
export const aiMode = () =>
  config.geminiBackend === 'gemini-api' ? 'Gemini API key' : config.geminiApiKey ? 'Vertex AI (API key)' : 'Vertex AI (service account)';
const gemini = () => (client ??= config.geminiBackend === 'gemini-api'
  ? new GoogleGenAI({ apiKey: config.geminiApiKey })
  : config.geminiApiKey
    ? new GoogleGenAI({ vertexai: true, apiKey: config.geminiApiKey })
    : new GoogleGenAI({ vertexai: true, project: config.project, location: config.location }));

/** replaceable in tests */
export let generate = async (prompt: string): Promise<string> => {
  const r = await gemini().models.generateContent({
    model: config.geminiModel,
    contents: prompt,
    config: { systemInstruction: SYSTEM, responseMimeType: 'application/json', temperature: 0.4 },
  });
  return r.text ?? '';
};
export const setGenerate = (fn: typeof generate) => { generate = fn; };

export function aiRoutes() {
  const r = express.Router();
  r.get('/ai', (_req, res) => {
    if (!aiReady()) return void res.status(404).json({ error: 'AI is not set up (GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT).' });
    res.json({ provider: 'gemini', model: config.geminiModel, mode: aiMode() }); // never the key itself
  });
  r.post('/ai', express.json({ limit: '1mb' }), (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      if (!aiReady()) return void res.status(503).json({ error: 'Gemini is not set up on the server yet. Use Rules or Copy-paste.' });
      const who = req.user?.name || 'anon', day = new Date().toISOString().slice(0, 10);
      const u = usage.get(who), n = u && u.day === day ? u.n : 0;
      if (n >= config.aiDailyLimit) return void res.status(429).json({ error: `Daily AI limit reached (${config.aiDailyLimit}). The rules engine still works.` });
      const prompt = String(req.body?.prompt || '');
      if (!prompt || prompt.length > MAX_PROMPT) return void res.status(400).json({ error: 'The prompt is empty or too long.' });
      usage.set(who, { day, n: n + 1 });
      try { res.json({ text: await generate(prompt) }); }
      catch (e: any) {
        const msg = redact(String(e?.message || e));
        console.error('Gemini error', msg);
        res.status(502).json({ error: `Gemini could not answer: ${msg}` });
      }
    })().catch(next);
  });
  return r;
}

/** never echo the key back, even inside a provider's error message */
const redact = (s: string) => (config.geminiApiKey ? s.split(config.geminiApiKey).join('[key]') : s).replace(/AIza[0-9A-Za-z_-]{35}/g, '[key]');
