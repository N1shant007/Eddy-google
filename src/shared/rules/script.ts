import type { Asset, Category, Cue, CueType, ScriptLine } from './types';
import { VOICE_TAGS } from './patterns';

export const r2 = (x: number) => Math.round(x * 100) / 100;
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
let n = 0;
export const cueId = () => 'q_' + (++n).toString(36) + Math.random().toString(36).slice(2, 7);

export interface Tag { raw: string; line?: number; prev: number; pos?: 'before' | 'after'; inline: boolean }
export interface Parsed { lines: ScriptLine[]; tags: Tag[] }

/** "NAME (mood): text [SFX: whoosh]" lines → spoken lines + editing tags */
export function parseScript(text: string): Parsed {
  const lines: ScriptLine[] = [], tags: Tag[] = [];
  const tagRe = /[\[\{]\s*([^\]\}]{1,60}?)\s*[\]\}]/g;
  const speakerRe = /^\**\s*([A-Za-zÀ-ɏ][\w .'\-À-ɏ]{0,28}?)\s*(?:\(([^)]{0,40})\))?\s*\**\s*:\s*(.+)$/;
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.trim();
    if (!raw) continue;
    const only = raw.match(/^[\[\{]{1,2}\s*([^\]\}]+?)\s*[\]\}]{1,2}$/);
    if (only) { tags.push({ raw: only[1], prev: lines.length - 1, inline: false }); continue; }
    const m = raw.match(speakerRe);
    if (m && !/^(note|scene|music|sfx|title|episode)$/i.test(m[1].trim())) {
      const body = m[3];
      const mood = (m[2] || '').toLowerCase();
      const inl: { raw: string; pos: 'before' | 'after' }[] = [];
      let mm: RegExpExecArray | null;
      tagRe.lastIndex = 0;
      while ((mm = tagRe.exec(body))) inl.push({ raw: mm[1], pos: mm.index < body.length * 0.35 ? 'before' : 'after' });
      const clean = body.replace(tagRe, ' ').replace(/\s+/g, ' ').trim();
      const idx = lines.length;
      lines.push({ speaker: m[1].trim().toUpperCase(), mood, text: clean, t0: null, t1: null });
      for (const x of inl) tags.push({ raw: x.raw, line: idx, prev: idx - 1, pos: x.pos, inline: true });
    } else if (lines.length && !/^[#=\-—]/.test(raw) && !/^[A-Z0-9 \-—:]+$/.test(raw)) {
      lines[lines.length - 1].text += ' ' + raw.replace(tagRe, ' ').trim();
    }
  }
  return { lines, tags };
}

interface TagClass { type: CueType | '*'; sound: string; edge?: 'start' | 'end' }

