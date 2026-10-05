import { describe, expect, it, vi } from 'vitest';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { trustBoundaryRecorder } from '../../../src/lib/trust-boundaries/index.js';

function harness(maxFacts = 1000) {
  let listener: (event: AgentfootprintEvent) => void = () => undefined;
  const recorder = trustBoundaryRecorder({ maxFacts });
  recorder.subscribe({
    on: (_type, next) => {
      listener = next;
      return () => undefined;
    },
  });
  return { recorder, send: (value: unknown) => listener(value as AgentfootprintEvent) };
}

function event(payload: object = {}, meta: object = {}) {
  return {
    type: 'agentfootprint.permission.check',
    payload: { capability: 'tool_call', result: 'allow', ...payload },
    meta: { runId: 'agent-run', runtimeStageId: 'stage#1', wallClockMs: 0, ...meta },
  };
}

const cases = [
  [
    'middleware.decision',
    { middleware: 'policy', moment: 'before-tool', outcome: 'ask', changed: true, iteration: 0 },
    ['middleware', 'moment', 'outcome', 'changed', 'iteration'],
  ],
  [
    'permission.check',
    { capability: 'skill_read', result: 'gate_open', target: 'skill', policyRuleId: 'rule' },
    ['capability', 'result', 'target', 'policyRuleId'],
  ],
  [
    'permission.halt',
    { target: 'tool', checkerId: 'checker', iteration: 2 },
    ['target', 'checkerId', 'iteration'],
  ],
  ['credential.requested', { service: 'billing', mode: 'user' }, ['service', 'mode']],
  ['credential.acquired', { service: 'billing', kind: 'bearer' }, ['service', 'kind']],
  ['credential.authorization_required', { service: 'billing' }, ['service']],
  [
    'credential.failed',
    { service: 'billing', errorClass: 'SyntheticError' },
    ['service', 'errorClass'],
  ],
] as const;

