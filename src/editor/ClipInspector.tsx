import type { Clip } from '@eddy/rules';
import { useApp } from '../state/app';
import { useEditor } from '../state/editor';
import { getBuffer } from '../audio/engine';
import { ITrash } from '../ui/icons';
import { fmtTime } from './layout';

export function ClipInspector({ onDelete }: { onDelete: () => void }) {
  const { doc, sel, edit, checkpoint } = useEditor();
  const assets = useApp((s) => s.assets);
  const c = doc.clips.find((x) => x.id === sel);
  if (!c) return <p className="hint">Click a clip on the timeline to change its volume, fades and length, or to delete it.</p>;
  const a = assets.find((x) => x.hash === c.assetHash);
  const track = doc.tracks.find((t) => t.id === c.trackId);
  const buf = getBuffer(c.assetHash);
  const set = (patch: Partial<Clip>) => edit((d) => { const k = d.clips.find((x) => x.id === c.id); if (k) Object.assign(k, patch, { auto: false }); }, false);
  const slider = (label: string, key: 'gain' | 'fadeIn' | 'fadeOut', min: number, max: number, step: number, unit: string) => (
    <div className="field">
      <label>{label} <span className="val">{key === 'gain' && c[key] > 0 ? '+' : ''}{c[key]} {unit}</span></label>
      <input type="range" min={min} max={max} step={step} value={c[key]} onPointerDown={checkpoint} onKeyDown={checkpoint}
        onChange={(e) => set({ [key]: +e.target.value } as Partial<Clip>)} />
    </div>
  );
  return (
    <div className="insp">
      <h4>{a?.name || (c.assetHash === doc.dialogueHash ? 'Main dialogue' : 'Audio')}</h4>
      <div className="sub">{track?.name} · {fmtTime(c.start, true)} – {fmtTime(c.start + c.dur, true)} · {c.dur.toFixed(2)} s{c.auto ? ' · placed by auto-edit' : ''}{c.fixed ? ' · fixed disclaimer' : ''}</div>
      {slider('Volume', 'gain', -30, 12, 0.5, 'dB')}
      {slider('Fade in', 'fadeIn', 0, Math.min(10, c.dur / 2), 0.1, 's')}
      {slider('Fade out', 'fadeOut', 0, Math.min(10, c.dur / 2), 0.1, 's')}
      <div className="field">
        <label>Start (seconds)</label>
        <input type="number" step={0.1} min={0} value={c.start} disabled={!!c.fixed} onFocus={checkpoint} onChange={(e) => set({ start: Math.max(0, +e.target.value) })} />
      </div>
      <div className="field">
        <label>Length (seconds){buf && !c.loop ? ` · max ${(buf.duration - c.offset).toFixed(2)}` : ''}</label>
        <input type="number" step={0.1} min={0.1} value={c.dur} onFocus={checkpoint}
          onChange={(e) => { const v = Math.max(0.1, +e.target.value); set({ dur: buf && !c.loop ? Math.min(v, buf.duration - c.offset) : v }); }} />
      </div>
      <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={c.loop} onChange={(e) => { checkpoint(); set({ loop: e.target.checked }); }} /> Loop to fill the length
      </label>
      <div className="acts">
        <button className="btn sm" onClick={() => { checkpoint(); set({ gain: 0, fadeIn: 0, fadeOut: 0 }); }}>Reset volume & fades</button>
        <button className="btn sm del" onClick={onDelete}><ITrash /> Delete clip</button>
      </div>
    </div>
  );
}
