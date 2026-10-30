import type { Cue, ScriptLine } from './types';
import {
  ACK_RE, BENEFIT_RE, BRAND_RE, CAUTION_NOT, CAUTION_RE, CTA_RE, GUEST_RE, INSIGHT_MOOD, INSIGHT_RE, INTEREST_RE,
  MOOD_MAP, NO_COST_RE, NUMBER_RE, PRODUCT_RE, QUESTION_RE, SAVINGS_RE, TAKEAWAY_RE, VALUE_RE,
} from './patterns';
import { cueId } from './script';

/* Bajaj storytelling rules, ported from Eddy v1 (v64). */

export function hostNames(lines: ScriptLine[], hostsSetting: string): Set<string> {
  const set = String(hostsSetting || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (set.length) return new Set(set);
  const order: string[] = [];
  for (const l of lines) { if (!order.includes(l.speaker)) order.push(l.speaker); if (order.length >= 2) break; }
  return new Set(order);
}

/** lines where a Bajaj product is introduced: the first mention of each product, by anyone */
export function productIntroLines(lines: ScriptLine[]): Set<number> {
  const seen = new Set<string>(), out = new Set<number>();
  lines.forEach((l, i) => {
    const re = new RegExp(PRODUCT_RE.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(l.text || ''))) { const k = m[1].toLowerCase().replace(/s$/, ''); if (!seen.has(k)) { seen.add(k); out.add(i); } }
  });
  return out;
}

export type Mood = 'product' | 'cta' | 'curiosity' | 'story-play' | 'story-rewrite' | 'guest-product' | 'guest';

