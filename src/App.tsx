import { useEffect, useState, type FormEvent } from 'react';
import { useApp, type View } from './state/app';
import { setSignedOutHandler } from './data/api';
import { DialogHost, MenuHost, openDialog } from './ui/dialogs';
import { ILogo } from './ui/icons';
import { ProjectsView } from './projects/ProjectsView';
import { EditorView } from './editor/EditorView';
import { LibraryView } from './library/LibraryView';
import { GuidelinesView } from './library/GuidelinesView';
import { ChangePasswordDialog, UsersView } from './users/UsersView';

const NAV: [View, string][] = [['projects', 'Projects'], ['editor', 'Editor'], ['library', 'Audio library'], ['guidelines', 'Guidelines']];

export function App() {
  const { ready, user, view, setView, init, be, toasts, openProjectId, libraryImport, toast } = useApp();
  useEffect(() => {
    setSignedOutHandler(() => useApp.setState({ user: null }));
    init();
    // a project link pasted into an open Eddy tab (#/p/<id>) opens that project
    const onHash = () => {
      const m = location.hash.match(/^#\/p\/(.+)$/), st = useApp.getState();
      if (m && st.user && st.openProjectId !== m[1]) useApp.setState({ openProjectId: m[1], view: 'editor' });
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (!ready) return <div className="app"><div className="topbar"><div className="brand"><ILogo /> Eddy</div></div></div>;
  if (!user) return <SignIn />;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><ILogo /> Eddy</div>
        <nav className="nav">
          {[...NAV, ...(user.role === 'admin' && be.accounts ? [['users', 'Users'] as [View, string]] : [])].map(([v, label]) => (
            <button key={v} className={view === v ? 'on' : ''} disabled={v === 'editor' && !openProjectId} style={v === 'editor' && !openProjectId ? { opacity: 0.4 } : undefined} onClick={() => setView(v)}>{label}</button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="who">
          <span title={user.username ? `Signed in as ${user.username}${user.role === 'admin' ? ' (admin)' : ''}` : undefined}>{user.name}</span>
          {be.accounts && <button className="btn ghost sm" style={{ color: '#c9d4ea' }} onClick={async () => {
            const v = await openDialog<{ current: string; next: string }>((close) => <ChangePasswordDialog close={close} />);
            if (!v) return;
            try { await be.accounts!.changeOwnPassword(v.current, v.next); toast('Password changed', 'ok'); } catch (e: any) { toast(e?.message || String(e), 'error'); }
          }}>Change password</button>}
          <button className="btn ghost sm" style={{ color: '#c9d4ea' }} onClick={async () => { await be.signOut(); location.replace(location.pathname.replace(/\/{2,}/g, '/')); }}>Sign out</button>
        </div>
      </div>
      {view === 'projects' && <ProjectsView />}
      {view === 'editor' && openProjectId && <EditorView key={openProjectId} projectId={openProjectId} />}
      {view === 'library' && <LibraryView />}
      {view === 'guidelines' && <GuidelinesView />}
      {view === 'users' && user.role === 'admin' && be.accounts && <UsersView />}
      <DialogHost />
      <MenuHost />
      {libraryImport && <div className="libimport" role="status"><span className="spin" />{libraryImport}</div>}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={'toast ' + (t.kind || '')}>{t.text}</div>)}</div>
    </div>
  );
}

function SignIn() {
  const { be, signedIn } = useApp();
  const [username, setUsername] = useState(() => { try { return localStorage.getItem('eddy.username') || ''; } catch { return ''; } });
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      try { localStorage.setItem('eddy.username', username.trim()); } catch { /* ignore */ }
      await signedIn(await be.signIn(username.trim(), password));
    } catch (x: any) { setErr(x?.message || String(x)); }
    finally { setBusy(false); }
  };
  return (
    <div className="app" style={{ background: 'var(--navy)' }}>
      <form className="signin" onSubmit={submit}>
        <ILogo width={40} height={40} />
        <h2>Eddy</h2>
        <p>AI podcast editor. Sign in with the username and password your admin gave you.</p>
        {be.demo && <p style={{ background: '#fdeedf', color: '#9b4a07', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}>Test build: everything is stored in this browser. Sign in as <b>admin</b> with the password <b>demo</b>, then add more users on the Users page.</p>}
        <div className="field" style={{ textAlign: 'left' }}>
          <label htmlFor="si-user">Username</label>
          <input id="si-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!username} />
        </div>
        <div className="field" style={{ textAlign: 'left' }}>
          <label htmlFor="si-pass">Password</label>
          <input id="si-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus={!!username} />
        </div>
        {err && <p role="alert" style={{ color: 'var(--danger)' }}>{err}</p>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !username.trim() || !password}>{busy ? 'Checking…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
