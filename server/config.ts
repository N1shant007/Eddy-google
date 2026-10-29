/* All configuration comes from environment variables. Nothing secret is ever written to the repo. */
const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  production: env.NODE_ENV === 'production' || process.argv.includes('--production'),
  /** 'local' keeps data and audio in ./.data (development without Google Cloud) */
  storage: (env.EDDY_STORAGE || (env.EDDY_BUCKET ? 'gcp' : 'local')) as 'gcp' | 'local',
  dataDir: env.EDDY_DATA_DIR || '.data',
  /** proxies in front of the app that add X-Forwarded-For: 1 on Cloud Run, 2 behind API Gateway */
  trustProxyHops: Number(env.TRUST_PROXY_HOPS || 1),

  /** password for the first account, "admin" (EDDY_PASSCODE is accepted for older setups) */
  adminPassword: env.ADMIN_PASSWORD || env.EDDY_PASSCODE || '',
  sessionSecret: env.SESSION_SECRET || '',
  pipelineToken: env.PIPELINE_TOKEN || '',

  project: env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || '',
  location: env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  bucket: env.EDDY_BUCKET || '',
  firestoreDatabase: env.FIRESTORE_DATABASE || '(default)',
  prefix: env.FIRESTORE_PREFIX ?? 'eddy_',

  geminiModel: env.GEMINI_MODEL || 'gemini-2.5-flash',
  /** Gemini through Vertex AI with the service account (no key). Off on a PC with emulators, where there is no service account */
  vertexEnabled: env.GEMINI_VERTEX !== 'off',
  /** optional API key (secret). Without it, Vertex AI uses the Cloud Run service account. */
  geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
  /** extra Gemini models people can pick in the editor (comma separated) */
  geminiModels: (env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.5-pro').split(',').map((s) => s.trim()).filter(Boolean),
  /** ChatGPT: secret key, the default model, and optionally a fixed list of models (else read from the key's account) */
  openaiApiKey: env.OPENAI_API_KEY || '',
  openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
  openaiModels: (env.OPENAI_MODELS || '').split(',').map((s) => s.trim()).filter(Boolean),
  openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
  /** 'vertex' (default; with a key this is Vertex AI express mode) or 'gemini-api' (Google AI Studio key) */
  geminiBackend: (env.GEMINI_BACKEND === 'gemini-api' ? 'gemini-api' : 'vertex') as 'vertex' | 'gemini-api',
  aiDailyLimit: Number(env.AI_DAILY_LIMIT || 60),
  aiEnabled: env.EDDY_AI !== 'off',

  driveFolderId: env.DRIVE_FOLDER_ID || '',
  callbackUrl: env.PIPELINE_CALLBACK_URL || '',
  allowedAudioHosts: (env.ALLOWED_AUDIO_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
};

export function checkConfig(): string[] {
  const problems: string[] = [];
  if (!config.adminPassword) problems.push('ADMIN_PASSWORD is not set: the admin account can only be created once it is.');
  else if (config.adminPassword.length < 8) problems.push('ADMIN_PASSWORD should be at least 8 characters.');
  if (!config.sessionSecret || config.sessionSecret.length < 24) problems.push('SESSION_SECRET must be set to a random string of at least 24 characters.');
  if (config.geminiBackend === 'gemini-api' && !config.geminiApiKey) problems.push('GEMINI_BACKEND=gemini-api needs GEMINI_API_KEY.');
  if (config.storage === 'gcp' && !config.bucket) problems.push('EDDY_BUCKET is required when EDDY_STORAGE=gcp.');
  return problems;
}
