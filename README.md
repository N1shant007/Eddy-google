# Eddy for Google Cloud (v3)

Eddy places intro/outro, background music, sound effects and disclaimers on AI-voice podcast episodes, with
projects in folders, full version history, a timeline editor and the Bajaj storytelling auto-edit.
It is Eddy v2 rebuilt for the pipeline's stack and Google Cloud. A browser-only test build (`npm run build:demo`, passcode `demo`) is used for the hosted preview.

| Part | Technology |
|---|---|
| Server | Node 22 + Express 5 (`server.ts`), TypeScript |
| Frontend | React 19 + Vite 6 + Tailwind 4, TypeScript; Konva timeline, Zustand, Web Audio, lamejs, JSZip |
| Data | Firestore (collections prefixed `eddy_`) |
| Audio | Cloud Storage bucket (`audio/<sha256>`, `exports/<project>/…`) |
| AI | Gemini via `@google/genai`: Vertex AI with the service account, or an API key kept server-side |
| Sign-in | Team passcode gate (`EDDY_PASSCODE`), signed session cookie |
| Hosting | One container on Cloud Run (us-central1), behind API Gateway |

## Run locally (no Google Cloud needed)

```bash
npm install
EDDY_STORAGE=local EDDY_PASSCODE=pick-one SESSION_SECRET=$(openssl rand -hex 32) npm run dev   # http://localhost:8080
npm test            # rules engine + API tests (32)
```

`EDDY_STORAGE=local` keeps data and audio in `.data`. Then open **Audio library → Import starter library** once.
To try the real services locally, set `EDDY_BUCKET`, `GOOGLE_CLOUD_PROJECT` and run `gcloud auth application-default login`.

## Configuration (environment variables only)

See `.env.example`. Secrets (`EDDY_PASSCODE`, `SESSION_SECRET`, `PIPELINE_TOKEN`) belong in Secret Manager, mounted as env vars on Cloud Run.