/** [BGM: Happy START] / [SFX: Whoosh] / [MUSIC: Product END] → the user's categories and sound names */
function classifyLibraryTag(t: string, cats: Category[], assets: Asset[]): TagClass | null {
  const m = t.match(/^(bgm|music|sfx|fx|sound)\s*[:\-]\s*(.+)$/);
  if (!m) return null;
  const isBgm = /bgm|music/.test(m[1]), end = /\b(end|stop|out|fade out)\b/.test(m[2]);
  const rest = m[2].replace(/\b(start|begin|in|end|stop|out|fade out)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const musicRoles = ['intro', 'outro', 'bed', 'positioning'];
  const pool = cats.filter((c) => (isBgm ? musicRoles.includes(c.role) : !musicRoles.includes(c.role))).sort((a, b) => b.name.length - a.name.length);
  const uc = pool.find((c) => rest.includes(c.name.toLowerCase()));
  const asset = !uc && rest ? assets.find((a) => a.name.toLowerCase() === rest) : undefined;
  const role = uc?.role || asset?.role || (isBgm ? (rest ? 'bed' : null) : 'sfx');
  if (isBgm && !role) return { type: '*', edge: end ? 'end' : 'start', sound: '' };
  if (role === 'intro' || role === 'outro') return { type: role, sound: rest || role };
  if (role === 'positioning' || role === 'bed') return { type: role, sound: rest || role, edge: end ? 'end' : 'start' };
  return { type: (role as CueType) || 'sfx', sound: rest || 'whoosh' };
}

export function classifyTag(raw: string, cats: Category[] = [], assets: Asset[] = []): TagClass | null {
  const t = raw.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (VOICE_TAGS.test(t)) return null;
  const lib = classifyLibraryTag(t, cats, assets);
  if (lib) return lib;
  const after = (t.split(':')[1] || '').trim();
  const end = /\b(end|stop|out|off|fade out)\b/.test(t) && !/^outro/.test(t);
  if (/\bintro\b/.test(t)) return { type: 'intro', sound: after || 'intro' };
  if (/\boutro\b|closing music|end music|end theme/.test(t)) return { type: 'outro', sound: after || 'outro' };
  if (/position|product|brand|sponsor|feel.?good/.test(t)) return { type: 'positioning', sound: after || 'positioning', edge: end ? 'end' : 'start' };
  if (/\bbgm\b|\bbed\b|background music|underscore/.test(t)) return { type: 'bed', sound: after || 'bed', edge: end ? 'end' : 'start' };
  if (/transition|sting|segment|riser/.test(t)) return { type: 'transition', sound: after || (t.includes('sting') ? 'stinger' : 'riser') };
  const emo = 'laugh|funny|joke|surprise|wow|excite|sad|serious|tension|suspense|aha|insight|realiz|applause|celebrat|win|shock';
  if (/emotion|mood/.test(t) || new RegExp('^(' + emo + ')').test(t)) return { type: 'emotion', sound: after || t.replace(/emotion|mood|:/g, '').trim() };
  if (/\bsfx\b|\bfx\b|sound|effect|whoosh|swoosh|ding|pop|click|impact|boom|bell|notification/.test(t)) return { type: 'sfx', sound: after || t.replace(/\bsfx\b|sound effect|sound|effect/g, '').trim() || 'whoosh' };
  return null;
}

/** script tags → cues; adds intro and outro when the script has none */
export function cuesFromTags(p: Parsed, cats: Category[] = [], assets: Asset[] = []): Cue[] {
  const { lines, tags } = p, N = lines.length, cues: Cue[] = [];
  const open: Record<string, Cue> = {};
  const mk = (o: Partial<Cue>): Cue => ({ id: cueId(), on: true, type: 'sfx', sound: '', line: 0, position: 'before', source: 'tag', ...o });
  for (const tg of tags) {
    const c = classifyTag(tg.raw, cats, assets);
    if (!c) continue;
    if (c.type === 'sfx' && /\b(music|bgm|theme|melody|tune)\b/.test(c.sound)) {
      const last = cues[cues.length - 1];
      if (last && (last.type === 'intro' || last.type === 'outro')) { last.sound = (last.sound + ' ' + c.sound.replace(/\b(fades?|out|gently|in)\b/g, ' ')).replace(/\s+/g, ' ').trim(); last.reason += ` + [${tg.raw}]`; }
      continue;
    }
    if (c.type === 'intro') { cues.push(mk({ type: 'intro', sound: c.sound, line: 0, position: 'before', reason: `Script tag [${tg.raw}]` })); continue; }
    if (c.type === 'outro') { cues.push(mk({ type: 'outro', sound: c.sound, line: Math.max(0, N - 1), position: 'after', reason: `Script tag [${tg.raw}]` })); continue; }
    if (c.type === 'positioning' || c.type === 'bed' || c.type === '*') {
      const at = tg.inline ? tg.line! : c.edge === 'end' ? tg.prev : tg.prev + 1;
      if (c.edge === 'end') {
        const key = open[c.type] ? c.type : Object.keys(open).pop();
        const o = key && open[key];
        if (o) { o.endLine = Math.max(o.line, Math.min(N - 1, at)); delete open[key!]; }
      } else if (c.type !== '*') {
        const cue = mk({ type: c.type, sound: c.sound, line: clamp(at, 0, N - 1), endLine: clamp(at, 0, N - 1), position: 'under', reason: `Script tag [${tg.raw}]` });
        cues.push(cue); open[c.type] = cue;
      }
      continue;
    }
    let line: number, pos: Cue['position'];
    if (tg.inline) { line = tg.line!; pos = tg.pos!; } else if (tg.prev + 1 < N) { line = tg.prev + 1; pos = 'before'; } else { line = Math.max(0, tg.prev); pos = 'after'; }
    cues.push(mk({ type: c.type as CueType, sound: c.sound, line, position: pos, reason: `Script tag [${tg.raw}]` }));
  }
  for (const k in open) { open[k].endLine = Math.min(N - 1, open[k].line + 2); open[k].reason += ' (no END tag; ran 3 lines)'; }
  if (N && !cues.some((c) => c.type === 'intro')) cues.unshift(mk({ type: 'intro', sound: 'intro', line: 0, position: 'before', source: 'rule', reason: 'Every episode opens on intro music' }));
  if (N && !cues.some((c) => c.type === 'outro')) cues.push(mk({ type: 'outro', sound: 'outro', line: N - 1, position: 'after', source: 'rule', reason: 'Outro plays out the episode' }));
  return cues;
}

/* ============ timing ============ */
/** Lines onto detected speech: prefers long pauses close to the expected (text-length based) boundaries. */
export function alignLines(lines: ScriptLine[], segs: [number, number][], dur: number) {
  const N = lines.length;
  if (!N) return;
  if (!segs.length) segs = [[0, dur]];
  const s0 = segs[0][0], s1 = segs[segs.length - 1][1], span = Math.max(0.5, s1 - s0);
  const w = lines.map((l) => l.text.length + 12), W = w.reduce((a, b) => a + b, 0);
  const exp: number[] = [];
  let acc = 0;
  for (let i = 0; i < N - 1; i++) { acc += w[i]; exp.push(s0 + span * acc / W); }
  const pauses: { a: number; b: number; len: number }[] = [];
  for (let i = 1; i < segs.length; i++) pauses.push({ a: segs[i - 1][1], b: segs[i][0], len: segs[i][0] - segs[i - 1][1] });
  const K = N - 1, M = pauses.length, bounds: { a: number; b: number }[] = [];
  if (K > 0 && M >= K) {
    const scale = span / N, INF = 1e18;
    const cost = (k: number, j: number) => { const mid = (pauses[j].a + pauses[j].b) / 2, d = (mid - exp[k]) / scale; return d * d * 1.2 - 1.4 * Math.log(1 + pauses[j].len / 0.25); };
    let prev = new Float64Array(M).fill(INF);
    const back: (Int32Array | null)[] = [];
    for (let j = 0; j < M; j++) prev[j] = cost(0, j);
    back.push(null);
    for (let k = 1; k < K; k++) {
      const cur = new Float64Array(M).fill(INF), bk = new Int32Array(M).fill(-1);
      let best = INF, bj = -1;
      for (let j = 0; j < M; j++) { if (j > 0 && prev[j - 1] < best) { best = prev[j - 1]; bj = j - 1; } if (bj >= 0) { cur[j] = best + cost(k, j); bk[j] = bj; } }
      prev = cur; back.push(bk);
    }
    let j = -1, best = INF;
    for (let x = 0; x < M; x++) if (prev[x] < best) { best = prev[x]; j = x; }
    const pick: number[] = new Array(K);
    for (let k = K - 1; k >= 0; k--) { pick[k] = j; j = k > 0 ? back[k]![j] : -1; }
    for (const p of pick) bounds.push(pauses[p]);
  } else for (const e of exp) bounds.push({ a: e - 0.1, b: e + 0.1 });
  for (let i = 0; i < N; i++) { lines[i].t0 = r2(i === 0 ? s0 : bounds[i - 1].b); lines[i].t1 = r2(i === N - 1 ? s1 : bounds[i].a); }
}

export interface TimedBlock { t0: number; t1: number; text: string }

/** .srt / .vtt subtitles */
export function parseSubs(txt: string): TimedBlock[] {
  const out: TimedBlock[] = [], s = txt.replace(/\r/g, '') + '\n\n';
  const re = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})[^\n]*\n([\s\S]*?)\n\s*\n/g;
  const ts = (h: string, m: string, x: string, ms: string) => +(h || 0) * 3600 + +m * 60 + +x + +String(ms).padEnd(3, '0') / 1000;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push({ t0: ts(m[1], m[2], m[3], m[4]), t1: ts(m[5], m[6], m[7], m[8]), text: m[9].replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim() });
  return out;
}

