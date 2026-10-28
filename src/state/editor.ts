import { create } from 'zustand';
import type { Asset, Clip, ProjectDoc } from '@eddy/rules';
import { emptyDoc, kindForRole, pruneTracks, trackFor } from '@eddy/rules';
import { uid } from '../data/util';

export { TRACK_ORDER, kindForRole, trackFor, pruneTracks } from '@eddy/rules';

const r2 = (x: number) => Math.round(x * 100) / 100;
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

interface EditorState {
  projectId: string | null;
  doc: ProjectDoc;
  sel: string | null;
  playhead: number;
  playing: boolean;
  pps: number;       // pixels per second
  scrollX: number;   // seconds at the left edge
  undo: ProjectDoc[];
  redo: ProjectDoc[];
  save: SaveState;
  rev: number;       // bumps on every doc change (autosave trigger)

  load(projectId: string, doc: ProjectDoc): void;
  /** change the doc; pushes an undo step unless `undoable` is false */
  edit(fn: (d: ProjectDoc) => void, undoable?: boolean): void;
  /** call once before a drag, then edit(…, false) during it */
  checkpoint(): void;
  undoStep(): void;
  redoStep(): void;
  select(id: string | null): void;
  setPlayhead(t: number): void;
  setZoom(pps: number, anchorT?: number, anchorPx?: number): void;
  setScroll(t: number): void;
  setSave(s: SaveState): void;
  setPlaying(p: boolean): void;

  addAsset(a: Asset, at: number): Clip;
  deleteClip(id: string): Clip | null;
  duplicateClip(id: string): void;
  splitClip(id: string, at: number): boolean;
}

export const useEditor = create<EditorState>((set, get) => ({
  projectId: null,
  doc: emptyDoc(),
  sel: null,
  playhead: 0,
  playing: false,
  pps: 20,
  scrollX: 0,
  undo: [],
  redo: [],
  save: 'saved',
  rev: 0,

  load(projectId, doc) {
    set({ projectId, doc: { ...emptyDoc(), ...doc }, sel: null, playhead: 0, scrollX: 0, undo: [], redo: [], save: 'saved', rev: 0 });
  },
  edit(fn, undoable = true) {
    const before = get().doc;
    const next = structuredClone(before);
    fn(next);
    set((s) => ({
      doc: next, rev: s.rev + 1, save: 'unsaved',
      ...(undoable ? { undo: [...s.undo.slice(-99), before], redo: [] } : {}),
    }));
  },
  checkpoint() {
    set((s) => ({ undo: [...s.undo.slice(-99), s.doc], redo: [] }));
  },
  undoStep() {
    const { undo, doc, redo } = get();
    if (!undo.length) return;
    set((s) => ({ doc: undo[undo.length - 1], undo: undo.slice(0, -1), redo: [...redo, doc], rev: s.rev + 1, save: 'unsaved', sel: null }));
  },
  redoStep() {
    const { undo, doc, redo } = get();
    if (!redo.length) return;
    set((s) => ({ doc: redo[redo.length - 1], redo: redo.slice(0, -1), undo: [...undo, doc], rev: s.rev + 1, save: 'unsaved', sel: null }));
  },
  select(sel) { set({ sel }); },
  setPlayhead(t) { set({ playhead: Math.max(0, t) }); },
  setZoom(pps, anchorT, anchorPx) {
    const z = Math.max(2, Math.min(400, pps));
    if (anchorT != null && anchorPx != null) set({ pps: z, scrollX: Math.max(0, anchorT - anchorPx / z) });
    else set({ pps: z });
  },
  setScroll(t) { set({ scrollX: Math.max(0, t) }); },
  setSave(save) { set({ save }); },
  setPlaying(playing) { set({ playing }); },

  addAsset(a, at) {
    let clip!: Clip;
    get().edit((d) => {
      const t = trackFor(d, kindForRole(a.role));
      clip = { id: uid('c_'), trackId: t.id, assetHash: a.hash, start: r2(Math.max(0, at)), offset: 0, dur: a.dur, gain: 0, fadeIn: 0, fadeOut: 0, loop: false };
      d.clips.push(clip);
    });
    set({ sel: clip.id });
    return clip;
  },
  deleteClip(id) {
    const c = get().doc.clips.find((x) => x.id === id);
    if (!c) return null;
    get().edit((d) => {
      d.clips = d.clips.filter((x) => x.id !== id);
      for (const q of d.cues) if (q.clipId === id) { q.on = false; q.clipId = null; }
      pruneTracks(d);
    });
    set({ sel: null });
    return c;
  },
  duplicateClip(id) {
    const c = get().doc.clips.find((x) => x.id === id);
    if (!c) return;
    const n = { ...c, id: uid('c_'), start: r2(c.start + c.dur), auto: false, fixed: undefined, cueId: null };
    get().edit((d) => { d.clips.push(n); });
    set({ sel: n.id });
  },
  splitClip(id, at) {
    const c = get().doc.clips.find((x) => x.id === id);
    if (!c || at <= c.start + 0.05 || at >= c.start + c.dur - 0.05) return false;
    get().edit((d) => {
      const x = d.clips.find((y) => y.id === id)!;
      const left = r2(at - x.start);
      const right: Clip = { ...x, id: uid('c_'), start: r2(at), offset: r2(x.offset + left), dur: r2(x.dur - left), fadeIn: 0, cueId: null };
      x.dur = left; x.fadeOut = 0;
      d.clips.push(right);
    });
    return true;
  },
}));
