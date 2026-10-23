import { describe, expect, it } from 'vitest';
import type { NegativeClaimsOptions, NegativeClaimPhraseExtensions } from '../../src/index';
import type { AgentfootprintEventMap, Payloads } from '../../src/events';

describe('negative claims public configuration and event types', () => {
  it('accepts readonly literal phrases in either arm, with mutually exclusive configuration', () => {
    const phrases: NegativeClaimPhraseExtensions = { none: ['lacks incidents'] as const };
    const prose: NegativeClaimsOptions = { prose: true, phrases };
    const typed: NegativeClaimsOptions = {
      field: 'negatives',
      tools: ['lookup'] as const,
      phrases,
    };
    // @ts-expect-error The observing arm cannot request typed enforcement.
    const mixed: NegativeClaimsOptions = { prose: true, field: 'negatives', tools: ['lookup'] };
    // @ts-expect-error Prose has no withholding option.
    const withholding: NegativeClaimsOptions = { prose: true, unestablished: 'withhold' };
    // @ts-expect-error Enforcement of free text remains unavailable.
    const strict: NegativeClaimsOptions = { prose: true, strictProse: true };
    // @ts-expect-error Custom phrases are literal strings, not executable regular expressions.
    const executable: NegativeClaimPhraseExtensions = { none: [/none/] };
    expect([prose, typed, mixed, withholding, strict, executable]).toHaveLength(6);
  });

  it('exposes the same warning payload through the event map and payload namespace', () => {
    const payload: Payloads.FindingsNegativeClaimPayload = {
      kind: 'negative-claim-note',
      iteration: 1,
      turn: 1,
      field: '/',
      span: { start: 0, end: 10 },
      packVersion: '1',
      code: 'input-limit',
    };
    const mapped: AgentfootprintEventMap['agentfootprint.findings.negative_claim']['payload'] =
      payload;
    expect(mapped.kind).toBe('negative-claim-note');
  });
});
