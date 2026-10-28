import { useMemo, useState, type DragEvent } from 'react';
import { useApp } from '../state/app';
import type { Folder, ProjectMeta } from '../data/types';
import { openMenu } from '../ui/dialogs';
import { IChevron, ICopy, IDown, IEdit, IFolder, IFolderPlus, IHistory, IHome, IMore, IMove, IPlus, ITrash } from '../ui/icons';
import {
  ago, childrenOf, deleteFolder, deleteProject, duplicateProject, fmtDur, folderPath, moveFolderTo, moveProjectTo,
  newFolder, newProject, renameFolder, renameProject,
} from './folderOps';
import { HistoryDrawer } from './HistoryDrawer';

type Sort = 'updated' | 'name' | 'created';

export function ProjectsView() {
  const { folders, projects, currentFolder, openFolder, openProject } = useApp();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem('eddy.sort') as Sort) || 'updated');
  const [historyFor, setHistoryFor] = useState<ProjectMeta | null>(null);
  const cur = folders.find((f) => f.id === currentFolder) || null;
  const path = folderPath(folders, currentFolder);

  const sorter = (a: ProjectMeta, b: ProjectMeta) =>
    sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true })
      : sort === 'created' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt);

  const searching = q.trim().length > 0;
  const list = useMemo(() => {
    if (searching) {
      const w = q.toLowerCase().split(/\s+/).filter(Boolean);
      return projects.filter((p) => {
        const hay = `${p.name} ${p.product} ${folderPath(folders, p.folderId).map((f) => f.name).join(' ')}`.toLowerCase();
        return w.every((x) => hay.includes(x));
      }).sort(sorter);
    }
    return projects.filter((p) => p.folderId === currentFolder).sort(sorter);
  }, [projects, folders, currentFolder, q, sort]);
  const subs = searching ? [] : childrenOf(folders, currentFolder);

  const projectMenu = (p: ProjectMeta, x: number, y: number) => openMenu(x, y, [
    { label: 'Open', icon: <IEdit />, onClick: () => openProject(p.id) },
    { label: 'Version history', icon: <IHistory />, onClick: () => setHistoryFor(p) },
    { label: 'Rename', icon: <IEdit />, onClick: () => renameProject(p) },
    { label: 'Move to…', icon: <IMove />, onClick: () => moveProjectTo(p) },
    { label: 'Duplicate', icon: <ICopy />, onClick: () => duplicateProject(p) },
    { sep: true, label: '', onClick: () => {} },
    { label: 'Delete', icon: <ITrash />, danger: true, onClick: () => deleteProject(p) },
  ]);
  const folderMenu = (f: Folder, x: number, y: number) => openMenu(x, y, [
    { label: 'New sub-folder', icon: <IFolderPlus />, onClick: () => newFolder(f.id) },
    { label: 'New project here', icon: <IPlus />, onClick: () => newProject(f.id) },
    { label: 'Rename', icon: <IEdit />, onClick: () => renameFolder(f) },
    { label: 'Move to…', icon: <IMove />, onClick: () => moveFolderTo(f) },
    { sep: true, label: '', onClick: () => {} },
    { label: 'Delete folder', icon: <ITrash />, danger: true, onClick: () => deleteFolder(f) },
  ]);

  return (
    <div className="main">
      <FolderTree folderMenu={folderMenu} />
      <div className="content">
        <div className="crumbs">
          <a onClick={() => openFolder(null)}>All projects</a>
          {path.map((f) => (<span key={f.id} style={{ display: 'contents' }}><IChevron width={12} /><a onClick={() => openFolder(f.id)}>{f.name}</a></span>))}
        </div>
        <div className="headrow">
          <h1>{searching ? `Search: “${q}”` : cur ? cur.name : 'All projects'}</h1>
          <input className="search" placeholder="Search projects, products, folders…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="btn" value={sort} onChange={(e) => { setSort(e.target.value as Sort); localStorage.setItem('eddy.sort', e.target.value); }} aria-label="Sort">
            <option value="updated">Last edited</option>
            <option value="name">Name</option>
            <option value="created">Created</option>
          </select>
          <button className="btn" onClick={() => newFolder(currentFolder)}><IFolderPlus /> New folder</button>
          <button className="btn primary" onClick={() => newProject(currentFolder)}><IPlus /> New project</button>
        </div>

        {subs.length > 0 && (<>
          <div className="section-title">Folders</div>
          <div className="grid">
            {subs.map((f) => {
              const n = projects.filter((p) => p.folderId === f.id).length + childrenOf(folders, f.id).length;
              return (
                <DropTarget key={f.id} folderId={f.id} className="card folder" onClick={() => openFolder(f.id)}
                  onContextMenu={(e) => { e.preventDefault(); folderMenu(f, e.clientX, e.clientY); }}>
                  <IFolder width={22} height={22} style={{ color: 'var(--accent)' }} />
                  <div className="t">{f.name}</div>
                  <span className="m">{n} item{n === 1 ? '' : 's'}</span>
                  <button className="btn ghost icon" aria-label="Folder menu" onClick={(e) => { e.stopPropagation(); folderMenu(f, e.clientX, e.clientY); }}><IMore /></button>
                </DropTarget>
              );
            })}
          </div>
        </>)}

        <div className="section-title">{searching ? `${list.length} result${list.length === 1 ? '' : 's'}` : 'Projects'}</div>
        {list.length === 0 ? (
          <div className="empty">
            <h3>{searching ? 'No projects match' : 'No projects here yet'}</h3>
            {!searching && <p>Create a project for an episode. Every save keeps a version you can go back to.</p>}
            {!searching && <button className="btn primary" onClick={() => newProject(currentFolder)}><IPlus /> New project</button>}
          </div>
        ) : (
          <div className="grid">
            {list.map((p) => (
              <div key={p.id} className="card" draggable onDragStart={(e) => { e.dataTransfer.setData('eddy/project', p.id); e.dataTransfer.effectAllowed = 'move'; }}
                onClick={() => openProject(p.id)} onContextMenu={(e) => { e.preventDefault(); projectMenu(p, e.clientX, e.clientY); }}>
                <div className="m">{p.product ? <span className="tag">{p.product}</span> : <span className="tag" style={{ background: '#eef1f7', color: 'var(--muted)' }}>No product</span>}
                  {p.headVersion > 0 && <span className="tag v">v{p.headVersion}</span>}</div>
                <div className="t" title={p.name}>{p.name}</div>
                <div className="m">
                  <span>Edited {ago(p.updatedAt)}{p.updatedBy ? ` by ${p.updatedBy.split('@')[0]}` : ''}</span>
                  {p.duration ? <span>· {fmtDur(p.duration)}</span> : null}
                </div>
                {searching && <div className="m" style={{ marginTop: 4 }}><IFolder width={12} /> {folderPath(folders, p.folderId).map((f) => f.name).join(' / ') || 'All projects'}</div>}
                <button className="btn ghost icon kebab" aria-label="Project menu" onClick={(e) => { e.stopPropagation(); projectMenu(p, e.clientX, e.clientY); }}><IMore /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      {historyFor && <HistoryDrawer project={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

/* Drop a dragged project or folder onto a folder to move it there */
function DropTarget({ folderId, className, children, ...rest }: { folderId: string | null; className: string; children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  const [over, setOver] = useState(false);
  const drop = async (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    const app = useApp.getState();
    const pid = e.dataTransfer.getData('eddy/project');
    const fid = e.dataTransfer.getData('eddy/folder');
    try {
      if (pid) await app.be.moveProject(pid, folderId);
      else if (fid && fid !== folderId) await app.be.moveFolder(fid, folderId);
      else return;
      await app.refresh();
      app.toast('Moved', 'ok', 1800);
    } catch (err: any) { app.toast(err?.message || String(err), 'error'); }
  };
  return (
    <div {...rest} className={className + (over ? ' drop' : '')}
      onDragOver={(e) => { if (e.dataTransfer.types.some((t) => t.startsWith('eddy/'))) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)} onDrop={drop}>
      {children}
    </div>
  );
}

function FolderTree({ folderMenu }: { folderMenu: (f: Folder, x: number, y: number) => void }) {
  const { folders, projects, currentFolder, openFolder } = useApp();
  const [open, setOpen] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('eddy.open') || '[]')));
  const toggle = (id: string) => {
    const n = new Set(open); n.has(id) ? n.delete(id) : n.add(id); setOpen(n);
    localStorage.setItem('eddy.open', JSON.stringify([...n]));
  };
  // keep the current folder's parents expanded
  for (const f of folderPath(folders, currentFolder).slice(0, -1)) if (!open.has(f.id)) open.add(f.id);

  const node = (f: Folder, depth: number): React.JSX.Element => {
    const kids = childrenOf(folders, f.id);
    const isOpen = open.has(f.id);
    const count = projects.filter((p) => p.folderId === f.id).length;
    return (
      <div key={f.id}>
        <DropTarget folderId={f.id} className={'tnode' + (currentFolder === f.id ? ' on' : '')}
          style={{ paddingLeft: 6 + depth * 14 }} onClick={() => openFolder(f.id)}
          draggable onDragStart={(e) => { e.dataTransfer.setData('eddy/folder', f.id); e.stopPropagation(); }}
          onContextMenu={(e) => { e.preventDefault(); folderMenu(f, e.clientX, e.clientY); }}>
          <span className="tw" onClick={(e) => { e.stopPropagation(); toggle(f.id); }}>{kids.length ? (isOpen ? <IDown /> : <IChevron />) : null}</span>
          <IFolder style={{ color: currentFolder === f.id ? 'var(--accent)' : 'var(--muted)', flex: 'none' }} />
          <span className="nm">{f.name}</span>
          {count > 0 && <span className="ct">{count}</span>}
          <button className="btn ghost icon sm more" aria-label="Folder menu" onClick={(e) => { e.stopPropagation(); folderMenu(f, e.clientX, e.clientY); }}><IMore width={14} /></button>
        </DropTarget>
        {isOpen && kids.map((k) => node(k, depth + 1))}
      </div>
    );
  };
  return (
    <aside className="sidebar">
      <h4>Folders <button className="btn ghost icon sm" title="New folder" onClick={() => newFolder(null)}><IFolderPlus /></button></h4>
      <div className="tree">
        <DropTarget folderId={null} className={'tnode' + (currentFolder === null ? ' on' : '')} onClick={() => openFolder(null)}>
          <span className="tw" /><IHome style={{ flex: 'none' }} /> <span className="nm">All projects</span>
          <span className="ct">{projects.filter((p) => !p.folderId).length || ''}</span>
        </DropTarget>
        {childrenOf(folders, null).map((f) => node(f, 0))}
      </div>
    </aside>
  );
}
