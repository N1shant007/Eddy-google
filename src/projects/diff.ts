import type { Asset, Clip, ProjectDoc } from '@eddy/rules';

export interface DiffLine { kind: 'add' | 'del' | 'chg'; text: string }

const t = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/** Human-readable differences between two versions of an edit (a = older, b = newer). */
export function diffDocs(a: ProjectDoc, b: ProjectDoc, assets: Asset[]): DiffLine[] {
  const name = (h: string) => assets.find((x) => x.hash === h)?.name || (h === b.dialogueHash || h === a.dialogueHash ? 'Main dialogue' : 'Sound ' + h.slice(0, 6));
  const out: DiffLine[] = [];
  if ((a.product || '') !== (b.product || '')) out.push({ kind: 'chg', text: `Product: ${a.product || 'none'} → ${b.product || 'none'}` });
  if (a.dialogueHash !== b.dialogueHash) out.push({ kind: 'chg', text: b.dialogueHash ? 'Main dialogue audio replaced' : 'Main dialogue removed' });
  if ((a.scriptText || '') !== (b.scriptText || '')) {
    const la = a.lines.length, lb = b.lines.length;
    out.push({ kind: 'chg', text: `Script changed (${la} → ${lb} lines)` });
  }
  const ka = new Map(a.clips.map((c) => [c.id, c])), kb = new Map(b.clips.map((c) => [c.id, c]));
  // auto-edit replaces auto clip ids, so also match by sound + start
  const sig = (c: Clip) => `${c.assetHash}@${c.start.toFixed(1)}`;
  const sa = new Set(a.clips.map(sig)), sb = new Set(b.clips.map(sig));
  for (const c of b.clips) {
    const o = ka.get(c.id);
    if (!o) { if (!sa.has(sig(c))) out.push({ kind: 'add', text: `Added ${name(c.assetHash)} at ${t(c.start)}` }); continue; }
    const ch: string[] = [];
    if (Math.abs(o.start - c.start) > 0.04) ch.push(`moved ${t(o.start)} → ${t(c.start)}`);
    if (Math.abs(o.dur - c.dur) > 0.04) ch.push(`length ${o.dur.toFixed(1)} → ${c.dur.toFixed(1)} s`);
    if (o.gain !== c.gain) ch.push(`volume ${o.gain} → ${c.gain} dB`);
    if (o.fadeIn !== c.fadeIn || o.fadeOut !== c.fadeOut) ch.push('fades changed');
    if (ch.length) out.push({ kind: 'chg', text: `${name(c.assetHash)}: ${ch.join(', ')}` });
  }
  for (const c of a.clips) if (!kb.has(c.id) && !sb.has(sig(c))) out.push({ kind: 'del', text: `Removed ${name(c.assetHash)} at ${t(c.start)}` });
  for (const tr of b.tracks) {
    const o = a.tracks.find((x) => x.id === tr.id);
    if (o && (o.vol !== tr.vol || o.mute !== tr.mute)) out.push({ kind: 'chg', text: `Track ${tr.name}: ${o.vol !== tr.vol ? `volume ${o.vol} → ${tr.vol} dB` : ''}${o.mute !== tr.mute ? (tr.mute ? ' muted' : ' unmuted') : ''}` });
  }
  return out;
}
