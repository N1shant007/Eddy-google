#!/usr/bin/env bash
# Deploys Eddy v3 to Google Cloud: Cloud Run (app + API), Firestore (data), Cloud Storage (audio),
# Secret Manager (admin password, session secret, pipeline token, optional AI keys), Vertex AI (Gemini).
#
# Safe to run again: it creates only what is missing and then deploys a new revision.
# Run it from the repo folder in Cloud Shell (or anywhere `gcloud` is signed in as a project Owner/Editor):
#
#   PROJECT=cobalt-mind-422108 ./scripts/deploy-gcp.sh
#
# Settings (environment variables, all optional except PROJECT if gcloud has no default project):
#   REGION=us-central1            Cloud Run, bucket and Vertex AI region
#   SERVICE=eddy                  Cloud Run service name
#   BUCKET=<project>-eddy-audio   Cloud Storage bucket for audio
#   FIRESTORE_DATABASE=(default)  FIRESTORE_LOCATION=nam5   (only used when the database does not exist yet)
#   PUBLIC=yes                    yes: anyone with the link reaches the sign-in page. no: only IAM callers (API Gateway)
#   TRUST_PROXY_HOPS=1            1 on Cloud Run directly, 2 behind API Gateway
#   ADMIN_PASSWORD=…              password of the "admin" account (asked for on the first run if not set);
#                                 admin then adds everyone else on the Users page
#   GEMINI_API_KEY=… OPENAI_API_KEY=…   optional; stored in Secret Manager. Without GEMINI_API_KEY, Gemini uses Vertex AI
#                                 with the service account (no key needed).
#   ALLOWED_AUDIO_HOSTS=…  PIPELINE_CALLBACK_URL=…  DRIVE_FOLDER_ID=…   optional pipeline hand-off settings
#   GRANT_BUILDER=yes             let Cloud Build's default service account build from source (needed on new projects)
# Secret values are never printed or written to disk.
set -euo pipefail

PROJECT=${PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}
[[ -n "$PROJECT" ]] || { echo "Set PROJECT=<your project id>"; exit 1; }
REGION=${REGION:-us-central1}
SERVICE=${SERVICE:-eddy}
BUCKET=${BUCKET:-$PROJECT-eddy-audio}
FIRESTORE_DATABASE=${FIRESTORE_DATABASE:-(default)}
FIRESTORE_LOCATION=${FIRESTORE_LOCATION:-nam5}
PUBLIC=${PUBLIC:-yes}
TRUST_PROXY_HOPS=${TRUST_PROXY_HOPS:-1}
GRANT_BUILDER=${GRANT_BUILDER:-yes}
SA_NAME=${SA_NAME:-eddy-run}
SA="$SA_NAME@$PROJECT.iam.gserviceaccount.com"
cd "$(dirname "$0")/.."
g() { gcloud --project "$PROJECT" --quiet "$@"; }
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "1/7 APIs"
g services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firestore.googleapis.com storage.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com iam.googleapis.com

step "2/7 Firestore ($FIRESTORE_DATABASE)"
if g firestore databases describe --database="$FIRESTORE_DATABASE" >/dev/null 2>&1; then
  echo "exists"
else
  g firestore databases create --database="$FIRESTORE_DATABASE" --location="$FIRESTORE_LOCATION" --type=firestore-native
fi

step "3/7 Cloud Storage (gs://$BUCKET)"
if g storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  echo "exists"
else
  g storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention
fi
# unfinished multi-part uploads are cleared after a day
lc=$(mktemp); trap 'rm -f "$lc"' EXIT
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":1,"matchesPrefix":["uploads/"]}}]}' > "$lc"
g storage buckets update "gs://$BUCKET" --lifecycle-file="$lc" >/dev/null && echo "lifecycle: uploads/ cleared after 1 day"

step "4/7 Service account ($SA)"
g iam service-accounts describe "$SA" >/dev/null 2>&1 || g iam service-accounts create "$SA_NAME" --display-name="Eddy (Cloud Run)"
for role in roles/datastore.user roles/aiplatform.user; do
  g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" --condition=None >/dev/null
done
g storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin >/dev/null
echo "Firestore user, Vertex AI user, objectAdmin on the bucket"
if [[ "$GRANT_BUILDER" == yes ]]; then
  num=$(g projects describe "$PROJECT" --format='value(projectNumber)') || num=''
  [[ -n "$num" ]] && g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$num-compute@developer.gserviceaccount.com" --role=roles/run.builder --condition=None >/dev/null || true
fi

