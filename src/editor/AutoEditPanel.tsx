import { useEffect, useMemo, useRef, useState } from 'react';
import {
  alignLines, applyTimings, autoEdit, autoEditPrompt, finishEdit, guessProduct, linesFromBlocks, normCues, parseAlignJson, parseJsonLoose, parseProductDisclaimers,
  parseScript, parseSubs, placeCues, prepareLines, type AutoEditReport, type Cue,
} from '@eddy/rules';
import { aiProviders, askAI, useAi } from '../data/ai';
import { AiPicker } from './AiPicker';
import { copyPasteAI } from '../ui/copyPaste';
import { useApp } from '../state/app';
import { useEditor } from '../state/editor';
import { getBuffer, loadAll, loadBuffer, speechSegments } from '../audio/engine';
import { IMagic, IUpload } from '../ui/icons';
import { openDialog } from '../ui/dialogs';
import { fmtTime } from './layout';

type Engine = 'rules' | 'team' | 'paste';
/** the guideline this project uses: its own choice, else the team default (Guidelines page) */
export const activeGuideline = (guidelineId?: string | null) => {
  const g = useApp.getState().guidelines;
  return g.find((x) => x.id === guidelineId) || g.find((x) => x.isDefault) || g[0] || null;
};
export const activeGuidelineText = () => activeGuideline(useEditor.getState().doc.guidelineId)?.text || '';

