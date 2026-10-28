import { describe, expect, it } from 'vitest';
import {
  applyTimings, autoEdit, emptyDoc, INTRO_FULL, parseScript, parseSubs, trackFor,
  type Asset, type Category, type ProjectDoc,
} from '../src/shared/rules/index';

const cats: Category[] = [
  { id: 'k_disclaimer', name: 'AI Disclaimer', role: 'disclaimer' },
  { id: 'k_pdisc', name: 'Product Disclaimers', role: 'pdisclaimer' },
  { id: 'k_intro', name: 'Intro', role: 'intro' },
  { id: 'k_outro', name: 'Outro', role: 'outro' },
  { id: 'k_story', name: 'Storytelling', role: 'bed' },
  { id: 'k_curious', name: 'Curiosity', role: 'bed' },
  { id: 'k_guest', name: 'Guest', role: 'bed' },
  { id: 'k_char', name: 'Character Intros', role: 'sfx' },
  { id: 'k_engage', name: 'Engagement', role: 'sfx' },
  { id: 'k_trans', name: 'Transitions', role: 'transition' },
];
const A = (hash: string, name: string, categoryId: string, dur: number, extra: Partial<Asset> = {}): Asset => ({
  hash, name, categoryId, role: cats.find((c) => c.id === categoryId)!.role, tags: name.toLowerCase().split(' '), dur, size: 1, mime: 'audio/mpeg', ...extra,
});
const assets: Asset[] = [
  A('disc', 'AI-Generated Podcast Notice', 'k_disclaimer', 8),
  A('pdisc', 'Home loan disclaimer', 'k_pdisc', 20, { product: 'Home Loan' }),
  A('intro', '1BFL Intro Track', 'k_intro', 21),
  A('outro', 'Warm Close', 'k_outro', 30),
  A('play', 'story play', 'k_story', 90),
  A('rewrite', 'story rewrite', 'k_story', 120),
  A('unfold', 'Unfolding Insights', 'k_curious', 60),
  A('guestbed', 'Guest Warm Acoustic', 'k_guest', 60),
  A('keys', 'Character Intro – Warm Keys', 'k_char', 4),
  A('coin', 'Coin Chime', 'k_engage', 1.1, { tags: ['coin', 'money', 'savings'] }),
  A('ding', 'Takeaway Bell', 'k_engage', 1.5, { tags: ['ding', 'takeaway'] }),
  A('pop', 'Marimba Pop', 'k_engage', 0.5, { tags: ['pop'] }),
  A('harp', 'Harp Glide', 'k_trans', 2),
];

const SCRIPT = `SHWETA: Hello and welcome to the show! Today we talk about buying your first home.
KARAN: It is a big step for every family.
SHWETA: Aaj humare saath hain Rahul. Welcome Rahul!
RAHUL: Thank you. I want to buy a flat but how do I start?
KARAN: The first step is to check your eligibility and documents.
SHWETA: A Bajaj Finserv home loan comes with competitive interest rates, so your EMI stays comfortable.
RAHUL: What about the tenure?
KARAN: You can choose up to 30 years, which keeps the EMI low.
RAHUL: Understood, I will calculate my EMI today.
SHWETA: Visit the Bajaj Finserv website and use the EMI calculator.
KARAN: Thanks for listening!`;

/** dialogue starting at 0 with one 5-second line after another */
function makeDoc(): ProjectDoc {
  const doc = emptyDoc();
  doc.scriptText = SCRIPT;
  doc.dialogueHash = 'dlg';
  const t = trackFor(doc, 'dialogue');
  doc.clips.push({ id: 'c_dlg', trackId: t.id, assetHash: 'dlg', start: 0, offset: 0, dur: 60, gain: 0, fadeIn: 0, fadeOut: 0, loop: false });
  return doc;
}
const srt = parseScript(SCRIPT).lines.map((l, i) => `${i + 1}\n00:00:${String(i * 5).padStart(2, '0')},000 --> 00:00:${String(i * 5 + 4).padStart(2, '0')},500\n${l.text}\n`).join('\n');
const speech: [number, number][] = parseScript(SCRIPT).lines.map((_, i) => [i * 5, i * 5 + 4.5]);
const lib = { assets: [...assets, A('dlg', 'dialogue', 'k_engage', 60, { role: 'dialogue' as const })], categories: cats, speech, dialogueDur: 60, products: ['Home Loan', 'Personal Loan'] };

function run() {
  const doc = makeDoc();
  // subtitles give exact timings
  doc.lines = parseScript(SCRIPT).lines;
  const matched = applyTimings(doc.lines, parseSubs(srt));
  const rep = autoEdit(doc, lib);
  const kind = (id: string) => doc.tracks.find((t) => t.id === id)?.kind;
  return { doc, rep, matched, kind, name: (h: string) => assets.find((a) => a.hash === h)?.name || h };
}

