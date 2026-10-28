import type { Clip, ProjectDoc, Track } from '@eddy/rules';
import { useApp } from '../state/app';

/* ============ decoding + caches ============ */
let liveCtx: AudioContext | null = null;
export const audioCtx = () => (liveCtx ??= new AudioContext({ latencyHint: 'interactive' }));

const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();
const listeners = new Set<() => void>();
export const onBuffersChanged = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export function getBuffer(hash: string): AudioBuffer | undefined { return buffers.get(hash); }

export function loadBuffer(hash: string): Promise<AudioBuffer | null> {
  const hit = buffers.get(hash);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(hash);
  if (!p) {
    p = (async () => {
      const blob = await useApp.getState().be.getAudio(hash);
      if (!blob) return null;
      try {
        const buf = await audioCtx().decodeAudioData(await blob.arrayBuffer());
        buffers.set(hash, buf);
        listeners.forEach((f) => f());
        return buf;
      } catch { return null; }
    })();
    pending.set(hash, p);
  }
  return p;
}
export const loadAll = (hashes: string[]) => Promise.all([...new Set(hashes)].map(loadBuffer));

/* ============ waveform peaks (min/max per bucket, 200 buckets per second) ============ */
export const PEAK_RATE = 200;
const peaks = new Map<string, Float32Array>();
export function getPeaks(hash: string): Float32Array | null {
  const hit = peaks.get(hash);
  if (hit) return hit;
  const buf = buffers.get(hash);
  if (!buf) return null;
  const n = Math.ceil(buf.duration * PEAK_RATE), out = new Float32Array(n * 2);
  const step = buf.sampleRate / PEAK_RATE;
  const chs = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
  for (let b = 0; b < n; b++) {
    let mn = 0, mx = 0;
    const i0 = Math.floor(b * step), i1 = Math.min(chs[0].length, Math.floor((b + 1) * step));
    for (const d of chs) for (let i = i0; i < i1; i += 2) { const v = d[i]; if (v < mn) mn = v; else if (v > mx) mx = v; }
    out[b * 2] = mn; out[b * 2 + 1] = mx;
  }
  peaks.set(hash, out);
  return out;
}

/* ============ speech detection on the dialogue (for ducking music under voices) ============ */
const speechCache = new Map<string, [number, number][]>();
export function speechSegments(hash: string): [number, number][] {
  const hit = speechCache.get(hash);
  if (hit) return hit;
  const buf = buffers.get(hash);
  if (!buf) return [];
  const sr = buf.sampleRate, d = buf.getChannelData(0), hop = Math.floor(sr * 0.02);
  const rms: number[] = [];
  for (let i = 0; i + hop <= d.length; i += hop) { let s = 0; for (let j = i; j < i + hop; j += 4) s += d[j] * d[j]; rms.push(Math.sqrt(s / (hop / 4))); }
  const sorted = [...rms].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0, top = sorted[Math.floor(sorted.length * 0.98)] || 0;
  const thr = Math.max(0.006, floor * 3, top * 0.06);
  const segs: [number, number][] = [];
  let st = -1;
  rms.forEach((v, i) => {
    if (v > thr && st < 0) st = i;
    else if (v <= thr && st >= 0) { segs.push([st * 0.02, i * 0.02]); st = -1; }
  });
  if (st >= 0) segs.push([st * 0.02, rms.length * 0.02]);
  const merged: [number, number][] = [];
  for (const s of segs) { const l = merged[merged.length - 1]; if (l && s[0] - l[1] < 0.3) l[1] = s[1]; else merged.push([...s] as [number, number]); }
  const out = merged.filter(([a, b]) => b - a >= 0.15);
  speechCache.set(hash, out);
  return out;
}

/** speech regions on the timeline (through the dialogue clips' trims and positions) */
export function timelineSpeech(doc: ProjectDoc): [number, number][] {
  const dt = doc.tracks.find((t) => t.kind === 'dialogue');
  if (!dt || dt.mute) return [];
  const out: [number, number][] = [];
  for (const c of doc.clips) {
    if (c.trackId !== dt.id) continue;
    for (const [a, b] of speechSegments(c.assetHash)) {
      const lo = Math.max(a, c.offset), hi = Math.min(b, c.offset + c.dur);
      if (hi > lo) out.push([c.start + lo - c.offset, c.start + hi - c.offset]);
    }
  }
  out.sort((p, q) => p[0] - q[0]);
  const m: [number, number][] = [];
  for (const s of out) { const l = m[m.length - 1]; if (l && s[0] - l[1] < 0.8) l[1] = Math.max(l[1], s[1]); else m.push([...s] as [number, number]); }
  return m;
}