/** ElevenLabs alignment JSON, or Whisper-style segments/words */
export function parseAlignJson(o: any): TimedBlock[] {
  const al = o?.alignment || o?.normalized_alignment || o;
  if (al && Array.isArray(al.characters) && Array.isArray(al.character_start_times_seconds)) {
    const blocks: { t0: number | null; t1: number; text: string }[] = [];
    let cur: { t0: number | null; t1: number; text: string } = { t0: null, t1: 0, text: '' };
    for (let i = 0; i < al.characters.length; i++) {
      const ch = al.characters[i], t0 = al.character_start_times_seconds[i], t1 = al.character_end_times_seconds?.[i] ?? t0;
      if (cur.t0 == null && ch.trim()) cur.t0 = t0;
      if (cur.t0 != null && ch.trim() && t0 - cur.t1 > 0.35 && cur.text.trim()) { blocks.push(cur); cur = { t0, t1, text: '' }; }
      cur.text += ch;
      if (ch.trim()) cur.t1 = t1;
      if (/[.?!]/.test(ch) && cur.text.trim().length > 12) { blocks.push(cur); cur = { t0: null, t1, text: '' }; }
    }
    if (cur.text.trim()) blocks.push(cur);
    return blocks.filter((b) => b.t0 != null) as TimedBlock[];
  }
  const arr = Array.isArray(o) ? o : o?.segments || o?.chunks || o?.words || o?.results;
  if (Array.isArray(arr)) return arr.map((x: any) => ({ t0: +(x.start ?? x.start_time ?? x.startTime ?? x.timestamp?.[0]), t1: +(x.end ?? x.end_time ?? x.endTime ?? x.timestamp?.[1]), text: String(x.text ?? x.word ?? x.transcript ?? '') })).filter((b: TimedBlock) => isFinite(b.t0) && isFinite(b.t1));
  return [];
}

