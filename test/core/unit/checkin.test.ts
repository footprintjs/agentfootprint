/**
 * Unit tests — the pure check-in module (`src/core/checkin.ts`).
 *
 * Types + helpers in isolation, no Agent: decision helpers, the decision
 * guard, the `shouldCheckIn` trip logic (incl. fail-toward-asking on a
 * throwing predicate), config resolution, the deterministic lexical scorer,
 * and both built-in evidence assemblers over a synthetic history.
 */

import { describe, it, expect } from 'vitest';
import {
  checkInApproved,
  checkInDeclined,
  isCheckInDecision,
  shouldCheckIn,
  resolveCheckInConfig,
  lexicalDriverScorer,
  standardEvidenceAssembler,
  minimalEvidenceAssembler,
  unitsFromHistory,
  type CheckInAssembler,
  type CheckInScorer,
} from '../../../src/core/checkin.js';
import type { LLMMessage } from '../../../src/adapters/types.js';

const HISTORY: readonly LLMMessage[] = [
  { role: 'system', content: 'Refund only verified orders. Confirm the amount.' },
  { role: 'user', content: 'refund order 42 for 500' },
  { role: 'tool', content: 'order total: 500', toolCallId: 't0', toolName: 'lookup' },
];

describe('check-in helpers — decisions', () => {
  it('checkInApproved / checkInDeclined build clone+JSON-safe records', () => {
    const a = checkInApproved({ by: 'alice', note: 'ok' });
    expect(a).toMatchObject({ approved: true, by: 'alice', note: 'ok' });
    expect(typeof a.at).toBe('number');
    const d = checkInDeclined({ by: 'bob' });
    expect(d).toMatchObject({ approved: false, by: 'bob' });
    expect('note' in d).toBe(false); // omitted, not undefined
    // structuredClone + JSON safe
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(() => structuredClone(d)).not.toThrow();
  });

  it('isCheckInDecision narrows a real decision and rejects other shapes', () => {
    expect(isCheckInDecision(checkInApproved({ by: 'x' }))).toBe(true);
    expect(isCheckInDecision('yes')).toBe(false);
    expect(isCheckInDecision(null)).toBe(false);
    expect(isCheckInDecision({ approved: true })).toBe(false); // missing `by`
    expect(isCheckInDecision({ by: 'x' })).toBe(false); // missing `approved`
  });
});

describe('check-in helpers — shouldCheckIn', () => {
  const ctx = { iteration: 1, toolCallId: 't', history: HISTORY };

  it('undefined demand → never trips (backward-compat)', () => {
    expect(shouldCheckIn(undefined, {}, ctx)).toBe(false);
  });
  it("'always' → always trips", () => {
    expect(shouldCheckIn('always', {}, ctx)).toBe(true);
  });
  it('predicate honored both ways', () => {
    expect(shouldCheckIn((a) => (a.amount as number) > 1000, { amount: 5000 }, ctx)).toBe(true);
    expect(shouldCheckIn((a) => (a.amount as number) > 1000, { amount: 5 }, ctx)).toBe(false);
  });
  it('a throwing predicate fails TOWARD asking the human', () => {
    expect(
      shouldCheckIn(() => {
        throw new Error('buggy predicate');
      }, {}, ctx),
    ).toBe(true);
  });
});

describe('check-in helpers — resolveCheckInConfig', () => {
  it('default → standard assembler + lexical scorer', () => {
    const c = resolveCheckInConfig();
    expect(c.assembler).toBe(standardEvidenceAssembler);
    expect(c.scorer).toBe(lexicalDriverScorer);
  });
  it("'minimal' preset selects the minimal assembler", () => {
    expect(resolveCheckInConfig({ evidence: 'minimal' }).assembler).toBe(minimalEvidenceAssembler);
  });
  it('a custom assembler + scorer pass through', () => {
    const assembler: CheckInAssembler = () => ({ willDo: 'x' });
    const scorer: CheckInScorer = () => [];
    const c = resolveCheckInConfig({ evidence: assembler, scorer });
    expect(c.assembler).toBe(assembler);
    expect(c.scorer).toBe(scorer);
  });
});

describe('check-in helpers — lexicalDriverScorer', () => {
  it('is deterministic and ranks overlapping units first', () => {
    const input = {
      tool: { name: 'issue_refund', text: 'issue refund amount 500' },
      units: [
        { id: 'far', channel: 'system', text: 'the sky is blue today' },
        { id: 'near', channel: 'task', text: 'please issue a refund of 500' },
      ],
    };
    const a = lexicalDriverScorer(input);
    const b = lexicalDriverScorer(input);
    expect(a).toEqual(b);
    expect(a[0].id).toBe('near');
    expect(a[0].score).toBeGreaterThan(a[1].score);
  });
});

describe('check-in helpers — assemblers', () => {
  it('unitsFromHistory tags system / task / result channels', () => {
    const units = unitsFromHistory(HISTORY);
    const channels = new Set(units.map((u) => u.channel));
    expect(channels).toEqual(new Set(['system', 'task', 'result']));
    // system prompt split into rule-sized units (two sentences → two units)
    expect(units.filter((u) => u.channel === 'system').length).toBeGreaterThanOrEqual(2);
  });

  it('standard assembler fills all four fields; drivers are ranked', async () => {
    const ev = await standardEvidenceAssembler({
      tool: { name: 'issue_refund', description: 'Issue a refund' },
      args: { amount: 500 },
      iteration: 1,
      history: HISTORY,
      scorer: lexicalDriverScorer,
    });
    expect(ev.willDo).toContain('Issue a refund');
    expect(ev.willDo).toContain('amount=500');
    expect((ev.read ?? []).length).toBeGreaterThan(0);
    expect((ev.drivers ?? []).length).toBeGreaterThan(0);
    const scores = (ev.drivers ?? []).map((d) => d.score);
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    expect(ev.trail?.toolCalls.some((t) => t.name === 'lookup')).toBe(true);
  });

  it('minimal assembler fills ONLY willDo', async () => {
    const ev = await minimalEvidenceAssembler({
      tool: { name: 'issue_refund', description: 'Issue a refund' },
      args: { amount: 500 },
      iteration: 1,
      history: HISTORY,
      scorer: lexicalDriverScorer,
    });
    expect(ev.willDo).toContain('Issue a refund');
    expect(ev.read).toBeUndefined();
    expect(ev.drivers).toBeUndefined();
    expect(ev.trail).toBeUndefined();
  });
});