export const projectEnd = (doc: ProjectDoc) => doc.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/* ============ mix graph (shared by live playback and export) ============ */
type Pt = [number, number]; // [timeline seconds, gain]

/** schedules a piecewise-linear envelope (timeline time) on a param, starting at timeline `from` = ctx time `t0` */
function envelope(param: AudioParam, pts: Pt[], from: number, t0: number) {
  const valAt = (t: number) => {
    if (!pts.length) return 1;
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return b === a ? vb : va + (vb - va) * (t - a) / (b - a); }
    return pts[pts.length - 1][1];
  };
  param.cancelScheduledValues(0);
  param.setValueAtTime(valAt(from), t0);
  for (const [t, v] of pts) if (t > from) param.linearRampToValueAtTime(v, t0 + (t - from));
}

function clipEnvelope(c: Clip): Pt[] {
  const g = dbToGain(c.gain), s = c.start, e = c.start + c.dur;
  const fi = Math.min(c.fadeIn, c.dur / 2), fo = Math.min(c.fadeOut, c.dur / 2);
  return [[s, fi > 0 ? 0 : g], [s + fi, g], [e - fo, g], [e, fo > 0 ? 0 : g]];
}

function duckEnvelope(tr: Track, speech: [number, number][]): Pt[] {
  if (!tr.duck || tr.kind === 'dialogue' || tr.kind === 'disclaimer') return [];
  const lo = dbToGain(-tr.duck);
  const pts: Pt[] = [[0, 1]];
  for (const [a, b] of speech) pts.push([Math.max(0, a - 0.25), 1], [a - 0.05, lo], [b + 0.2, lo], [b + 0.5, 1]);
  return pts.sort((x, y) => x[0] - y[0]);
}

export interface Graph { stop(): void }

/** Builds the whole mix into `dest`, playing timeline time `from` at ctx time `when`. */
export function buildGraph(ctx: BaseAudioContext, dest: AudioNode, doc: ProjectDoc, from: number, when: number, until = Infinity): Graph {
  const speech = timelineSpeech(doc);
  const solo = doc.tracks.some((t) => t.solo);
  const nodes: AudioScheduledSourceNode[] = [];
  const buses = new Map<string, GainNode>();
  for (const tr of doc.tracks) {
    if (tr.mute || (solo && !tr.solo)) continue;
    const vol = ctx.createGain(); vol.gain.value = dbToGain(tr.vol);
    const duck = ctx.createGain();
    const env = duckEnvelope(tr, speech);
    if (env.length) envelope(duck.gain, env, from, when);
    vol.connect(duck).connect(dest);
    buses.set(tr.id, vol);
  }
  for (const c of doc.clips) {
    const bus = buses.get(c.trackId), buf = buffers.get(c.assetHash);
    if (!bus || !buf) continue;
    const s = c.start, e = Math.min(c.start + c.dur, until);
    if (e <= from || s >= until) continue;
    const startAt = Math.max(s, from);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain();
    envelope(g.gain, clipEnvelope(c), from, when);
    src.connect(g).connect(bus);
    let off = c.offset + (startAt - s);
    if (c.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = buf.duration; off = off % buf.duration; }
    else if (off >= buf.duration) continue;
    const at = when + (startAt - from), len = e - startAt;
    if (c.loop) { src.start(at, off); src.stop(at + len); } else src.start(at, off, len);
    nodes.push(src);
  }
  return { stop: () => nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }) };
}