/** Pipeline hand-off: apply the pipeline's subtitles (if any) and run the rules auto-edit, without the panel open. */
export async function autoEditFromPipeline(subtitles: string | null): Promise<AutoEditReport> {
  const { assets, categories } = useApp.getState();
  const products = [...new Set([...DEFAULT_PRODUCTS, ...assets.filter((a) => a.role === 'pdisclaimer' && a.product).map((a) => a.product!)])];
  const s = useEditor.getState();
  const h = s.doc.dialogueHash;
  const buf = h ? getBuffer(h) || (await loadBuffer(h)) : null;
  const c = { assets, categories, speech: h && buf ? speechSegments(h) : [], dialogueDur: buf?.duration || 0, products: useEditor.getState().doc.noProduct ? [] : products, productDisclaimers: parseProductDisclaimers(activeGuidelineText()) };
  let rep!: AutoEditReport;
  s.edit((d) => {
    if (subtitles) {
      const blocks = /^\s*[\[{]/.test(subtitles) ? (() => { try { return parseAlignJson(JSON.parse(subtitles)); } catch { return []; } })() : parseSubs(subtitles);
      if (blocks.length) {
        if ((d.scriptText || '').trim()) {
          const p = parseScript(d.scriptText);
          alignLines(p.lines, c.speech, c.dialogueDur);
          applyTimings(p.lines, blocks);
          d.lines = p.lines;
        } else {
          d.lines = linesFromBlocks(blocks);
          d.scriptText = d.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
        }
      }
    }
    rep = autoEdit(d, c);
  });
  await loadAll(useEditor.getState().doc.clips.map((x) => x.assetHash));
  return rep;
}

/** Gemini on the server, if set up (it can transcribe the episode) */
export async function geminiModel(): Promise<string | null> {
  if (!useApp.getState().be.transcribe) return null;
  const list = await aiProviders();
  const g = list.find((p) => p.id === 'gemini');
  if (!g) return null;
  let saved: { provider?: string; model?: string } | null = null;
  try { saved = JSON.parse(localStorage.getItem('eddy.ai') || 'null'); } catch { /* ignore */ }
  return saved?.provider === 'gemini' && saved.model && g.models.includes(saved.model) ? saved.model : g.defaultModel;
}

/** Gemini listens to the episode and times every line, so no subtitles are needed.
    With a script: the script keeps its wording and gets exact times. Without one: the transcript becomes the script. */
export async function transcribeEpisode(model: string): Promise<string> {
  const { be } = useApp.getState();
  const s0 = useEditor.getState();
  const h = s0.doc.dialogueHash;
  if (!h || !be.transcribe) throw new Error('Import the episode audio first.');
  const { segments } = await be.transcribe(h, s0.doc.scriptText || '', model);
  const blocks = segments.map((x) => ({ t0: x.start, t1: x.end, text: (x.speaker ? x.speaker + ': ' : '') + x.text }));
  const buf = getBuffer(h) || (await loadBuffer(h));
  const speech = buf ? speechSegments(h) : [], dur = buf?.duration || 0;
  let msg = '';
  useEditor.getState().edit((d) => {
    if ((d.scriptText || '').trim()) {
      const p = parseScript(d.scriptText);
      alignLines(p.lines, speech, dur);
      const n = applyTimings(p.lines, blocks);
      d.lines = p.lines;
      msg = `Gemini timed ${n} of ${p.lines.length} script lines`;
    } else {
      d.lines = linesFromBlocks(blocks);
      d.scriptText = d.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
      msg = `Gemini transcribed the episode: ${d.lines.length} timed lines`;
    }
  });
  return msg;
}

/** products to choose from: the usual ones, those with a disclaimer sound, and those the guideline names a disclaimer for */
export function productChoices(): string[] {
  const { assets } = useApp.getState();
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const title = (x: string) => x.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const named = Object.keys(parseProductDisclaimers(activeGuidelineText())).map(title);
  const all = [...DEFAULT_PRODUCTS, ...assets.filter((a) => a.role === 'pdisclaimer' && a.product).map((a) => a.product!), ...named];
  const seen = new Set<string>();
  return all.filter((p) => { const k = norm(p); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** asks which product the episode is about, once, when the episode audio is imported (its disclaimer plays before the closing AI disclaimer). null = cancelled, '' = no product */
export function askProduct(): Promise<string | null> {
  const d = useEditor.getState().doc;
  const options = productChoices();
  const guess = d.product || guessProduct(d.scriptText || '', options) || '';
  const named = parseProductDisclaimers(activeGuidelineText());
  return openDialog<string>((close) => <ProductDialog options={options} initial={guess} named={named} close={close} />);
}

function ProductDialog({ options, initial, named, close }: { options: string[]; initial: string; named: Record<string, string>; close: (v: string | null) => void }) {
  const [v, setV] = useState(options.find((o) => o.toLowerCase() === initial.toLowerCase()) || initial);
  const file = named[v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()];
  return (
    <form className="modal" onSubmit={(e) => { e.preventDefault(); close(v); }}>
      <h3>Which product is this episode about?</h3>
      <div className="field">
        <label htmlFor="ae-product">Product</label>
        <select id="ae-product" value={v} onChange={(e) => setV(e.target.value)} autoFocus>
          <option value="">No product (no product disclaimer)</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <p className="hint">{v ? (file ? `Its disclaimer, “${file}”, plays just before the closing AI disclaimer.` : `The ${v} disclaimer from the Product Disclaimer category plays just before the closing AI disclaimer. Name the file in the guideline (PRODUCT DISCLAIMERS line) to pick a specific one.`) : 'Only the AI disclaimer will open and close the episode.'}</p>
      <div className="row">
        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
        <button type="submit" className="btn primary">Continue</button>
      </div>
    </form>
  );
}

const DEFAULT_PRODUCTS = ['Home Loan', 'Personal Loan', 'Gold Loan', 'Business Loan', 'Loan Against Property', 'Insurance', 'Fixed Deposit', 'Credit Card'];

export function AutoEditPanel() {
  const { doc, edit } = useEditor();
  const { assets, categories, toast } = useApp();
  const [report, setReport] = useState<AutoEditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [showCues, setShowCues] = useState(false);
  const [engine, setEngineS] = useState<Engine>(() => (localStorage.getItem('eddy.engine') as Engine) || 'rules');
  const { list: aiList, choice: aiChoice, provider: aiProv, label: aiLabel } = useAi();
  const ai = aiList && aiList.length ? aiChoice : null;
  const canTranscribe = !!useApp.getState().be.transcribe && !!aiList?.some((p) => p.id === 'gemini');
  const setEngine = (e: Engine) => { setEngineS(e); try { localStorage.setItem('eddy.engine', e); } catch { /* ignore */ } };
  const eff: Engine = engine === 'team' && !ai ? 'rules' : engine;
  const aiName = aiProv?.name || 'AI';
  const scriptFile = useRef<HTMLInputElement>(null), subsFile = useRef<HTMLInputElement>(null);
  const products = useMemo(() => [...new Set([...DEFAULT_PRODUCTS, ...assets.filter((a) => a.role === 'pdisclaimer' && a.product).map((a) => a.product!)])], [assets]);
  const parsedCount = useMemo(() => parseScript(doc.scriptText || '').lines.length, [doc.scriptText]);
  const exact = doc.lines.filter((l) => l.exact).length;

  const ctx = async () => {
    const h = useEditor.getState().doc.dialogueHash;
    const buf = h ? getBuffer(h) || (await loadBuffer(h)) : null;
    // the product chosen on import; with none chosen yet (older projects) it is picked from the script, unless "No product" was chosen
    const noGuess = !!useEditor.getState().doc.noProduct;
    return { assets, categories, speech: h && buf ? speechSegments(h) : [], dialogueDur: buf?.duration || 0, products: noGuess ? [] : products, productDisclaimers: parseProductDisclaimers(activeGuidelineText()) };
  };

  const run = async () => {
    if (!doc.dialogueHash) { toast('Import the episode audio first (top right).', 'error'); return; }
    if (!assets.length) { toast('The audio library is empty. Import the starter library in Audio library.', 'error', 6000); return; }
    setBusy(true);
    try {
      // no subtitles yet: let Gemini listen to the episode and time the lines first
      if (!useEditor.getState().doc.lines.some((l) => l.exact)) {
        const gm = await geminiModel();
        if (gm) {
          setStage('Gemini is listening to the episode…');
          try { toast(await transcribeEpisode(gm), 'ok', 5000); }
          catch (e: any) { toast(`${e?.message || e} Timing the lines from the speech pauses instead.`, 'error', 8000); }
          finally { setStage(''); }
        }
      }
      const c = await ctx();
      let rep!: AutoEditReport;
      if (eff === 'rules') {
        edit((d) => { rep = autoEdit(d, c); });
      } else {
        // AI: the same line timing as the rules, then the AI's cue sheet, then the storytelling rules on top
        const work = structuredClone(useEditor.getState().doc);
        const p = prepareLines(work, c);
        if (p.audioOnly) throw new Error('Add the script or subtitles first: the AI needs the words.');
        const prompt = autoEditPrompt(work, assets, categories, activeGuidelineText());
        const text = eff === 'team' ? await askAI(prompt, ai!) : await copyPasteAI(prompt, 'Auto-edit');
        if (text == null) return;
        const cues = normCues(parseJsonLoose(text), work.lines.length, assets);
        if (!cues.length) throw new Error('No cues found in the reply. Paste the JSON exactly as the AI returned it.');
        // keep the script's own tags even if the AI dropped them
        for (const t of p.tagCues) if (t.source === 'tag' && !cues.some((x) => x.type === t.type && x.line === t.line)) cues.push(t);
        edit((d) => { Object.assign(d, work); rep = finishEdit(d, c, cues, p.notes, false); });
      }
      await loadAll(useEditor.getState().doc.clips.map((x) => x.assetHash));
      setReport(rep);
      toast(`${eff === 'rules' ? 'Auto-edit' : eff === 'team' ? aiLabel : 'Claude'} placed ${rep.placed} sounds`, 'ok');
    } catch (e: any) { toast(e?.message || String(e), 'error', 7000); }
    finally { setBusy(false); }
  };

  const loadScript = async (f?: File) => {
    if (!f) return;
    const txt = await f.text();
    if (/\.(srt|vtt|json)$/i.test(f.name)) { loadSubs(f); return; }
    if (!parseScript(txt).lines.length) { toast(`No speaker lines in ${f.name}. Lines should look like NAME: text`, 'error', 6000); return; }
    edit((d) => { d.scriptText = txt; });
    toast(`Script loaded: ${parseScript(txt).lines.length} lines. Press Auto-edit.`, 'ok');
  };

  const loadSubs = async (f?: File) => {
    if (!f) return;
    let blocks: ReturnType<typeof parseSubs> = [];
    try { const t = await f.text(); blocks = /\.json$/i.test(f.name) ? parseAlignJson(JSON.parse(t)) : parseSubs(t); } catch { /* handled below */ }
    if (!blocks.length) { toast(`No timings found in ${f.name}. Use .srt, .vtt or an ElevenLabs / Whisper .json`, 'error', 6000); return; }
    const c = await ctx();
    let msg = '';
    edit((d) => {
      if ((d.scriptText || '').trim()) {
        const p = parseScript(d.scriptText);
        alignLines(p.lines, c.speech, c.dialogueDur);
        const n = applyTimings(p.lines, blocks);
        d.lines = p.lines;
        msg = `Subtitles matched ${n} of ${p.lines.length} script lines exactly`;
      } else {
        d.lines = linesFromBlocks(blocks);
        d.scriptText = d.lines.map((l) => `${l.speaker}: ${l.text}`).join('\n');
        msg = `Built a ${d.lines.length}-line script from ${f.name}. Add speaker names (NAME: text) for the storytelling rules.`;
      }
    });
    toast(msg + '. Press Auto-edit.', 'ok', 6000);
  };

  const toggleCue = (q: Cue) => {
    edit((d) => {
      const c = d.cues.find((x) => x.id === q.id);
      if (!c) return;
      c.on = !c.on;
      placeCues(d, d.cues, { assets, categories });
    });
  };

  return (
    <div className="insp">
      <div className="field">
        <label>Script <span className="val" style={{ fontWeight: 400, color: 'var(--muted)' }}>{parsedCount ? `${parsedCount} lines` : ''}{exact ? ` · ${exact} timed exactly` : ''}</span></label>
        <textarea value={doc.scriptText} spellCheck={false} placeholder={'SHWETA: Welcome to the show…\nKARAN: Today we talk about…\n[SFX: whoosh]'}
          onFocus={() => useEditor.getState().checkpoint()}
          onChange={(e) => edit((d) => { d.scriptText = e.target.value; }, false)} style={{ minHeight: 150, fontSize: 12.5 }} />
      </div>
      <div className="acts" style={{ marginTop: -4, marginBottom: 12 }}>
        <input ref={scriptFile} type="file" accept=".txt,.md,.srt,.vtt,.json" hidden onChange={(e) => { loadScript(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={subsFile} type="file" accept=".srt,.vtt,.json" hidden onChange={(e) => { loadSubs(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="btn sm" onClick={() => scriptFile.current?.click()}><IUpload /> Script file</button>
        <button className="btn sm" onClick={() => subsFile.current?.click()}><IUpload /> Subtitles (.srt)</button>
      </div>
      {canTranscribe && !exact && (
        <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>Subtitles are optional: Gemini listens to the episode and times every line when you press Auto-edit (no script needed either).</p>
      )}
      <div className="field">
        <label>Product</label>
        <input list="eddy-products" value={doc.product} placeholder="Chosen when you import the episode audio"
          onFocus={() => useEditor.getState().checkpoint()} onChange={(e) => edit((d) => { d.product = e.target.value; if (e.target.value.trim()) d.noProduct = false; }, false)} />
        <datalist id="eddy-products">{products.map((p) => <option key={p} value={p} />)}</datalist>
      </div>
      <div className="field">
        <label>Hosts (blank = first two speakers)</label>
        <input value={doc.settings.hosts} placeholder="e.g. Shweta, Karan" onFocus={() => useEditor.getState().checkpoint()}
          onChange={(e) => edit((d) => { d.settings.hosts = e.target.value; }, false)} />
      </div>
      <GuidelinePicker />
      <div className="field"><label>Who edits</label></div>
      <div className="seg" role="radiogroup" aria-label="Who edits">
        <button role="radio" aria-checked={eff === 'rules'} className={eff === 'rules' ? 'on' : ''} onClick={() => setEngine('rules')}>Rules (instant)</button>
        <button role="radio" aria-checked={eff === 'team'} className={eff === 'team' ? 'on' : ''} disabled={!ai} title={ai ? aiLabel : 'No AI is set up on the server (GEMINI_API_KEY or OPENAI_API_KEY)'} onClick={() => setEngine('team')}>{ai ? 'AI (Gemini / ChatGPT)' : 'AI (not set up)'}</button>
        <button role="radio" aria-checked={eff === 'paste'} className={eff === 'paste' ? 'on' : ''} onClick={() => setEngine('paste')}>Copy-paste Claude</button>
      </div>
      {eff === 'team' && <AiPicker />}
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center', padding: 10 }} disabled={busy} onClick={run}>
        <IMagic /> {busy ? (stage || (eff === 'team' ? `${aiName} is editing…` : 'Editing…')) : doc.cues.length ? 'Auto-edit again' : 'Auto-edit'}
      </button>
      <p className="hint" style={{ marginTop: 8 }}>
        {eff === 'rules'
          ? 'Uses the Bajaj storytelling rules: story rewrite for general talk, story play for valuable information, Unfolding Insights under questions, Coin Chime (the only sound effect) after low interest rates and money benefits, the intro music under every CTA, the outro, then the product disclaimer and the AI disclaimer. One background music at a time.'
          : `${eff === 'team' ? aiLabel : 'Claude'} reads the timed script, the library and the guideline above and writes the cue sheet; the storytelling rules (Coin Chime only, CTA music, one music at a time, disclaimers) still apply on top.`}
        {' '}Your own clips stay.
      </p>
      {report && (
        <div className="report">
          <b>{report.placed} sounds placed</b> from {report.cues} cues · {report.lines} lines{report.exactLines ? `, ${report.exactLines} timed exactly` : ''}
          {report.notes.map((n, i) => <div key={i} className="note">{n}</div>)}
        </div>
      )}
      {doc.cues.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button className="btn sm ghost" onClick={() => setShowCues((s) => !s)}>{showCues ? 'Hide' : 'Show'} the {doc.cues.length} cues (why each sound is there)</button>
          {showCues && (
            <div className="cues">
              {doc.cues.slice().sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9)).map((q) => (
                <label key={q.id} className={'cue' + (q.on ? '' : ' off')}>
                  <input type="checkbox" checked={q.on} onChange={() => toggleCue(q)} />
                  <span className="cw">
                    <span className="ct">{q.at != null ? fmtTime(q.at) : '—'} · {q.sound}</span>
                    <span className="cr">{q.reason}{q.note ? ` · ${q.note}` : ''}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** per-project choice of editing guideline; saved with the project and its versions */
function GuidelinePicker() {
  const { doc, edit } = useEditor();
  const guidelines = useApp((s) => s.guidelines);
  const def = guidelines.find((x) => x.isDefault) || guidelines[0];
  const chosen = guidelines.find((x) => x.id === doc.guidelineId);
  if (!guidelines.length) return null;
  return (
    <div className="field">
      <label htmlFor="ae-guideline">Guideline</label>
      <select id="ae-guideline" value={chosen ? chosen.id : ''} style={{ width: '100%' }}
        onChange={(e) => { const v = e.target.value || null; edit((d) => { d.guidelineId = v; }); }}>
        <option value="">Team default{def ? ` (${def.name})` : ''}</option>
        {guidelines.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <p className="hint" style={{ margin: '4px 0 0' }}>AI and Copy-paste Claude follow this guideline. Rules (instant) always applies the Bajaj storytelling rules.</p>
    </div>
  );
}
