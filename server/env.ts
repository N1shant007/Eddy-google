import { existsSync } from 'node:fs';

/* Loads secrets from a local .env file (development, or a mounted file). Imported first by server.ts so
   config.ts sees the values. On Cloud Run, secrets come from Secret Manager as environment variables instead.
   .env files are git-ignored and docker-ignored: they never reach GitHub or the image. Real env vars win. */
for (const f of ['.env.local', '.env']) {
  if (existsSync(f)) {
    try { process.loadEnvFile(f); } catch (e) { console.warn(`[eddy] could not read ${f}: ${(e as Error).message}`); }
  }
}
