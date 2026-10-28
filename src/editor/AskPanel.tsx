import { useEffect, useState } from 'react';
import { applyOps, isEditBlock, opsPrompt, parseEditBlock, parseJsonLoose, placeCues } from '@eddy/rules';
import { useApp } from '../state/app';
import { useEditor } from '../state/editor';
import { loadAll } from '../audio/engine';
import { askTeamAI, PROVIDER_NAME, teamAI } from '../data/ai';
import { copyPasteAI } from '../ui/copyPaste';
import { activeGuidelineText } from './AutoEditPanel';

interface Msg { role: 'u' | 'a' | 'e'; text: string }

const EXAMPLES = [
  'Lower all background music by 3 dB',
  'Add a whoosh before every line the guest speaks',
  'Remove sound effects that are closer than 10 seconds apart',
  'Make the outro fade out over 5 seconds',
];

export function AskPanel() {
  const { assets, categories } = useApp();
  const [chat, setChat] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState<{ provider: string; model: string } | null>(null);
  useEffect(() => { teamAI().then(setAi); }, []);
  const push = (m: Msg) => setChat((c) => [...c, m]);
  const block = isEditBlock(text);

  const send = async () => {
    const req = text.trim();
    if (!req) return;
    const s = useEditor.getState();
    if (block) {
      // exact instructions: no AI involved
      const ed = parseEditBlock(req, s.doc);
      if (!ed) return;
      if (!s.doc.lines.length) { push({ role: 'e', text: 'Add the script first (Auto-edit tab) so line numbers like L12 can be matched.' }); return; }
      push({ role: 'u', text: req.split('\n').slice(0, 4).join('\n') + (req.split('\n').length > 4 ? '\n…' : '') });
      let placed = 0, missing: string[] = [], n = 0;
      s.edit((d) => {
        const replaces = new Set(ed.cues.filter((c) => c.type === 'intro' || c.type === 'outro').map((c) => c.type));
        const cues = [...d.cues.filter((c) => !replaces.has(c.type)), ...ed.cues];
        placeCues(d, cues, { assets, categories });
        d.cues = cues;
        n = applyOps(d, ed.ops, assets).n;
        placed = ed.cues.filter((c) => c.clipId).length;
        missing = ed.cues.filter((c) => !c.clipId).map((c) => `· L${c.line + 1} ${c.type} “${c.sound}”: ${c.note || 'no matching sound'}`);
      });
      await loadAll(useEditor.getState().doc.clips.map((c) => c.assetHash));
      push({ role: 'a', text: `Applied: ${placed} of ${ed.cues.length} cues placed${n ? `, ${n} track change${n > 1 ? 's' : ''}` : ''}.` +
        (missing.length ? `\nNot placed:\n${missing.join('\n')}` : '') + (ed.warn.length ? `\nSkipped:\n${ed.warn.map((w) => '· ' + w).join('\n')}` : '') + '\nCtrl+Z undoes it.' });
      setText('');
      return;
    }
    push({ role: 'u', text: req });
    setText('');
    setBusy(true);
    try {
      const prompt = opsPrompt(s.doc, req, assets, categories, activeGuidelineText(), s.playhead, s.sel);
      const reply = ai ? await askTeamAI(prompt) : await copyPasteAI(prompt, 'Edit');
      if (reply == null) { push({ role: 'e', text: 'Cancelled.' }); return; }
      const j = parseJsonLoose(reply);
      if (!j || !Array.isArray(j.ops)) { push({ role: 'e', text: 'The reply had no edit operations. Try rephrasing.' }); return; }
      let r = { n: 0, skipped: 0 };
      useEditor.getState().edit((d) => { r = applyOps(d, j.ops, assets); });
      await loadAll(useEditor.getState().doc.clips.map((c) => c.assetHash));
      push({ role: 'a', text: `${j.summary || 'Done.'}\n${r.n} change${r.n === 1 ? '' : 's'} applied${r.skipped ? `, ${r.skipped} skipped` : ''}. Ctrl+Z undoes it.` });
    } catch (e: any) { push({ role: 'e', text: e?.message || String(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="insp">
      <p className="hint" style={{ marginTop: 0 }}>
        Describe a change in plain words and {ai ? `${PROVIDER_NAME[ai.provider] || 'the team AI'}` : 'Claude (copy-paste)'} turns it into edits.
        Or paste exact instructions starting with <b>EDDY EDIT</b>: they apply straight away, with no AI.
      </p>
      <div className="chat">{chat.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.text}</div>)}</div>
      {chat.length === 0 && (
        <div className="acts" style={{ marginBottom: 10 }}>
          {EXAMPLES.map((x) => <button key={x} className="btn sm" onClick={() => setText(x)}>{x}</button>)}
        </div>
      )}
      <div className="field">
        <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 100 }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
          placeholder={'e.g. Lower all background music by 3 dB\n\nor\n\nEDDY EDIT\nSFX: coin chime | after L12\nBGM: story play | L5-L9 | -2 dB\nVOLUME: Background music | -3 dB'} />
      </div>
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || !text.trim()} onClick={send}>
        {busy ? 'Working…' : block ? 'Apply instructions' : 'Apply'}
      </button>
      <details style={{ marginTop: 12 }} className="hint">
        <summary>EDDY EDIT format</summary>
        <div style={{ marginTop: 6, lineHeight: 1.7 }}>
          First line <code>EDDY EDIT</code>, then one instruction per line:<br />
          <code>SFX: coin chime | after L12</code><br />
          <code>EMOTION: laugh | after "that is so true"</code><br />
          <code>TRANSITION: harp glide | before L20 | -16 dB</code><br />
          <code>BGM: story play | L5-L9</code><br />
          <code>INTRO: 1bfl intro track</code> · <code>OUTRO: warm close</code><br />
          <code>VOLUME: Background music | -3 dB</code> · <code>DUCK: Background music | 12 dB</code><br />
          Line numbers count from L1 (the first spoken line). Add <code>// why</code> at the end of a line as a note.
        </div>
      </details>
    </div>
  );
}
