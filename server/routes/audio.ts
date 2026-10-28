import { createHash, randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { audioKey, sha256Of, type Blobs } from '../blobs.js';
import { HttpError } from './data.js';

/* Audio by SHA-256. Small files: one PUT. Big files (episode audio, final mixes): uploaded in parts under
   8 MB each, because Cloud Run and API Gateway refuse request bodies over 32 MB; the server joins them. */

export const PART_SIZE = 8 * 1024 * 1024;
const MAX_PARTS = 64; // 512 MB
const HASH = /^[0-9a-f]{64}$/;
const wrap = (fn: (req: Request<Record<string, string>>, res: Response) => Promise<unknown>) => (req: Request<Record<string, string>>, res: Response, next: NextFunction) => fn(req, res).catch(next);
const okType = (t: unknown) => (typeof t === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(t) ? t : 'application/octet-stream');

export function audioRoutes(blobs: Blobs) {
  const r = express.Router();
  const raw = express.raw({ type: () => true, limit: PART_SIZE + 1024 });

  r.head('/audio/:hash', wrap(async (req, res) => {
    if (!HASH.test(req.params.hash)) throw new HttpError(400, 'Bad id');
    const s = await blobs.stat(audioKey(req.params.hash));
    res.status(s ? 200 : 404).end();
  }));

  r.get('/audio/:hash', wrap(async (req, res) => {
    if (!HASH.test(req.params.hash)) throw new HttpError(400, 'Bad id');
    const key = audioKey(req.params.hash);
    const s = await blobs.stat(key);
    if (!s) throw new HttpError(404, 'Audio not found');
    res.setHeader('Content-Type', s.contentType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && s.size > 0) {
      let start = m[1] ? +m[1] : s.size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], s.size - 1) : s.size - 1;
      if (!m[1]) end = s.size - 1;
      if (start < 0 || start > end) { res.status(416).setHeader('Content-Range', `bytes */${s.size}`).end(); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${s.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      blobs.read(key, { start, end }).on('error', () => res.destroy()).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(s.size));
    blobs.read(key).on('error', () => res.destroy()).pipe(res);
  }));

  /* one-shot upload (up to 8 MB) */
  r.put('/audio/:hash', raw, wrap(async (req, res) => {
    const hash = req.params.hash;
    if (!HASH.test(hash)) throw new HttpError(400, 'Bad id');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty upload');
    if (createHash('sha256').update(body).digest('hex') !== hash) throw new HttpError(400, 'Checksum mismatch: the file changed in transit. Try again.');
    if (!(await blobs.stat(audioKey(hash)))) await blobs.write(audioKey(hash), body, okType(req.headers['content-type']));
    res.status(201).json({ hash });
  }));

  /* multipart upload: create → parts → complete */
  r.post('/uploads', express.json(), wrap(async (req, res) => {
    const parts = Number(req.body?.parts);
    if (!HASH.test(String(req.body?.hash)) || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) throw new HttpError(400, `Uploads can have 1–${MAX_PARTS} parts of up to 8 MB.`);
    if (await blobs.stat(audioKey(req.body.hash))) return void res.json({ exists: true });
    res.status(201).json({ uploadId: randomUUID(), partSize: PART_SIZE });
  }));
  r.put('/uploads/:id/:n', raw, wrap(async (req, res) => {
    const n = Number(req.params.n);
    if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !Number.isInteger(n) || n < 0 || n >= MAX_PARTS) throw new HttpError(400, 'Bad part');
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, 'Empty part');
    await blobs.write(`uploads/${req.params.id}/${String(n).padStart(3, '0')}`, body, 'application/octet-stream');
    res.json({ ok: true });
  }));
  r.post('/uploads/:id/complete', express.json(), wrap(async (req, res) => {
    const { hash, parts } = req.body || {};
    if (!/^[0-9a-f-]{36}$/.test(req.params.id) || !HASH.test(String(hash)) || !Number.isInteger(parts) || parts < 1 || parts > MAX_PARTS) throw new HttpError(400, 'Bad request');
    const keys = Array.from({ length: parts }, (_, n) => `uploads/${req.params.id}/${String(n).padStart(3, '0')}`);
    for (const k of keys) if (!(await blobs.stat(k))) throw new HttpError(400, 'A part is missing. Upload again.');
    const tmp = `uploads/${req.params.id}/joined`;
    await blobs.join(tmp, keys, okType(req.body?.contentType));
    const got = await sha256Of(blobs, tmp);
    if (got !== hash) { await blobs.del(tmp); throw new HttpError(400, 'Checksum mismatch after joining. Upload again.'); }
    if (!(await blobs.stat(audioKey(hash)))) await blobs.copy(tmp, audioKey(hash));
    await blobs.del(tmp);
    res.status(201).json({ hash });
  }));
  return r;
}
