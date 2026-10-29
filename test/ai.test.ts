import { describe, expect, it } from 'vitest';
import { applyOps, emptyDoc, normCues, parseEditBlock, parseJsonLoose, parseScript, trackFor, type Asset } from '../src/shared/rules/index';

const coin: Asset = { hash: 'c0ffee0000000000aaaa', name: 'Coin Chime', categoryId: 'k', role: 'sfx', tags: [], dur: 1.1, size: 1, mime: 'audio/mpeg' };

function doc() {
  const d = emptyDoc();
  d.lines = parseScript('A: one\nB: two\nA: three').lines.map((l, i) => ({ ...l, t0: i * 5, t1: i * 5 + 4 }));
  d.dialogueHash = 'dlg';
  const t = trackFor(d, 'dialogue');
  d.clips.push({ id: 'dl', trackId: t.id, assetHash: 'dlg', start: 0, offset: 0, dur: 15, gain: 0, fadeIn: 0, fadeOut: 0, loop: false });
  return d;
}

describe('AI replies', () => {
  it('reads JSON wrapped in prose or code fences', () => {
    expect(parseJsonLoose('Here you go:\n```json\n{"cues":[]}\n```')).toEqual({ cues: [] });
    expect(parseJsonLoose('sure {"a":1} done')).toEqual({ a: 1 });
  });
  it('validates cues: drops unknown types, clamps lines, maps library ids to names', () => {
    const c = normCues({ cues: [{ type: 'sfx', sound: 'c0ffee000000', line: 99 }, { type: 'nonsense', line: 1 }] }, 3, [coin]);
    expect(c).toHaveLength(1);
    expect(c[0].line).toBe(2);
    expect(c[0].sound).toBe('Coin Chime');
    expect(c[0].source).toBe('ai');
  });
  it('applies ops safely and never touches fixed disclaimers', () => {
    const d = doc();
    const tr = trackFor(d, 'disclaimer');
    d.clips.push({ id: 'fx', trackId: tr.id, assetHash: 'disc', start: 0, offset: 0, dur: 5, gain: 0, fadeIn: 0, fadeOut: 0, loop: false, fixed: 'start' });
    const r = applyOps(d, [
      { op: 'add', asset: 'Coin Chime', line: 1, position: 'after', gainDb: 99 },
      { op: 'delete', clip: 'fx' },
      { op: 'delete', clip: 'nope' },
    ], [coin]);
    expect(r).toEqual({ n: 1, skipped: 2 });
    const added = d.clips.find((c) => c.assetHash === coin.hash)!;
    expect(added.start).toBeCloseTo(9.08, 2);
    expect(added.gain).toBe(12);
    expect(d.clips.some((c) => c.id === 'fx')).toBe(true);
  });
});

describe('EDDY EDIT blocks', () => {
  it('parses instructions with 1-based line numbers and quoted text', () => {
    const d = doc();
    trackFor(d, 'bed');
    const ed = parseEditBlock('EDDY EDIT\nSFX: coin chime | after L2 // money moment\nBGM: story play | L1-L3 | -2 dB\nEMOTION: laugh | after "three"\nVOLUME: Background | -3 dB\nNONSENSE: x', d)!;
    expect(ed.cues.map((c) => [c.type, c.line, c.position])).toEqual([['sfx', 1, 'after'], ['bed', 0, 'under'], ['emotion', 2, 'after']]);
    expect(ed.cues[0].reason).toBe('money moment');
    expect(ed.cues[1].endLine).toBe(2);
    expect(ed.ops).toHaveLength(1);
    expect(ed.warn.join()).toMatch(/Unknown instruction/);
  });
  it('is not triggered by ordinary requests', () => {
    expect(parseEditBlock('Lower the music', doc())).toBeNull();
  });
});

