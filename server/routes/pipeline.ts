import { createHash, createHmac, randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { audioKey, type Blobs } from '../blobs.js';
import type { Store } from '../store.js';
import { uploadToDrive } from '../drive.js';
import { HttpError } from './data.js';
import { requirePipeline } from '../auth.js';

/* Hand-off with the podcast pipeline.
   IN:  POST /api/pipeline/episodes          the pipeline sends the script + Wondercraft audio; Eddy creates a project
   OUT: POST /api/projects/:id/final         the editor sends the final mix; Eddy stores it, saves to Drive, notifies the pipeline
        GET  /api/pipeline/episodes/:id       status + where the final mix is
        GET  /api/pipeline/episodes/:id/final the final MP3 itself */

const wrap = (fn: (req: Request<Record<string, string>>, res: Response) => Promise<unknown>) => (req: Request<Record<string, string>>, res: Response, next: NextFunction) => fn(req, res).catch(next);
const now = () => new Date().toISOString();
const MAX_FETCH = 512 * 1024 * 1024;

function emptyDoc(product: string, scriptText: string, dialogueHash: string | null) {
  const tracks: any[] = [], clips: any[] = [];
  if (dialogueHash) {
    const t = { id: 't_dialogue', kind: 'dialogue', name: 'Dialogue', vol: 0, duck: 0, mute: false, solo: false };
    tracks.push(t);
    // length is filled in by the editor when it first decodes the audio
    clips.push({ id: 'c_dialogue', trackId: t.id, assetHash: dialogueHash, start: 0, offset: 0, dur: 0, gain: 0, fadeIn: 0, fadeOut: 0, loop: false });
  }
  return {
    schema: 2, product, scriptText, lines: [], dialogueHash, tracks, clips, cues: [], guidelineId: null,
    settings: { hosts: '', outroLen: 7, outroLead: 2, minSpacing: 6, bedFadeIn: 1.5, bedFadeOut: 2, sfxGain: -6, emoGain: -6, transGain: -16 },
  };
}

/** fetches audio from an allowed host (ALLOWED_AUDIO_HOSTS), stores it, returns its hash */
async function fetchAudio(blobs: Blobs, url: string): Promise<string> {
  let u: URL;
  try { u = new URL(url); } catch { throw new HttpError(400, 'audioUrl is not a valid URL'); }
  if (u.protocol !== 'https:') throw new HttpError(400, 'audioUrl must be https');
  const host = u.hostname.toLowerCase();
  if (!config.allowedAudioHosts.some((h) => host === h || host.endsWith('.' + h))) throw new HttpError(400, `Audio host ${host} is not allowed. Add it to ALLOWED_AUDIO_HOSTS.`);
  const r = await fetch(u, { redirect: 'error' });
  if (!r.ok) throw new HttpError(502, `Could not download the audio (${r.status}).`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_FETCH) throw new HttpError(413, 'The audio file is larger than 512 MB.');
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX_FETCH) throw new HttpError(413, 'The audio file is larger than 512 MB.');
  const hash = createHash('sha256').update(buf).digest('hex');
  if (!(await blobs.stat(audioKey(hash)))) await blobs.write(audioKey(hash), buf, r.headers.get('content-type') || 'audio/mpeg');
  return hash;
}

/** "Home Loan/Season 1" → folder id, creating missing folders */
async function folderFor(db: Store, pathStr: string): Promise<string | null> {
  const names = pathStr.split('/').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (!names.length) return null;
  const all = await db.list('folders');
  let parent: string | null = null;
  for (const n of names) {
    let f = all.find((x) => (x.parentId ?? null) === parent && String(x.name).toLowerCase() === n.toLowerCase());
    if (!f) {
      f = { id: randomUUID(), parentId: parent, name: n.slice(0, 120), createdAt: now(), updatedAt: now() };
      await db.set('folders', f.id, f);
      all.push(f);
    }
    parent = f.id;
  }
  return parent;
}

