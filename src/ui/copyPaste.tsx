import { useState } from 'react';
import { openDialog } from './dialogs';
import { ICopy } from './icons';

/** Free option: copy the prompt into Claude (Pro or free) or ChatGPT, paste the reply back. Resolves to the reply text. */
export function copyPasteAI(prompt: string, what: string) {
  return openDialog<string>((close) => <CopyPaste prompt={prompt} what={what} close={close} />);
}

function CopyPaste({ prompt, what, close }: { prompt: string; what: string; close: (v: string | null) => void }) {
  const [copied, setCopied] = useState(false);
  const [reply, setReply] = useState('');
  const copy = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); }
    catch { const t = document.getElementById('cp-prompt') as HTMLTextAreaElement | null; t?.select(); document.execCommand('copy'); setCopied(true); }
  };
  return (
    <div className="modal wide">
      <h3>{what} with your Claude account</h3>
      <p>Free with your Claude subscription. Nothing is sent from Eddy: you copy the request into Claude and paste its answer back here.</p>
      <div className="steps">
        <div className="step"><b>1</b><span>Copy the request ({Math.round(prompt.length / 1000)}k characters)</span>
          <button className="btn sm primary" onClick={copy}><ICopy /> {copied ? 'Copied' : 'Copy request'}</button></div>
        <div className="step"><b>2</b><span>Open a new chat, paste it and send</span>
          <a className="btn sm" href="https://claude.ai/new" target="_blank" rel="noreferrer">Open Claude</a></div>
        <div className="step"><b>3</b><span>Copy Claude’s whole reply (the JSON) and paste it below</span></div>
      </div>
      <textarea id="cp-prompt" readOnly value={prompt} style={{ position: 'absolute', left: -9999, width: 1, height: 1 }} aria-hidden />
      <div className="field"><textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder='{"cues": [ … ] }' style={{ minHeight: 140, fontFamily: 'ui-monospace, monospace', fontSize: 12 }} /></div>
      <div className="row">
        <button className="btn" onClick={() => close(null)}>Cancel</button>
        <button className="btn primary" disabled={!reply.trim()} onClick={() => close(reply)}>Apply reply</button>
      </div>
    </div>
  );
}
