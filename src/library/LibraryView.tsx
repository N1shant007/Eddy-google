import { useMemo, useRef, useState } from 'react';
import type { Asset, Category, CategoryRole } from '@eddy/rules';
import { useApp } from '../state/app';
import { importStarterLibrary } from '../data/seed';
import { audioDuration, uid } from '../data/util';
import { askText, confirmBox, openDialog, openMenu } from '../ui/dialogs';
import { IEdit, IMore, IMove, IPause, IPlay, IPlus, ITrash, IUpload } from '../ui/icons';

const ROLES: [CategoryRole, string][] = [
  ['intro', 'Intro music'], ['outro', 'Outro music'], ['bed', 'Background music'], ['positioning', 'Product music'],
  ['sfx', 'Sound effect'], ['transition', 'Transition'], ['emotion', 'Reaction'], ['disclaimer', 'AI disclaimer'], ['pdisclaimer', 'Product disclaimer'],
];
const roleLabel = (r: string) => ROLES.find((x) => x[0] === r)?.[1] || r;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

let previewEl: HTMLAudioElement | null = null;

export function LibraryView() {
  const { categories, assets, be, refreshLibrary, toast } = useApp();
  const [cat, setCat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = categories.find((c) => c.id === cat) || null;

  const shown = useMemo(() => {
    const w = q.toLowerCase().split(/\s+/).filter(Boolean);
    return assets.filter((a) => (!cat || a.categoryId === cat) && w.every((x) => `${a.name} ${a.tags.join(' ')}`.toLowerCase().includes(x)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [assets, cat, q]);

  const play = async (a: Asset) => {
    previewEl?.pause();
    if (playing === a.hash) { setPlaying(null); return; }
    const blob = await be.getAudio(a.hash);
    if (!blob) { toast('Audio file missing', 'error'); return; }
    previewEl = new Audio(URL.createObjectURL(blob));
    previewEl.onended = () => setPlaying(null);
    previewEl.play();
    setPlaying(a.hash);
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const target = current || categories[0];
    if (!target) { toast('Create a category first', 'error'); return; }
    let n = 0;
    for (const f of [...files]) {
      setBusy(`Uploading ${f.name} (${++n}/${files.length})…`);
      try {
        const dur = await audioDuration(f);
        if (!dur) throw new Error(`${f.name} isn’t an audio file this browser can read`);
        const name = f.name.replace(/\.[^.]+$/, '');
        await be.putAsset({ name, categoryId: target.id, role: target.role, tags: name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2), dur }, f);
      } catch (e: any) { toast(e?.message || String(e), 'error', 6000); }
    }
    setBusy(null);
    await refreshLibrary();
    toast(`Added to ${target.name}`, 'ok');
  };

  const editCategory = async (c?: Category) => {
    const r = await openDialog<Category>((close) => <CategoryForm initial={c} close={close} />);
    if (!r) return;
    await be.saveCategory(r);
    await refreshLibrary();
    setCat(r.id);
  };

  const assetMenu = (a: Asset, x: number, y: number) => openMenu(x, y, [
    { label: 'Rename', icon: <IEdit />, onClick: async () => { const n = await askText('Rename sound', a.name); if (n) { await be.updateAsset(a.hash, { name: n }); refreshLibrary(); } } },
    { label: 'Edit tags', icon: <IEdit />, onClick: async () => { const n = await askText('Tags (comma separated)', a.tags.join(', ')); if (n != null) { await be.updateAsset(a.hash, { tags: n.split(',').map((s) => s.trim()).filter(Boolean) }); refreshLibrary(); } } },
    ...(a.role === 'pdisclaimer' ? [{ label: `Product: ${a.product || 'none'}`, icon: <IEdit />, onClick: async () => { const n = await askText('Product this disclaimer is for', a.product || ''); if (n) { await be.updateAsset(a.hash, { product: n }); refreshLibrary(); } } }] : []),
    { label: 'Move to category…', icon: <IMove />, onClick: async () => {
      const to = await openDialog<string>((close) => (
        <div className="modal"><h3>Move “{a.name}” to…</h3>
          <div className="pick">{categories.map((c) => <div key={c.id} className="tnode" onClick={() => close(c.id)}>{c.name} <span className="ct">{roleLabel(c.role)}</span></div>)}</div>
          <div className="row"><button className="btn" onClick={() => close(null)}>Cancel</button></div></div>));
      const c = categories.find((x) => x.id === to);
      if (c) { await be.updateAsset(a.hash, { categoryId: c.id, role: c.role }); refreshLibrary(); }
    } },
    { sep: true, label: '', onClick: () => {} },
    { label: 'Delete', icon: <ITrash />, danger: true, onClick: async () => {
      if (await confirmBox('Delete sound?', `“${a.name}” is removed from the library. Projects that already use it keep working.`)) { await be.deleteAsset(a.hash); refreshLibrary(); }
    } },
  ]);

  return (
    <div className="main">
      <aside className="sidebar">
        <h4>Categories <button className="btn ghost icon sm" title="New category" onClick={() => editCategory()}><IPlus /></button></h4>
        <div className="tree">
          <div className={'tnode' + (!cat ? ' on' : '')} onClick={() => setCat(null)}><span className="nm">All sounds</span><span className="ct">{assets.length}</span></div>
          {categories.map((c) => (
            <div key={c.id} className={'tnode' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}
              onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, [
                { label: 'Edit category', icon: <IEdit />, onClick: () => editCategory(c) },
                { label: 'Delete category', icon: <ITrash />, danger: true, onClick: async () => {
                  const n = assets.filter((a) => a.categoryId === c.id).length;
                  if (n) { toast(`Move or delete its ${n} sound${n > 1 ? 's' : ''} first`, 'error'); return; }
                  if (await confirmBox('Delete category?', `“${c.name}” will be removed.`)) { await be.deleteCategory(c.id); if (cat === c.id) setCat(null); refreshLibrary(); }
                } },
              ]); }}>
              <span className="nm">{c.name}</span><span className="ct">{assets.filter((a) => a.categoryId === c.id).length}</span>
            </div>
          ))}
        </div>
      </aside>
      <div className="content">
        <div className="headrow">
          <h1>{current ? current.name : 'Audio library'}</h1>
          {current && <span className="tag v">{roleLabel(current.role)}</span>}
          <input className="search" placeholder="Search sounds or tags…" value={q} onChange={(e) => setQ(e.target.value)} />
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
          <button className="btn primary" onClick={() => fileRef.current?.click()} disabled={!categories.length}><IUpload /> Add audio{current ? ` to ${current.name}` : ''}</button>
        </div>
        {busy && <p className="meta">{busy}</p>}
        {assets.length === 0 && !busy && (
          <div className="empty">
            <h3>The library is empty</h3>
            <p>Import the Bajaj starter library: intro and outro, story play and story rewrite, coin chime, character intros, disclaimers and the storytelling guidelines.</p>
            <button className="btn primary" onClick={async () => {
              try { await importStarterLibrary(be, (d, t, n) => setBusy(n ? `Importing ${n} (${d + 1}/${t})…` : null)); await refreshLibrary(); toast('Starter library imported', 'ok'); }
              catch (e: any) { toast(e?.message || String(e), 'error', 6000); setBusy(null); }
            }}>Import starter library</button>
          </div>
        )}
        <div className="assets">
          {shown.map((a) => (
            <div key={a.hash} className="asset" onContextMenu={(e) => { e.preventDefault(); assetMenu(a, e.clientX, e.clientY); }}>
              <button className="btn icon" aria-label={playing === a.hash ? 'Pause' : 'Play'} onClick={() => play(a)}>{playing === a.hash ? <IPause /> : <IPlay />}</button>
              <div className="an"><div className="t">{a.name}</div>
                <div className="m">{categories.find((c) => c.id === a.categoryId)?.name || '—'} · {fmt(a.dur)}{a.product ? ` · ${a.product}` : ''}{a.tags.length ? ` · ${a.tags.slice(0, 4).join(', ')}` : ''}</div></div>
              <button className="btn ghost icon" aria-label="Sound menu" onClick={(e) => assetMenu(a, e.clientX, e.clientY)}><IMore /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryForm({ initial, close }: { initial?: Category; close: (c: Category | null) => void }) {
  const [name, setName] = useState(initial?.name || '');
  const [role, setRole] = useState<CategoryRole>(initial?.role || 'bed');
  return (
    <form className="modal" onSubmit={(e) => { e.preventDefault(); if (name.trim()) close({ id: initial?.id || uid('k_'), name: name.trim(), role, sort: initial?.sort ?? 99 }); }}>
      <h3>{initial ? 'Edit category' : 'New category'}</h3>
      <div className="field"><label>Name</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label>Auto-edit uses it as</label>
        <select value={role} onChange={(e) => setRole(e.target.value as CategoryRole)}>{ROLES.map(([r, l]) => <option key={r} value={r}>{l}</option>)}</select></div>
      <div className="row"><button type="button" className="btn" onClick={() => close(null)}>Cancel</button><button className="btn primary" disabled={!name.trim()}>Save</button></div>
    </form>
  );
}