export function pipelineRoutes(db: Store, blobs: Blobs) {
  const r = express.Router();

  r.post('/pipeline/episodes', requirePipeline, express.json({ limit: '4mb' }), wrap(async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || '').trim().slice(0, 160);
    if (!title) throw new HttpError(400, 'title is required');
    let hash: string | null = null;
    if (b.audioHash) {
      if (!/^[0-9a-f]{64}$/.test(b.audioHash) || !(await blobs.stat(audioKey(b.audioHash)))) throw new HttpError(400, 'audioHash not found: upload the audio first (/api/uploads).');
      hash = b.audioHash;
    } else if (b.audioUrl) hash = await fetchAudio(blobs, String(b.audioUrl));
    const folderId = b.folder ? await folderFor(db, String(b.folder)) : null;
    const id = randomUUID();
    const doc = emptyDoc(String(b.product || '').slice(0, 80), String(b.script || '').slice(0, 300_000), hash);
    await db.set('projects', id, {
      folderId, name: title, product: doc.product, createdAt: now(), updatedAt: now(), updatedBy: 'Pipeline', headVersion: 0,
      doc: JSON.stringify(doc),
      pipeline: { externalId: b.externalId ? String(b.externalId).slice(0, 200) : null, subtitles: b.subtitles ? String(b.subtitles).slice(0, 500_000) : null, autoEditPending: b.autoEdit !== false, final: null },
    });
    res.status(201).json({ projectId: id, editorPath: `/#/p/${id}`, audioHash: hash });
  }));

  r.get('/pipeline/episodes/:id', requirePipeline, wrap(async (req, res) => {
    const p = await db.get('projects', req.params.id);
    if (!p) throw new HttpError(404, 'Project not found');
    res.json({ projectId: p.id, title: p.name, externalId: p.pipeline?.externalId ?? null, headVersion: p.headVersion || 0, status: p.pipeline?.final ? 'final' : 'editing', final: p.pipeline?.final ?? null });
  }));

  r.get('/pipeline/episodes/:id/final', requirePipeline, wrap(async (req, res) => {
    const p = await db.get('projects', req.params.id);
    const f = p?.pipeline?.final;
    if (!f) throw new HttpError(404, 'No final mix yet');
    const s = await blobs.stat(f.key);
    if (!s) throw new HttpError(404, 'Final mix file is missing');
    res.setHeader('Content-Type', s.contentType);
    res.setHeader('Content-Length', String(s.size));
    res.setHeader('Content-Disposition', `attachment; filename="${String(f.filename).replace(/"/g, '')}"`);
    blobs.read(f.key).on('error', () => res.destroy()).pipe(res);
  }));

  /* called by the editor (signed-in user) once the final MP3 is uploaded as audio/<hash> */
  r.post('/projects/:id/final', express.json(), wrap(async (req, res) => {
    const p = await db.get('projects', req.params.id);
    if (!p) throw new HttpError(404, 'Project not found');
    const hash = String(req.body?.hash || '');
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new HttpError(400, 'Bad audio id');
    const src = await blobs.stat(audioKey(hash));
    if (!src) throw new HttpError(400, 'Upload the mix first');
    const safe = String(req.body?.filename || p.name || 'episode').replace(/[^\w\- .]+/g, '').trim().slice(0, 120) || 'episode';
    const filename = /\.mp3$/i.test(safe) ? safe : `${safe}.mp3`;
    const key = `exports/${p.id}/${new Date().toISOString().replace(/[:.]/g, '-')}-${filename}`;
    await blobs.copy(audioKey(hash), key);
    const final: Record<string, any> = { key, uri: blobs.uri(key), filename, size: src.size, hash, versionNo: p.headVersion || 0, savedAt: now(), savedBy: req.user?.name ?? null, drive: null, callback: null };
    const warnings: string[] = [];
    if (config.driveFolderId) {
      try { final.drive = await uploadToDrive(config.driveFolderId, filename, 'audio/mpeg', src.size, blobs.read(key)); }
      catch (e: any) { warnings.push(`Saved to Cloud Storage, but Google Drive refused it: ${e?.message || e}`); }
    }
    await db.update('projects', p.id, { 'pipeline.final': final, updatedAt: now() });
    if (config.callbackUrl) {
      const payload = JSON.stringify({ event: 'final_mix_ready', projectId: p.id, externalId: p.pipeline?.externalId ?? null, title: p.name, final });
      try {
        const sig = config.pipelineToken ? createHmac('sha256', config.pipelineToken).update(payload).digest('hex') : '';
        const r2 = await fetch(config.callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(sig ? { 'X-Eddy-Signature': `sha256=${sig}` } : {}) }, body: payload });
        final.callback = r2.ok ? 'sent' : `failed (${r2.status})`;
        if (!r2.ok) warnings.push(`The pipeline was not notified (${r2.status}).`);
      } catch (e: any) { final.callback = 'failed'; warnings.push(`The pipeline was not notified: ${e?.message || e}`); }
      await db.update('projects', p.id, { 'pipeline.final': final });
    }
    res.json({ final, warnings });
  }));
  return r;
}
