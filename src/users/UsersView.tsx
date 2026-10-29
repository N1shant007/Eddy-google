import { useEffect, useState, type FormEvent } from 'react';
import { useApp } from '../state/app';
import type { Account } from '../data/types';
import { confirmBox, openDialog } from '../ui/dialogs';
import { IPlus } from '../ui/icons';

/* Admins only: add people, set their passwords, change roles, disable or remove accounts. */

const MIN = 8;
const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export function UsersView() {
  const { be, user, toast } = useApp();
  const acc = be.accounts!;
  const [list, setList] = useState<Account[] | null>(null);
  const load = () => acc.list().then(setList).catch((e) => toast(e?.message || String(e), 'error'));
  useEffect(() => { void load(); }, []);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok, 'ok'); await load(); } catch (e: any) { toast(e?.message || String(e), 'error', 6000); }
  };
  const add = async () => {
    const a = await openDialog<{ username: string; name: string; password: string; role: 'admin' | 'editor' }>((close) => <AddUserDialog close={close} />);
    if (a) await run(() => acc.add(a), `Added ${a.username}. Share the password with them privately.`);
  };
  const reset = async (u: Account) => {
    const pw = await openDialog<string>((close) => <PasswordDialog title={`New password for ${u.username}`} close={close} />);
    if (pw) await run(() => acc.update(u.username, { password: pw }), `Password changed for ${u.username}`);
  };
  const remove = async (u: Account) => {
    if (!(await confirmBox(`Remove ${u.username}?`, 'They can no longer sign in. Their saved versions keep their name.'))) return;
    await run(() => acc.remove(u.username), `Removed ${u.username}`);
  };

  return (
    <div className="main">
      <section className="content" style={{ maxWidth: 980 }}>
        <div className="pagehead" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <h2 style={{ margin: 0, flex: 1 }}>Users</h2>
          <button className="btn primary" onClick={add}><IPlus /> Add user</button>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>Everyone signs in with their own username and password. Admins can add people, reset passwords, change roles and disable or remove accounts. Passwords are stored only as secure hashes, so nobody can read them back: share a new password with the person directly.</p>
        {!list ? <p className="hint">Loading…</p> : (
          <table className="users">
            <thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Added</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {list.map((u) => {
                const me = u.username === user?.username;
                return (
                  <tr key={u.username} className={u.disabled ? 'off' : ''}>
                    <td><b>{u.username}</b>{me && <span className="tag v" style={{ marginLeft: 6 }}>You</span>}</td>
                    <td>{u.name}</td>
                    <td>
                      <select value={u.role} aria-label={`Role for ${u.username}`} onChange={(e) => run(() => acc.update(u.username, { role: e.target.value as Account['role'] }), `${u.username} is now ${e.target.value === 'admin' ? 'an admin' : 'an editor'}`)}>
                        <option value="editor">Editor</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td>{u.disabled ? 'Disabled' : 'Active'}</td>
                    <td className="muted">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : ''}{u.createdBy ? ` by ${u.createdBy}` : ''}</td>
                    <td className="acts">
                      <button className="btn sm" onClick={() => reset(u)}>Set password</button>
                      {!me && <button className="btn sm" onClick={() => run(() => acc.update(u.username, { disabled: !u.disabled }), `${u.username} ${u.disabled ? 'can sign in again' : 'is disabled'}`)}>{u.disabled ? 'Enable' : 'Disable'}</button>}
                      {!me && <button className="btn sm danger" onClick={() => remove(u)}>Remove</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function AddUserDialog({ close }: { close: (v: { username: string; name: string; password: string; role: 'admin' | 'editor' } | null) => void }) {
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'editor'>('editor');
  const u = username.trim().toLowerCase();
  const err = u && !USERNAME.test(u) ? 'Use 2–32 lowercase letters, digits, dot, dash or underscore.' : password && password.length < MIN ? `At least ${MIN} characters.` : '';
  const ok = USERNAME.test(u) && password.length >= MIN;
  const submit = (e: FormEvent) => { e.preventDefault(); if (ok) close({ username: u, name: name.trim() || u, password, role }); };
  return (
    <form className="modal" onSubmit={submit}>
      <h3>Add user</h3>
      <div className="field"><label htmlFor="nu-user">Username</label><input id="nu-user" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="off" placeholder="e.g. riya" /></div>
      <div className="field"><label htmlFor="nu-name">Name (shown in version history)</label><input id="nu-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" placeholder="e.g. Riya" /></div>
      <div className="field"><label htmlFor="nu-pass">Password</label><input id="nu-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="nu-role">Role</label>
        <select id="nu-role" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'editor')}><option value="editor">Editor: edits projects and the library</option><option value="admin">Admin: also manages users</option></select>
      </div>
      {err && <p role="alert" style={{ color: 'var(--danger)', margin: '4px 0' }}>{err}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!ok}>Add user</button>
      </div>
    </form>
  );
}

function PasswordDialog({ title, close }: { title: string; close: (v: string | null) => void }) {
  const [pw, setPw] = useState('');
  return (
    <form className="modal" onSubmit={(e) => { e.preventDefault(); if (pw.length >= MIN) close(pw); }}>
      <h3>{title}</h3>
      <div className="field"><label htmlFor="pw-new">New password (at least {MIN} characters)</label><input id="pw-new" type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" /></div>
      <div className="row">
        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={pw.length < MIN}>Save password</button>
      </div>
    </form>
  );
}

/** anyone: change your own password */
export function ChangePasswordDialog({ close }: { close: (v: { current: string; next: string } | null) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const err = next && next.length < MIN ? `At least ${MIN} characters.` : again && again !== next ? 'The new passwords don’t match.' : '';
  const ok = current && next.length >= MIN && next === again;
  return (
    <form className="modal" onSubmit={(e) => { e.preventDefault(); if (ok) close({ current, next }); }}>
      <h3>Change your password</h3>
      <div className="field"><label htmlFor="cp-cur">Current password</label><input id="cp-cur" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus autoComplete="current-password" /></div>
      <div className="field"><label htmlFor="cp-new">New password</label><input id="cp-new" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></div>
      <div className="field"><label htmlFor="cp-again">New password again</label><input id="cp-again" type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></div>
      {err && <p role="alert" style={{ color: 'var(--danger)', margin: '4px 0' }}>{err}</p>}
      <div className="row">
        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!ok}>Change password</button>
      </div>
    </form>
  );
}
