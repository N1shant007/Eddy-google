import { existsSync, readFileSync } from 'node:fs';

/* Loads secrets from a local .env file (development, or a mounted file). Imported first by server.ts so
   config.ts sees the values. On Cloud Run, secrets come from Secret Manager as environment variables instead.
   .env files are git-ignored and docker-ignored: they never reach GitHub or the image. Real env vars win.
   A small parser (not process.loadEnvFile) so it works on every Node 20 release. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.endsWith(q) && v.length >= 2) {
      v = v.slice(1, -1);
      if (q === '"') v = v.replace(/\\n/g, '\n');
    } else {
      v = v.replace(/\s+#.*$/, '');
    }
    out[m[1]] = v;
  }
  return out;
}

for (const f of ['.env.local', '.env']) {
  if (!existsSync(f)) continue;
  try {
    for (const [k, v] of Object.entries(parseEnv(readFileSync(f, 'utf8')))) if (process.env[k] === undefined) process.env[k] = v;
  } catch (e) { console.warn(`[eddy] could not read ${f}: ${(e as Error).message}`); }
}
