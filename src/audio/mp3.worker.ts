/* MP3 encoding off the main thread, so the editor stays responsive during export. */
import { Mp3Encoder } from '@breezystack/lamejs';

self.onmessage = (e: MessageEvent<{ l: Float32Array; r: Float32Array; sampleRate: number; kbps: number }>) => {
  try {
    const { l, r, sampleRate, kbps } = e.data;
    const enc = new Mp3Encoder(2, sampleRate, kbps);
    const toI16 = (f: Float32Array, a: number, b: number) => {
      const o = new Int16Array(b - a);
      for (let i = a; i < b; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i - a] = v < 0 ? v * 0x8000 : v * 0x7fff; }
      return o;
    };
    const parts: BlobPart[] = [];
    const block = 1152 * 20;
    for (let i = 0; i < l.length; i += block) {
      const j = Math.min(l.length, i + block);
      const out = enc.encodeBuffer(toI16(l, i, j), toI16(r, i, j));
      if (out.length) parts.push(new Uint8Array(out));
      if ((i / block) % 40 === 0) (self as any).postMessage({ progress: i / l.length });
    }
    const end = enc.flush();
    if (end.length) parts.push(new Uint8Array(end));
    (self as any).postMessage({ blob: new Blob(parts, { type: 'audio/mpeg' }) });
  } catch (err: any) {
    (self as any).postMessage({ error: err?.message || String(err) });
  }
};
