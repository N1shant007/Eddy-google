import type { Asset, Category, Clip, Cue, ProjectDoc, Track, TrackKind } from './types';
import { clamp, r2 } from './script';

/* Turns cues into clips on the timeline. House rules (Eddy v1 v64):
   - AI disclaimer first; the intro starts 0.2 s after it, plays 2.5 s at full volume, fades out over 1.5 s; voices start at 2.5 s
   - all background music at -10 dB (beds, product music and the intro music under the CTA); only ONE background music at a time (the later one wins, manual clips always win)
   - story rewrite fills every gap from 2 s after the intro until the outro
   - at the CTA the intro music plays again lightly under the whole call to action
   - closing: product disclaimer (if the episode's product has one), then the AI disclaimer again */

export const INTRO_FULL = 2.5, INTRO_FADE = 1.5, CTA_INTRO_GAIN = -10, BG_GAIN = -10;
const INTRO_GAP = 0.2;

export const TRACK_ORDER: { kind: TrackKind; name: string; duck: number }[] = [
  { kind: 'disclaimer', name: 'Disclaimers', duck: 0 },
  { kind: 'dialogue', name: 'Dialogue', duck: 0 },
  { kind: 'intro', name: 'Intro / Outro', duck: 10 },
  { kind: 'positioning', name: 'Product music', duck: 9 },
  { kind: 'bed', name: 'Background music', duck: 12 },
  { kind: 'transition', name: 'Transitions', duck: 0 },
  { kind: 'sfx', name: 'Sound effects', duck: 0 },
  { kind: 'emotion', name: 'Reactions', duck: 0 },
];
export const kindForRole = (role: string): TrackKind =>
  role === 'outro' ? 'intro' : role === 'pdisclaimer' ? 'disclaimer' : (TRACK_ORDER.some((t) => t.kind === role) ? role : 'sfx') as TrackKind;

let seq = 0;
export const newId = (p: string) => p + Date.now().toString(36).slice(-5) + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);

export function trackFor(doc: ProjectDoc, kind: TrackKind): Track {
  let t = doc.tracks.find((x) => x.kind === kind);
  if (!t) {
    const d = TRACK_ORDER.find((x) => x.kind === kind)!;
    t = { id: newId('t_'), kind, name: d.name, vol: 0, duck: d.duck, mute: false, solo: false };
    const order = (k: TrackKind) => TRACK_ORDER.findIndex((x) => x.kind === k);
    const at = doc.tracks.findIndex((x) => order(x.kind) > order(kind));
    if (at < 0) doc.tracks.push(t); else doc.tracks.splice(at, 0, t);
  }
  return t;
}
export const pruneTracks = (doc: ProjectDoc) => { doc.tracks = doc.tracks.filter((t) => t.kind === 'dialogue' || doc.clips.some((c) => c.trackId === t.id)); };

/** each script line's start/end on the timeline (through the dialogue clips), or null if that part was cut */
export function lineTimes(doc: ProjectDoc): ({ s: number; e: number } | null)[] {
  const t = doc.tracks.find((x) => x.kind === 'dialogue');
  const dcl = t ? doc.clips.filter((c) => c.trackId === t.id && c.assetHash === doc.dialogueHash).sort((a, b) => a.start - b.start) : [];
  const absOf = (at: number) => { for (const c of dcl) if (at >= c.offset - 1e-6 && at <= c.offset + c.dur + 1e-6) return c.start + (at - c.offset); return null; };
  return doc.lines.map((l) => {
    if (l.t0 == null || l.t1 == null) return null;
    const a = absOf(l.t0), b = absOf(l.t1);
    if (a == null && b == null) return null;
    return { s: (a ?? b)!, e: (b ?? a)! };
  });
}

export interface PlaceContext {
  assets: Asset[];
  categories: Category[];
}
export interface PlaceResult { placed: number; notes: string[]; missingStory: boolean }

const MUSIC_ROLES = new Set(['intro', 'outro', 'bed', 'positioning']);

