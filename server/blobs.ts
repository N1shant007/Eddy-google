import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Storage } from '@google-cloud/storage';
import { config } from './config.js';

/* Audio files, stored once per SHA-256: Cloud Storage in production, ./.data/blobs locally.
   Layout: audio/<sha256>, uploads/<uploadId>/<part>, exports/<projectId>/<file>.
   Cloud Run and API Gateway cap a request at 32 MB, so big files are uploaded in parts and joined here. */

export interface BlobInfo { size: number; contentType: string }
export interface Blobs {
  stat(key: string): Promise<BlobInfo | null>;
  read(key: string, range?: { start: number; end: number }): Readable;
  write(key: string, data: Buffer, contentType: string): Promise<void>;
  /** joins parts into `key` in order, deletes the parts */
  join(key: string, parts: string[], contentType: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  del(key: string): Promise<void>;
  /** gs://… for GCS, a file path locally */
  uri(key: string): string;
}

export const audioKey = (hash: string) => `audio/${hash}`;

export async function sha256Of(blobs: Blobs, key: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of blobs.read(key)) h.update(chunk as Buffer);
  return h.digest('hex');
}

class GcsBlobs implements Blobs {
  private bucket = new Storage({ projectId: config.project || undefined }).bucket(config.bucket);
  async stat(key: string) {
    const f = this.bucket.file(key);
    const [exists] = await f.exists();
    if (!exists) return null;
    const [m] = await f.getMetadata();
    return { size: Number(m.size || 0), contentType: m.contentType || 'application/octet-stream' };
  }
  read(key: string, range?: { start: number; end: number }) {
    return this.bucket.file(key).createReadStream(range ? { start: range.start, end: range.end } : {});
  }
  async write(key: string, data: Buffer, contentType: string) {
    await this.bucket.file(key).save(data, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=31536000, immutable' } });
  }
  async join(key: string, parts: string[], contentType: string) {
    // compose takes up to 32 sources at a time
    let sources = parts;
    let round = 0;
    while (sources.length > 32) {
      const next: string[] = [];
      for (let i = 0; i < sources.length; i += 32) {
        const k = `${key}.compose${round}-${i}`;
        await this.bucket.combine(sources.slice(i, i + 32).map((s) => this.bucket.file(s)), this.bucket.file(k));
        next.push(k);
      }
      await Promise.all(sources.map((s) => this.bucket.file(s).delete({ ignoreNotFound: true })));
      sources = next; round++;
    }
    await this.bucket.combine(sources.map((s) => this.bucket.file(s)), this.bucket.file(key));
    await this.bucket.file(key).setMetadata({ contentType });
    await Promise.all(sources.map((s) => this.bucket.file(s).delete({ ignoreNotFound: true })));
  }
  async copy(from: string, to: string) { await this.bucket.file(from).copy(this.bucket.file(to)); }
  async del(key: string) { await this.bucket.file(key).delete({ ignoreNotFound: true }); }
  uri(key: string) { return `gs://${config.bucket}/${key}`; }
}

class LocalBlobs implements Blobs {
  constructor(private dir: string) {}
  private p(key: string) {
    const full = path.resolve(this.dir, key);
    if (!full.startsWith(path.resolve(this.dir) + path.sep)) throw new Error('Bad key');
    return full;
  }
  async stat(key: string) {
    try {
      const s = await fs.stat(this.p(key));
      let contentType = 'application/octet-stream';
      try { contentType = (await fs.readFile(this.p(key) + '.type', 'utf8')) || contentType; } catch { /* default */ }
      return { size: s.size, contentType };
    } catch { return null; }
  }
  read(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.p(key), range ? { start: range.start, end: range.end } : {});
  }
  async write(key: string, data: Buffer, contentType: string) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    await fs.writeFile(this.p(key), data);
    await fs.writeFile(this.p(key) + '.type', contentType);
  }
  async join(key: string, parts: string[], contentType: string) {
    await fs.mkdir(path.dirname(this.p(key)), { recursive: true });
    const out = createWriteStream(this.p(key));
    for (const part of parts) await pipeline(createReadStream(this.p(part)), out, { end: false });
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : r())));
    await fs.writeFile(this.p(key) + '.type', contentType);
    for (const part of parts) await this.del(part);
  }
  async copy(from: string, to: string) {
    await fs.mkdir(path.dirname(this.p(to)), { recursive: true });
    await fs.copyFile(this.p(from), this.p(to));
    try { await fs.copyFile(this.p(from) + '.type', this.p(to) + '.type'); } catch { /* none */ }
  }
  async del(key: string) {
    await fs.rm(this.p(key), { force: true });
    await fs.rm(this.p(key) + '.type', { force: true });
  }
  uri(key: string) { return this.p(key); }
}

export function makeBlobs(): Blobs {
  return config.storage === 'gcp' ? new GcsBlobs() : new LocalBlobs(path.join(config.dataDir, 'blobs'));
}
