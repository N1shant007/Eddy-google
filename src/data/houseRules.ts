/* House rules every guideline set carries, added where missing (presets, saved sets and new sets). */
export const CTA_RULE =
  'CTA: When the call to action begins (before the outro), play the same intro music again, lightly and low under the voices, for the whole CTA. No other background music plays during it; the outro follows.';

/** the text with the CTA rule: before OUTRO, else before MIX, else at the end */
export function withHouseRules(text: string): string {
  const t = text || '';
  if (/^CTA:/m.test(t)) return t;
  if (/^OUTRO:/m.test(t)) return t.replace(/^OUTRO:/m, `${CTA_RULE}\nOUTRO:`);
  if (/^MIX:/m.test(t)) return t.replace(/^MIX:/m, `${CTA_RULE}\nMIX:`);
  return (t.trimEnd() ? t.trimEnd() + '\n' : '') + CTA_RULE;
}
