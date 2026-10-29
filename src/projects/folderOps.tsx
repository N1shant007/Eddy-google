import { useState } from 'react';
import { emptyDoc } from '@eddy/rules';
import { useApp } from '../state/app';
import type { Folder, ProjectMeta } from '../data/types';
import { askText, confirmBox, openDialog } from '../ui/dialogs';
import { IChevron, IDown, IFolder, IHome } from '../ui/icons';

/** ids of every folder below `id` */
export function descendants(all: Folder[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => { for (const f of all) if (f.parentId === pid && !out.has(f.id)) { out.add(f.id); walk(f.id); } };
  walk(id);
  return out;
}

export const childrenOf = (all: Folder[], pid: string | null) =>
  all.filter((f) => f.parentId === pid).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

export function folderPath(all: Folder[], id: string | null): Folder[] {
  const out: Folder[] = [];
  let cur = id ? all.find((f) => f.id === id) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) { seen.add(cur.id); out.unshift(cur); cur = cur.parentId ? all.find((f) => f.id === cur!.parentId) : undefined; }
  return out;
}

export function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
export const stamp = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const fmtDur = (s?: number) => (s == null ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);

/* ---------- actions (all refresh the lists and report errors as toasts) ---------- */
async function run(fn: () => Promise<unknown>, ok?: string) {
  const app = useApp.getState();
  try { await fn(); await app.refresh(); if (ok) app.toast(ok, 'ok'); }
  catch (e: any) { app.toast(e?.message || String(e), 'error', 6000); }
}

export async function newFolder(parentId: string | null) {
  const name = await askText('New folder', '', 'Create', 'Folder name');
  if (name) await run(() => useApp.getState().be.createFolder(name, parentId));
}
export async function renameFolder(f: Folder) {
  const name = await askText('Rename folder', f.name);
  if (name && name !== f.name) await run(() => useApp.getState().be.renameFolder(f.id, name));
}
export async function deleteFolder(f: Folder) {
  const { folders, projects, currentFolder, openFolder } = useApp.getState();
  const ids = descendants(folders, f.id); ids.add(f.id);
  const np = projects.filter((p) => p.folderId && ids.has(p.folderId)).length;
  const ok = await confirmBox('Delete folder?', `“${f.name}”${ids.size > 1 ? `, its ${ids.size - 1} sub-folder${ids.size > 2 ? 's' : ''}` : ''} and ${np} project${np === 1 ? '' : 's'} inside (with their version history) will be deleted. This can’t be undone.`);
  if (!ok) return;
  if (currentFolder && ids.has(currentFolder)) openFolder(f.parentId);
  await run(() => useApp.getState().be.deleteFolder(f.id), 'Folder deleted');
}
export async function moveFolderTo(f: Folder) {
  const { folders } = useApp.getState();
  const bad = descendants(folders, f.id); bad.add(f.id);
  const to = await pickFolder(`Move “${f.name}” to…`, bad);
  if (to === undefined) return;
  await run(() => useApp.getState().be.moveFolder(f.id, to), 'Folder moved');
}

export async function newProject(folderId: string | null) {
  const name = await askText('New project', '', 'Create', 'Episode name');
  if (!name) return;
  const app = useApp.getState();
  try {
    const p = await app.be.createProject(name, folderId, emptyDoc());
    await app.refresh();
    app.openProject(p.id);
  } catch (e: any) { app.toast(e?.message || String(e), 'error', 6000); }
}
export async function renameProject(p: ProjectMeta) {
  const name = await askText('Rename project', p.name);
  if (name && name !== p.name) await run(() => useApp.getState().be.renameProject(p.id, name));
}
export async function moveProjectTo(p: ProjectMeta) {
  const to = await pickFolder(`Move “${p.name}” to…`);
  if (to === undefined) return;
  await run(() => useApp.getState().be.moveProject(p.id, to), 'Project moved');
}
export async function duplicateProject(p: ProjectMeta, docOverride?: import('@eddy/rules').ProjectDoc, name?: string) {
  const app = useApp.getState();
  const nm = await askText('Duplicate project', name || `${p.name} (copy)`, 'Duplicate');
  if (!nm) return;
  await run(async () => {
    const full = docOverride ? null : await app.be.getProject(p.id);
    const doc = docOverride || full?.draft;
    if (!doc) throw new Error('Project not found');
    await app.be.createProject(nm, p.folderId, structuredClone(doc));
  }, 'Duplicated');
}
export async function deleteProject(p: ProjectMeta) {
  const ok = await confirmBox('Delete project?', `“${p.name}” and all ${p.headVersion} saved version${p.headVersion === 1 ? '' : 's'} will be deleted. This can’t be undone.`);
  if (ok) await run(() => useApp.getState().be.deleteProject(p.id), 'Project deleted');
}

/* ---------- folder picker ---------- */
/** resolves to a folder id, null for "All projects" (top level), or undefined if cancelled */
export async function pickFolder(title: string, disabled: Set<string> = new Set()): Promise<string | null | undefined> {
  const r = await openDialog<{ id: string | null }>((close) => <FolderPicker title={title} disabled={disabled} close={close} />);
  return r ? r.id : undefined;
}

function FolderPicker({ title, disabled, close }: { title: string; disabled: Set<string>; close: (v: { id: string | null } | null) => void }) {
  const folders = useApp((s) => s.folders);
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const row = (f: Folder, depth: number): React.JSX.Element => {
    const kids = childrenOf(folders, f.id);
    const isOpen = open.has(f.id);
    const dis = disabled.has(f.id);
    return (
      <div key={f.id}>
        <div className={'tnode' + (sel === f.id ? ' on' : '')} style={{ paddingLeft: 6 + depth * 16, opacity: dis ? 0.4 : 1 }}
          onClick={() => !dis && setSel(f.id)} onDoubleClick={() => !dis && close({ id: f.id })}>
          <span className="tw" onClick={(e) => { e.stopPropagation(); const n = new Set(open); isOpen ? n.delete(f.id) : n.add(f.id); setOpen(n); }}>
            {kids.length ? (isOpen ? <IDown /> : <IChevron />) : null}
          </span>
          <IFolder /> <span className="nm">{f.name}</span>
        </div>
        {isOpen && kids.map((k) => row(k, depth + 1))}
      </div>
    );
  };
  return (
    <div className="modal">
      <h3>{title}</h3>
      <div className="pick">
        <div className={'tnode' + (sel === null ? ' on' : '')} onClick={() => setSel(null)}><span className="tw" /><IHome /> <span className="nm">All projects (top level)</span></div>
        {childrenOf(folders, null).map((f) => row(f, 0))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => close(null)}>Cancel</button>
        <button className="btn primary" onClick={() => close({ id: sel })}>Move here</button>
      </div>
    </div>
  );
}