describe('auto-edit (Bajaj storytelling rules)', () => {
  it('matches every subtitle line exactly', () => {
    const { matched, rep } = run();
    expect(matched).toBe(11);
    expect(rep.exactLines).toBe(11);
  });

  it('opens with the AI disclaimer, then 2.5 s of intro at full volume; voices start at 2.5 s', () => {
    const { doc } = run();
    const disc = doc.clips.find((c) => c.fixed === 'start')!;
    const intro = doc.clips.find((c) => c.assetHash === 'intro' && c.start < 20)!;
    const dlg = doc.clips.find((c) => c.assetHash === 'dlg')!;
    expect(disc.start).toBe(0);
    expect(intro.start).toBeCloseTo(8.2, 2);
    expect(intro.gain).toBe(0);
    expect(intro.dur).toBeCloseTo(4, 2);
    expect(intro.fadeOut).toBeCloseTo(1.5, 2);
    expect(dlg.start).toBeCloseTo(8.2 + INTRO_FULL, 2);
  });

  it('puts a coin chime on the competitive interest rate line, right after the phrase', () => {
    const { doc } = run();
    const coin = doc.clips.filter((c) => c.assetHash === 'coin');
    expect(coin.length).toBeGreaterThanOrEqual(1);
    const lineStart = 10.7 + 5 * 5; // dialogue offset + line 5
    expect(coin[0].start).toBeGreaterThan(lineStart);
    expect(coin[0].start).toBeLessThan(lineStart + 4.5);
  });

  it('plays Character Intro – Warm Keys when the guest is welcomed', () => {
    const { doc } = run();
    expect(doc.clips.some((c) => c.assetHash === 'keys')).toBe(true);
  });

  it('uses story play when the Bajaj home loan is introduced and Unfolding Insights under questions', () => {
    const { doc } = run();
    const at = (t: number) => doc.clips.filter((c) => c.start <= t && c.start + c.dur > t && ['bed', 'positioning', 'intro'].includes(doc.tracks.find((x) => x.id === c.trackId)!.kind));
    expect(at(10.7 + 5 * 5 + 2).map((c) => c.assetHash)).toContain('play');
    expect(at(10.7 + 6 * 5 + 2).map((c) => c.assetHash)).toContain('unfold');
  });

  it('plays the intro music again lightly under the CTA, before the outro', () => {
    const { doc } = run();
    const cta = doc.clips.filter((c) => c.assetHash === 'intro' && c.start > 20);
    expect(cta.length).toBe(1);
    expect(cta[0].gain).toBe(-10);
    const outro = doc.clips.find((c) => c.assetHash === 'outro')!;
    expect(cta[0].start + cta[0].dur).toBeLessThanOrEqual(outro.start + 0.01);
  });

  it('never plays two background music clips at the same time', () => {
    const { doc, kind } = run();
    const m = doc.clips.filter((c) => !c.fixed && ['intro', 'bed', 'positioning'].includes(kind(c.trackId)!)).sort((a, b) => a.start - b.start);
    for (let i = 1; i < m.length; i++) expect(m[i].start).toBeGreaterThanOrEqual(m[i - 1].start + m[i - 1].dur - 0.06);
  });

  it('background music sits at -10 dB', () => {
    const { doc, kind } = run();
    for (const c of doc.clips.filter((c) => kind(c.trackId) === 'bed')) expect(c.gain).toBe(-10);
  });

  it('a harp glide plays when the guest acknowledges', () => {
    const { doc } = run();
    expect(doc.clips.some((c) => c.assetHash === 'harp')).toBe(true);
  });

  it('closes with the product disclaimer and then the AI disclaimer', () => {
    const { doc, rep } = run();
    expect(rep.product).toBe('Home Loan');
    const p = doc.clips.find((c) => c.fixed === 'product')!, e = doc.clips.find((c) => c.fixed === 'end')!;
    const last = Math.max(...doc.clips.filter((c) => !c.fixed).map((c) => c.start + c.dur));
    expect(p.start).toBeGreaterThanOrEqual(last);
    expect(e.start).toBeGreaterThan(p.start);
  });

  it('keeps manually placed clips through a re-run', () => {
    const { doc } = run();
    const sfx = trackFor(doc, 'sfx');
    doc.clips.push({ id: 'manual', trackId: sfx.id, assetHash: 'pop', start: 33, offset: 0, dur: 0.5, gain: 0, fadeIn: 0, fadeOut: 0, loop: false });
    autoEdit(doc, lib);
    expect(doc.clips.some((c) => c.id === 'manual' && c.start === 33)).toBe(true);
  });

  it('audio only: places intro, outro and disclaimers without crashing', () => {
    const doc = makeDoc();
    doc.scriptText = '';
    const rep = autoEdit(doc, lib);
    expect(doc.clips.some((c) => c.assetHash === 'intro')).toBe(true);
    expect(doc.clips.some((c) => c.assetHash === 'outro')).toBe(true);
    expect(rep.notes.join(' ')).toMatch(/No script/);
  });
});
