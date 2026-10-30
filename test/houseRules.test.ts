import { describe, expect, it } from 'vitest';
import { CTA_RULE, PRODUCT_DISCLAIMERS_RULE, SFX_RULE, withHouseRules } from '../src/data/houseRules';

describe('house rules in every guideline set', () => {
  it('adds the product disclaimers, Coin Chime only and CTA rules, and removes conflicting SFX lines', () => {
    const old = 'FIXED: AI disclaimer opens and closes.\nENDING DISCLAIMER (MANDATORY): old line.\nNUMBERS: Marimba Pop.\nBENEFITS (MANDATORY): old.\nTRANSITIONS: Harp Glide.\nOUTRO: Warm Close.';
    const t = withHouseRules(old).split('\n');
    expect(t[0]).toMatch(/^FIXED/);
    expect(t[1]).toBe(PRODUCT_DISCLAIMERS_RULE);
    expect(PRODUCT_DISCLAIMERS_RULE).toContain('Home Loan: "2new hl DIS"');
    expect(t).toContain(SFX_RULE);
    expect(t).toContain(CTA_RULE);
    expect(t.some((l) => /^(ENDING DISCLAIMER|NUMBERS|TRANSITIONS)/.test(l))).toBe(false);
  });
  it('runs once: a set that already has the rules is left as it is', () => {
    const once = withHouseRules('FIXED: x\nOUTRO: y');
    expect(withHouseRules(once)).toBe(once);
    const edited = once.replace('Home Loan: "2new hl DIS"', 'Home Loan: "2new hl DIS"; Personal Loan: "pl dis"');
    expect(withHouseRules(edited)).toBe(edited); // the team's own additions stay
  });
});