/* ============ live player ============ */
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** 16-bit WAV of a buffer (used for sped-up previews) */
function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length, bytes = 44 + n * ch * 2;
  const dv = new DataView(new ArrayBuffer(bytes));
  let p = 0;
  const ws = (s: string) => { for (const c of s) dv.setUint8(p++, c.charCodeAt(0)); };
  const u32 = (v: number) => { dv.setUint32(p, v, true); p += 4; }, u16 = (v: number) => { dv.setUint16(p, v, true); p += 2; };
  ws('RIFF'); u32(bytes - 8); ws('WAVEfmt '); u32(16); u16(1); u16(ch); u32(sr); u32(sr * ch * 2); u16(ch * 2); u16(16); ws('data'); u32(n * ch * 2);
  const d = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, d[c][i])); dv.setInt16(p, v < 0 ? v * 0x8000 : v * 0x7fff, true); p += 2; }
  return new Blob([dv], { type: 'audio/wav' });
}

export class Player {
  private graph: Graph | null = null;
  private master: GainNode | null = null;
  private el: HTMLAudioElement | null = null;
  private url: string | null = null;
  private tok = 0;
  private t0 = 0;
  private from = 0;
  playing = false;
  /** true while a sped-up preview is being prepared */
  preparing = false;

  /** At 1× the mix plays live. At other speeds the stretch ahead (up to 10 min) is mixed first,
      then played with the pitch kept natural, so voices don't sound chipmunky. */
  async play(doc: ProjectDoc, from: number, speed = 1) {
    this.stop();
    const tok = ++this.tok;
    await loadAll(doc.clips.map((c) => c.assetHash));
    if (tok !== this.tok) return;
    const ctx = audioCtx();
    await ctx.resume();
    this.from = from;
    if (speed === 1) {
      this.master = ctx.createGain();
      this.master.connect(ctx.destination);
      this.t0 = ctx.currentTime + 0.05;
      this.graph = buildGraph(ctx, this.master, doc, from, this.t0);
      this.playing = true;
      return;
    }
    this.preparing = true;
    this.playing = true;
    const to = Math.min(projectEnd(doc) + 0.3, from + 600), sr = 22050;
    const oc = new OfflineAudioContext(1, Math.max(1, Math.ceil((to - from) * sr)), sr);
    buildGraph(oc, oc.destination, doc, from, 0, to);
    const buf = await oc.startRendering();
    if (tok !== this.tok) return;
    this.url = URL.createObjectURL(encodeWav(buf));
    const el = new Audio(this.url) as HTMLAudioElement & { mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
    el.playbackRate = speed;
    el.preservesPitch = true; el.mozPreservesPitch = true; el.webkitPreservesPitch = true;
    this.el = el;
    await el.play();
    if (tok !== this.tok) { el.pause(); return; }
    this.preparing = false;
  }
  /** current timeline position while playing */
  position() {
    if (!this.playing) return this.from;
    if (this.el) return this.from + this.el.currentTime;
    if (this.preparing) return this.from;
    return this.from + Math.max(0, audioCtx().currentTime - this.t0);
  }
  stop() {
    this.tok++;
    this.graph?.stop();
    this.master?.disconnect();
    this.el?.pause();
    if (this.url) URL.revokeObjectURL(this.url);
    this.graph = null; this.master = null; this.el = null; this.url = null;
    this.playing = false; this.preparing = false;
  }
}

/* ============ export ============ */
export async function renderMix(doc: ProjectDoc, onProgress?: (p: number, label: string) => void): Promise<AudioBuffer> {
  const end = projectEnd(doc);
  if (end < 0.2) throw new Error('Nothing to export yet.');
  onProgress?.(0.02, 'Loading audio…');
  await loadAll(doc.clips.map((c) => c.assetHash));
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil((end + 0.3) * sr), sr);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.15;
  limiter.connect(ctx.destination);
  buildGraph(ctx, limiter, doc, 0, 0);
  onProgress?.(0.1, 'Mixing…');
  return ctx.startRendering();
}

export function encodeMp3(buf: AudioBuffer, kbps = 192, onProgress?: (p: number) => void): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
    const l = buf.getChannelData(0).slice(), r = (buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)).slice();
    w.onmessage = (e) => {
      if (e.data.progress != null) onProgress?.(e.data.progress);
      else if (e.data.blob) { resolve(e.data.blob); w.terminate(); }
      else if (e.data.error) { reject(new Error(e.data.error)); w.terminate(); }
    };
    w.onerror = (e) => { reject(new Error(e.message)); w.terminate(); };
    w.postMessage({ l, r, sampleRate: buf.sampleRate, kbps }, [l.buffer, r.buffer]);
  });
}