const wordsOf = (s: string) => String(s).toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/^[a-z][\w .'-]{0,28}:\s*/, '').match(/[a-z0-9'ऀ-ॿ]+/g) || [];
export const normLine = (t: string) => String(t || '').toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, ' ').trim();

/** Gives script lines exact timings from subtitle blocks (matched by words). Returns how many lines matched. */
export function applyTimings(lines: ScriptLine[], blocks: TimedBlock[]): number {
  let j = 0, matched = 0;
  const cov = (bw: string[], set: Set<string>) => (bw.length ? bw.filter((w) => set.has(w)).length / bw.length : 0);
  lines.forEach((l, i) => {
    const lw = new Set(wordsOf(l.text));
    let first = -1;
    for (let k = j; k < Math.min(blocks.length, j + 10); k++) if (cov(wordsOf(blocks[k].text), lw) >= 0.6) { first = k; break; }
    if (first < 0) return;
    let last = first;
    const nl = lines[i + 1], nw = nl ? new Set(wordsOf(nl.text)) : new Set<string>();
    while (last + 1 < blocks.length) { const bw = wordsOf(blocks[last + 1].text), c = cov(bw, lw); if (c >= 0.6 && c >= cov(bw, nw)) last++; else break; }
    l.t0 = r2(blocks[first].t0); l.t1 = r2(blocks[last].t1); l.exact = true; j = last + 1; matched++;
  });
  return matched;
}

/** Subtitles with no script: each block becomes a line ("NAME: text" keeps the speaker). */
export function linesFromBlocks(blocks: TimedBlock[]): ScriptLine[] {
  return blocks.map((b) => {
    const m = b.text.match(/^([A-Za-z][\w .'-]{0,28}):\s*(.+)$/);
    return { speaker: m ? m[1].trim().toUpperCase() : 'SPEAKER', text: m ? m[2] : b.text, t0: r2(b.t0), t1: r2(b.t1), exact: true };
  });
}

/** keeps subtitle timings when the script is re-parsed */
export function keepExact(oldLines: ScriptLine[], lines: ScriptLine[]) {
  const keep = oldLines.filter((l) => l.exact && l.t0 != null).map((l) => ({ k: normLine(l.text), t0: l.t0, t1: l.t1 }));
  if (!keep.length) return;
  let j = 0;
  for (const l of lines) {
    const k = normLine(l.text);
    for (let x = j; x < Math.min(keep.length, j + 6); x++) if (keep[x].k === k) { l.t0 = keep[x].t0; l.t1 = keep[x].t1; l.exact = true; j = x + 1; break; }
  }
}

export function guessProduct(txt: string, products: string[]): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const t = norm(txt);
  let best = '', n = 0;
  for (const p of products) { const k = norm(p); if (!k) continue; const c = t.split(k).length - 1; if (c > n) { n = c; best = p; } }
  return best;
}
