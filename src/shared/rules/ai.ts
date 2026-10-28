import type { Asset, Category, Clip, Cue, CueType, ProjectDoc } from './types';
import { clamp, cueId, r2 } from './script';
import { kindForRole, lineTimes, newId, trackFor } from './place';

/* Prompts for an AI sound designer, and safe ways to apply what it sends back. Ported from Eddy v1. */

const CUE_TYPES: CueType[] = ['intro', 'outro', 'positioning', 'bed', 'transition', 'sfx', 'emotion'];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function libraryForPrompt(assets: Asset[], cats: Category[]) {
  const lib = assets.filter((a) => a.role !== 'dialogue');
  return `Categories:\n${cats.map((c) => `- ${c.name} (placed as ${c.role})`).join('\n')}\n` +
    `Sounds (id | name | category | role | length | tags):\n` +
    lib.map((a) => `- ${a.hash.slice(0, 12)} | ${a.name} | ${cats.find((c) => c.id === a.categoryId)?.name || ''} | ${a.role} | ${a.dur.toFixed(1)}s | ${a.tags.join(', ')}`).join('\n');
}

/** script with numbered spoken lines and their timing; editor tags and headings unnumbered */
function scriptForPrompt(doc: ProjectDoc) {
  const lt = lineTimes(doc);
  if (!doc.scriptText.trim()) return doc.lines.map((l, i) => `L${i} | ${l.speaker}: ${l.text}`).join('\n');
  const speakerRe = /^\**\s*([A-Za-zÀ-ɏ][\w .'\-À-ɏ]{0,28}?)\s*(?:\(([^)]{0,40})\))?\s*\**\s*:\s*(.+)$/;
  const out: string[] = [];
  let li = 0;
  for (let raw of doc.scriptText.split(/\r?\n/)) {
    raw = raw.trim();
    if (!raw) continue;
    const m = raw.match(speakerRe);
    const isLine = !!m && !/^(note|scene|music|sfx|title|episode)$/i.test(m[1].trim()) && !/^[\[\{]/.test(raw) && li < doc.lines.length;
    if (isLine) {
      const L = lt[li], nx = lt[li + 1];
      const tm = L ? ` | ${fmt(L.s)}–${fmt(L.e)} (${(L.e - L.s).toFixed(1)} s${nx ? `, pause after ${Math.max(0, nx.s - L.e).toFixed(1)} s` : ''})` : '';
      out.push(`L${li}${tm} | ${raw}`);
      li++;
    } else out.push(`     ${raw}`);
  }
  return out.join('\n');
}

export function autoEditPrompt(doc: ProjectDoc, assets: Asset[], cats: Category[], guidelines: string) {
  return `You are the sound designer for an audio podcast made with AI voices (two fixed hosts, sometimes one or two guests). Turn the script below into a cue sheet for the editing tool.

HOUSE GUIDELINES:
${guidelines || '(none)'}
FIXED RULE: the AI disclaimer plays at the very start and very end of every episode (the editor adds it).

SOUND LIBRARY (role values: intro, outro, positioning, bed, transition, sfx, emotion):
${libraryForPrompt(assets, cats)}

SCRIPT. Spoken lines are numbered L0, L1… with their position in the audio (start–end, length, pause after). Lines without a number are editor tags or headings.
Keep SFX at least ${doc.settings.minSpacing} s apart and prefer pauses for short SFX.
${scriptForPrompt(doc)}

TASK
1. Keep every explicit editing tag in the script (e.g. [SFX: whoosh], [POSITIONING MUSIC START]/[END], [INTRO MUSIC]). These have source "tag".
2. Add the cues the guidelines imply where the script has no tag. These have source "ai". Respect spacing; don't overload.
3. TTS voice tags like [laughs] are not edits but can hint at emotion cues.

Reply with ONLY JSON in this shape:
{"cues":[{"type":"intro|outro|positioning|bed|transition|sfx|emotion","sound":"short sound words or a library id","line":<L number>,"endLine":<L number, only for positioning/bed>,"position":"before|on|after|under","gainDb":<optional number>,"source":"tag|ai","reason":"short why"}]}
"before" ends the sound as the line starts, "on" starts with the line, "after" follows the line, "under" spans line..endLine.`;
}

export function parseJsonLoose(t: string): any {
  try { return JSON.parse(t); } catch { /* try harder */ }
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) try { return JSON.parse(f[1]); } catch { /* next */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) try { return JSON.parse(t.slice(a, b + 1)); } catch { /* none */ }
  return null;
}

/** validates an AI cue list (unknown types dropped, lines clamped) */
export function normCues(arr: unknown, N: number, assets: Asset[] = []): Cue[] {
  const list = Array.isArray(arr) ? arr : Array.isArray((arr as any)?.cues) ? (arr as any).cues : [];
  return list.filter((c: any) => c && CUE_TYPES.includes(c.type)).map((c: any) => {
    // a library id from the prompt (first 12 chars of the hash) → that sound's name
    const byId = assets.find((a) => String(c.sound || '').toLowerCase() === a.hash.slice(0, 12));
    return {
      id: cueId(), on: true, type: c.type as CueType,
      sound: byId ? byId.name : String(c.sound || c.type).slice(0, 60),
      line: clamp(parseInt(c.line) || 0, 0, Math.max(0, N - 1)),
      endLine: c.endLine != null ? clamp(parseInt(c.endLine) || 0, 0, Math.max(0, N - 1)) : undefined,
      position: ['before', 'on', 'after', 'under'].includes(c.position) ? c.position : 'before',
      gainDb: c.gainDb != null && isFinite(+c.gainDb) ? clamp(+c.gainDb, -40, 6) : undefined,
      source: c.source === 'tag' ? 'tag' : 'ai',
      reason: String(c.reason || '').slice(0, 160),
    } as Cue;
  });
}

/* ============ "change the edit" requests ============ */
export function opsPrompt(doc: ProjectDoc, req: string, assets: Asset[], cats: Category[], guidelines: string, playhead: number, selected: string | null) {
  const name = (h: string) => assets.find((a) => a.hash === h)?.name || (h === doc.dialogueHash ? 'Main dialogue' : 'audio');
  const tracks = doc.tracks.map((t) => `- ${t.id} | ${t.name} (${t.kind}) | volume ${t.vol} dB | dips ${t.duck} dB under voices${t.mute ? ' | muted' : ''}`).join('\n');
  const clips = [...doc.clips].sort((a, b) => a.start - b.start).map((c) =>
    `- ${c.id} | track ${c.trackId} | ${name(c.assetHash)} (${c.assetHash.slice(0, 12)}) | ${c.start.toFixed(2)}-${(c.start + c.dur).toFixed(2)}s | gain ${c.gain} dB | fades ${c.fadeIn}/${c.fadeOut}${c.loop ? ' | loop' : ''}${c.fixed ? ' | fixed disclaimer' : ''}`).join('\n');
  const lt = lineTimes(doc);
  const lines = doc.lines.map((l, i) => `L${i} | ${lt[i] ? lt[i]!.s.toFixed(2) + '-' + lt[i]!.e.toFixed(2) + 's' : 'cut'} | ${l.speaker}: ${l.text.slice(0, 90)}`).join('\n');
  return `You edit a multitrack podcast timeline. Times are seconds on the timeline.
GUIDELINES:
${guidelines || '(none)'}

TRACKS:
${tracks || '(none)'}

CLIPS:
${clips || '(none)'}

SCRIPT LINES (timeline times):
${lines || '(no script)'}

LIBRARY:
${libraryForPrompt(assets, cats)}

PLAYHEAD: ${playhead.toFixed(2)}s. SELECTED: ${selected || 'none'}.

REQUEST: ${req}

Reply with ONLY JSON: {"summary":"one short sentence of what you changed","ops":[...]}
Allowed ops:
{"op":"add","asset":"<library id>","track":"<track id, optional>","at":<seconds> OR "line":<L number>,"position":"before|on|after","gainDb":n,"fadeIn":n,"fadeOut":n,"length":n,"loop":bool}
{"op":"update","clip":"<clip id>","start":n,"length":n,"gainDb":n,"fadeIn":n,"fadeOut":n,"track":"<track id>","asset":"<library id>","loop":bool}
{"op":"delete","clip":"<clip id>"}
{"op":"track","track":"<track id>","volumeDb":n,"duckDb":n,"mute":bool,"solo":bool}
Use exact ids from above. Keep unrelated clips unchanged. Never move or delete fixed disclaimers.`;
}

/** applies AI edit operations to the doc (mutates). Unknown ids are skipped, values are clamped. */
export function applyOps(doc: ProjectDoc, ops: unknown, assets: Asset[]): { n: number; skipped: number } {
  let n = 0, skipped = 0;
  const num = (v: any) => (v != null && isFinite(+v) ? +v : null);
  const findAsset = (id: string) => assets.find((a) => a.hash === id || a.hash.slice(0, 12) === String(id).toLowerCase() || a.name.toLowerCase() === String(id).toLowerCase());
  const lt = lineTimes(doc);
  for (const o of Array.isArray(ops) ? ops : []) {
    try {
      if (o.op === 'add') {
        const a = findAsset(o.asset);
        if (!a) { skipped++; continue; }
        const tr = doc.tracks.find((t) => t.id === o.track && t.kind !== 'dialogue') || trackFor(doc, kindForRole(a.role));
        let at = num(o.at);
        if (at == null && o.line != null) {
          const L = lt[+o.line];
          if (!L) { skipped++; continue; }
          at = o.position === 'after' ? L.e + 0.08 : o.position === 'on' ? L.s : L.s - Math.min(a.dur * 0.6, 0.8);
        }
        const loop = !!o.loop, len = num(o.length);
        const c: Clip = { id: newId('c_'), trackId: tr.id, assetHash: a.hash, start: r2(Math.max(0, at ?? 0)), offset: 0, dur: r2(loop && len ? len : Math.min(len ?? a.dur, a.dur)), gain: clamp(num(o.gainDb) ?? 0, -60, 12), fadeIn: Math.max(0, num(o.fadeIn) ?? 0), fadeOut: Math.max(0, num(o.fadeOut) ?? 0), loop };
        doc.clips.push(c); n++;
      } else if (o.op === 'update') {
        const c = doc.clips.find((x) => x.id === o.clip);
        if (!c || c.fixed) { skipped++; continue; }
        if (o.asset) { const a = findAsset(o.asset); if (a) c.assetHash = a.hash; }
        const a = assets.find((x) => x.hash === c.assetHash);
        if (num(o.start) != null) c.start = r2(Math.max(0, +o.start));
        if (o.loop != null) c.loop = !!o.loop;
        if (num(o.length) != null) c.dur = r2(Math.max(0.05, c.loop || !a ? +o.length : Math.min(+o.length, a.dur - c.offset)));
        if (num(o.gainDb) != null) c.gain = clamp(+o.gainDb, -60, 12);
        if (num(o.fadeIn) != null) c.fadeIn = clamp(+o.fadeIn, 0, c.dur);
        if (num(o.fadeOut) != null) c.fadeOut = clamp(+o.fadeOut, 0, c.dur);
        const tr = doc.tracks.find((t) => t.id === o.track);
        if (tr && tr.kind !== 'dialogue' && tr.kind !== 'disclaimer') c.trackId = tr.id;
        c.auto = false; n++;
      } else if (o.op === 'delete') {
        const c = doc.clips.find((x) => x.id === o.clip);
        if (!c || c.fixed) { skipped++; continue; }
        doc.clips = doc.clips.filter((x) => x !== c); n++;
      } else if (o.op === 'track') {
        const t = doc.tracks.find((x) => x.id === o.track);
        if (!t) { skipped++; continue; }
        if (num(o.volumeDb) != null) t.vol = clamp(+o.volumeDb, -60, 12);
        if (num(o.duckDb) != null) t.duck = clamp(+o.duckDb, 0, 40);
        if (o.mute != null) t.mute = !!o.mute;
        if (o.solo != null) t.solo = !!o.solo;
        n++;
      } else skipped++;
    } catch { skipped++; }
  }
  for (const q of doc.cues) if (q.clipId && !doc.clips.some((c) => c.id === q.clipId)) { q.clipId = null; q.on = false; }
  return { n, skipped };
}

/* ============ EDDY EDIT blocks: exact instructions applied without any AI ============ */
export interface EditBlock { cues: Cue[]; ops: any[]; warn: string[] }

export const isEditBlock = (text: string) => /^\s*(eddy|cutroom|bajaj)\s+edit\b/i.test(text);

/**
 * EDDY EDIT
 * SFX: coin chime | after L12
 * BGM: story play | L5-L9 | -2 dB
 * VOLUME: Background music | -3 dB
 */
export function parseEditBlock(text: string, doc: ProjectDoc): EditBlock | null {
  if (!isEditBlock(text)) return null;
  const cues: Cue[] = [], ops: any[] = [], warn: string[] = [];
  const N = doc.lines.length;
  const findLineByText = (snip: string) => {
    const q = snip.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    return q ? doc.lines.findIndex((l) => l.text.toLowerCase().replace(/[^a-z0-9 ]/g, '').includes(q)) : -1;
  };
  const parseLineRef = (p: string) => {
    let m = p.match(/^(before|after|on|under|over|from)?\s*L\s*(\d+)(?:\s*(?:-|–|to)\s*L?\s*(\d+))?$/i);
    if (m) return { pos: (m[1] || '').toLowerCase(), a: +m[2] - 1, b: m[3] != null ? +m[3] - 1 : null };
    m = p.match(/^(before|after|on|under|over|from)?\s*["“](.+?)["”](?:\s*(?:-|–|to)\s*["“](.+?)["”])?$/i);
    if (m) return { pos: (m[1] || '').toLowerCase(), a: findLineByText(m[2]), b: m[3] ? findLineByText(m[3]) : null };
    return null;
  };
  for (let raw of text.split(/\r?\n/).slice(1)) {
    raw = raw.trim();
    if (!raw || raw.startsWith('#')) continue;
    let reason = '';
    const ri = raw.search(/\s(\/\/|—|--)\s/);
    if (ri >= 0) { reason = raw.slice(ri).replace(/^\s*(\/\/|—|--)\s*/, '').trim(); raw = raw.slice(0, ri).trim(); }
    const parts = raw.split('|').map((x) => x.trim()).filter(Boolean);
    const hm = parts[0].match(/^([A-Z ]+?)\s*:\s*(.*)$/i);
    if (!hm) { warn.push(`Not understood: ${raw}`); continue; }
    const kind = hm[1].trim().toUpperCase(), what = hm[2].trim();
    let ref: ReturnType<typeof parseLineRef> = null, gain: number | null = null;
    if (!['INTRO', 'OUTRO', 'BGM', 'MUSIC', 'POSITIONING', 'BED', 'SFX', 'EMOTION', 'TRANSITION', 'VOLUME', 'DUCK'].includes(kind)) { warn.push(`Unknown instruction “${hm[1].trim()}”. Use INTRO, OUTRO, BGM, SFX, EMOTION, TRANSITION, VOLUME or DUCK`); continue; }
    for (const p of parts.slice(1)) {
      const g = p.match(/^(-?\d+(?:\.\d+)?)\s*db$/i);
      if (g) { gain = +g[1]; continue; }
      const r = parseLineRef(p);
      if (r) { ref = r; continue; }
      warn.push(`Ignored “${p}” in: ${raw}`);
    }
    if (ref && (ref.a < 0 || ref.a >= N || (ref.b != null && (ref.b < 0 || ref.b >= N)))) { warn.push(`Line not found in the script for: ${raw}`); continue; }
    const base = { id: cueId(), on: true, source: 'tag' as const, reason: reason || raw, gainDb: gain ?? undefined };
    if (kind === 'INTRO') { cues.push({ ...base, type: 'intro', sound: what || 'intro', line: 0, position: 'before' }); continue; }
    if (kind === 'OUTRO') { cues.push({ ...base, type: 'outro', sound: what || 'outro', line: Math.max(0, N - 1), position: 'after' }); continue; }
    if (kind === 'VOLUME' || kind === 'DUCK') {
      const t = doc.tracks.find((t) => t.name.toLowerCase().includes(what.toLowerCase()) || t.kind === what.toLowerCase());
      if (!t || gain == null) { warn.push(`Need a track name and dB for: ${raw}`); continue; }
      ops.push(kind === 'VOLUME' ? { op: 'track', track: t.id, volumeDb: gain } : { op: 'track', track: t.id, duckDb: Math.abs(gain) });
      continue;
    }
    if (!ref) { warn.push(`Add a line like “before L3” or “L5-L7” to: ${raw}`); continue; }
    if (['BGM', 'MUSIC', 'POSITIONING', 'BED'].includes(kind)) {
      cues.push({ ...base, type: kind === 'POSITIONING' ? 'positioning' : 'bed', sound: what, line: ref.a, endLine: ref.b ?? ref.a, position: 'under' });
      continue;
    }
    const type: CueType = kind === 'EMOTION' ? 'emotion' : kind === 'TRANSITION' ? 'transition' : 'sfx';
    cues.push({ ...base, type, sound: what, line: ref.a, position: (['before', 'after', 'on'].includes(ref.pos) ? ref.pos : 'before') as Cue['position'] });
  }
  return { cues, ops, warn };
}
