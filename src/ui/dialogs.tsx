import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';

/* Promise-based dialogs: await askText(...), await confirmBox(...), await openDialog(render). */

type Render = (close: (v: unknown) => void) => ReactNode;
interface DState { stack: { id: number; render: Render; resolve: (v: unknown) => void }[] }
const useD = create<DState>(() => ({ stack: [] }));
let n = 0;

export function openDialog<T>(render: (close: (v: T | null) => void) => ReactNode): Promise<T | null> {
  return new Promise((resolve) => {
    const id = ++n;
    const close = (v: unknown) => {
      useD.setState((s) => ({ stack: s.stack.filter((d) => d.id !== id) }));
      resolve(v as T | null);
    };
    useD.setState((s) => ({ stack: [...s.stack, { id, render: render as Render, resolve: close }] }));
  });
}

export function DialogHost() {
  const stack = useD((s) => s.stack);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].resolve(null); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [stack]);
  return (
    <>
      {stack.map((d) => (
        <div key={d.id} className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) d.resolve(null); }}>
          {d.render(d.resolve)}
        </div>
      ))}
    </>
  );
}

function TextDialog({ title, label, initial, ok, close }: { title: string; label?: string; initial: string; ok: string; close: (v: string | null) => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <form className="modal" onSubmit={(e) => { e.preventDefault(); if (v.trim()) close(v.trim()); }}>
      <h3>{title}</h3>
      <div className="field">
        {label && <label>{label}</label>}
        <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} />
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
        <button type="submit" className="btn primary" disabled={!v.trim()}>{ok}</button>
      </div>
    </form>
  );
}

export const askText = (title: string, initial = '', ok = 'Save', label?: string) =>
  openDialog<string>((close) => <TextDialog title={title} label={label} initial={initial} ok={ok} close={close} />);

export const confirmBox = (title: string, text: string, ok = 'Delete', danger = true) =>
  openDialog<boolean>((close) => (
    <div className="modal">
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="row">
        <button className="btn" onClick={() => close(false)}>Cancel</button>
        <button className={'btn ' + (danger ? 'primary' : 'primary')} style={danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined} onClick={() => close(true)} autoFocus>{ok}</button>
      </div>
    </div>
  )).then((v) => !!v);

/* ---------- small context menu ---------- */
export interface MenuItem { label: string; icon?: ReactNode; danger?: boolean; kbd?: string; onClick: () => void; sep?: boolean }
interface MState { at: { x: number; y: number } | null; items: MenuItem[] }
const useM = create<MState>(() => ({ at: null, items: [] }));
export const openMenu = (x: number, y: number, items: MenuItem[]) => useM.setState({ at: { x, y }, items });
export const closeMenu = () => useM.setState({ at: null });

export function MenuHost() {
  const { at, items } = useM();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(at);
  useEffect(() => {
    if (!at) return;
    const el = ref.current;
    const w = el?.offsetWidth || 200, h = el?.offsetHeight || 200;
    setPos({ x: Math.min(at.x, innerWidth - w - 8), y: Math.min(at.y, innerHeight - h - 8) });
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) closeMenu(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    setTimeout(() => { addEventListener('mousedown', off); addEventListener('keydown', esc); addEventListener('blur', closeMenu); });
    return () => { removeEventListener('mousedown', off); removeEventListener('keydown', esc); removeEventListener('blur', closeMenu); };
  }, [at]);
  if (!at) return null;
  return (
    <div ref={ref} className="menu" style={{ left: (pos || at).x, top: (pos || at).y }} role="menu">
      {items.map((it, i) =>
        it.sep ? <hr key={i} /> : (
          <button key={i} className={it.danger ? 'danger' : ''} onClick={() => { closeMenu(); it.onClick(); }}>
            {it.icon}{it.label}{it.kbd && <span className="kbd">{it.kbd}</span>}
          </button>
        ),
      )}
    </div>
  );
}
