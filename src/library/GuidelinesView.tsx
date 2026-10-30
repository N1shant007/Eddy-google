import { useEffect, useState } from 'react';
import { useApp } from '../state/app';
import { withHouseRules } from '../data/houseRules';
import { uid } from '../data/util';
import { askText } from '../ui/dialogs';
import { IPlus, ISave } from '../ui/icons';

export function GuidelinesView() {
  const { guidelines, be, refreshLibrary, toast } = useApp();
  const def = guidelines.find((g) => g.isDefault) || guidelines[0];
  const [sel, setSel] = useState<string | null>(def?.id || null);
  const g = guidelines.find((x) => x.id === sel) || null;
  const [text, setText] = useState(g?.text || '');
  useEffect(() => { setText(g?.text || ''); }, [g?.id, g?.updatedAt]);
  const dirty = !!g && text !== g.text;

  const save = async (makeDefault = false) => {
    if (!g) return;
    try {
      if (makeDefault) for (const x of guidelines) if (x.isDefault && x.id !== g.id) await be.saveGuideline({ ...x, isDefault: false });
      await be.saveGuideline({ ...g, text, isDefault: makeDefault || g.isDefault });
      await refreshLibrary();
      toast(makeDefault ? `“${g.name}” is now the default for every edit` : 'Guidelines saved', 'ok');
    } catch (e: any) { toast(e?.message || String(e), 'error'); }
  };

  return (
    <div className="main">
      <aside className="sidebar">
        <h4>Guidelines <button className="btn ghost icon sm" title="New guidelines" onClick={async () => {
          const name = await askText('New guidelines', '', 'Create', 'Name');
          if (!name) return;
          const id = uid('g_');
          await be.saveGuideline({ id, name, text: withHouseRules(g?.text || '') });
          await refreshLibrary(); setSel(id);
        }}><IPlus /></button></h4>
        <div className="tree">
          {guidelines.map((x) => (
            <div key={x.id} className={'tnode' + (sel === x.id ? ' on' : '')} onClick={() => setSel(x.id)}>
              <span className="nm">{x.name}</span>{x.isDefault && <span className="tag v">Default</span>}
            </div>
          ))}
          {guidelines.length === 0 && <p style={{ color: 'var(--muted)', padding: 8, fontSize: 13 }}>Import the starter library (Audio library tab) to get the Bajaj storytelling guidelines.</p>}
        </div>
      </aside>
      <div className="content">
        {g ? (<>
          <div className="headrow">
            <h1>{g.name}</h1>
            {!g.isDefault && <button className="btn" onClick={() => save(true)}>Make default</button>}
            <button className="btn primary" disabled={!dirty} onClick={() => save(false)}><ISave /> Save</button>
          </div>
          <p style={{ color: 'var(--muted)', marginTop: -8 }}>Auto-edit and the AI follow these rules. One rule per line, written plainly.</p>
          <textarea className="guide" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        </>) : <div className="empty"><h3>No guidelines yet</h3></div>}
      </div>
    </div>
  );
}
