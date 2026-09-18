/**
 * Unit tests — the three tool-choice events (9.105.0).
 *
 * Pattern: Test-as-specification.
 * Role:    Lock the names and the payload LAW: `agentfootprint.tool_choice.picked`,
 *          `.outcome` and `.failed` are registered at every site the registry
 *          has (`EVENT_NAMES`, `AgentfootprintEventMap`, `ALL_EVENT_TYPES`),
 *          in the three-segment snake-case form the registry's own test
 *          demands (the brief's `toolChoice.picked` would be refused there),
 *          and their payloads carry identities (tool names), enums, numbers
 *          and a boolean ONLY — never a description the classifier read,
 *          never the user's message.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEventMap,
} from '../../../src/events/registry.js';
import type {
  ToolChoiceFailedPayload,
  ToolChoiceOutcomePayload,
  ToolChoicePickedPayload,
} from '../../../src/events/payloads.js';

describe('tool-choice events — registered at every site', () => {
  it('EVENT_NAMES.tool_choice names the three events in the three-segment form', () => {
    expect(EVENT_NAMES.tool_choice).toEqual({
      picked: 'agentfootprint.tool_choice.picked',
      outcome: 'agentfootprint.tool_choice.outcome',
      failed: 'agentfootprint.tool_choice.failed',
    });
  });

  it('all three are in ALL_EVENT_TYPES, directly after the findings domain', () => {
    const list = [...ALL_EVENT_TYPES];
    // The findings domain's last entry is `contingent` since 9.110.0.
    const at = list.indexOf('agentfootprint.findings.contingent');
    expect(at).toBeGreaterThan(-1);
    expect(list[at + 1]).toBe('agentfootprint.tool_choice.picked');
    expect(list[at + 2]).toBe('agentfootprint.tool_choice.outcome');
    expect(list[at + 3]).toBe('agentfootprint.tool_choice.failed');
  });

  it('each is a key of AgentfootprintEventMap with its own payload type', () => {
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.tool_choice.picked']['payload']
    >().toEqualTypeOf<ToolChoicePickedPayload>();
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.tool_choice.outcome']['payload']
    >().toEqualTypeOf<ToolChoiceOutcomePayload>();
    expectTypeOf<
      AgentfootprintEventMap['agentfootprint.tool_choice.failed']['payload']
    >().toEqualTypeOf<ToolChoiceFailedPayload>();
  });
});

describe('tool-choice events — the payload law', () => {
  it('picked: the pick, its confidence, counts, the narrowing and the cost — no description, no message', () => {
    expectTypeOf<keyof ToolChoicePickedPayload>().toEqualTypeOf<
      | 'iteration'
      | 'chosen'
      | 'confidence'
      | 'offered'
      | 'served'
      | 'narrowed'
      | 'narrowedSkipped'
      | 'latencyMs'
      | 'inputTokens'
      | 'outputTokens'
    >();
    // `offered` and `served` are COUNTS on the event; the names live on the row.
    expectTypeOf<ToolChoicePickedPayload['offered']>().toEqualTypeOf<number>();
    expectTypeOf<ToolChoicePickedPayload['served']>().toEqualTypeOf<number>();
  });

  it('outcome: the called names, the agreement, the missed names', () => {
    expectTypeOf<keyof ToolChoiceOutcomePayload>().toEqualTypeOf<
      'iteration' | 'called' | 'firstAgrees' | 'missed'
    >();
  });

  it('failed: the status and the latency — the message stays on the row', () => {
    expectTypeOf<keyof ToolChoiceFailedPayload>().toEqualTypeOf<
      'iteration' | 'status' | 'latencyMs'
    >();
  });
});
