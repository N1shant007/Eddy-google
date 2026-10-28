import type { Clip, ProjectDoc, Track } from '@eddy/rules';

export const HEAD_W = 200;
export const RULER_H = 28;

export interface Lane {
  track: Track;
  top: number;
  height: number;
  rows: number;
  rowOf: Map<string, number>;
}

/** Overlapping clips on one track get separate rows so each one can be clicked. */
function rowsFor(t: Track, clips: Clip[]) {
  const cs = clips.filter((c) => c.trackId === t.id).sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const ends: number[] = [], map = new Map<string, number>();
  for (const c of cs) {
    let r = ends.findIndex((e) => c.start >= e - 0.01);
    if (r < 0) { r = ends.length; ends.push(0); }
    ends[r] = c.start + c.dur;
    map.set(c.id, r);
  }
  return { map, rows: Math.max(1, ends.length) };
}

export function layoutLanes(doc: ProjectDoc): { lanes: Lane[]; height: number } {
  let y = 0;
  const lanes = doc.tracks.map((t) => {
    const base = t.kind === 'dialogue' ? 92 : 58;
    const { map, rows } = rowsFor(t, doc.clips);
    const height = rows <= 1 ? base : Math.round(base * 0.62 * rows) + 6;
    const lane = { track: t, top: y, height, rows, rowOf: map };
    y += height;
    return lane;
  });
  return { lanes, height: y };
}

export function clipBox(l: Lane, c: Clip) {
  const r = l.rowOf.get(c.id) ?? 0;
  const rh = (l.height - 6) / l.rows;
  return { top: l.top + 3 + r * rh, h: rh - 2 };
}

export const KIND_COLOR: Record<string, string> = {
  disclaimer: '#5b6b8c', dialogue: '#3b6fd8', intro: '#8a5cd6', positioning: '#d6884a',
  bed: '#2fa18a', transition: '#3c9fd1', sfx: '#e8862c', emotion: '#d6527a',
};

export const fmtTime = (s: number, ms = false) => {
  const m = Math.floor(s / 60), sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${ms ? sec.toFixed(2).padStart(5, '0') : String(Math.floor(sec)).padStart(2, '0')}`;
};