/** which background music each line gets */
export function lineMoods(lines: ScriptLine[], hosts: Set<string>): Mood[] {
  const pIntro = productIntroLines(lines);
  const N = lines.length;
  let guestProduct = false;
  const out: Mood[] = [];
  let lastGuest = -1;
  lines.forEach((l, i) => { if (!hosts.has(l.speaker)) lastGuest = i; });
  const firstGuest = lines.findIndex((l) => !hosts.has(l.speaker));
  let cta = -1;
  for (let i = Math.max(lastGuest + 1, Math.floor(N * 0.6)); i < N; i++) if (hosts.has(lines[i].speaker) && (CTA_RE.test(lines[i].text || '') || BRAND_RE.test(lines[i].text || ''))) { cta = i; break; }
  if (cta < 0) for (let i = N - 1; i >= Math.floor(N * 0.75); i--) { if (hosts.has(lines[i].speaker) && (CTA_RE.test(lines[i].text || '') || BRAND_RE.test(lines[i].text || ''))) cta = i; else if (cta >= 0) break; }
  if (cta < 0 && lastGuest >= 0 && lastGuest < N - 1 && lastGuest >= N * 0.6) cta = lastGuest + 1;
  lines.forEach((l, i) => {
    const t = (l.text || '').trim(), host = hosts.has(l.speaker);
    if (pIntro.has(i)) { out.push('product'); if (!host) guestProduct = true; return; }
    const isQ = /\?\s*['"”]?\s*$/.test(t) || (QUESTION_RE.test(t) && /^[A-Zऀ-ॿ]/.test(t) && !/[.!]\s*$/.test(t)) ||
      (/\b(but|lekin|par|doubt|confus|samajh nahi)\b/i.test(t) && /\?|\bhow\b|kitna|kaise|\bkya\b|doubt|\bwhat\b|\bwhich\b/i.test(t));
    let m: Mood;
    if (host && cta >= 0 && i >= cta) m = 'cta';
    else if (isQ) m = 'curiosity';
    else if (host && (firstGuest < 0 || i < firstGuest) && i <= 3) m = 'story-rewrite';
    else if (host ? VALUE_RE.test(t) || INSIGHT_RE.test(t) || SAVINGS_RE.test(t) || INSIGHT_MOOD.test(l.mood || '') : INSIGHT_RE.test(t) || INSIGHT_MOOD.test(l.mood || '')) m = 'story-play';
    else if (host) m = 'story-rewrite';
    else if (!guestProduct && PRODUCT_RE.test(t)) { m = 'guest-product'; guestProduct = true; }
    else m = 'guest';
    out.push(m);
  });
  for (let i = 1; i < N - 1; i++) if (out[i] === 'story-rewrite' && out[i - 1] === 'story-play' && out[i + 1] === 'story-play') out[i] = 'story-play';
  for (let i = 1; i < N; i++) if (out[i] === 'story-rewrite' && out[i - 1] === 'story-play' && lines[i].speaker === lines[i - 1].speaker && (lines[i].text || '').length < 45) out[i] = 'story-play';
  return out;
}

export const MOOD_INFO: Record<Mood, { gain: number; why: string; sound: string; fallback: string; afterIntro?: boolean; ctaIntro?: boolean }> = {
  'story-rewrite': { gain: -14, why: 'Hosts talking', sound: 'story rewrite', fallback: 'story play|storytelling', afterIntro: true },
  'story-play': { gain: -14, why: 'Valuable information (any speaker)', sound: 'story play', fallback: 'story rewrite|storytelling' },
  product: { gain: -14, why: 'Bajaj product introduced: story play (mandatory)', sound: 'story play', fallback: 'storytelling' },
  'guest-product': { gain: -14, why: 'Guest brings up the product for the first time', sound: 'story play', fallback: 'story rewrite|storytelling' },
  curiosity: { gain: -13, why: 'A question or doubt (any speaker)', sound: 'unfolding insights', fallback: 'curious|curiosity' },
  guest: { gain: -14, why: 'Guest shares their situation', sound: 'guest warm acoustic', fallback: 'guest' },
  cta: { gain: -10, why: 'Call to action: the intro music again, lightly', sound: '1bfl intro track', fallback: 'intro', ctaIntro: true },
};

const t = (lines: ScriptLine[], i: number) => lines[i].t0 ?? i * 10;

function fracAfterWelcome(text: string, m: RegExpMatchArray) {
  const w = /welcome[^.!?]*[.!?]?/i.exec(text);
  if (w) return Math.min(0.999, (w.index + w[0].length) / Math.max(1, text.length));
  let end = (m.index || 0) + m[0].length;
  const p = text.slice(end).search(/[.!?।]/);
  end = p >= 0 ? end + p + 1 : text.length;
  return Math.min(0.999, end / Math.max(1, text.length));
}
function fracAfter(text: string, m: RegExpMatchArray) {
  let end = (m.index || 0) + m[0].length;
  const p = text.slice(end).search(/[.,!?;।]/);
  if (p >= 0 && p < 25) end += p + 1;
  return end / Math.max(1, text.length);
}

const mk = (o: Partial<Cue>): Cue => ({ id: cueId(), on: true, type: 'sfx', sound: '', line: 0, position: 'after', source: 'rule', ...o });

/** Coin Chime is the only sound effect the auto-edit uses (script [SFX: …] tags written by hand still play) */
export const ONLY_SFX = /coin\s*chime/i;
const COIN_GAIN = -6;
const COIN_GAP = 12;

/** Sound effects: Coin Chime only.
    - after EVERY line that mentions low interest rates (mandatory, always plays)
    - after lines stating a clear money benefit (no hidden or prepayment charges, low EMI, no pressure on the budget,
      no financial strain, savings), at least 12 s from any other Coin Chime
    Each chime sits in the gap after the line, never on a key word, at -6 dB. */
export function withAccents(lines: ScriptLine[], _hosts: Set<string>, cues: Cue[]): Cue[] {
  if (!lines.length) return cues;
  // other sound effects from the rules or an AI cue sheet are not allowed (hand-written script tags stay)
  const out = cues.filter((c) => !((c.type === 'sfx' || c.type === 'emotion' || c.type === 'transition') && c.source !== 'tag' && !ONLY_SFX.test(c.sound || '')));
  const coinAt: number[] = [];
  const chime = (i: number, reason: string, must: boolean) => {
    for (let j = out.length - 1; j >= 0; j--) { const c = out[j]; if (c.source !== 'tag' && ONLY_SFX.test(c.sound || '') && c.line === i) out.splice(j, 1); }
    out.push(mk({ sound: 'coin chime', line: i, position: 'after', gainDb: COIN_GAIN, must, reason }));
    coinAt.push(t(lines, i));
  };
  // low interest rates: always
  lines.forEach((l, i) => {
    const m = (l.text || '').match(INTEREST_RE);
    if (m) chime(i, `Low interest rate: “${m[0].trim()}”`, true);
  });
  // money benefits: at least 12 s from any Coin Chime
  lines.forEach((l, i) => {
    if (out.some((c) => c.line === i && ONLY_SFX.test(c.sound || '') && c.source !== 'tag')) return;
    const m = (l.text || '').match(BENEFIT_RE);
    if (!m) return;
    const at = t(lines, i);
    if (coinAt.some((x) => Math.abs(x - at) < COIN_GAP)) return;
    chime(i, `Money benefit: “${m[0].trim()}”`, false);
  });
  return out;
}

/** light caution music under warnings about taxes, fines, penalties, charges */
export function withCaution(lines: ScriptLine[], cues: Cue[]): Cue[] {
  if (!lines.length) return cues;
  const pI = productIntroLines(lines);
  const hits = lines.map((l, i) => { const m = (l.text || '').match(CAUTION_RE); return m && !CAUTION_NOT.test(l.text) && !NO_COST_RE.test(l.text) && !pI.has(i) ? { i, m: m[0] } : null; }).filter(Boolean) as { i: number; m: string }[];
  if (!hits.length) return cues;
  const groups: { a: number; b: number; why: string[] }[] = [];
  for (const h of hits) { const g = groups[groups.length - 1]; if (g && h.i - g.b <= 1) { g.b = h.i; g.why.push(h.m); } else groups.push({ a: h.i, b: h.i, why: [h.m] }); }
  let out = [...cues];
  for (const g of groups) {
    if (out.some((c) => c.on !== false && (c.type === 'bed' || c.type === 'positioning') && /caution/i.test(c.sound || '') && c.line <= g.b && (c.endLine ?? c.line) >= g.a)) continue;
    out = out.flatMap((c) => {
      if (c.on === false || !(c.type === 'bed' || c.type === 'positioning')) return [c];
      const a = c.line, b = c.endLine ?? c.line;
      if (b < g.a || a > g.b) return [c];
      if (a < g.a) return [{ ...c, endLine: g.a - 1 }];
      if (b > g.b) return [{ ...c, line: g.b + 1 }];
      return [];
    });
    out = out.filter((c) => !(c.type === 'sfx' && c.source !== 'tag' && !c.must && c.line >= g.a && c.line <= g.b));
    out.push(mk({ type: 'bed', sound: 'caution', line: g.a, endLine: g.b, position: 'under', gainDb: -15, reason: `Caution: “${g.why[0]}”` }));
  }
  return out;
}

/** storytelling beds for every line not already covered by a bed */
export function withMoodBeds(lines: ScriptLine[], hosts: Set<string>, cues: Cue[]): Cue[] {
  if (!lines.length) return cues;
  let out = cues.filter((c) => !(c.source === 'rule' && c.type === 'bed' && !/caution/i.test(c.sound || '')));
  for (const i of productIntroLines(lines)) out = out.flatMap((c) => {
    if (c.on === false || !(c.type === 'bed' || c.type === 'positioning')) return [c];
    const a = c.line, b = c.endLine ?? c.line;
    if (i < a || i > b) return [c];
    const r: Cue[] = [];
    if (a < i) r.push({ ...c, endLine: i - 1 });
    if (b > i) r.push({ ...c, id: a < i ? cueId() : c.id, line: i + 1, endLine: b });
    return r;
  });
  const covered = new Set<number>();
  for (const c of out) if (c.on !== false && (c.type === 'bed' || c.type === 'positioning')) for (let i = c.line; i <= (c.endLine ?? c.line); i++) covered.add(i);
  const moods = lineMoods(lines, hosts);
  const runs: { m: Mood; a: number; b: number }[] = [];
  lines.forEach((_, i) => { if (covered.has(i)) return; const m = moods[i]; const r = runs[runs.length - 1]; if (r && r.m === m && r.b === i - 1) r.b = i; else runs.push({ m, a: i, b: i }); });
  for (const r of runs) if (r.m === 'curiosity') out = out.filter((c) => !(c.source === 'rule' && c.type === 'emotion' && c.sound === 'question' && c.line >= r.a && c.line <= r.b));
  for (const r of runs) {
    const info = MOOD_INFO[r.m];
    out.push(mk({ type: 'bed', sound: info.sound, fallback: info.fallback, afterIntro: !!info.afterIntro, ctaIntro: !!info.ctaIntro, line: r.a, endLine: r.b, position: 'under', gainDb: info.gain, reason: info.why }));
  }
  return out;
}

/** light extras from speaker moods, used when the script has few tags */
export function enrichCues(lines: ScriptLine[], cues: Cue[]): Cue[] {
  const substantive = cues.filter((c) => !['intro', 'outro'].includes(c.type)).length;
  if (substantive >= 3 || !lines.length) return cues;
  const taken = new Set(cues.map((c) => c.line));
  const extra: Cue[] = [];
  let lastT = -1e9;
  for (let i = 1; i < lines.length - 1; i++) {
    const l = lines[i];
    if (!l.mood || taken.has(i)) continue;
    const hit = MOOD_MAP.find(([re]) => re.test(l.mood!));
    if (!hit) continue;
    const tt = t(lines, i);
    if (tt - lastT < 20) continue;
    extra.push(mk({ type: hit[2], sound: hit[1], line: i, position: hit[3], reason: `Speaker is ${l.mood.split(',')[0].trim()}` }));
    taken.add(i); lastT = tt;
  }
  return [...cues, ...extra];
}

/** the full rules chain: script tags → mood extras → accents → caution → storytelling beds */
export function ruleCues(lines: ScriptLine[], hosts: Set<string>, tagCues: Cue[]): Cue[] {
  return withMoodBeds(lines, hosts, withCaution(lines, withAccents(lines, hosts, enrichCues(lines, tagCues))));
}
