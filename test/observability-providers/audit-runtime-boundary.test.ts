/**
 * The bounded audit chain holds its boundary at RUNTIME, through the public
 * doors — a real Agent's provider response, and `agent.emit()`.
 *
 * WHY. A payload's TypeScript type says what a field holds; it cannot say what
 * arrives. Structural typing lets a provider's `usage` object carry one more
 * child than `LLMEndPayload['usage']` declares, and a consumer can emit an event
 * under any name it likes. Two classes of runtime value used to cross the
 * bounded mode on a type's word:
 *
 *   1. A field the shapes KEPT passed whatever value it held, whole: a
 *      container kept wholesale carried undeclared children, and a kept leaf
 *      carried a value of the wrong kind (`stream.llm_end.usage`, through the
 *      real `callLLM` stage).
 *   2. An event name, or a payload field name, was used as a key into a plain
 *      object: a name `Object.prototype` holds (`constructor`, `toString`,
 *      `__proto__`, …) reached an inherited function instead of a shape — the
 *      payload rode through raw, or the call threw and the event was lost — and
 *      an own `__proto__` field vanished from the record.
 *
 * WHAT A GREEN RUN PROVES: every value reaches a bounded bundle through a shape
 * that checks it, whatever its name; every event is recorded and the chain
 * verifies. The class-level sweep over every shape is
 * `audit-bounded-sweep.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { auditExport, verifyAuditBundle } from '../../src/adapters/observability/audit.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { Agent } from '../../src/index.js';

const CANARY = 'RUNTIME-BOUNDARY-CANARY';

/** Every name `Object.prototype` holds: each one a key a plain-object table would answer. */
const INHERITED_NAMES = Object.getOwnPropertyNames(Object.prototype).sort();

function quietAgent(provider: MockProvider): Agent {
  return Agent.create({ provider, model: 'mock-model' }).system('You are terse.').build();
}

/** A payload whose OWN keys are the given names (an own `__proto__` included), each holding `value`. */
function ownFields(names: readonly string[], value: unknown): Record<string, unknown> {
  return Object.fromEntries(names.map((name) => [name, value]));
}

function roundTrips(bundle: ReturnType<ReturnType<typeof auditExport>['bundle']>): boolean {
  return verifyAuditBundle(JSON.parse(JSON.stringify(bundle))).valid;
}

