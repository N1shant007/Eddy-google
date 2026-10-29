import { gunzipSync, gzipSync } from 'node:zlib';

/* Firestore caps a document at 1 MiB. Edit data and pipeline subtitles are stored as text; anything long is
   gzipped (typically 6–10× smaller) and kept as "gz:<base64>". Short text stays readable in the console. */

const PLAIN_MAX = 64_000;
/** budget for one stored edit, leaving room for the rest of the document */
export const MAX_PACKED = 600_000;
export const MAX_PACKED_SUBS = 250_000;

export function pack(text: string): string {
  if (text.length <= PLAIN_MAX && !text.startsWith('gz:')) return text;
  return 'gz:' + gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).toString('base64');
}

export function unpack(stored: unknown): string {
  if (typeof stored !== 'string') return '';
  return stored.startsWith('gz:') ? gunzipSync(Buffer.from(stored.slice(3), 'base64')).toString('utf8') : stored;
}