describe('trust boundary metadata admission', () => {
  it.each(cases)('admits only the closed whitelist for %s', (suffix, selected, keys) => {
    const { recorder, send } = harness();
    const payload = {
      ...selected,
      actor: 'excluded-canary',
      principal: 'excluded-canary',
      tenant: 'excluded-canary',
      why: 'excluded-canary',
      rationale: 'excluded-canary',
      reason: 'excluded-canary',
      tellLLM: 'excluded-canary',
      sessionId: 'excluded-canary',
      authorizationUrl: 'excluded-canary',
      content: 'excluded-canary',
      extras: { secret: 'excluded-canary' },
    };
    send({
      ...event(payload, { principal: 'excluded-canary', tenant: 'excluded-canary' }),
      type: `agentfootprint.${suffix}`,
    });
    const row = recorder.toSnapshot().data.facts[0];
    expect(Object.keys(row).sort()).toEqual(
      ['seq', 'eventType', 'runId', 'runtimeStageId', 'wallClockMs', ...keys].sort(),
    );
    expect(JSON.stringify(recorder.toSnapshot())).not.toContain('excluded-canary');
    expect(row).not.toHaveProperty('redacted');
    expect(row).not.toHaveProperty('executed');
  });

  it('retains available call identity verbatim without inventing missing halves', () => {
    const { recorder, send } = harness();
    send(event({ toolCallId: 'call/#0', iteration: 0 }));
    send(event({ iteration: 2 }));
    send(event({ toolCallId: 'call/#0' }));
    expect(recorder.toSnapshot().data.facts).toEqual([
      expect.objectContaining({ toolCallId: 'call/#0', iteration: 0 }),
      expect.objectContaining({ iteration: 2 }),
      expect.objectContaining({ toolCallId: 'call/#0' }),
    ]);
    expect(recorder.toSnapshot().data.facts[1]).not.toHaveProperty('toolCallId');
    expect(recorder.toSnapshot().data.facts[2]).not.toHaveProperty('iteration');
  });

  it('copies positioned metadata without mixing engine and Agent identities', () => {
    const { recorder, send } = harness();
    const position = {
      engineRunId: 'engine-leg',
      logRunId: 'engine-log',
      drillPath: ['mount#4'],
      committedThroughIdx: -1,
      extra: 'excluded-canary',
    };
    send(event({}, { sourcePosition: position }));
    position.drillPath.push('later#5');
    position.committedThroughIdx = 10;
    const row = recorder.toSnapshot().data.facts[0];
    expect(row.runId).toBe('agent-run');
    expect(row.sourcePosition).toEqual({
      engineRunId: 'engine-leg',
      logRunId: 'engine-log',
      drillPath: ['mount#4'],
      committedThroughIdx: -1,
    });
    expect(Object.isFrozen(row.sourcePosition)).toBe(true);
    expect(Object.isFrozen(row.sourcePosition?.drillPath)).toBe(true);
    send(event());
    expect(recorder.toSnapshot().data.facts[1]).not.toHaveProperty('sourcePosition');
  });

  it.each(['type', 'meta', 'payload'])('does not invoke an envelope %s getter', (key) => {
    const { recorder, send } = harness();
    const value = event();
    const getter = vi.fn();
    Object.defineProperty(value, key, { get: getter });
    expect(() => send(value)).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(recorder.counters).toMatchObject({
      observed: key === 'type' ? 0 : 1,
      invalid: key === 'type' ? 0 : 1,
      retained: 0,
    });
  });

  it.each(['runId', 'runtimeStageId', 'wallClockMs', 'sourcePosition'])(
    'does not invoke selected meta %s getters',
    (key) => {
      const { recorder, send } = harness();
      const value = event();
      const getter = vi.fn();
      Object.defineProperty(value.meta, key, { get: getter });
      send(value);
      expect(getter).not.toHaveBeenCalled();
      expect(recorder.counters.invalid).toBe(1);
    },
  );

  it('does not invoke included payload/path accessors or inspect excluded accessors', () => {
    const { recorder, send } = harness();
    const getter = vi.fn();
    const value = event();
    Object.defineProperty(value.payload, 'reason', { get: getter });
    send(value);
    expect(recorder.counters.retained).toBe(1);
    Object.defineProperty(value.payload, 'target', { get: getter });
    send(value);
    const path = ['mount#0'];
    Object.defineProperty(path, '0', { get: getter });
    send(
      event(
        {},
        {
          sourcePosition: {
            engineRunId: 'e',
            logRunId: 'l',
            drillPath: path,
            committedThroughIdx: 0,
          },
        },
      ),
    );
    expect(getter).not.toHaveBeenCalled();
    expect(recorder.counters.invalid).toBe(2);
  });

  it('contains throwing/revoked proxy inspection failures', () => {
    const { recorder, send } = harness();
    send(
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error('not an event');
          },
        },
      ),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    send(revoked.proxy);
    expect(recorder.counters).toMatchObject({ observed: 0, retained: 0, invalid: 0 });
  });

  it('rejects inherited selected data but ignores unrelated typed events without inspecting them', () => {
    const { recorder, send } = harness();
    const getter = vi.fn();
    send(Object.create(event()));
    const value = { type: 'agentfootprint.stream.token' };
    Object.defineProperty(value, 'payload', { get: getter });
    send(value);
    expect(getter).not.toHaveBeenCalled();
    expect(recorder.counters.observed).toBe(0);
  });

  it.each([
    { result: 'invented' },
    { capability: 'invented' },
    { toolCallId: '' },
    { toolCallId: 1 },
    { iteration: -1 },
    { iteration: 0.5 },
    { iteration: NaN },
    { iteration: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects malformed retained payload data %j', (payload) => {
    const { recorder, send } = harness();
    send(event(payload));
    expect(recorder.counters.invalid).toBe(1);
  });

  it.each([
    null,
    {},
    { engineRunId: 'e', logRunId: 'l', drillPath: [], committedThroughIdx: -2 },
    { engineRunId: 'e', logRunId: 'l', drillPath: [''], committedThroughIdx: 0 },
    { engineRunId: 'e', logRunId: 'l', drillPath: new Array(1), committedThroughIdx: 0 },
  ])('rejects an invalid supplied position rather than repairing it', (sourcePosition) => {
    const { recorder, send } = harness();
    send(event({}, { sourcePosition }));
    expect(recorder.counters.invalid).toBe(1);
  });

  it('applies per-field, path and whole-fact UTF-8 ceilings without truncation', () => {
    const { recorder, send } = harness();
    send(event({ target: 'x'.repeat(512) }));
    send(event({ target: 'x'.repeat(513) }));
    send(
      event(
        {},
        {
          sourcePosition: {
            engineRunId: 'e',
            logRunId: 'l',
            drillPath: Array(33).fill('m'),
            committedThroughIdx: 0,
          },
        },
      ),
    );
    send(
      event(
        {},
        {
          sourcePosition: {
            engineRunId: 'e',
            logRunId: 'l',
            drillPath: Array(8).fill('😀'.repeat(256)),
            committedThroughIdx: 0,
          },
        },
      ),
    );
    expect(recorder.counters).toEqual({
      observed: 4,
      retained: 1,
      evicted: 0,
      invalid: 0,
      oversized: 3,
      pending: 0,
    });
    expect(recorder.toSnapshot().data.facts[0]).toHaveProperty('target', 'x'.repeat(512));
  });
});
