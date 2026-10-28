import { api } from './api';

/* Gemini on Vertex AI, through the Eddy server (the service account; no API keys in the browser). */

let status: Promise<{ provider: string; model: string } | null> | null = null;

/** which AI the server has set up, or null */
export function teamAI() {
  return (status ??= api<{ provider: string; model: string }>('/ai').catch(() => null));
}

export async function askTeamAI(prompt: string): Promise<string> {
  const j = await api<{ text: string }>('/ai', { method: 'POST', json: { prompt } });
  return j.text || '';
}

export const PROVIDER_NAME: Record<string, string> = { gemini: 'Gemini', anthropic: 'Claude', openai: 'ChatGPT' };