export function placeCues(doc: ProjectDoc, cues: Cue[], ctx: PlaceContext): PlaceResult {
  const st = doc.settings, N = doc.lines.length;
  const lib = ctx.assets.filter((a) => a.role !== 'dialogue' && a.role !== 'disclaimer' && a.role !== 'pdisclaimer');
  const byHash = new Map(ctx.assets.map((a) => [a.hash, a]));
  const catName = (a: Asset) => (ctx.categories.find((c) => c.id === a.categoryId)?.name || '').toLowerCase();
  const useCount: Record<string, number> = {};
  const notes: string[] = [];
  const kindOf = (c: Clip) => doc.tracks.find((t) => t.id === c.trackId)?.kind;

  /* ---------- sound lookup ---------- */
  const hasSoundNamed = (sound: string) => {
    const w = String(sound || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return !!w.length && lib.some((a) => w.every((x) => a.name.toLowerCase().includes(x)));
  };
  const resolveSound = (c: { sound: string; fallback?: string }): string | null => {
    for (const n of [c.sound, ...String(c.fallback || '').split('|').filter(Boolean)]) {
      if (n === 'storytelling') { const a = lib.find((x) => /story/.test(catName(x))); if (a) return a.name; continue; }
      if (hasSoundNamed(n)) return n;
    }
    return /^story\b/i.test(c.sound || '') ? null : c.sound;
  };
  const pickAsset = (role: string, sound: string): Asset | null => {
    const words = String(sound || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['sfx', 'music', 'sound', 'effect', 'emotion', 'start', 'end'].includes(w));
    const score = (a: Asset) => {
      let s = 0;
      const cn = catName(a), hay = (a.name + ' ' + a.tags.join(' ') + ' ' + cn).toLowerCase();
      for (const w of words) { if (hay.includes(w) || (w.length > 5 && hay.includes(w.replace(/(ing|s|ed)$/, '')))) s += 3; if (cn && cn.split(/\s+/).includes(w)) s += 4; }
      const matched = !words.length || s > 0;
      if (a.role === role) s += 2;
      s += a.role === role && matched ? 7 : 0.5;
      return s - (useCount[a.hash] || 0) * 0.4;
    };
    let pool = lib.filter((a) => a.role === role || (role === 'outro' && a.role === 'intro') || (role === 'intro' && a.role === 'outro' && !lib.some((x) => x.role === 'intro')));
    if (words.length) { const hit = lib.filter((a) => score(a) >= 3 + (a.role === role ? 2 : 0)); if (hit.length) pool = hit; }
    if (!pool.length) pool = lib.filter((a) => a.role === role);
    if (!pool.length) return null;
    pool.sort((a, b) => score(b) - score(a));
    const a = pool[0];
    useCount[a.hash] = (useCount[a.hash] || 0) + 1;
    return a;
  };

  /* ---------- timeline helpers ---------- */
  const dialogueClips = () => {
    const t = doc.tracks.find((x) => x.kind === 'dialogue');
    return t ? doc.clips.filter((c) => c.trackId === t.id && c.assetHash === doc.dialogueHash).sort((a, b) => a.start - b.start) : [];
  };
  const absOf = (at: number) => { for (const c of dialogueClips()) if (at >= c.offset - 1e-6 && at <= c.offset + c.dur + 1e-6) return c.start + (at - c.offset); return null; };
  const lineAbs = (i: number) => {
    const l = doc.lines[i];
    if (!l || l.t0 == null || l.t1 == null) return null;
    const a = absOf(l.t0), b = absOf(l.t1);
    if (a == null && b == null) return null;
    return { s: (a ?? b)!, e: (b ?? a)! };
  };
  const addClip = (asset: Asset, track: Track, start: number, o: Partial<Clip> = {}): Clip => {
    const c: Clip = { id: newId('c_'), trackId: track.id, assetHash: asset.hash, start: r2(Math.max(0, start)), offset: 0, dur: r2(o.dur ?? asset.dur), gain: 0, fadeIn: 0, fadeOut: 0, loop: false, auto: true, ...o };
    if (!c.loop) c.dur = Math.min(c.dur, asset.dur);
    c.start = r2(Math.max(0, c.start));
    doc.clips.push(c);
    return c;
  };

  /* ---------- reset: keep manual clips, drop auto and fixed ones ---------- */
  const live = new Set(cues.filter((q) => q.on !== false).map((q) => q.id));
  doc.clips = doc.clips.filter((c) => !c.fixed && !c.auto && (!c.cueId || live.has(c.cueId)));
  const disc = ctx.assets.find((a) => a.role === 'disclaimer') || null;
  const D = disc ? r2(disc.dur + INTRO_GAP) : 0;
  const hasIntro = cues.some((c) => c.type === 'intro' && c.on !== false);
  const dcl = dialogueClips();
  if (dcl.length) { const target = hasIntro ? D + INTRO_FULL : D, d = target - dcl[0].start; if (Math.abs(d) > 0.01) for (const c of dcl) c.start = r2(c.start + d); }

  let lastFx = -1e9, introEnd: number | null = null, introAsset: Asset | null = null, missingStory = false, placed = 0;
  const sorted = [...cues].sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || (a.type === 'intro' ? -1 : b.type === 'intro' ? 1 : 0));
  for (const c of sorted) {
    c.clipId = null; c.at = null; c.note = null;
    if (c.on === false) continue;
    const mc = doc.clips.find((x) => !x.auto && x.cueId === c.id);
    if (mc) { c.clipId = mc.id; c.at = mc.start; continue; }
    if ((c.type === 'bed' || c.type === 'positioning') && /insight/i.test(c.sound || '') && !/unfolding/i.test(c.sound || '')) { c.sound = 'story play'; c.fallback = c.fallback || 'storytelling'; }
    if (c.type === 'bed' && /^(curious|curiosity)/i.test(c.sound || '') && hasSoundNamed('unfolding insights')) { c.sound = 'unfolding insights'; c.fallback = 'curious|curiosity'; }
    if (c.type === 'positioning' && hasSoundNamed('1bfl intro track')) { c.sound = '1bfl intro track'; c.fallback = 'intro'; }
    const want = resolveSound(c);
    if (want === null) { c.note = 'Add “story rewrite” and “story play” to the Storytelling category'; missingStory = true; continue; }
    const asset = pickAsset(c.type, want);
    if (!asset) { c.note = 'No sound in this category'; continue; }
    const tr = trackFor(doc, asset.role === 'outro' || c.type === 'outro' ? 'intro' : kindForRole(c.type));
    const li = clamp(c.line ?? 0, 0, Math.max(0, N - 1)), L = lineAbs(li);
    const gainFor: Record<string, number> = { intro: 0, outro: -4, sfx: st.sfxGain, emotion: st.emoGain, transition: st.transGain };
    let g = c.gainDb != null && isFinite(c.gainDb) ? c.gainDb : gainFor[c.type] ?? -6;
    if (c.type === 'bed' || c.type === 'positioning') g = BG_GAIN;
    if (c.type === 'transition') g = Math.min(g, -14);
    let clip: Clip | null = null;
    if (c.type === 'intro') {
      const len = r2(Math.min(asset.dur, INTRO_FULL + INTRO_FADE));
      clip = addClip(asset, tr, D, { dur: len, gain: 0, fadeOut: r2(Math.max(0.3, Math.min(INTRO_FADE, len - INTRO_FULL))) });
      introEnd = D + len; introAsset = asset;
    } else if (!L) { c.note = 'Line not on the timeline'; continue; }
    else if (c.type === 'outro') {
      const Le = lineAbs(N - 1) || L;
      const olen = Math.min(asset.dur, Math.max(1, +st.outroLen || 7));
      clip = addClip(asset, tr, Math.max(0, Le.e - st.outroLead), { dur: olen, gain: g, fadeIn: 1.2, fadeOut: Math.min(2.5, olen / 3) });
    } else if (c.type === 'positioning' || c.type === 'bed') {
      const E = lineAbs(clamp(c.endLine ?? li, li, N - 1)) || L;
      let s = Math.max(D, L.s - 0.6);
      const e = E.e + 1.2;
      if ((c.afterIntro || (c.source === 'rule' && c.type === 'bed')) && introEnd != null) s = Math.max(s, introEnd + 2);
      if (e - s < 1.5) { c.note = 'No room after the intro'; continue; }
      if (c.ctaIntro) {
        const a2 = introAsset || asset, s2 = Math.max(D, L.s - 0.5), len = r2(Math.max(2, e - s2));
        clip = addClip(a2, trackFor(doc, 'intro'), s2, { dur: len, loop: len > a2.dur, gain: CTA_INTRO_GAIN, fadeIn: 1, fadeOut: Math.min(2, len / 3) });
      } else clip = addClip(asset, tr, s, { dur: r2(e - s), loop: e - s > asset.dur, gain: g, fadeIn: st.bedFadeIn, fadeOut: st.bedFadeOut });
    } else {
      let s: number;
      const lead = Math.min(asset.dur * 0.6, 0.8);
      if (c.frac != null && isFinite(c.frac) && c.frac < 0.92) s = L.s + (L.e - L.s) * c.frac + 0.25;
      else if (c.position === 'after') s = L.e + 0.08;
      else if (c.position === 'on') s = L.s;
      else s = L.s - (c.type === 'transition' ? Math.min(asset.dur, 1.6) : lead);
      if (c.source !== 'tag' && !c.must && Math.abs(s - lastFx) < st.minSpacing) { c.note = `Skipped: within ${st.minSpacing}s of another SFX`; continue; }
      clip = addClip(asset, tr, Math.max(D, s), { gain: g, fadeOut: c.type === 'transition' ? 0.2 : 0.05 });
      lastFx = s;
    }
    if (clip) { clip.cueId = c.id; c.clipId = clip.id; c.at = clip.start; placed++; }
  }

  /* ---------- one background music at a time ---------- */
  const isMusic = (c: Clip) => !c.fixed && ['intro', 'bed', 'positioning'].includes(kindOf(c) || '');
  const noOverlapMusic = () => {
    const skip = new Set<string>();
    for (let guard = 0; guard < 800; guard++) {
      const ms = doc.clips.filter(isMusic).sort((a, b) => a.start - b.start || b.dur - a.dur);
      let hit: [Clip, Clip] | null = null;
      for (let i = 0; i < ms.length && !hit; i++) for (let j = i + 1; j < ms.length; j++) {
        const p = ms[i], c = ms[j];
        if (c.start >= p.start + p.dur - 0.05) break;
        if (!skip.has(p.id + '|' + c.id)) { hit = [p, c]; break; }
      }
      if (!hit) return;
      const [p, c] = hit, pe = p.start + p.dur, ce = c.start + c.dur;
      if (!p.auto && !c.auto) { skip.add(p.id + '|' + c.id); continue; }
      const drop = (x: Clip) => { doc.clips = doc.clips.filter((y) => y !== x); for (const q of cues) if (q.clipId === x.id) { q.clipId = null; q.at = null; q.note = 'Replaced: another music plays here'; } };
      if (!p.auto && c.auto) {
        const cut = pe - c.start;
        if (c.dur - cut < 1) { drop(c); continue; }
        const a = byHash.get(c.assetHash);
        let off = (c.offset || 0) + cut;
        if (c.loop && a?.dur) off %= a.dur;
        c.offset = r2(off); c.start = r2(pe); c.dur = r2(c.dur - cut); c.fadeIn = Math.max(c.fadeIn || 0, 0.6);
        continue;
      }
      if (pe > ce + 3) {
        const a = byHash.get(p.assetHash)!;
        const r: Clip = { ...p, id: newId('c_'), start: r2(ce), dur: r2(pe - ce), fadeIn: 1 };
        let off = (p.offset || 0) + (ce - p.start);
        if (a?.dur && (p.loop || off >= a.dur)) off %= a.dur;
        r.offset = r2(off);
        if (!p.loop && a && r.offset + r.dur > a.dur) r.dur = r2(Math.max(0, a.dur - r.offset));
        if (r.dur >= 1) doc.clips.push(r);
      }
      const nd = r2(c.start - p.start);
      if (nd < 1) { drop(p); continue; }
      p.dur = nd; p.fadeOut = Math.min(Math.max(p.fadeOut || 0, 0.6), nd / 2, 1.2);
    }
  };

  /* ---------- story rewrite wherever there is no background music ---------- */
  const fillMusicGaps = () => {
    const d = dialogueClips();
    if (!d.length) return;
    const music = doc.clips.filter((c) => { const a = byHash.get(c.assetHash); return a && MUSIC_ROLES.has(a.role) && !c.fixed; });
    const outro = music.filter((c) => byHash.get(c.assetHash)!.role === 'outro').sort((a, b) => a.start - b.start)[0];
    const t0 = introEnd != null ? introEnd + 2 : Math.min(...d.map((c) => c.start));
    const t1 = outro ? outro.start : Math.max(...d.map((c) => c.start + c.dur));
    if (t1 - t0 < 3) return;
    const iv = music.map((c) => [c.start, c.start + c.dur]).filter(([a, b]) => b > t0 && a < t1).sort((x, y) => x[0] - y[0]);
    const gaps: [number, number][] = [];
    let cur = t0;
    for (const [a, b] of iv) { if (a - cur >= 3) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (t1 - cur >= 3) gaps.push([cur, t1]);
    if (!gaps.length) return;
    const want = resolveSound({ sound: 'story rewrite', fallback: 'story play|storytelling' });
    if (!want) return;
    const asset = pickAsset('bed', want);
    if (!asset) return;
    const tr = trackFor(doc, 'bed');
    for (const [a, b] of gaps) addClip(asset, tr, a, { dur: r2(b - a), loop: b - a > asset.dur, gain: BG_GAIN, fadeIn: 1.5, fadeOut: 1.5 });
  };

  noOverlapMusic();
  fillMusicGaps();
  noOverlapMusic();
  placeDisclaimers(doc, ctx.assets);
  pruneTracks(doc);
  if (missingStory) notes.push('Storytelling music is missing: add “story rewrite” and “story play” to the Storytelling category in the Audio library.');
  if (!disc) notes.push('Add your AI disclaimer audio (a category set to “AI disclaimer”) so it opens and closes every episode.');
  return { placed, notes, missingStory };
}

/** fixed rule: AI disclaimer at the start; at the end the product disclaimer (if any) then the AI disclaimer */
export function placeDisclaimers(doc: ProjectDoc, assets: Asset[]) {
  doc.clips = doc.clips.filter((c) => !c.fixed);
  if (!doc.clips.length) return;
  const disc = assets.find((a) => a.role === 'disclaimer');
  const norm = (s?: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const pd = doc.product ? assets.filter((a) => a.role === 'pdisclaimer' && norm(a.product) === norm(doc.product)).pop() : undefined;
  if (!disc && !pd) return;
  const tr = trackFor(doc, 'disclaimer');
  tr.duck = 0;
  const end = r2(doc.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0) + 0.4);
  const add = (a: Asset, at: number, fixed: Clip['fixed']) => doc.clips.push({ id: newId('c_'), trackId: tr.id, assetHash: a.hash, start: r2(at), offset: 0, dur: a.dur, gain: 0, fadeIn: 0, fadeOut: 0, loop: false, auto: true, fixed });
  if (disc) add(disc, 0, 'start');
  let t = end;
  if (pd) { add(pd, t, 'product'); t = r2(t + pd.dur + 0.3); }
  if (disc) add(disc, t, 'end');
}