describe('the bounded audit chain checks what arrives, not what the type says', () => {
  it("SECURITY: a provider usage object's undeclared child never reaches a bounded bundle (real Agent)", async () => {
    // Type-correct: not a fresh literal, so the extra child is structural typing's to allow.
    const usage = { input: 3, output: 5, extra: { prompt: CANARY } };
    const provider = new MockProvider({ replies: [{ content: 'done', usage }] });
    const agent = quietAgent(provider);
    const audit = auditExport();
    const stop = agent.enable.observability({ strategy: audit });
    try {
      await agent.run({ message: 'hello' });
    } finally {
      stop();
    }

    const bundle = audit.bundle();
    expect(verifyAuditBundle(bundle).valid).toBe(true);
    expect(roundTrips(bundle)).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain(CANARY);
    const llmEnd = bundle.records.find((r) => r.eventType === 'agentfootprint.stream.llm_end');
    // The declared counts stay; the undeclared child is a marker, its key kept.
    expect((llmEnd?.payload as { usage?: unknown }).usage).toEqual({
      input: 3,
      output: 5,
      extra: '[type: object]',
    });
  });

  it('SECURITY: a provider usage count of the wrong kind is a marker, never its value (real Agent)', async () => {
    const usage = { input: 3, output: 5, cacheRead: CANARY as unknown as number };
    const provider = new MockProvider({ replies: [{ content: 'done', usage }] });
    const agent = quietAgent(provider);
    const audit = auditExport();
    const stop = agent.enable.observability({ strategy: audit });
    try {
      await agent.run({ message: 'hello' });
    } finally {
      stop();
    }
    const bundle = audit.bundle();
    expect(verifyAuditBundle(bundle).valid).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain(CANARY);
    const llmEnd = bundle.records.find((r) => r.eventType === 'agentfootprint.stream.llm_end');
    expect((llmEnd?.payload as { usage?: { cacheRead?: unknown } }).usage?.cacheRead).toBe(
      `[${CANARY.length} chars]`,
    );
  });

  it.each(INHERITED_NAMES)(
    'SECURITY: an event named %s, sent through agent.emit, is recorded with every field a marker',
    (name) => {
      const agent = quietAgent(new MockProvider({ replies: ['unused'] }));
      const audit = auditExport();
      const stop = agent.enable.observability({ strategy: audit });
      try {
        agent.emit(name, { error: CANARY, errorMessage: CANARY, lastError: CANARY });
        // An ordinary unregistered event after it: still recorded, still bounded.
        agent.emit('consumer.order_placed', { email: CANARY, total: 12 });
      } finally {
        stop();
      }
      const bundle = audit.bundle();
      const marker = `[${CANARY.length} chars]`;
      const named = bundle.records.filter((r) => r.eventType === name);
      expect(named).toHaveLength(1);
      expect(named[0]?.payload).toEqual({ error: marker, errorMessage: marker, lastError: marker });
      const ordinary = bundle.records.find((r) => r.eventType === 'consumer.order_placed');
      expect(ordinary?.payload).toEqual({ email: marker, total: '[type: number]' });
      expect(JSON.stringify(bundle)).not.toContain(CANARY);
      expect(verifyAuditBundle(bundle).valid).toBe(true);
      expect(roundTrips(bundle)).toBe(true);
    },
  );

  it('SECURITY: payload fields named for Object.prototype are own keys of the record, each a marker — registered and unregistered events alike', () => {
    const agent = quietAgent(new MockProvider({ replies: ['unused'] }));
    const audit = auditExport();
    const stop = agent.enable.observability({ strategy: audit });
    const inherited = ownFields(INHERITED_NAMES, CANARY);
    const nested = ownFields(INHERITED_NAMES, { prompt: CANARY });
    try {
      // A registered event: its shape names neither set of fields.
      agent.emit('agentfootprint.map.parked', {
        mapId: 'orders-map',
        iteration: 1,
        by: 'lexical',
        idleCalls: 2,
        witness: 'w',
        ...inherited,
      });
      // A nested container of a registered event: the same names one level down.
      agent.emit('agentfootprint.stream.llm_end', {
        iteration: 1,
        content: 'c',
        toolCallCount: 0,
        usage: { input: 1, output: 2, ...nested },
        stopReason: 'stop',
        durationMs: 3,
      });
      // An unregistered event.
      agent.emit('consumer.inherited_fields', inherited);
    } finally {
      stop();
    }
    const bundle = audit.bundle();
    const marker = `[${CANARY.length} chars]`;
    const payloadOf = (type: string): Record<string, unknown> =>
      bundle.records.find((r) => r.eventType === type)?.payload as Record<string, unknown>;

    const parked = payloadOf('agentfootprint.map.parked');
    const usage = payloadOf('agentfootprint.stream.llm_end').usage as Record<string, unknown>;
    const custom = payloadOf('consumer.inherited_fields');
    for (const name of INHERITED_NAMES) {
      expect(Object.hasOwn(parked, name), `map.parked keeps ${name}`).toBe(true);
      expect(parked[name]).toBe(marker);
      expect(Object.hasOwn(usage, name), `llm_end.usage keeps ${name}`).toBe(true);
      expect(usage[name]).toBe('[type: object]');
      expect(Object.hasOwn(custom, name), `the unregistered event keeps ${name}`).toBe(true);
      expect(custom[name]).toBe(marker);
    }
    // The bounded record's objects are plain records: no field re-prototyped one.
    expect(Object.getPrototypeOf(parked)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(usage)).toBe(Object.prototype);
    expect(JSON.stringify(bundle)).not.toContain(CANARY);
    expect(verifyAuditBundle(bundle).valid).toBe(true);
    expect(roundTrips(bundle)).toBe(true);
  });

  it("an own __proto__ field rides a 'verbatim' bundle as an own key, never dropped", () => {
    const agent = quietAgent(new MockProvider({ replies: ['unused'] }));
    const audit = auditExport({ payloadMode: 'verbatim' });
    const stop = agent.enable.observability({ strategy: audit });
    try {
      agent.emit('consumer.proto_field', ownFields(['__proto__', 'kept'], 'VERBATIM-VALUE'));
    } finally {
      stop();
    }
    const bundle = audit.bundle();
    const payload = bundle.records.find((r) => r.eventType === 'consumer.proto_field')
      ?.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['__proto__', 'kept']);
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    expect(verifyAuditBundle(bundle).valid).toBe(true);
    expect(roundTrips(bundle)).toBe(true);
  });
});
