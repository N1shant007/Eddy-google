import { ApiBackend } from './api';
import { DemoBackend } from './demoBackend';
import type { Account, Backend, UserInfo } from './types';

/** what the app needs from storage: the Backend interface plus sign-in and the pipeline hand-off */
export interface EddyBackend extends Backend {
  readonly demo?: boolean;
  signIn(username: string, password: string): Promise<UserInfo>;
  /** user accounts (the server only; the browser demo has a single built-in user) */
  accounts?: {
    list(): Promise<Account[]>;
    add(a: { username: string; name: string; password: string; role: 'admin' | 'editor' }): Promise<Account>;
    update(username: string, patch: Partial<{ name: string; password: string; role: 'admin' | 'editor'; disabled: boolean }>): Promise<Account>;
    remove(username: string): Promise<void>;
    changeOwnPassword(current: string, next: string): Promise<void>;
  };
  signOut(): Promise<void>;
  markAutoEdited(id: string): Promise<void>;
  putAudio(file: Blob, onProgress?: (p: number) => void): Promise<string>;
  sendFinal(projectId: string, mp3: Blob, filename: string, onProgress?: (p: number) => void): Promise<{ final: any; warnings: string[] }>;
}

/** the Eddy server (Firestore + Cloud Storage + Gemini); the browser-only demo when built with VITE_DEMO=1 */
export function makeBackend(): EddyBackend {
  return import.meta.env.VITE_DEMO ? new DemoBackend() : new ApiBackend();
}
