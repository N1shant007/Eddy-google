import { GoogleAuth } from 'google-auth-library';
import type { Readable } from 'node:stream';

/* Saves a file to a Google Drive folder with the service account (share the folder with the service account's email).
   Uses a resumable upload so large mixes work. */

let auth: GoogleAuth | null = null;

export async function uploadToDrive(folderId: string, name: string, mime: string, size: number, body: Readable): Promise<{ id: string; webViewLink?: string }> {
  auth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const start = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify({ name, parents: [folderId], mimeType: mime }),
  });
  const location = start.headers.get('location');
  if (!start.ok || !location) throw new Error(`Drive refused the upload (${start.status}): ${await start.text()}`);
  const chunks: Buffer[] = [];
  for await (const c of body) chunks.push(c as Buffer);
  const put = await fetch(location, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(size) }, body: Buffer.concat(chunks) });
  if (!put.ok) throw new Error(`Drive upload failed (${put.status}): ${await put.text()}`);
  return (await put.json()) as { id: string; webViewLink?: string };
}
