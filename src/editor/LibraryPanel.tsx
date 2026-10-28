import { useMemo, useState } from 'react';
import { useApp } from '../state/app';
import { IPause, IPlay, IPlus } from '../ui/icons';

let preview: HTMLAudioElement | null = null;

export function LibraryPanel({ onAdd }: { onAdd: (hash: string) => void }) {
  const { assets, categories, be, setView } = useApp();
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const groups = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = assets.filter((a) => w.every((x) => `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(x)));
    return categories.map((c) => ({ c, items: hit.filter((a) => a.categoryId === c.id).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
  }, [assets, categories, q]);

  const play = async (hash: string) => {
    preview?.pause();
    if (playing === hash) { setPlaying(null); return; }
    const b = await be.getAudio(hash);
    if (!b) return;
    preview = new Audio(URL.createObjectURL(b));
    preview.onended = () => setPlaying(null);
    preview.play(); setPlaying(hash);
  };

  if (!assets.length) return (
    <p className="hint">The library is empty. <a href="#" onClick={(e) => { e.preventDefault(); setView('library'); }}>Open the Audio library</a> to import the Bajaj starter sounds or add your own.</p>
  );
  return (
    <div>
      <input className="libsearch" placeholder="Search sounds…" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="hint" style={{ margin: '0 2px 4px' }}>Drag a sound onto the timeline, or press + to add it at the playhead.</p>
      {groups.map(({ c, items }) => (
        <div key={c.id}>
          <div className="libcat">{c.name}</div>
          {items.map((a) => (
            <div key={a.hash} className="libitem" draggable onDragStart={(e) => { e.dataTransfer.setData('eddy/asset', a.hash); e.dataTransfer.effectAllowed = 'copy'; }}>
              <button className="btn ghost icon sm" aria-label="Preview" onClick={() => play(a.hash)}>{playing === a.hash ? <IPause width={12} /> : <IPlay width={12} />}</button>
              <span className="nm" title={a.name}>{a.name}</span>
              <span className="d">{a.dur.toFixed(1)}s</span>
              <button className="btn ghost icon sm" aria-label={`Add ${a.name} at the playhead`} onClick={() => onAdd(a.hash)}><IPlus width={14} /></button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
