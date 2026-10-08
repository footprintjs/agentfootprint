/**
 * What one event is served as, and the run wiring around it —
 * `src/redaction/served.ts` and `src/redaction/runRedaction.ts`, below the
 * agent.
 *
 * The end-to-end suites drive an agent; these pin the pieces' own contracts,
 * including the branches an agent run rarely reaches: the no-policy identity,
 * a policy that selects only by event NAME, the identity on an event's meta,
 * a payload whose walk throws, the derived fields (a parser's message that
 * quotes the draft), the write relay's order, and a scope no run made.
 */
import { describe, expect, it, vi } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import type { FlowChart, RedactionPolicy } from 'footprintjs';

import { eventServing, SERVED_PLACEHOLDER } from '../../src/redaction/served.js';
import {
  createRunRedaction,
  emitServed,
  servingAhead,
  coverageInForce,
  policyInForce,
  runKeepsOut,
  setEventSource,
} from '../../src/redaction/runRedaction.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import { conversationRedaction } from '../../src/redaction/conversation.js';
import { namesAnything } from '../../src/redaction/policy.js';
import { noPolicyScope } from '../helpers/noPolicy.js';
import type { EventMeta } from '../../src/events/types.js';

const serving = (policy: RedactionPolicy | undefined) =>
  eventServing(() => new RedactionRule(policy), namesAnything(policy));

const META = { runId: 'run-1', runtimeStageId: 'call-llm#3' } as unknown as EventMeta;

describe('eventServing — one event, decided once', () => {
  it('no policy: the payload and the meta are handed back as they are', () => {
    const s = serving(undefined);
    const payload = { args: { ssn: '123' } };
    const meta = { ...META, principal: 'alice' } as EventMeta;
    expect(s.active()).toBe(false);
    expect(s.payload('agentfootprint.stream.tool_start', payload)).toBe(payload);
    expect(s.meta(meta)).toBe(meta);
  });

  it('a selected name at any depth, by name — then every value by its kind; the original untouched', () => {
    const payload = {
      status: 'ok',
      iteration: 2,
      args: { customer: { ssn: '123', note: 'Ada' } },
    };
    const served = serving({ keys: ['ssn'] }).payload(
      'agentfootprint.stream.tool_start',
      payload,
    ) as { status: unknown; iteration: unknown; args: Record<string, unknown> };
    // By name the selected value, by kind the free string beside it — and the
    // key `customer`, data that is no library word: one placeholder entry.
    expect(served.args).toEqual({ [SERVED_PLACEHOLDER]: SERVED_PLACEHOLDER });
    expect(JSON.stringify(served)).not.toMatch(/123|Ada/);
    // A library word and a number pass.
    expect(served.status).toBe('ok');
    expect(served.iteration).toBe(2);
    expect(payload.args.customer.ssn).toBe('123');
  });

  it('a policy that selects only by event NAME is active: that event whole, every other by kind', () => {
    const s = serving({ emitPatterns: [/stream\.token$/] });
    expect(s.active()).toBe(true);
    expect(s.payload('agentfootprint.stream.token', { content: 'hi' })).toBe(SERVED_PLACEHOLDER);
    const counts = { iteration: 1 };
    expect(s.payload('agentfootprint.stream.llm_start', counts)).toEqual(counts);
    expect(s.payload('agentfootprint.stream.llm_start', { iteration: 1, content: 'hi' })).toEqual({
      iteration: 1,
      content: SERVED_PLACEHOLDER,
    });
  });

  it('a policy of event names or diagnostic selectors only still serves every event by kind', () => {
    for (const policy of [
      { emitPatterns: [/^app\.never$/] },
      { diagnostics: { keys: ['note'] } },
    ] as RedactionPolicy[]) {
      const s = serving(policy);
      expect(s.active()).toBe(true);
      expect(s.payload('agentfootprint.stream.llm_end', { iteration: 1, content: 'Ada' })).toEqual({
        iteration: 1,
        content: SERVED_PLACEHOLDER,
      });
    }
    // The runner's own servings agree (`runRedaction.ts`).
    const ahead = servingAhead({ diagnostics: { keys: ['note'] } });
    expect(ahead.payload('agentfootprint.stream.llm_end', { content: 'Ada' })).toEqual({
      content: SERVED_PLACEHOLDER,
    });
  });

  it("the meta's identity is served in its own slots — by name, then by kind; its address never is", () => {
    const meta = { ...META, principal: 'alice', tenant: 'acme' } as EventMeta;
    for (const policy of [{ keys: ['principal'] }, { keys: ['ssn'] }] as RedactionPolicy[]) {
      const served = serving(policy).meta(meta);
      expect(served).toEqual({
        ...meta,
        principal: SERVED_PLACEHOLDER,
        tenant: SERVED_PLACEHOLDER,
      });
      // No key beside them: a served copy is never spread over the meta.
      expect(Object.keys(served)).toEqual(Object.keys(meta));
    }
    // No identity at all: the same object.
    expect(serving({ keys: ['principal'] }).meta(META)).toBe(META);
  });

  it('a payload whose walk throws is served as the placeholder whole, never raw', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'ssn', {
      enumerable: true,
      get() {
        throw new Error('no reading me');
      },
    });
    const served = serving({ keys: ['ssn'] }).payload('agentfootprint.stream.tool_end', {
      result: hostile,
    });
    expect(served).toBe(SERVED_PLACEHOLDER);
  });

  it('a parser’s message about the draft is free text: kept out under ANY policy', () => {
    const retry = {
      attempt: 2,
      stage: 'schema-validate',
      error: 'Unexpected token in "SSN 123-45-6789"',
      iteration: 1,
    };
    for (const policy of [conversationRedaction(), { keys: ['rawOutput'] }] as RedactionPolicy[]) {
      const served = serving(policy).payload('agentfootprint.agent.output_schema_retry', retry);
      // Its verdict word and counts stay.
      expect(served).toEqual({ ...retry, error: SERVED_PLACEHOLDER });
    }
  });
});

