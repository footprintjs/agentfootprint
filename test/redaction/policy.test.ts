/**
 * The policy as data — `src/redaction/policy.ts`.
 *
 * `assertRedactionPolicy` is what `Agent.create({ redact })`, `run(…, { redact })`
 * and `conversationRedaction(extra)` run first: a policy that is not one would
 * be silently ignored by footprintjs (an unknown field), or read like it keeps
 * something out while it keeps nothing (an empty policy). Each refusal names
 * the site and the field. `unionRedactionPolicies` is how a run covered by
 * several declarations (an agent's own, a composition's members', a policy
 * handed down by a tool call) gets ONE policy: every name any of them selects.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { RedactionPolicy } from 'footprintjs';

import {
  assertRedactionPolicy,
  CarriedPolicyError,
  carriedRedactionPolicy,
  policyFromCarried,
  policyOfMarks,
  unionRedactionPolicies,
} from '../../src/redaction/policy.js';
import { conversationRedaction, keepsConversationOut } from '../../src/redaction/conversation.js';

const refused =
  (policy: unknown): (() => void) =>
  () =>
    assertRedactionPolicy(policy, 'Site');

describe('assertRedactionPolicy — what is refused, and why', () => {
  it('a value that is not a policy object', () => {
    for (const value of [null, 'history', 42, [/ssn/]]) {
      expect(refused(value)).toThrow(/Site: .*must be a footprintjs RedactionPolicy object/);
    }
  });

  it('an unknown field — footprintjs would ignore it', () => {
    expect(refused({ key: ['history'] })).toThrow(/`redact.key` is not a RedactionPolicy field/);
    expect(refused({ diagnostics: { emitPatterns: [/x/] } })).toThrow(
      /`redact.diagnostics.emitPatterns` is not a RedactionPolicy field/,
    );
  });

  it('keys that are not a list of non-empty strings', () => {
    expect(refused({ keys: 'history' })).toThrow(
      /`redact.keys` must be a list of non-empty strings/,
    );
    expect(refused({ keys: [''] })).toThrow(/non-empty strings/);
    expect(refused({ keys: [1] })).toThrow(/non-empty strings/);
  });

  it('patterns and emit patterns that are not RegExps', () => {
    expect(refused({ patterns: ['ssn'] })).toThrow(/`redact.patterns` must be a list of RegExp/);
    expect(refused({ emitPatterns: /x/ })).toThrow(
      /`redact.emitPatterns` must be a list of RegExp/,
    );
  });

  it('a FROZEN global or sticky RegExp — footprintjs could not reset it', () => {
    expect(refused({ patterns: [Object.freeze(/ssn/g)] })).toThrow(/frozen global RegExp/);
    expect(refused({ emitPatterns: [Object.freeze(/x/y)] })).toThrow(/frozen sticky RegExp/);
    // A mutable one is fine: footprintjs resets `lastIndex` before each test.
    expect(() => assertRedactionPolicy({ patterns: [/ssn/g] }, 'Site')).not.toThrow();
  });

  it('fields that are not an object of key → dot-paths', () => {
    expect(refused({ fields: ['email'] })).toThrow(/`redact.fields` must be an object/);
    expect(refused({ fields: { customer: 'email' } })).toThrow(
      /`redact.fields.customer` must be a list of non-empty dot-paths/,
    );
  });

  it('diagnostics that are not a selector object', () => {
    expect(refused({ diagnostics: [] })).toThrow(/`redact.diagnostics` must be an object/);
    expect(refused({ diagnostics: { keys: 'token' } })).toThrow(
      /`redact.diagnostics.keys` must be a list/,
    );
  });

  it('a policy that names nothing — it would read like it keeps something out', () => {
    for (const empty of [{}, { keys: [] }, { fields: { customer: [] } }, { diagnostics: {} }]) {
      expect(refused(empty)).toThrow(/`redact` names nothing/);
    }
  });

  it('every selector is enough on its own', () => {
    const accepted: RedactionPolicy[] = [
      { keys: ['history'] },
      { patterns: [/ssn/i] },
      { fields: { customer: ['email'] } },
      { emitPatterns: [/agentfootprint\.stream\.token/] },
      { diagnostics: { keys: ['token'] } },
    ];
    for (const policy of accepted)
      expect(() => assertRedactionPolicy(policy, 'Site')).not.toThrow();
  });
});

describe('unionRedactionPolicies — one policy for a run several declarations cover', () => {
  it('none → undefined; one → that very object', () => {
    const one: RedactionPolicy = { keys: ['history'] };
    expect(unionRedactionPolicies()).toBeUndefined();
    expect(unionRedactionPolicies(undefined, undefined)).toBeUndefined();
    expect(unionRedactionPolicies(one)).toBe(one);
    expect(unionRedactionPolicies(one, undefined, one)).toBe(one);
  });

  it('several → every name any of them selects, deduplicated and frozen', () => {
    const ssn = /ssn/i;
    const union = unionRedactionPolicies(
      { keys: ['history', 'args'], patterns: [ssn], fields: { customer: ['email'] } },
      {
        keys: ['args', 'result'],
        patterns: [ssn],
        fields: { customer: ['phone', 'email'], order: ['card'] },
        emitPatterns: [/token/],
        diagnostics: { keys: ['apiKey'] },
      },
    )!;
    expect(Object.isFrozen(union)).toBe(true);
    expect(union.keys).toEqual(['history', 'args', 'result']);
    expect(union.patterns).toEqual([ssn]);
    expect(union.fields).toEqual({ customer: ['email', 'phone'], order: ['card'] });
    expect(union.emitPatterns).toHaveLength(1);
    expect(union.diagnostics).toEqual({ keys: ['apiKey'] });
  });

  it('the union only adds — no declaration can take a name away', () => {
    const union = unionRedactionPolicies({ keys: ['history'] }, { keys: ['ssn'] })!;
    expect(union.keys).toEqual(expect.arrayContaining(['history', 'ssn']));
  });
});

describe('a policy carried through a pause — `carriedRedactionPolicy` / `policyFromCarried`', () => {
  const policy: RedactionPolicy = {
    keys: ['history'],
    patterns: [/ssn|email/i],
    fields: { customer: ['ssn'] },
    emitPatterns: [/^agentfootprint\.secret\./],
    diagnostics: { keys: ['token'], patterns: [/^pin$/] },
  };
  const carry = (p: RedactionPolicy): unknown =>
    JSON.parse(JSON.stringify(carriedRedactionPolicy(p))) as unknown;

  it('round-trips through JSON: names as they are, each pattern the SAME RegExp the trusted side holds', () => {
    const back = policyFromCarried(carry(policy), 'Agent.resume', [policy]);
    expect(back?.keys).toEqual(['history']);
    expect(back?.patterns?.[0]).toBe(policy.patterns?.[0]);
    expect(back?.fields).toEqual({ customer: ['ssn'] });
    expect(back?.emitPatterns?.[0]).toBe(policy.emitPatterns?.[0]);
    expect(back?.diagnostics?.patterns?.[0]).toBe(policy.diagnostics?.patterns?.[0]);
    expect(policyFromCarried(undefined, 'Agent.resume', [policy])).toBeUndefined();
  });

  it('a carried pattern the resuming side does not hold is refused — never compiled', () => {
    // A pattern built to hang a backtracking matcher, as a checkpoint from
    // storage someone else controls could carry it.
    const hostile = { keys: ['history'], patterns: [{ source: '^(a+)+$', flags: '' }] };
    for (const trusted of [[], [undefined], [policy], [conversationRedaction()]]) {
      expect(() => policyFromCarried(hostile, 'Agent.resume', trusted)).toThrow(CarriedPolicyError);
      try {
        policyFromCarried(hostile, 'Agent.resume', trusted);
      } catch (e) {
        expect((e as CarriedPolicyError).refusal).toBe('unknown-pattern');
        // The message names no pattern.
        expect((e as Error).message).not.toContain('a+');
      }
    }
    // The same source with other flags is another pattern.
    const flagged = { patterns: [{ source: 'ssn|email', flags: 'g' }] };
    expect(() => policyFromCarried(flagged, 'Agent.resume', [policy])).toThrow(
      /names a pattern the resuming side does not hold/,
    );
  });

  it('the work a hostile checkpoint can cause is bounded: the module compiles no pattern at all', () => {
    // A work-count bound by construction: no RegExp is built from data here, so
    // the matcher only ever runs patterns code declared (on keys footprintjs
    // caps in length).
    const source = readFileSync(resolve(__dirname, '../../src/redaction/policy.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/new\s+RegExp\s*\(/);
    expect(code).not.toMatch(/\bRegExp\s*\(/);
  });

  it('a carried value this library did not write refuses the resume — fail closed', () => {
    for (const bad of [
      'history',
      [{ keys: ['x'] }],
      { patterns: ['ssn'] },
      { patterns: [{ source: 1, flags: '' }] },
      { keys: 'history' },
      {},
    ]) {
      expect(() => policyFromCarried(bad, 'Agent.resume', [policy])).toThrow(
        /Agent\.resume: the checkpoint's `runRedaction` is not a redaction policy this library wrote/,
      );
    }
  });
});

describe('policyOfMarks — the names a paused run kept out, as a policy', () => {
  it('keys and field marks become a policy; nothing marked is no policy', () => {
    expect(policyOfMarks(undefined)).toBeUndefined();
    expect(policyOfMarks({ keys: [] })).toBeUndefined();
    expect(policyOfMarks({ keys: ['history', 'history'], fields: { route: ['witness'] } })).toEqual(
      {
        keys: ['history'],
        fields: { route: ['witness'] },
      },
    );
  });
});

describe('keepsConversationOut — a calling run that keeps its whole conversation out', () => {
  it('the vocabulary and anything more; never a narrower policy', () => {
    expect(keepsConversationOut(conversationRedaction())).toBe(true);
    expect(keepsConversationOut(conversationRedaction({ keys: ['apiKey'] }))).toBe(true);
    expect(keepsConversationOut({ patterns: [/./] })).toBe(true);
    expect(keepsConversationOut({ keys: ['history', 'result'] })).toBe(false);
    expect(keepsConversationOut(undefined)).toBe(false);
  });
});
