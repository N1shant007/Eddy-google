/* All configuration comes from environment variables. Nothing secret is ever written to the repo. */
const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  production: env.NODE_ENV === 'production',
  /** 'local' keeps data and audio in ./.data (development without Google Cloud) */
  storage: (env.EDDY_STORAGE || (env.EDDY_BUCKET ? 'gcp' : 'local')) as 'gcp' | 'local',
  dataDir: env.EDDY_DATA_DIR || '.data',

  passcode: env.EDDY_PASSCODE || '',
  sessionSecret: env.SESSION_SECRET || '',
  pipelineToken: env.PIPELINE_TOKEN || '',

  project: env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || '',
  location: env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  bucket: env.EDDY_BUCKET || '',
  firestoreDatabase: env.FIRESTORE_DATABASE || '(default)',
  prefix: env.FIRESTORE_PREFIX ?? 'eddy_',

  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
  aiDailyLimit: Number(env.AI_DAILY_LIMIT || 60),
  aiEnabled: env.EDDY_AI !== 'off',

  driveFolderId: env.DRIVE_FOLDER_ID || '',
  callbackUrl: env.PIPELINE_CALLBACK_URL || '',
  allowedAudioHosts: (env.ALLOWED_AUDIO_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
};

export function checkConfig(): string[] {
  const problems: string[] = [];
  if (!config.passcode) problems.push('EDDY_PASSCODE is not set: nobody can sign in.');
  if (!config.sessionSecret || config.sessionSecret.length < 24) problems.push('SESSION_SECRET must be set to a random string of at least 24 characters.');
  if (config.storage === 'gcp' && !config.bucket) problems.push('EDDY_BUCKET is required when EDDY_STORAGE=gcp.');
  return problems;
}
