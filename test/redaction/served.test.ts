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
  policyInForce,
  runKeepsOut,
  setEventSource,
} from '../../src/redaction/runRedaction.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import type { EventMeta } from '../../src/events/types.js';

const serving = (policy: RedactionPolicy | undefined) =>
  eventServing(() => new RedactionRule(policy), (policy?.emitPatterns?.length ?? 0) > 0);

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

  it('a selected name at any depth of the payload; the original untouched', () => {
    const payload = { toolCallId: 'c1', args: { citizen: { ssn: '123', name: 'Ada' } } };
    const served = serving({ keys: ['ssn'] }).payload(
      'agentfootprint.stream.tool_start',
      payload,
    ) as {
      args: { citizen: Record<string, unknown> };
    };
    expect(served.args.citizen).toEqual({ ssn: SERVED_PLACEHOLDER, name: 'Ada' });
    expect(payload.args.citizen.ssn).toBe('123');
  });

  it('a policy that selects only by event NAME is active, and serves that event whole', () => {
    const s = serving({ emitPatterns: [/stream\.token$/] });
    expect(s.active()).toBe(true);
    expect(s.payload('agentfootprint.stream.token', { content: 'hi' })).toBe(SERVED_PLACEHOLDER);
    const other = { iteration: 1 };
    expect(s.payload('agentfootprint.stream.llm_start', other)).toEqual(other);
  });

  it("the meta's identity is served by name; its address never is", () => {
    const meta = { ...META, principal: 'alice', tenant: 'acme' } as EventMeta;
    const served = serving({ keys: ['principal'] }).meta(meta);
    expect(served.principal).toBe(SERVED_PLACEHOLDER);
    expect(served.tenant).toBe('acme');
    expect(served.runId).toBe('run-1');
    expect(served.runtimeStageId).toBe('call-llm#3');
    // Nothing selected in it, or no identity at all: the same object.
    expect(serving({ keys: ['ssn'] }).meta(meta)).toBe(meta);
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

  it("a parser's message is kept out with the draft it can quote (DERIVED)", () => {
    const retry = {
      attempt: 1,
      stage: 'json-parse',
      error: 'Unexpected token \'d\', "draft SSN 123" is not valid JSON',
    };
    const kept = serving({ keys: ['rawOutput'] }).payload(
      'agentfootprint.agent.output_schema_retry',
      retry,
    ) as Record<string, unknown>;
    expect(kept.error).toBe(SERVED_PLACEHOLDER);
    expect(kept.stage).toBe('json-parse');
    expect(retry.error).toContain('draft'); // the payload itself is untouched
    // The draft not kept out: the message stays.
    const clear = serving({ keys: ['history'] }).payload(
      'agentfootprint.agent.output_schema_retry',
      retry,
    ) as Record<string, unknown>;
    expect(clear.error).toBe(retry.error);
    // An event with no derived field present is handed back as served.
    const bare = { attempt: 1 };
    expect(
      serving({ keys: ['rawOutput'] }).payload('agentfootprint.agent.output_schema_retry', bare),
    ).toEqual(bare);
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
  it('a scope no run made emits as it always did, and reports no policy', () => {
    const emitted: unknown[] = [];
    const bare = { $emit: (_name: string, payload?: unknown) => emitted.push(payload) };
    const payload = { args: { ssn: '123' } };
    emitServed(bare, 'agentfootprint.stream.tool_start', payload);
    expect(emitted).toEqual([payload]);
    expect(policyInForce(bare)).toBeUndefined();
    expect(runKeepsOut(bare, 'ssn')).toBe(false);
  });

  it("a run's scope: the real payload to the real tier, the served one to $emit", () => {
    const { dispatcher, emitted, scopeFor } = scopedRun({ keys: ['ssn'] });
    const real: unknown[] = [];
    dispatcher.onRealEvent((event) => real.push(event.payload));
    const scope = scopeFor('tool-calls#4');
    emitServed(scope, 'agentfootprint.stream.tool_start', { args: { ssn: '123' } });
    expect(real).toEqual([{ args: { ssn: '123' } }]);
    expect(emitted[0]?.payload).toEqual({ args: { ssn: SERVED_PLACEHOLDER } });
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
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toEqual({
      value: ['first'],
    });
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toEqual({
      value: ['second'],
    });
    expect(run.takeRealWrite('sf-messages/compose#7', 'messagesInjections')).toBeUndefined();
    expect(run.takeRealWrite('sf-messages/compose#9', 'messagesInjections')).toEqual({
      value: ['other stage'],
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
