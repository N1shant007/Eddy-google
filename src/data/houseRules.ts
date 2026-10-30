/* House rules every guideline set carries, added where missing (presets, saved sets and new sets). */
export const CTA_RULE =
  'CTA: When the call to action begins (before the outro), play the same intro music again, lightly and low under the voices, for the whole CTA. No other background music plays during it; the outro follows.';

export const BENEFITS_RULE =
  'BENEFITS (MANDATORY): Play Coin Chime (Engagement) just after every line that mentions low interest rates (low, lower, competitive, attractive or "very good" rates, "kam byaj", "starting at X%"). Also play it just after lines stating a clear money benefit for the listener: no hidden charges, no prepayment charges, a low EMI, no pressure on the budget, no financial strain, or savings. Low-interest-rate chimes always play. Benefit chimes need at least 12 s between any two Coin Chimes. Place each one in the gap after the line, never on a key word. Gain -6 dB.';

export const SFX_RULE =
  "SFX: Coin Chime is the only sound effect allowed. Don't use Marimba Pop, Takeaway Bell, Character Intros, Drumrolls, Reactions or any other SFX.";

/** guideline lines that ask for sound effects other than Coin Chime (they conflict with SFX_RULE) */
const OTHER_SFX = /^(NUMBERS|GUEST INTRODUCTION|GUEST INTRO|ACKNOWLEDGEMENT|TRANSITIONS|ENGAGEMENT SFX|EMOTION|KEY TAKEAWAY)\b[^:\n]*:/;
const VOICE_TAGS = /^TTS voice tags/i;

/** Coin Chime as the only sound effect: the BENEFITS and SFX rules in, conflicting SFX lines out (once per set) */
function withSfxRules(t: string): string {
  if (t.split('\n').some((l) => l.trim() === SFX_RULE)) return t;
  let lines = t.split('\n').filter((l) => !OTHER_SFX.test(l.trim()) && !VOICE_TAGS.test(l.trim()));
  const b = lines.findIndex((l) => /^BENEFITS\b[^:]*:/.test(l.trim()));
  if (b >= 0) lines[b] = BENEFITS_RULE;
  else {
    const at = lines.findIndex((l) => /^(CTA|OUTRO|MIX):/.test(l.trim()));
    if (at >= 0) lines.splice(at, 0, BENEFITS_RULE); else lines.push(BENEFITS_RULE);
  }
  const bi = lines.indexOf(BENEFITS_RULE);
  lines.splice(bi + 1, 0, SFX_RULE);
  lines = lines.filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
  return lines.join('\n').replace(/^\n+/, '');
}

/** the text with the house rules: Coin Chime only (BENEFITS + SFX), and the CTA rule before OUTRO, else before MIX, else at the end */
export function withHouseRules(text: string): string {
  const t = withSfxRules(text || '');
  if (/^CTA:/m.test(t)) return t;
  if (/^OUTRO:/m.test(t)) return t.replace(/^OUTRO:/m, `${CTA_RULE}\nOUTRO:`);
  if (/^MIX:/m.test(t)) return t.replace(/^MIX:/m, `${CTA_RULE}\nMIX:`);
  return (t.trimEnd() ? t.trimEnd() + '\n' : '') + CTA_RULE;
}
