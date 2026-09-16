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
  FindingsStandingPayload,
} from '../../../src/events/payloads.js';

describe('findings events — registered at every site', () => {
  it('EVENT_NAMES.findings names the two events in the three-segment form', () => {
    expect(EVENT_NAMES.findings).toEqual({
      declared: 'agentfootprint.findings.declared',
      standing: 'agentfootprint.findings.standing',
    });
  });

  it('both are in ALL_EVENT_TYPES, directly after the middleware domain', () => {
    const list = [...ALL_EVENT_TYPES];
    const at = list.indexOf('agentfootprint.middleware.decision');
    expect(at).toBeGreaterThan(-1);
    expect(list[at + 1]).toBe('agentfootprint.findings.declared');
    expect(list[at + 2]).toBe('agentfootprint.findings.standing');
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

  it('FindingsStandingPayload carries exactly the eight declared keys', () => {
    expectTypeOf<keyof FindingsStandingPayload>().toEqualTypeOf<
      | 'toolCallId'
      | 'toolName'
      | 'iteration'
      | 'standing'
      | 'declaredOn'
      | 'assertionCount'
      | 'conflictKeys'
      | 'unknownId'
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
