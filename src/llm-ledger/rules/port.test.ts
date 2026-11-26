/**
 * rules/port — registration, running a rule, and the verdict law (case table §8, §9).
 *
 * Unit: every registration refusal, the two record forms (`decisionRecord` of the table's evidence,
 * `fixedRecord(outcome, label, 'app')`), throwing, hanging and lying rules, `verdictOf` and
 * `weakest`. The built-ins' oracles live in `test/llm-ledger/rules-oracle.test.ts`.
 */
import { decideFromFacts, decisionRecord, fixedRecord } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import type { LedgerReceipt } from '../types.js';
import { cited } from './cited.js';
import { LedgerRuleError, registerRules, runRule, verdictOf, weakest } from './port.js';
import type { LedgerRule, LedgerRuleInput, LedgerTableRule } from './port.js';
import { timeWindow } from './timeWindow.js';
import { traceableValues } from './traceableValues.js';

const AT = '2026-11-26T10:00:00Z';
const BUILT = [cited, traceableValues, timeWindow];
const receipt = (seq: number, tokens: string[], how: 'observed' | 'reported' = 'observed') =>
  ({
    v: 1,
    seq,
    kind: 'receipt',
    by: 'host',
    how,
    at: AT,
    source: 's',
    bytes: 1,
    nothingFound: false,
    tokens,
  } as LedgerReceipt);
const noteInput = (text: string, cites: number[], receipts: LedgerReceipt[]): LedgerRuleInput => ({
  subject: {
    kind: 'claim',
    note: {
      v: 1,
      seq: 9,
      kind: 'note',
      by: 'agent',
      how: 'observed',
      at: AT,
      noteKind: 'claim',
      text,
      cites,
    },
  },
  receipts,
  supplied: [],
});
const host = (over: Partial<LedgerTableRule> = {}): LedgerRule => ({
  id: 'acme/rule',
  version: 1,
  appliesTo: ['claim'],
  facts: () => ({ facts: { n: 1 }, restsOn: [] }),
  table: [{ when: { n: { eq: 0 } }, then: 'checked-fail' }],
  default: { branch: 'checked-pass' },
  ...over,
});

describe('registration (§9.2)', () => {
  it('the built-ins and a namespaced host rule register by id@version', () => {
    const rules = registerRules(BUILT, [host()]);
    expect([...rules.keys()]).toEqual([
      'cited@1',
      'traceable-values@1',
      'time-window@1',
      'acme/rule@1',
    ]);
  });

  it.each([
    ['a host id without its namespace', [host({ id: 'rule' })], 'bad-id'],
    ['a bad id', [host({ id: 'Acme/Rule' })], 'bad-id'],
    ['a bad version', [host({ version: 0 })], 'bad-version'],
    ['a duplicate', [host(), host()], 'duplicate'],
    ['an empty appliesTo', [host({ appliesTo: [] })], 'bad-applies-to'],
    [
      'a branch that is no disposition',
      [host({ table: [{ when: { n: { eq: 0 } }, then: 'maybe' }] })],
      'bad-branch',
    ],
    [
      'a default that is no disposition',
      [host({ default: { branch: 'fine' as never } })],
      'bad-branch',
    ],
    [
      'a function rule',
      [host({ table: [{ when: () => true, then: 'checked-pass' }] })],
      'function-rule',
    ],
    [
      'more than 16 rules',
      Array.from({ length: 14 }, (_, i) => host({ id: `acme/r${i}` })),
      'too-many-rules',
    ],
    [
      'more than 32 fact names',
      [
        host({
          table: [
            {
              when: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, { eq: 0 }])),
              then: 'checked-pass',
            },
          ],
        }),
      ],
      'too-many-facts',
    ],
    ['not a rule', [null as unknown as LedgerRule], 'bad-rule'],
  ])('refuses %s', (_name, rules, problem) => {
    expect(() => registerRules(BUILT, rules)).toThrow(LedgerRuleError);
    try {
      registerRules(BUILT, rules);
    } catch (e) {
      expect((e as LedgerRuleError).problem).toBe(problem);
    }
  });
});

