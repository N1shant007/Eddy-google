import { useEffect, useState } from 'react';
import { api } from './api';

/* AI through the Eddy server (keys stay on the server). The server lists which providers are set up
   (Gemini, ChatGPT) and their models; the person picks one, remembered in this browser. */

export interface AiProvider { id: string; name: string; mode: string; models: string[]; defaultModel: string }
export interface AiChoice { provider: string; model: string }

let status: Promise<AiProvider[]> | null = null;
export function aiProviders() {
  return (status ??= api<{ providers: AiProvider[] }>('/ai').then((r) => r.providers || []).catch(() => []));
}

const KEY = 'eddy.ai';
const listeners = new Set<(c: AiChoice | null) => void>();
function readChoice(): AiChoice | null {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export function setAiChoice(c: AiChoice) {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* ignore */ }
  listeners.forEach((f) => f(c));
}
/** a valid choice for the providers on offer: the saved one, else the first provider's default model */
export function resolveChoice(list: AiProvider[], saved: AiChoice | null): AiChoice | null {
  const p = list.find((x) => x.id === saved?.provider) || list[0];
  if (!p) return null;
  return { provider: p.id, model: saved && saved.provider === p.id && p.models.includes(saved.model) ? saved.model : p.defaultModel };
}

/** providers + the current choice, kept in sync across panels */
export function useAi() {
  const [list, setList] = useState<AiProvider[] | null>(null);
  const [saved, setSaved] = useState<AiChoice | null>(readChoice);
  useEffect(() => { aiProviders().then(setList); listeners.add(setSaved); return () => { listeners.delete(setSaved); }; }, []);
  const choice = list ? resolveChoice(list, saved) : null;
  const provider = list?.find((p) => p.id === choice?.provider) || null;
  return { list, choice, provider, label: provider && choice ? `${provider.name} · ${choice.model}` : '' };
}

export async function askAI(prompt: string, choice: AiChoice): Promise<string> {
  const j = await api<{ text: string }>('/ai', { method: 'POST', json: { prompt, provider: choice.provider, model: choice.model } });
  return j.text || '';
}
