export const uid = (p = '') => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const nowIso = () => new Date().toISOString();

export async function sha256(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Decoded length of an audio file in seconds (0 if it can't be decoded). */
export async function audioDuration(blob: Blob): Promise<number> {
  try {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    return Math.round(buf.duration * 100) / 100;
  } catch {
    return 0;
  }
}

export const clone = <T,>(x: T): T => structuredClone(x);
