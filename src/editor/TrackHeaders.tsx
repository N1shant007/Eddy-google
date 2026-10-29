import type { Track } from '@eddy/rules';
import { useEditor } from '../state/editor';
import { HEAD_W, KIND_COLOR, type Lane } from './layout';

export function TrackHeaders({ lanes }: { lanes: Lane[] }) {
  const edit = useEditor((s) => s.edit);
  const set = (id: string, patch: Partial<Track>, undo = true) => edit((d) => { const t = d.tracks.find((x) => x.id === id); if (t) Object.assign(t, patch); }, undo);
  return (
    <div className="tl-heads" style={{ width: HEAD_W }}>
      {lanes.map(({ track: t, height }) => (
        <div key={t.id} className="th" style={{ height }}>
          <div className="th-name" title={t.duck ? `Dips ${t.duck} dB while anyone speaks` : undefined}><i style={{ background: KIND_COLOR[t.kind] }} />{t.name}{t.duck > 0 && <span className="duck">↓{t.duck}</span>}</div>
          <div className="th-ctl">
            <button className={'tbtn' + (t.mute ? ' on' : '')} title="Mute" aria-pressed={t.mute} onClick={() => set(t.id, { mute: !t.mute })}>M</button>
            <button className={'tbtn' + (t.solo ? ' on s' : '')} title="Solo" aria-pressed={t.solo} onClick={() => set(t.id, { solo: !t.solo })}>S</button>
            <input type="range" min={-30} max={12} step={0.5} value={t.vol} aria-label={`${t.name} volume`}
              onPointerDown={() => useEditor.getState().checkpoint()}
              onChange={(e) => set(t.id, { vol: +e.target.value }, false)} title={`${t.vol} dB`} />
            <span className="db">{t.vol > 0 ? '+' : ''}{t.vol}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
