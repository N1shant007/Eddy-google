import { create } from 'zustand';
import type { Asset, Category, Guideline } from '@eddy/rules';
import { makeBackend } from '../data/backend';
import { importStarterLibrary } from '../data/seed';
import type { EddyBackend } from '../data/backend';
import type { Folder, ProjectMeta, UserInfo } from '../data/types';

export type View = 'projects' | 'editor' | 'library' | 'guidelines';

interface Toast { id: number; text: string; kind?: 'error' | 'ok' }

interface AppState {
  be: EddyBackend;
  ready: boolean;
  user: UserInfo | null;
  view: View;
  folders: Folder[];
  projects: ProjectMeta[];
  currentFolder: string | null;
  openProjectId: string | null;
  categories: Category[];
  assets: Asset[];
  guidelines: Guideline[];
  toasts: Toast[];

  init(): Promise<void>;
  signedIn(user: UserInfo): Promise<void>;
  /** first run: an empty library gets the Bajaj starter library (24 sounds, categories, guidelines) */
  ensureLibrary(): Promise<void>;
  libraryImport: string | null;
  setView(v: View): void;
  refresh(): Promise<void>;
  refreshLibrary(): Promise<void>;
  openFolder(id: string | null): void;
  openProject(id: string): void;
  toast(text: string, kind?: Toast['kind'], ms?: number): void;
}

let tid = 0;

export const useApp = create<AppState>((set, get) => ({
  be: makeBackend(),
  ready: false,
  user: null,
  view: 'projects',
  folders: [],
  projects: [],
  currentFolder: null,
  openProjectId: null,
  categories: [],
  assets: [],
  guidelines: [],
  toasts: [],
  libraryImport: null,

  async signedIn(user) {
    set({ user });
    await Promise.all([get().refresh(), get().refreshLibrary()]);
    void get().ensureLibrary();
    // a link straight to a project (#/p/<id>, e.g. from the pipeline) opens it after sign-in
    const m = location.hash.match(/^#\/p\/(.+)$/);
    if (m) set({ openProjectId: m[1], view: 'editor' });
  },
  async init() {
    const user = await get().be.user();
    set({ user });
    if (user) { await Promise.all([get().refresh(), get().refreshLibrary()]); void get().ensureLibrary(); }
    // deep link: #/p/<id>
    const m = location.hash.match(/^#\/p\/(.+)$/);
    if (user && m) set({ openProjectId: m[1], view: 'editor' });
    set({ ready: true });
  },
  async ensureLibrary() {
    const { assets, categories, be, libraryImport } = get();
    if (libraryImport || assets.length || categories.length) return;
    set({ libraryImport: 'Importing the audio library…' });
    try {
      await importStarterLibrary(be, (d, t, name) => set({ libraryImport: name ? `Importing the audio library: ${name} (${d + 1}/${t})` : null }));
      await get().refreshLibrary();
      get().toast(`Audio library imported: ${get().assets.length} sounds and the storytelling guidelines`, 'ok', 5000);
    } catch (e: any) {
      get().toast(`The audio library could not be imported: ${e?.message || e}. Try Audio library → Import starter library.`, 'error', 8000);
    } finally { set({ libraryImport: null }); }
  },
  setView(view) {
    set({ view });
    if (view !== 'editor') history.replaceState(null, '', location.pathname);
  },
  async refresh() {
    const be = get().be;
    const [folders, projects] = await Promise.all([be.listFolders(), be.listProjects()]);
    set({ folders, projects });
  },
  async refreshLibrary() {
    const be = get().be;
    const [categories, assets, guidelines] = await Promise.all([be.listCategories(), be.listAssets(), be.listGuidelines()]);
    set({ categories, assets, guidelines });
  },
  openFolder(id) {
    set({ currentFolder: id, view: 'projects' });
  },
  openProject(id) {
    set({ openProjectId: id, view: 'editor' });
    history.replaceState(null, '', `#/p/${id}`);
  },
  toast(text, kind, ms = 3500) {
    const t = { id: ++tid, text, kind };
    set({ toasts: [...get().toasts, t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), ms);
  },
}));
