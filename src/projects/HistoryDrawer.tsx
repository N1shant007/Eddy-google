import { useEffect, useState } from 'react';
import type { ProjectDoc } from '@eddy/rules';
import { useApp } from '../state/app';
import type { ProjectMeta, VersionMeta } from '../data/types';
import { confirmBox, openDialog } from '../ui/dialogs';
import { ICompare, ICopy, IRestore } from '../ui/icons';
import { diffDocs } from './diff';
import { ago, duplicateProject, stamp } from './folderOps';

interface Props {
  project: ProjectMeta;
  onClose: () => void;
  /** editor: the unsaved working copy, to compare against */
  current?: ProjectDoc;
  /** editor: load a restored doc into the open editor */
  onRestored?: (doc: ProjectDoc) => void;
  /** bump to reload the list (e.g. after "Save version") */
  reloadKey?: number;
}

export function HistoryDrawer({ project, onClose, current, onRestored, reloadKey }: Props) {
  const { be, toast, refresh } = useApp();
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);

  const load = async () => {
    try { setList(await be.listVersions(project.id)); } catch (e: any) { toast(e?.message || String(e), 'error'); setList([]); }
  };
  useEffect(() => { load(); }, [project.id, reloadKey]);

  const restore = async (v: VersionMeta) => {
    const ok = await confirmBox(`Restore v${v.versionNo}?`, `The edit goes back to v${v.versionNo}${v.note ? ` (“${v.note}”)` : ''}. Nothing is lost: it is saved as a new version on top, so every later version stays in the history.`, 'Restore', false);
    if (!ok) return;
    try {
      const full = await be.getVersion(v.id);
      if (!full) throw new Error('Version not found');
      await be.saveVersion(project.id, full.doc, `Restored from v${v.versionNo}`);
      onRestored?.(full.doc);
      await Promise.all([load(), refresh()]);
      toast(`Restored v${v.versionNo}`, 'ok');
    } catch (e: any) { toast(e?.message || String(e), 'error'); }
  };

  const duplicate = async (v: VersionMeta) => {
    const full = await be.getVersion(v.id);
    if (full) await duplicateProject(project, full.doc, `${project.name} (v${v.versionNo})`);
  };

  const compare = async (aId: string | 'current', bId: string | 'current') => {
    try {
      const get = async (id: string) => (id === 'current' ? { doc: current!, label: 'Unsaved changes' } : await be.getVersion(id).then((v) => ({ doc: v!.doc, label: `v${v!.versionNo}` })));
      let [a, b] = await Promise.all([get(aId), get(bId)]);
      const na = aId === 'current' ? 1e9 : list!.find((x) => x.id === aId)!.versionNo;
      const nb = bId === 'current' ? 1e9 : list!.find((x) => x.id === bId)!.versionNo;
      if (na > nb) [a, b] = [b, a];
      const d = diffDocs(a.doc, b.doc, useApp.getState().assets);
      await openDialog((close) => (
        <div className="modal wide">
          <h3>{a.label} → {b.label}</h3>
          {d.length === 0 ? <p>No differences.</p> : (
            <div className="diff">{d.map((x, i) => <div key={i} className={x.kind}>{x.kind === 'add' ? '+ ' : x.kind === 'del' ? '− ' : '~ '}{x.text}</div>)}</div>
          )}
          <div className="row"><button className="btn primary" onClick={() => close(null)}>Close</button></div>
        </div>
      ));
    } catch (e: any) { toast(e?.message || String(e), 'error'); }
  };

  const togglePick = (id: string) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p.slice(-1), id]));

  return (
    <div className="drawer" role="dialog" aria-label="Version history">
      <header>
        <h3>Version history</h3>
        {pick.length === 2 && <button className="btn sm" onClick={() => compare(pick[0], pick[1])}><ICompare /> Compare</button>}
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </header>
      <div className="body">
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '8px 4px' }}>
          {project.name}. Tick two versions to compare them. Restoring never deletes anything.
        </p>
        {current && (
          <div className="ver">
            <div className="top"><span className="no">Working copy</span><span className="meta">autosaved</span></div>
            <div className="acts">{list && list.length > 0 && <button className="btn sm" onClick={() => compare(list[0].id, 'current')}><ICompare /> Changes since v{list[0].versionNo}</button>}</div>
          </div>
        )}
        {list === null && <p className="meta">Loading…</p>}
        {list && list.length === 0 && <p style={{ color: 'var(--muted)', margin: 8 }}>No saved versions yet. Use “Save version” in the editor to keep a snapshot you can come back to.</p>}
        {list?.map((v, i) => (
          <div key={v.id} className={'ver' + (pick.includes(v.id) ? ' sel' : '')}>
            <div className="top">
              <input type="checkbox" checked={pick.includes(v.id)} onChange={() => togglePick(v.id)} aria-label={`Select v${v.versionNo} to compare`} />
              <span className="no">v{v.versionNo}</span>
              {i === 0 && <span className="tag v">Latest</span>}
              <span className="meta" style={{ marginLeft: 'auto' }} title={stamp(v.createdAt)}>{ago(v.createdAt)}</span>
            </div>
            <div className="note">{v.note}</div>
            <div className="meta">{stamp(v.createdAt)}{v.createdBy ? ` · ${v.createdBy}` : ''}</div>
            <div className="acts">
              {i > 0 && <button className="btn sm" onClick={() => restore(v)}><IRestore /> Restore</button>}
              <button className="btn sm" onClick={() => duplicate(v)}><ICopy /> Copy as new project</button>
              {i < list.length - 1 && <button className="btn sm" onClick={() => compare(list[i + 1].id, v.id)}><ICompare /> vs v{list[i + 1].versionNo}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
