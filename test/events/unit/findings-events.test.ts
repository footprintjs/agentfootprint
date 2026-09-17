/**
 * Unit tests — the two findings events (9.101.0).
 *
 * Pattern: Test-as-specification.
 * Role:    Lock the names and the payload LAW: `agentfootprint.findings.declared`
 *          and `agentfootprint.findings.standing` are registered at every site
 *          the registry has (`EVENT_NAMES`, `AgentfootprintEventMap`,
 *          `ALL_EVENT_TYPES`), and their payloads carry identities, enums and
 *          counts ONLY — never an assertion, a `settles`, a `line` or any
 *          other word the model wrote (the `MiddlewareDecisionPayload` rule:
 *          values live in the committed key under redaction; an event stream
 *          fans out to sinks the run does not control).
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEventMap,
} from '../../../src/events/registry.js';
import type {
  FindingsDeclaredPayload,
  FindingsJudgeFailedPayload,
  FindingsJudgedPayload,
  FindingsStandingPayload,
} from '../../../src/events/payloads.js';

describe('findings events — registered at every site', () => {
  it('EVENT_NAMES.findings names the four events in the three-segment form', () => {
    expect(EVENT_NAMES.findings).toEqual({
      declared: 'agentfootprint.findings.declared',
      standing: 'agentfootprint.findings.standing',
      // 9.104.0 — the judge's two: `judge_failed`, not `judgeFailed`, because
      // the registry's form is `agentfootprint.<domain>.<snake_action>`.
      judged: 'agentfootprint.findings.judged',
      judge_failed: 'agentfootprint.findings.judge_failed',
    });
  });

  it('all four are in ALL_EVENT_TYPES, directly after the middleware domain', () => {
    const list = [...ALL_EVENT_TYPES];
    const at = list.indexOf('agentfootprint.middleware.decision');
    expect(at).toBeGreaterThan(-1);
    expect(list[at + 1]).toBe('agentfootprint.findings.declared');
    expect(list[at + 2]).toBe('agentfootprint.findings.standing');
    expect(list[at + 3]).toBe('agentfootprint.findings.judged');
    expect(list[at + 4]).toBe('agentfootprint.findings.judge_failed');
  });

  it('the judge events are keys of AgentfootprintEventMap with their own payload types', () => {
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.findings.judged']['payload']
    >().toEqualTypeOf<FindingsJudgedPayload>();
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.findings.judge_failed']['payload']
    >().toEqualTypeOf<FindingsJudgeFailedPayload>();
  });

  it('both are keys of AgentfootprintEventMap with their own payload types', () => {
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.findings.declared']['payload']
    >().toEqualTypeOf<FindingsDeclaredPayload>();
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.findings.standing']['payload']
    >().toEqualTypeOf<FindingsStandingPayload>();
  });
});

describe('findings events — identities, enums and counts only', () => {
  it('FindingsDeclaredPayload carries exactly the six declared keys', () => {
    expectTypeOf<keyof FindingsDeclaredPayload>().toEqualTypeOf<
      'toolName' | 'toolCallId' | 'iteration' | 'basis' | 'expect' | 'malformed'
    >();
    expectTypeOf<FindingsDeclaredPayload['basis']>().toEqualTypeOf<'direct' | 'exploratory'>();
    expectTypeOf<FindingsDeclaredPayload['expect']>().toEqualTypeOf<
      'low' | 'medium' | 'high' | undefined
    >();
    expectTypeOf<FindingsDeclaredPayload['malformed']>().toEqualTypeOf<number | undefined>();
  });

  it('FindingsStandingPayload carries exactly the nine declared keys (`agrees` since 9.104.0)', () => {
    expectTypeOf<keyof FindingsStandingPayload>().toEqualTypeOf<
      | 'toolCallId'
      | 'toolName'
      | 'iteration'
      | 'standing'
      | 'declaredOn'
      | 'assertionCount'
      | 'conflictKeys'
      | 'unknownId'
      | 'agrees'
    >();
    expectTypeOf<FindingsStandingPayload['standing']>().toEqualTypeOf<
      'fact' | 'open' | 'noise' | 'ruled-out'
    >();
    expectTypeOf<FindingsStandingPayload['declaredOn']>().toEqualTypeOf<'tool-call' | 'answer'>();
    expectTypeOf<FindingsStandingPayload['assertionCount']>().toEqualTypeOf<number>();
    expectTypeOf<FindingsStandingPayload['conflictKeys']>().toEqualTypeOf<
      readonly string[] | undefined
    >();
    expectTypeOf<FindingsStandingPayload['unknownId']>().toEqualTypeOf<true | undefined>();
  });

  it('neither payload has a slot for the model’s words (assertions, settles, line, args)', () => {
    // A value-carrying key would be a type error to READ, which is the point:
    // the row lives in `AgentState.findingsLedger`, the event only names it.
    expectTypeOf<FindingsStandingPayload>().not.toHaveProperty('assertions');
    expectTypeOf<FindingsStandingPayload>().not.toHaveProperty('settles');
    expectTypeOf<FindingsStandingPayload>().not.toHaveProperty('line');
    expectTypeOf<FindingsStandingPayload>().not.toHaveProperty('sought');
    expectTypeOf<FindingsDeclaredPayload>().not.toHaveProperty('args');
    expectTypeOf<FindingsDeclaredPayload>().not.toHaveProperty('previous');
  });
});

describe('findings events — the judge payloads carry identities, enums and numbers only (9.104.0)', () => {
  it('FindingsJudgedPayload carries exactly the nine declared keys — no state, no distribution, no `agrees`', () => {
    expectTypeOf<keyof FindingsJudgedPayload>().toEqualTypeOf<
      | 'toolCallId'
      | 'toolName'
      | 'iteration'
      | 'against'
      | 'standing'
      | 'confidence'
      | 'latencyMs'
      | 'inputTokens'
      | 'outputTokens'
    >();
    expectTypeOf<FindingsJudgedPayload['against']>().toEqualTypeOf<'proposition' | 'question'>();
    expectTypeOf<FindingsJudgedPayload['standing']>().toEqualTypeOf<
      'fact' | 'open' | 'noise' | 'ruled-out'
    >();
    // The judge files before the model declares, so the comparison cannot
    // be made here — it rides the standing event, the one moment both exist.
    expectTypeOf<FindingsJudgedPayload>().not.toHaveProperty('agrees');
  });

  it('FindingsStandingPayload carries `agrees?: boolean` — the model against the judge, present only when a judgment exists', () => {
    expectTypeOf<FindingsStandingPayload['agrees']>().toEqualTypeOf<boolean | undefined>();
  });

  it('FindingsJudgeFailedPayload carries exactly the five declared keys — no message text', () => {
    expectTypeOf<keyof FindingsJudgeFailedPayload>().toEqualTypeOf<
      'toolCallId' | 'toolName' | 'iteration' | 'status' | 'latencyMs'
    >();
    expectTypeOf<FindingsJudgeFailedPayload['status']>().toEqualTypeOf<number | undefined>();
  });
});