/** A chart whose factory hands back a bare scope — the run wrapper is what is under test. */
function scopedRun(policy: RedactionPolicy | undefined) {
  const dispatcher = new EventDispatcher();
  const run = createRunRedaction({ policy, dispatcher, getRunContext: () => ({} as never) });
  const emitted: { name: string; payload: unknown }[] = [];
  const factory = run.scopeFactoryFor({
    scopeFactory: () => ({
      $emit: (name: string, payload?: unknown) => emitted.push({ name, payload }),
      $setValue: vi.fn(),
    }),
  } as unknown as FlowChart);
  const scopeFor = (runtimeStageId: string) =>
    factory(
      { runtimeStageId, getRedactionRule: () => undefined } as never,
      'stage',
      {},
      undefined as never,
    ) as {
      $emit(name: string, payload?: unknown): void;
      $setValue: ReturnType<typeof vi.fn>;
    };
  return { run, dispatcher, emitted, scopeFor };
}

describe('runRedaction — the run wiring', () => {
  it('a scope no run made is UNKNOWN: its payload is refused, and it hands down the whole vocabulary', () => {
    const emitted: unknown[] = [];
    const bare = { $emit: (_name: string, payload?: unknown) => emitted.push(payload) };
    const payload = { args: { ssn: '123' } };
    emitServed(bare, 'agentfootprint.stream.tool_start', payload);
    expect(emitted).toEqual(['[REDACTED]']);
    expect(coverageInForce(bare)).toEqual({ state: 'unknown' });
    // A run its state cannot be resolved for never hands down "none".
    expect(policyInForce(bare)).toBe(conversationRedaction());
    expect(runKeepsOut(bare, 'ssn')).toBe(true);
  });

  it('a scope tied to a run with no policy emits as made — positively none', () => {
    const emitted: unknown[] = [];
    const tied = noPolicyScope({
      $emit: (_name: string, payload?: unknown) => emitted.push(payload),
    });
    const payload = { args: { ssn: '123' } };
    emitServed(tied, 'agentfootprint.stream.tool_start', payload);
    expect(emitted).toEqual([payload]);
    expect(coverageInForce(tied)).toEqual({ state: 'declared-none' });
    expect(policyInForce(tied)).toBeUndefined();
    expect(runKeepsOut(tied, 'ssn')).toBe(false);
  });

  it("a run's scope: the real payload to the real tier, the served one to $emit", () => {
    const { dispatcher, emitted, scopeFor } = scopedRun({ keys: ['ssn'] });
    const real: unknown[] = [];
    dispatcher.onRealEvent((event) => real.push(event.payload));
    const scope = scopeFor('tool-calls#4');
    emitServed(scope, 'agentfootprint.stream.tool_start', { args: { ssn: '123' } });
    expect(real).toEqual([{ args: { ssn: '123' } }]);
    // By name, then by kind: `ssn` is a key this run never declared, so it goes too.
    expect(emitted[0]?.payload).toEqual({ args: { [SERVED_PLACEHOLDER]: SERVED_PLACEHOLDER } });
    expect(policyInForce(scope)).toEqual({ keys: ['ssn'] });
    expect(runKeepsOut(scope, 'ssn')).toBe(true);
    expect(runKeepsOut(scope, 'history')).toBe(false);
  });

  it('the write relay hands each value back once, oldest first, per stage and key', () => {
    const { run, scopeFor } = scopedRun({ keys: ['messagesInjections'] });
    const slot = scopeFor('sf-messages/compose#7');
    const other = scopeFor('sf-messages/compose#9');
    setEventSource(slot, 'messagesInjections', ['first']);
    setEventSource(slot, 'messagesInjections', ['second']);
    setEventSource(other, 'messagesInjections', ['other stage']);
    expect(slot.$setValue).toHaveBeenCalledTimes(2); // it still writes, as $setValue does
    // `keptOut`: the policy selects the key itself, so what is derived from it keeps that verdict.
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toEqual({
      value: ['first'],
      keptOut: true,
    });
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toEqual({
      value: ['second'],
      keptOut: true,
    });
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toBeUndefined();
    expect(run.takeRealWrite('sf-messages/compose#9', 'messagesInjections')).toEqual({
      value: ['other stage'],
      keptOut: true,
    });
    // A key the policy does not select is relayed too (any policy relays), and says so.
    setEventSource(slot, 'slotCompositions', { slot: 'messages' });
    expect(run.takeRealWrite('sf-messages/compose#7', 'slotCompositions')).toEqual({
      value: { slot: 'messages' },
      keptOut: false,
    });
  });

  it('no policy: nothing is relayed — the served write IS the value', () => {
    const { run, scopeFor } = scopedRun(undefined);
    const slot = scopeFor('sf-messages/compose#7');
    setEventSource(slot, 'messagesInjections', ['x']);
    expect(slot.$setValue).toHaveBeenCalledWith('messagesInjections', ['x']);
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toBeUndefined();
  });
});
