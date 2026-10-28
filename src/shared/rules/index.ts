export * from './types';
export * from './patterns';
export * from './script';
export * from './storytelling';
export * from './place';
export * from './ai';

import type { Asset, Category, Cue, ProjectDoc } from './types';
import { alignLines, cueId, cuesFromTags, guessProduct, keepExact, parseScript } from './script';
import { hostNames, ruleCues, withAccents, withCaution, withMoodBeds } from './storytelling';
import { placeCues } from './place';

export interface AutoEditInput {
  assets: Asset[];
  categories: Category[];
  /** speech segments in the dialogue file (seconds), for lining the script up when there are no subtitles */
  speech: [number, number][];
  dialogueDur: number;
  products?: string[];
}
export interface AutoEditReport {
  lines: number;
  exactLines: number;
  cues: number;
  placed: number;
  notes: string[];
  product?: string;
}

/** Parses the script and gives every line a time (subtitles exact, the rest lined up with the speech). */
export function prepareLines(doc: ProjectDoc, inp: AutoEditInput): { tagCues: Cue[]; notes: string[]; audioOnly: boolean } {
  const notes: string[] = [];
  const parsed = parseScript(doc.scriptText || '');
  if (parsed.lines.length) {
    const old = doc.lines;
    alignLines(parsed.lines, inp.speech, inp.dialogueDur);
    keepExact(old, parsed.lines);
    doc.lines = parsed.lines;
    if (!doc.product && inp.products?.length) {
      const g = guessProduct(doc.scriptText, inp.products);
      if (g) { doc.product = g; notes.push(`Product set to ${g} from the script.`); }
    }
    return { tagCues: cuesFromTags(parsed, inp.categories, inp.assets), notes, audioOnly: false };
  }
  if (doc.lines.length) return { tagCues: cuesFromTags({ lines: doc.lines, tags: [] }, inp.categories, inp.assets), notes, audioOnly: false };
  const s0 = inp.speech[0]?.[0] ?? 0, s1 = inp.speech[inp.speech.length - 1]?.[1] ?? inp.dialogueDur;
  doc.lines = [{ speaker: 'SPEAKER', text: '', t0: s0, t1: s1 }];
  notes.push('No script yet: only intro, outro, background music and disclaimers were placed. Paste the script or subtitles for story play, coin chimes and the CTA music.');
  return {
    tagCues: [
      { id: cueId(), on: true, type: 'intro', sound: 'intro', line: 0, position: 'before', source: 'rule', reason: 'Open on intro music' },
      { id: cueId(), on: true, type: 'outro', sound: 'outro', line: 0, position: 'after', source: 'rule', reason: 'Close on outro music' },
    ],
    notes, audioOnly: true,
  };
}

/** Places a cue list (from the rules or an AI) with the storytelling rules on top. Mutates `doc`. */
export function finishEdit(doc: ProjectDoc, inp: AutoEditInput, cues: Cue[], notes: string[], withEnrich: boolean, audioOnly = false): AutoEditReport {
  if (!audioOnly) {
    const hosts = hostNames(doc.lines, doc.settings.hosts);
    if (!cues.some((c) => c.type === 'intro')) cues.unshift({ id: cueId(), on: true, type: 'intro', sound: 'intro', line: 0, position: 'before', source: 'rule', reason: 'Every episode opens on intro music' });
    if (!cues.some((c) => c.type === 'outro')) cues.push({ id: cueId(), on: true, type: 'outro', sound: 'outro', line: Math.max(0, doc.lines.length - 1), position: 'after', source: 'rule', reason: 'Outro plays out the episode' });
    cues = withEnrich ? ruleCues(doc.lines, hosts, cues) : withMoodBeds(doc.lines, hosts, withCaution(doc.lines, withAccents(doc.lines, hosts, cues)));
  }
  // cues the user switched off stay off
  const off = new Set(doc.cues.filter((c) => !c.on).map((c) => `${c.type}|${c.sound}|${c.line}`));
  for (const c of cues) if (off.has(`${c.type}|${c.sound}|${c.line}`)) c.on = false;
  const r = placeCues(doc, cues, { assets: inp.assets, categories: inp.categories });
  doc.cues = cues;
  return {
    lines: doc.lines.length,
    exactLines: doc.lines.filter((l) => l.exact).length,
    cues: cues.filter((c) => c.on).length,
    placed: r.placed,
    notes: [...notes, ...r.notes],
    product: doc.product,
  };
}

/**
 * Builds the whole edit with the rules engine. Mutates `doc` (pass a copy).
 * Order: parse script → keep subtitle timings → line up the rest with the speech → script tags →
 * storytelling rules → place clips → one music at a time → fill gaps → disclaimers.
 */
export function autoEdit(doc: ProjectDoc, inp: AutoEditInput): AutoEditReport {
  const p = prepareLines(doc, inp);
  return finishEdit(doc, inp, p.tagCues, p.notes, true, p.audioOnly);
}