| Variable | Needed | What it does |
|---|---|---|
| `EDDY_PASSCODE` | yes | Team passcode for the sign-in gate |
| `SESSION_SECRET` | yes | Random string (32+ chars) that signs session cookies |
| `EDDY_BUCKET` | yes | Cloud Storage bucket for audio; also switches storage to Firestore + GCS |
| `GOOGLE_CLOUD_PROJECT` | yes | `cobalt-mind-422108`; Firestore, Vertex AI |
| `GOOGLE_CLOUD_LOCATION` | no | Vertex AI region, default `us-central1` |
| `GEMINI_API_KEY` | no (secret) | Gemini API key. Empty = Vertex AI with the service account. Set = Vertex AI express mode |
| `GEMINI_BACKEND` | no | `vertex` (default) or `gemini-api` for a Google AI Studio key |
| `GEMINI_MODEL` | no | Default `gemini-2.5-flash`; use the model the pipeline already uses |
| `FIRESTORE_DATABASE` / `FIRESTORE_PREFIX` | no | Default `(default)` / `eddy_` |
| `PIPELINE_TOKEN` | for hand-off | Bearer token the pipeline uses for `/api/pipeline/*`; also signs callbacks |
| `ALLOWED_AUDIO_HOSTS` | for audio URLs | Hosts the pipeline may send `audioUrl` from (Wondercraft's file host) |
| `DRIVE_FOLDER_ID` | no | Also save each final mix to this Drive folder (share it with the service account) |
| `PIPELINE_CALLBACK_URL` | no | POSTed `{event: "final_mix_ready", …}` when a final mix is saved |
| `AI_DAILY_LIMIT` | no | Gemini requests per person per day, default 60 |

## Keeping keys secret

Keys and passcodes are only ever read by the server, from environment variables:

- **Locally:** copy `.env.example` to `.env` and fill it in. `.env` is git-ignored and docker-ignored, so it is never committed or baked into the image. The server loads it at start-up.
- **Cloud Run:** store each secret in Secret Manager and mount it as an environment variable:

  ```bash
  printf '%s' "<your Gemini API key>" | gcloud secrets create gemini-api-key --data-file=- --project=cobalt-mind-422108
  gcloud secrets add-iam-policy-binding gemini-api-key --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
  # deploy flag: --set-secrets=GEMINI_API_KEY=gemini-api-key:latest,EDDY_PASSCODE=eddy-passcode:latest,SESSION_SECRET=eddy-session-secret:latest
  ```

Safeguards in this repo:
- The browser never receives the key. `GET /api/ai` reports only the model and mode, and errors are scrubbed of the key.
- The build refuses any `VITE_*KEY/SECRET/TOKEN` variable, because `VITE_*` values are published in the browser bundle.
- CI fails if a `.env` file, a Google API key (`AIza…`) or a private key is committed.

## Google Cloud setup (one time)

```bash
PROJECT=cobalt-mind-422108
SA=<cloud-run-service-account>@$PROJECT.iam.gserviceaccount.com
gcloud storage buckets create gs://$PROJECT-eddy-audio --location=us-central1 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://$PROJECT-eddy-audio --member=serviceAccount:$SA --role=roles/storage.objectAdmin
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/datastore.user
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/aiplatform.user
```

Firestore needs no custom indexes. The bucket stays private: audio is served
through Eddy's API to signed-in users.

Container: `docker build -t eddy .` (see `Dockerfile`; listens on `$PORT`, default 8080). Health check: `GET /healthz`.

**Request size:** Cloud Run and API Gateway refuse request bodies over 32 MB, so Eddy uploads audio in 8 MB parts
(`/api/uploads`) and joins them in Cloud Storage. Downloads are streamed with HTTP range support.

## Pipeline hand-off

1. **Pipeline → Eddy:** the pipeline sends the script and the Wondercraft audio. Eddy creates a project, and the first time
   someone opens it, the storytelling auto-edit runs automatically.

   ```http
   POST /api/pipeline/episodes
   Authorization: Bearer $PIPELINE_TOKEN
   Content-Type: application/json

   {
     "title": "Home loan for parents",
     "folder": "Home Loan/Season 1",          // optional, created if missing
     "product": "Home Loan",                   // optional, picks the product disclaimer
     "script": "SHWETA: Welcome…\nKARAN: …",   // NAME: line format; [SFX: …] tags allowed
     "subtitles": "1\n00:00:00,000 --> …",     // optional .srt/.vtt text or ElevenLabs/Whisper JSON: exact timings
     "audioUrl": "https://<wondercraft host>/…mp3",   // or "audioHash" after uploading via /api/uploads
     "externalId": "wondercraft-episode-id"    // optional, echoed back
   }
   → 201 { "projectId": "…", "editorPath": "/#/p/<projectId>", "audioHash": "…" }
   ```

   Audio can also be uploaded first with the pipeline token: `PUT /api/audio/<sha256>` (≤ 8 MB) or
   `POST /api/uploads {hash, parts}` → `PUT /api/uploads/<id>/<n>` → `POST /api/uploads/<id>/complete`.

2. **Eddy → pipeline:** in the editor, **Save final mix** renders the MP3 and stores it under `exports/<projectId>/` in the bucket,
   saves a copy to Google Drive (if `DRIVE_FOLDER_ID` is set) and POSTs `PIPELINE_CALLBACK_URL` (if set) with header
   `X-Eddy-Signature: sha256=<HMAC of the body with PIPELINE_TOKEN>`.
   The pipeline can also poll:

   ```http
   GET /api/pipeline/episodes/<projectId>        → { status: "editing" | "final", final: { uri, filename, size, drive, … } }
   GET /api/pipeline/episodes/<projectId>/final  → the MP3
   ```

## What's in the app

- Projects in nested folders (create, rename, move by menu or drag and drop, delete, duplicate, search, sort).
- Version history: autosave, Save version with a note, compare, restore (as a new version), copy a version as a new project.
- Timeline editor: move, trim, split, duplicate, delete, clip volume and fades, track mute/solo/volume, music dips under voices,
  undo/redo, playback speed 0.5×–2× with natural pitch, play from the beginning, MP3 export.
- Auto-edit: Bajaj storytelling rules (story play / story rewrite, Unfolding Insights, coin chime, warm keys, harp glide,
  2.5 s intro, intro music under the CTA, one music at a time at −10 dB, disclaimers), Gemini, or copy-paste with Claude.
- Ask AI: plain-words edits through Gemini, or exact `EDDY EDIT` instructions.
- Audio library with categories and the Bajaj starter library; guidelines editor.
