import type { Asset, Category, Guideline, ProjectDoc } from '@eddy/rules';
import type { Backend, Folder, Project, ProjectMeta, UserInfo, Version, VersionMeta } from './types';
import { sha256 } from './util';

/* Talks to the Eddy server (Express on Cloud Run): Firestore data, Cloud Storage audio, Gemini.
   The session is a cookie set by the passcode gate, so every request is same-origin with credentials. */

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
let onSignedOut: (() => void) | null = null;
export const setSignedOutHandler = (f: () => void) => { onSignedOut = f; };

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const r = await fetch('/api' + path, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(rest.headers || {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (r.status === 401 && path !== '/session') onSignedOut?.();
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new ApiError(r.status, j?.error || `Request failed (${r.status})`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}

const PART = 8 * 1024 * 1024;

export class ApiBackend implements Backend {
  readonly kind = 'cloud' as const;
  private blobCache = new Map<string, Blob>();
  private me: UserInfo | null = null;

  /* ---------- session (team passcode) ---------- */
  async user(): Promise<UserInfo | null> {
    if (this.me) return this.me;
    try { const s = await api<{ name: string }>('/session'); return (this.me = { id: s.name, email: '', name: s.name }); }
    catch { return null; }
  }
  async signIn(passcode: string, name: string) {
    const s = await api<{ name: string }>('/session', { method: 'POST', json: { passcode, name } });
    this.me = { id: s.name, email: '', name: s.name };
    return this.me;
  }
  async signOut() { await api('/session', { method: 'DELETE' }).catch(() => {}); this.me = null; }

  /* ---------- folders ---------- */
  listFolders() { return api<Folder[]>('/folders'); }
  createFolder(name: string, parentId: string | null) { return api<Folder>('/folders', { method: 'POST', json: { name, parentId } }); }
  async renameFolder(id: string, name: string) { await api(`/folders/${id}`, { method: 'PATCH', json: { name } }); }
  async moveFolder(id: string, parentId: string | null) { await api(`/folders/${id}`, { method: 'PATCH', json: { parentId } }); }
  async deleteFolder(id: string) { await api(`/folders/${id}`, { method: 'DELETE' }); }

  /* ---------- projects ---------- */
  listProjects() { return api<ProjectMeta[]>('/projects'); }
  createProject(name: string, folderId: string | null, doc: ProjectDoc) { return api<ProjectMeta>('/projects', { method: 'POST', json: { name, folderId, doc } }); }
  async getProject(id: string) {
    try { return await api<Project>(`/projects/${id}`); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }
  async renameProject(id: string, name: string) { await api(`/projects/${id}`, { method: 'PATCH', json: { name } }); }
  async moveProject(id: string, folderId: string | null) { await api(`/projects/${id}`, { method: 'PATCH', json: { folderId } }); }
  async deleteProject(id: string) { await api(`/projects/${id}`, { method: 'DELETE' }); }
  async saveDraft(id: string, doc: ProjectDoc, duration?: number) { await api(`/projects/${id}/draft`, { method: 'PUT', json: { doc, duration } }); }
  async markAutoEdited(id: string) { await api(`/projects/${id}`, { method: 'PATCH', json: { autoEditDone: true } }); }

  /* ---------- versions ---------- */
  saveVersion(projectId: string, doc: ProjectDoc, note: string) { return api<VersionMeta>(`/projects/${projectId}/versions`, { method: 'POST', json: { doc, note } }); }
  listVersions(projectId: string) { return api<VersionMeta[]>(`/projects/${projectId}/versions`); }
  async getVersion(id: string) {
    try { return await api<Version>(`/versions/${encodeURIComponent(id)}`); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }

  /* ---------- library ---------- */
  listCategories() { return api<Category[]>('/categories'); }
  async saveCategory(c: Category) { await api(`/categories/${encodeURIComponent(c.id)}`, { method: 'PUT', json: c }); }
  async deleteCategory(id: string) { await api(`/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  listAssets() { return api<Asset[]>('/assets'); }
  async putAsset(meta: Omit<Asset, 'hash' | 'size' | 'mime'>, file: Blob) {
    const hash = await this.putAudio(file);
    return api<Asset>(`/assets/${hash}`, { method: 'PUT', json: { ...meta, size: file.size, mime: file.type || 'audio/mpeg' } });
  }
  async updateAsset(hash: string, patch: Partial<Asset>) { await api(`/assets/${hash}`, { method: 'PATCH', json: patch }); }
  async deleteAsset(hash: string) { await api(`/assets/${hash}`, { method: 'DELETE' }); }
  listGuidelines() { return api<Guideline[]>('/guidelines'); }
  async saveGuideline(g: Guideline) { await api(`/guidelines/${encodeURIComponent(g.id)}`, { method: 'PUT', json: g }); }

  /* ---------- audio ---------- */
  async getAudio(hash: string): Promise<Blob | null> {
    const hit = this.blobCache.get(hash);
    if (hit) return hit;
    const url = `/api/audio/${hash}`;
    const cache = 'caches' in self ? await caches.open('eddy-audio').catch(() => null) : null;
    let res = cache ? await cache.match(url) : undefined;
    if (!res) {
      res = await fetch(url, { credentials: 'same-origin' });
      if (res.status === 401) onSignedOut?.();
      if (!res.ok) return null;
      if (cache) await cache.put(url, res.clone()).catch(() => {}); // content-addressed: safe to keep
    }
    const b = await res.blob();
    this.blobCache.set(hash, b);
    return b;
  }
  /** uploads once per content; files over 8 MB go up in parts (Cloud Run's request limit is 32 MB) */
  async putAudio(file: Blob, onProgress?: (p: number) => void): Promise<string> {
    const hash = await sha256(file);
    const type = file.type || 'application/octet-stream';
    const head = await fetch(`/api/audio/${hash}`, { method: 'HEAD', credentials: 'same-origin' });
    if (!head.ok) {
      if (file.size <= PART) {
        await api(`/audio/${hash}`, { method: 'PUT', headers: { 'Content-Type': type }, body: file });
      } else {
        const parts = Math.ceil(file.size / PART);
        const up = await api<{ uploadId?: string; exists?: boolean }>('/uploads', { method: 'POST', json: { hash, parts, size: file.size, contentType: type } });
        if (!up.exists) {
          for (let n = 0; n < parts; n++) {
            await api(`/uploads/${up.uploadId}/${n}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(n * PART, (n + 1) * PART) });
            onProgress?.((n + 1) / parts);
          }
          await api(`/uploads/${up.uploadId}/complete`, { method: 'POST', json: { hash, parts, contentType: type } });
        }
      }
    }
    onProgress?.(1);
    this.blobCache.set(hash, file);
    return hash;
  }

  /* ---------- hand-off ---------- */
  async sendFinal(projectId: string, mp3: Blob, filename: string, onProgress?: (p: number) => void) {
    const hash = await this.putAudio(mp3, onProgress);
    return api<{ final: any; warnings: string[] }>(`/projects/${projectId}/final`, { method: 'POST', json: { hash, filename } });
  }
}