step "5/7 Secrets (Secret Manager)"
secrets=()
# put_secret NAME ENV_VAR VALUE: creates the secret, or adds a new version when a value is given for an existing one
put_secret() {
  local name=$1 var=$2 value=$3
  if ! g secrets describe "$name" >/dev/null 2>&1; then
    printf '%s' "$value" | g secrets create "$name" --replication-policy=automatic --data-file=- >/dev/null
    echo "$name: created"
  elif [[ -n "$value" && "${4:-}" == update ]]; then
    printf '%s' "$value" | g secrets versions add "$name" --data-file=- >/dev/null
    echo "$name: new version"
  else
    echo "$name: kept"
  fi
  g secrets add-iam-policy-binding "$name" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
  secrets+=("$var=$name:latest")
}
if ! g secrets describe eddy-admin-password >/dev/null 2>&1 && [[ -z "${ADMIN_PASSWORD:-}" ]]; then
  read -r -s -p "Password for the Eddy \"admin\" account (admin adds the other users): " ADMIN_PASSWORD; echo
fi
if [[ -n "${ADMIN_PASSWORD:-}" && ${#ADMIN_PASSWORD} -lt 8 ]]; then echo "Use at least 8 characters for the admin password."; exit 1; fi
# used only to create the admin account the first time; after that, change passwords on the Users page
put_secret eddy-admin-password ADMIN_PASSWORD "${ADMIN_PASSWORD:-}" update
put_secret eddy-session-secret SESSION_SECRET "$(openssl rand -hex 32)"
put_secret eddy-pipeline-token PIPELINE_TOKEN "$(openssl rand -hex 24)"
# AI keys are optional: added when given now, kept when stored earlier
if [[ -n "${GEMINI_API_KEY:-}" ]] || g secrets describe eddy-gemini-api-key >/dev/null 2>&1; then
  put_secret eddy-gemini-api-key GEMINI_API_KEY "${GEMINI_API_KEY:-}" update
fi
if [[ -n "${OPENAI_API_KEY:-}" ]] || g secrets describe eddy-openai-api-key >/dev/null 2>&1; then
  put_secret eddy-openai-api-key OPENAI_API_KEY "${OPENAI_API_KEY:-}" update
fi

step "6/7 Cloud Run ($SERVICE, $REGION): build from source and deploy"
envs="EDDY_STORAGE=gcp|EDDY_BUCKET=$BUCKET|GOOGLE_CLOUD_PROJECT=$PROJECT|GOOGLE_CLOUD_LOCATION=$REGION|FIRESTORE_DATABASE=$FIRESTORE_DATABASE|FIRESTORE_PREFIX=eddy_|TRUST_PROXY_HOPS=$TRUST_PROXY_HOPS"
for v in ALLOWED_AUDIO_HOSTS PIPELINE_CALLBACK_URL DRIVE_FOLDER_ID GEMINI_MODEL OPENAI_MODEL AI_DAILY_LIMIT; do
  [[ -n "${!v:-}" ]] && envs+="|$v=${!v}"
done
access=--allow-unauthenticated; [[ "$PUBLIC" == yes ]] || access=--no-allow-unauthenticated
g run deploy "$SERVICE" --source . --region "$REGION" --service-account "$SA" \
  --memory 1Gi --cpu 1 --timeout 900 --concurrency 40 --min-instances 0 --max-instances 4 \
  --set-env-vars "^|^$envs" --set-secrets "$(IFS=,; echo "${secrets[*]}")" $access

step "7/7 Check"
URL=$(g run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
auth=(); [[ "$PUBLIC" == yes ]] || auth=(-H "Authorization: Bearer $(gcloud auth print-identity-token)")
ok=''
for _ in 1 2 3 4 5 6; do curl -fsS "${auth[@]}" "$URL/api/health" && { ok=1; echo; break; }; sleep 5; done
if [[ -z "$ok" ]]; then
  echo "Eddy did not answer at $URL/api/health. Logs: gcloud run services logs read $SERVICE --region $REGION --project $PROJECT"
  exit 1
fi
cat <<EOF

Eddy is live: $URL
  Sign in as "admin" with the admin password, then add people on the Users page.
  Admin password (first sign-in):      gcloud secrets versions access latest --secret=eddy-admin-password --project=$PROJECT
  Pipeline token for /api/pipeline/*:  gcloud secrets versions access latest --secret=eddy-pipeline-token --project=$PROJECT
  Full check of the live site (creates and then deletes an "E2E test" folder):
    BASE=$URL ADMIN_PASSWORD=\$(gcloud secrets versions access latest --secret=eddy-admin-password --project=$PROJECT) \\
    PIPELINE_TOKEN=\$(gcloud secrets versions access latest --secret=eddy-pipeline-token --project=$PROJECT) npm run e2e:remote
EOF
