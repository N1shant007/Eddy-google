import express, { type Request, type Response, type NextFunction } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

/* AI sound designer. Providers are switched on by environment variables only; keys never leave the server.
   - Gemini via @google/genai:
       Vertex AI with the Cloud Run service account (no key):  GOOGLE_CLOUD_PROJECT + GOOGLE_CLOUD_LOCATION
       Vertex AI express mode:                                  GEMINI_API_KEY
       Gemini API (Google AI Studio key):                       GEMINI_API_KEY + GEMINI_BACKEND=gemini-api
   - ChatGPT (OpenAI API):                                      OPENAI_API_KEY
   The editor lists the configured providers and their models; people pick one before Auto-edit.
   Only signed-in team members can call it, up to AI_DAILY_LIMIT requests each per day. */

const SYSTEM = 'You are the sound designer for an AI-voice podcast editor. Follow the house guidelines exactly. Reply with JSON only, no prose.';
const MAX_PROMPT = 400_000;
const usage = new Map<string, { day: string; n: number }>();

export type ProviderId = 'gemini' | 'openai';
export interface ProviderInfo { id: ProviderId; name: string; mode: string; models: string[]; defaultModel: string }

/* ---------- Gemini ---------- */
let geminiClient: GoogleGenAI | null = null;
const geminiReady = () => !!config.geminiApiKey || (!!config.project && config.vertexEnabled);
export const aiMode = () =>
  config.geminiBackend === 'gemini-api' ? 'Gemini API key' : config.geminiApiKey ? 'Vertex AI (API key)' : 'Vertex AI (service account)';
const gemini = () => (geminiClient ??= config.geminiBackend === 'gemini-api'
  ? new GoogleGenAI({ apiKey: config.geminiApiKey })
  : config.geminiApiKey
    ? new GoogleGenAI({ vertexai: true, apiKey: config.geminiApiKey })
    : new GoogleGenAI({ vertexai: true, project: config.project, location: config.location }));

async function callGemini(model: string, prompt: string) {
  const r = await gemini().models.generateContent({
    model, contents: prompt,
    config: { systemInstruction: SYSTEM, responseMimeType: 'application/json', temperature: 0.4 },
  });
  return r.text ?? '';
}

/* ---------- ChatGPT (OpenAI) ---------- */
const openaiReady = () => !!config.openaiApiKey;
let openaiModelCache: { at: number; models: string[] } | null = null;

/** chat models this key can use (live list, cached for an hour); OPENAI_MODELS overrides it */
async function openaiModels(): Promise<string[]> {
  if (config.openaiModels.length) return config.openaiModels;
  if (openaiModelCache && Date.now() - openaiModelCache.at < 3600_000) return openaiModelCache.models;
  try {
    const r = await fetch(`${config.openaiBaseUrl}/models`, { headers: { Authorization: `Bearer ${config.openaiApiKey}` } });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { data?: { id: string }[] };
    const ids = (j.data || []).map((m) => m.id)
      .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|codex)/.test(id))
      .sort();
    const models = ids.length ? ids : [config.openaiModel];
    openaiModelCache = { at: Date.now(), models };
    return models;
  } catch {
    return [config.openaiModel];
  }
}

async function callOpenAI(model: string, prompt: string) {
  const r = await fetch(`${config.openaiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.openaiApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }] }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `OpenAI error ${r.status}`);
  return j.choices?.[0]?.message?.content || '';
}

/* ---------- shared ---------- */
export async function providers(): Promise<ProviderInfo[]> {
  if (!config.aiEnabled) return [];
  const out: ProviderInfo[] = [];
  if (geminiReady()) {
    const models = [...new Set([config.geminiModel, ...config.geminiModels])];
    out.push({ id: 'gemini', name: 'Gemini', mode: aiMode(), models, defaultModel: config.geminiModel });
  }
  if (openaiReady()) {
    const models = await openaiModels();
    out.push({ id: 'openai', name: 'ChatGPT', mode: 'OpenAI API key', models, defaultModel: models.includes(config.openaiModel) ? config.openaiModel : models[0] });
  }
  return out;
}
export const aiReady = () => config.aiEnabled && (geminiReady() || openaiReady());

/** replaceable in tests */
export let generate = async (provider: ProviderId, model: string, prompt: string): Promise<string> =>
  provider === 'openai' ? callOpenAI(model, prompt) : callGemini(model, prompt);
export const setGenerate = (fn: typeof generate) => { generate = fn; };

/** never echo a key back, even inside a provider's error message */
const redact = (s: string) => {
  for (const k of [config.geminiApiKey, config.openaiApiKey]) if (k) s = s.split(k).join('[key]');
  return s.replace(/AIza[0-9A-Za-z_-]{35}/g, '[key]').replace(/sk-[A-Za-z0-9_-]{20,}/g, '[key]');
};

export function aiRoutes() {
  const r = express.Router();
  r.get('/ai', (_req, res, next) => {
    providers().then((list) => {
      if (!list.length) return void res.status(404).json({ error: 'No AI is set up (GEMINI_API_KEY, GOOGLE_CLOUD_PROJECT or OPENAI_API_KEY).' });
      res.json({ providers: list }); // names and models only, never keys
    }).catch(next);
  });
  r.post('/ai', express.json({ limit: '1mb' }), (req: Request, res: Response, next: NextFunction) => {
    (async () => {
      const list = await providers();
      if (!list.length) return void res.status(503).json({ error: 'No AI is set up on the server yet. Use Rules or Copy-paste.' });
      const p = list.find((x) => x.id === req.body?.provider) || list[0];
      const model = String(req.body?.model || p.defaultModel);
      if (!p.models.includes(model)) return void res.status(400).json({ error: `${p.name} model “${model}” is not enabled on this server.` });
      const who = req.user?.name || 'anon', day = new Date().toISOString().slice(0, 10);
      const u = usage.get(who), n = u && u.day === day ? u.n : 0;
      if (n >= config.aiDailyLimit) return void res.status(429).json({ error: `Daily AI limit reached (${config.aiDailyLimit}). The rules engine still works.` });
      const prompt = String(req.body?.prompt || '');
      if (!prompt || prompt.length > MAX_PROMPT) return void res.status(400).json({ error: 'The prompt is empty or too long.' });
      usage.set(who, { day, n: n + 1 });
      try { res.json({ text: await generate(p.id, model, prompt), provider: p.id, model }); }
      catch (e: any) {
        const msg = redact(String(e?.message || e));
        console.error(`${p.name} error`, msg);
        res.status(502).json({ error: `${p.name} could not answer: ${msg}` });
      }
    })().catch(next);
  });
  return r;
}
