import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Only VITE_* variables reach the browser bundle. Refuse to build if a secret was given that prefix by mistake.
function refuseSecrets(env: Record<string, string | undefined>) {
  for (const k of Object.keys(env)) {
    if (k.startsWith('VITE_') && /KEY|SECRET|TOKEN|PASSCODE|PASSWORD/i.test(k)) {
      throw new Error(`${k} would be published in the browser bundle. Secrets must not start with VITE_.`);
    }
  }
}

export default defineConfig((({ mode }: { mode: string }) => {
  refuseSecrets({ ...process.env, ...loadEnv(mode, process.cwd(), 'VITE_') });
  return {
  // the hosted test build (mode "demo") runs from any folder
  base: mode === 'demo' ? './' : '/',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@eddy/rules': fileURLToPath(new URL('./src/shared/rules/index.ts', import.meta.url)) } },
  build: {
    outDir: mode === 'demo' ? 'dist-demo' : 'dist',
    // no source maps on the live site (they would publish the source); kept for local and test builds
    sourcemap: mode !== 'production',
    rollupOptions: { output: { manualChunks: { konva: ['konva', 'react-konva'], react: ['react', 'react-dom'] } } },
  },
  test: { environment: 'node' },
  };
}) as any);
