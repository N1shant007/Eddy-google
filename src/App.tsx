import { useEffect, useState, type FormEvent } from 'react';
import { useApp, type View } from './state/app';
import { setSignedOutHandler } from './data/api';
import { DialogHost, MenuHost } from './ui/dialogs';
import { ILogo } from './ui/icons';
import { ProjectsView } from './projects/ProjectsView';
import { EditorView } from './editor/EditorView';
import { LibraryView } from './library/LibraryView';
import { GuidelinesView } from './library/GuidelinesView';

const NAV: [View, string][] = [['projects', 'Projects'], ['editor', 'Editor'], ['library', 'Audio library'], ['guidelines', 'Guidelines']];

export function App() {
  const { ready, user, view, setView, init, be, toasts, openProjectId, libraryImport } = useApp();
  useEffect(() => {
    setSignedOutHandler(() => useApp.setState({ user: null }));
    init();
  }, []);

  if (!ready) return <div className="app"><div className="topbar"><div className="brand"><ILogo /> Eddy</div></div></div>;
  if (!user) return <SignIn />;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><ILogo /> Eddy</div>
        <nav className="nav">
          {NAV.map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} disabled={v === 'editor' && !openProjectId} style={v === 'editor' && !openProjectId ? { opacity: 0.4 } : undefined} onClick={() => setView(v)}>{label}</button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="who">
          <span>{user.name}</span>
          <button className="btn ghost sm" style={{ color: '#c9d4ea' }} onClick={async () => { await be.signOut(); location.reload(); }}>Sign out</button>
        </div>
      </div>
      {view === 'projects' && <ProjectsView />}
      {view === 'editor' && openProjectId && <EditorView key={openProjectId} projectId={openProjectId} />}
      {view === 'library' && <LibraryView />}
      {view === 'guidelines' && <GuidelinesView />}
      <DialogHost />
      <MenuHost />
      {libraryImport && <div className="libimport" role="status"><span className="spin" />{libraryImport}</div>}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast ' + (t.kind || '')}>{t.text}</div>)}</div>
    </div>
  );
}

function SignIn() {
  const { be, signedIn } = useApp();
  const [passcode, setPasscode] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('eddy.name') || ''; } catch { return ''; } });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      try { localStorage.setItem('eddy.name', name); } catch { /* ignore */ }
      await signedIn(await be.signIn(passcode, name));
    } catch (x: any) { setErr(x?.message || String(x)); }
    finally { setBusy(false); }
  };
  return (
    <div className="app" style={{ background: 'var(--navy)' }}>
      <form className="signin" onSubmit={submit}>
        <ILogo width={40} height={40} />
        <h2>Eddy</h2>
        <p>AI podcast editor. Enter the team passcode to open the shared projects and library.</p>
        {be.demo && <p style={{ background: '#fdeedf', color: '#9b4a07', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>Test build: everything is stored in this browser. The passcode is <b>demo</b>.</p>}
        <div className="field" style={{ textAlign: 'left' }}>
          <label htmlFor="si-name">Your name (shown in version history)</label>
          <input id="si-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="e.g. Nishant" />
        </div>
        <div className="field" style={{ textAlign: 'left' }}>
          <label htmlFor="si-pass">Team passcode</label>
          <input id="si-pass" type="password" value={passcode} onChange={(e) => setPasscode(e.target.value)} autoComplete="current-password" autoFocus />
        </div>
        {err && <p role="alert" style={{ color: 'var(--danger)' }}>{err}</p>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !passcode}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