describe('running a rule (§9.3, §9.4)', () => {
  it('a table rule stores decisionRecord(evidence), recomputed equal', async () => {
    const input = noteInput('esx01a 41200', [2], [receipt(2, ['esx01a', '41200'])]);
    const finding = await runRule(traceableValues, input);
    const facts = (traceableValues.facts(input) as { facts: Record<string, unknown> }).facts;
    expect(finding.decision).toEqual(
      decisionRecord(
        decideFromFacts(traceableValues.table, facts, traceableValues.default).evidence,
      ),
    );
    expect(finding).toMatchObject({
      disposition: 'checked-pass',
      verdict: 'verified',
      restsOn: [2],
    });
    expect(finding.decision).toMatchObject({ strategy: 'checked-pass', by: 'default' });
  });

  it('a token rests on the first OBSERVED receipt that holds it, else the first reported one', async () => {
    const observedFirst = [receipt(2, ['id-1234']), receipt(3, ['id-1234'], 'reported')];
    const reportedFirst = [receipt(2, ['id-1234'], 'reported'), receipt(3, ['id-1234'])];
    const onlyReported = [receipt(2, ['id-1234'], 'reported'), receipt(3, ['id-1234'], 'reported')];
    expect(
      await runRule(traceableValues, noteInput('id-1234', [2, 3], observedFirst)),
    ).toMatchObject({ restsOn: [2], verdict: 'verified' });
    expect(
      await runRule(traceableValues, noteInput('id-1234', [2, 3], reportedFirst)),
    ).toMatchObject({ restsOn: [3], verdict: 'verified' });
    expect(
      await runRule(traceableValues, noteInput('id-1234', [2, 3], onlyReported)),
    ).toMatchObject({ restsOn: [2], verdict: 'consistent-with-reported' });
  });

  it('a code rule stores fixedRecord(outcome, label, app)', async () => {
    const rule: LedgerRule = {
      id: 'acme/code',
      version: 2,
      appliesTo: ['claim'],
      decide: () => ({ outcome: 'checked-fail', label: 'no', restsOn: [2] }),
    };
    const finding = await runRule(rule, noteInput('x', [2], [receipt(2, [])]));
    expect(finding).toMatchObject({
      rule: 'acme/code@2',
      disposition: 'checked-fail',
      verdict: 'unsupported',
    });
    expect(finding.decision).toEqual(fixedRecord('checked-fail', 'no', 'app'));
  });

  it.each([
    [
      'throws',
      {
        decide: () => {
          throw new Error('value 4242');
        },
      },
      'rule-threw',
    ],
    [
      'rejects',
      {
        decide: async () => {
          throw new Error('value 4242');
        },
      },
      'rule-threw',
    ],
    ['hangs past 1,000 ms', { decide: () => new Promise(() => undefined) }, 'rule-timeout'],
    [
      'answers an unknown branch',
      { decide: () => ({ outcome: 'great', restsOn: [] }) },
      'bad-result',
    ],
    [
      'rests on a receipt outside its input',
      { decide: () => ({ outcome: 'checked-pass', restsOn: [77] }) },
      'bad-result',
    ],
  ])(
    'a rule that %s: unreachable, open, no decision, no message',
    async (_name, over, why) => {
      const rule = { id: 'acme/r', version: 1, appliesTo: ['claim'], ...over } as LedgerRule;
      const finding = await runRule(rule, noteInput('x', [2], [receipt(2, [])]));
      expect(finding).toEqual({
        rule: 'acme/r@1',
        disposition: 'unreachable',
        verdict: 'open',
        restsOn: [],
        counts: { visible: 0, missing: 0, supplied: 0, incomplete: 0 },
        why,
      });
    },
    5_000,
  );

  it('a table rule whose facts the engine refuses (an accessor) is bad-result', async () => {
    const rule = host({
      facts: () => ({
        facts: Object.defineProperty({}, 'n', { get: () => 1, enumerable: true }),
        restsOn: [],
      }),
    });
    expect((await runRule(rule, noteInput('x', [], []))).why).toBe('bad-result');
  });
});

describe('the verdict law (§8)', () => {
  const how = (seq: number) => (seq === 2 ? 'observed' : 'reported') as 'observed' | 'reported';
  it('verified only when it rests on receipts and all are observed', () => {
    expect(verdictOf('checked-pass', [2], how)).toBe('verified');
    expect(verdictOf('checked-pass', [2, 3], how)).toBe('consistent-with-reported');
    expect(verdictOf('checked-pass', [], how)).toBe('consistent-with-reported');
    expect(verdictOf('checked-fail', [2], how)).toBe('unsupported');
    expect(verdictOf('unreachable', [2], how)).toBe('open');
    expect(verdictOf('not-applicable', [2], how)).toBeUndefined();
  });
  it('the weakest wins', () => {
    expect(weakest(['verified', 'open', 'consistent-with-reported'])).toBe('open');
    expect(weakest(['verified', 'unsupported', 'open'])).toBe('unsupported');
    expect(weakest([undefined, 'verified'])).toBe('verified');
    expect(weakest([undefined])).toBeUndefined();
  });
});
