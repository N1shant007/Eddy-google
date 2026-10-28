import express, { type Request, type Response, type NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/* Gemini on Vertex AI, using the Cloud Run service account (no API key).
   Only signed-in team members can call it, up to AI_DAILY_LIMIT requests each per day. */

const SYSTEM = 'You are the sound designer for an AI-voice podcast editor. Follow the house guidelines exactly. Reply with JSON only, no prose.';
const MAX_PROMPT = 400_000;
const usage = new Map<string, { day: string; n: number }>();
let client: GoogleGenAI | null = null;

export const aiReady = () => config.aiEnabled && !!config.project;
const gemini = () => (client ??= new GoogleGenAI({ vertexai: true, project: config.project, location: config.location }));

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
    if (!aiReady()) return void res.status(404).json({ error: 'AI is not set up (GOOGLE_CLOUD_PROJECT).' });
    res.json({ provider: 'gemini', model: config.geminiModel });
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
      catch (e: any) { console.error('Gemini error', e?.message); res.status(502).json({ error: `Gemini could not answer: ${e?.message || e}` }); }
    })().catch(next);
  });
  return r;
}
