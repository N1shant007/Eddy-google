import { create } from 'zustand';
import type { Asset, Category, Guideline } from '@eddy/rules';
import { makeBackend } from '../data/backend';
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

  async signedIn(user) {
    set({ user });
    await Promise.all([get().refresh(), get().refreshLibrary()]);
    // a link straight to a project (#/p/<id>, e.g. from the pipeline) opens it after sign-in
    const m = location.hash.match(/^#\/p\/(.+)$/);
    if (m) set({ openProjectId: m[1], view: 'editor' });
  },
  async init() {
    const user = await get().be.user();
    set({ user });
    if (user) await Promise.all([get().refresh(), get().refreshLibrary()]);
    // deep link: #/p/<id>
    const m = location.hash.match(/^#\/p\/(.+)$/);
    if (user && m) set({ openProjectId: m[1], view: 'editor' });
    set({ ready: true });
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
