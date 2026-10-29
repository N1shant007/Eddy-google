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
| AI | Gemini via `@google/genai` (Vertex AI or API key) and ChatGPT (OpenAI API); keys kept server-side; provider and model picked in the editor |
| Sign-in | Team passcode gate (`EDDY_PASSCODE`), signed session cookie |
| Hosting | One container on Cloud Run (us-central1), behind API Gateway |

## Run locally (no Google Cloud needed)

**Windows:** double-click `Setup Eddy (Windows).bat`. It installs Node.js if needed, the libraries, a private `.env` (passcode `eddy-local`), runs the tests, builds and starts Eddy on http://localhost:8080. Later, start it with `scripts\windows\start-eddy.bat`.

**macOS / Linux:**

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
| `GEMINI_MODEL` / `GEMINI_MODELS` | no | Default model, and the list people can pick (default `gemini-2.5-flash,gemini-2.5-pro`) |
| `OPENAI_API_KEY` | no (secret) | Turns on ChatGPT |
| `OPENAI_MODEL` / `OPENAI_MODELS` | no | Default model (`gpt-4.1-mini`), and an optional fixed list; empty = the chat models the key can use |
| `FIRESTORE_DATABASE` / `FIRESTORE_PREFIX` | no | Default `(default)` / `eddy_` |
| `PIPELINE_TOKEN` | for hand-off | Bearer token the pipeline uses for `/api/pipeline/*`; also signs callbacks |
| `ALLOWED_AUDIO_HOSTS` | for audio URLs | Hosts the pipeline may send `audioUrl` from (Wondercraft's file host) |
| `DRIVE_FOLDER_ID` | no | Also save each final mix to this Drive folder (share it with the service account) |
| `PIPELINE_CALLBACK_URL` | no | POSTed `{event: "final_mix_ready", …}` when a final mix is saved |
| `AI_DAILY_LIMIT` | no | Gemini requests per person per day, default 60 |

## Keeping keys secret

Keys and passcodes are only ever read by the server, from environment variables:

- **Locally:** copy `.env.example` to `.env` and fill it in. `.env` is git-ignored and docker-ignored, so it is never committed or baked into the image. The server loads it at start-up.
- **Cloud Run:** `scripts/deploy-gcp.sh` stores them in Secret Manager for you. By hand:

  ```bash
  printf '%s' "<your Gemini API key>" | gcloud secrets create eddy-gemini-api-key --data-file=- --project=cobalt-mind-422108
  printf '%s' "<your OpenAI API key>" | gcloud secrets create eddy-openai-api-key --data-file=- --project=cobalt-mind-422108
  gcloud secrets add-iam-policy-binding eddy-gemini-api-key --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
  # deploy flag: --set-secrets=GEMINI_API_KEY=eddy-gemini-api-key:latest,OPENAI_API_KEY=eddy-openai-api-key:latest,EDDY_PASSCODE=eddy-passcode:latest,SESSION_SECRET=eddy-session-secret:latest
  ```

Safeguards in this repo:
- The browser never receives the key. `GET /api/ai` reports only the model and mode, and errors are scrubbed of the key.
- The build refuses any `VITE_*KEY/SECRET/TOKEN` variable, because `VITE_*` values are published in the browser bundle.
- CI fails if a `.env` file, a Google API key (`AIza…`), an OpenAI key (`sk-…`) or a private key is committed.

## Deploy to Google Cloud

Full documentation, functional requirements with acceptance tests, and the deployment runbook:
[`docs/Eddy-v3-Documentation-and-Requirements.txt`](docs/Eddy-v3-Documentation-and-Requirements.txt).
The team passcode is a secret: give it to the deploy script when asked (or as `EDDY_PASSCODE=…`); it is stored only in Secret Manager.


One script sets up everything and deploys: Firestore (Native mode), a private Cloud Storage bucket, a service account
with only the roles Eddy needs, Secret Manager secrets, and a Cloud Run service built from this repo's `Dockerfile`.
It is safe to run again (it creates only what is missing, then deploys a new revision).

In [Cloud Shell](https://shell.cloud.google.com) (or any terminal where `gcloud` is signed in as a project Owner/Editor):

```bash
git clone -b v3 https://github.com/N1shant007/Eddy-google.git && cd Eddy-google
PROJECT=cobalt-mind-422108 ./scripts/deploy-gcp.sh
```

It asks for the team passcode the first time. Optional settings go in front of the command, for example
`GEMINI_API_KEY=… OPENAI_API_KEY=… ALLOWED_AUDIO_HOSTS=cdn.wondercraft.ai PUBLIC=no TRUST_PROXY_HOPS=2` (behind API Gateway).
Without `GEMINI_API_KEY`, Gemini runs on Vertex AI with the service account, so no key is needed.

| What it creates | Name |
|---|---|
| Cloud Run service | `eddy` (us-central1, 1 GiB, scales 0–4) |
| Firestore database | `(default)`, collections `eddy_folders`, `eddy_projects`, `eddy_versions`, `eddy_categories`, `eddy_assets`, `eddy_guidelines` |
| Cloud Storage bucket | `<project>-eddy-audio` (private; unfinished uploads cleared after a day) |
| Service account | `eddy-run@…` with Firestore user, Vertex AI user, and object admin on the bucket only |
| Secrets | `eddy-passcode`, `eddy-session-secret`, `eddy-pipeline-token`, and `eddy-gemini-api-key` / `eddy-openai-api-key` if given |

After deploying, check the live site end to end (it creates an "E2E test" folder, runs through everything, then deletes it):

```bash
BASE=<service URL> PASSCODE=$(gcloud secrets versions access latest --secret=eddy-passcode) \
PIPELINE_TOKEN=$(gcloud secrets versions access latest --secret=eddy-pipeline-token) npm run e2e:remote
```

Firestore needs no custom indexes. The bucket stays private: audio is served through Eddy's API to signed-in users.
Health check: `GET /api/health` (Cloud Run reserves `/healthz`).

### Tested before deploying

- `npm test`: rules engine and API (local storage).
- `npm run test:gcp`: the same API tests against Firestore and Cloud Storage emulators (`pip install gcp-storage-emulator`).
- `npm run build && npm run e2e:gcp`: the production build against the emulators in a real browser: sign in, starter
  library, folders, a 26 MB episode uploaded in parts, auto-edit, versions, final mix, reload, pipeline hand-off, clean-up.

Edits and pipeline subtitles are stored compressed, so a long episode fits within Firestore's 1 MiB document limit;
the server also refuses data Firestore cannot hold (lists inside lists, oversize documents) with a clear message, in
local mode too.

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
- Auto-edit: pick Rules, AI (Gemini or ChatGPT, then the model) or Copy-paste before running; Bajaj storytelling rules (story play / story rewrite, Unfolding Insights, coin chime, warm keys, harp glide,
  2.5 s intro, intro music under the CTA, one music at a time at −10 dB, disclaimers), Gemini, or copy-paste with Claude.
- Ask AI: plain-words edits through Gemini, or exact `EDDY EDIT` instructions.
- Audio library with categories and the Bajaj starter library; guidelines editor.
