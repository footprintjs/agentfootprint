/**
 * THE value-kind rule (`src/redaction/knownStrings.ts` · `keepKnownValues`) —
 * what every event is served by under ANY policy, GENERATED for every event
 * type in the registry.
 *
 * Under a policy that selects at least one name, every value of an event is
 * checked by its KIND, wherever it sits: numbers, booleans and null pass; a
 * string passes only when it is one of the library's own words; a key that is
 * not a payload field name is checked the same way. Ids the library mints,
 * the names an app declared and the host's identity are NOT words in this
 * release: they are the placeholder too. Pinned for every event type, under
 * random policies — name-only ones included — with adversarial strings at
 * every depth and as keys: no string but a library word survives, and every
 * library word does. Then the copies the library derives from a selected
 * value under names of its own (a validation issue's quote, a check-in's
 * `willDo`, a parser's message, a coverage declaration's words), under
 * name-only policies: none leaves raw. No policy is byte-identical.
 */
import { RedactionRule } from 'footprintjs/advanced';
import type { FlowChart, RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { ALL_EVENT_TYPES } from '../../src/events/registry.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import { conversationRedaction } from '../../src/doors/security.js';
import {
  FIELD_NAMES,
  keepKnownValues,
  LIBRARY_WORDS,
  servedString,
} from '../../src/redaction/knownStrings.js';
import { createRunRedaction, emitServed } from '../../src/redaction/runRedaction.js';
import { eventServing, SERVED_PLACEHOLDER } from '../../src/redaction/served.js';
import { namesAnything } from '../../src/redaction/policy.js';
import type { EventMeta } from '../../src/events/types.js';
import { adversarialStrings, locationsOf, NOT_KEPT, unknownStringsIn } from './fixture.js';

const serve = (policy: RedactionPolicy | undefined, type: string, payload: unknown): unknown => {
  const rule = new RedactionRule(policy);
  return eventServing(() => rule, namesAnything(policy)).payload(type, payload);
};

/** mulberry32 — the suite's seeded PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random policy that selects at least one name — name-only ones (a key, a
 * pattern, a `fields` selector, an event name that is not this event's, a
 * diagnostic selector), the vocabulary alone, or the vocabulary joined with
 * one of them.
 */
function anyPolicy(next: () => number): RedactionPolicy {
  const field = ['pin', 'token', 'iban', 'vin'][Math.floor(next() * 4)] as string;
  const named: RedactionPolicy[] = [
    { keys: [field] },
    { patterns: [new RegExp(`^${field}$`)] },
    { fields: { customer: [field] } },
    { emitPatterns: [/^app\.never$/] },
    { diagnostics: { keys: [field] } },
  ];
  const pick = named[Math.floor(next() * named.length)] as RedactionPolicy;
  const all: RedactionPolicy[] = [...named, conversationRedaction(), conversationRedaction(pick)];
  return all[Math.floor(next() * all.length)] as RedactionPolicy;
}

/** Library words — the only strings the rule keeps. */
const WORDS = ['ok', 'tool_use', 'agentfootprint.stream.tool_start', 'stage requested pause'];

/** Ids the library mints and names an app declares — content in this release. */
const NOT_WORDS = Object.values(NOT_KEPT);

/**
 * A payload with the secret in every place it could ride, beside the words
 * that must survive — its structural keys the payload types' own field names
 * (any other key is data, and checked like a value).
 */
function plantedPayload(secret: string, next: () => number): Record<string, unknown> {
  const bad = adversarialStrings(secret);
  const pick = () => bad[Math.floor(next() * bad.length)] as string;
  return {
    toolName: pick(),
    status: 'ok',
    iteration: 3,
    enforced: true,
    provider: null,
    tools: [...WORDS, ...NOT_WORDS],
    semantics: {
      facts: [{ entity: pick(), value: pick(), toolCallId: pick() }],
      note: pick(),
      tool: NOT_KEPT.tool,
    },
    edges: bad,
    // A map-like field: its keys are data.
    withheldReasons: Object.fromEntries([
      ...bad.map((key) => [key, 1]),
      [NOT_KEPT.tool, 2],
      ['ok', 3],
    ]),
    [pick()]: 'a key the payload types do not name',
  };
}

describe('the rule, generated for every event type in the registry', () => {
  for (const [index, type] of ALL_EVENT_TYPES.entries()) {
    it(type, () => {
      const next = rng(index + 1);
      const secret = `SEC${index}X${Math.floor(next() * 1e9).toString(36)}`;
      const payload = plantedPayload(secret, next);
      const served = serve(anyPolicy(next), type, payload);
      // No string but a library word survives — values and keys alike.
      expect(unknownStringsIn(served)).toEqual([]);
      expect(locationsOf(served, secret)).toEqual([]);
      for (const text of NOT_WORDS) expect(locationsOf(served, text), text).toEqual([]);
      // …and every library word does, where it was.
      const s = served as Record<string, unknown> & {
        semantics: { tool: unknown };
        withheldReasons: Record<string, unknown>;
      };
      expect(s.tools).toEqual([...WORDS, ...NOT_WORDS.map(() => SERVED_PLACEHOLDER)]);
      expect([s.status, s.iteration, s.enforced, s.provider]).toEqual(['ok', 3, true, null]);
      expect(s.semantics.tool).toBe(SERVED_PLACEHOLDER);
      expect(s.withheldReasons).toEqual({ ok: 3, [SERVED_PLACEHOLDER]: SERVED_PLACEHOLDER });
      // No policy: the very object, byte-identical.
      expect(serve(undefined, type, payload)).toBe(payload);
    });
  }
});

/** Name-only policies, each selecting the one argument field `customer.ssn`. */
const NAME_ONLY: readonly [string, RedactionPolicy][] = [
  ['a key', { keys: ['ssn'] }],
  ['a pattern', { patterns: [/ssn/i] }],
  ['a dotted-path pattern', { patterns: [/customer\.ssn/] }],
  ['a fields selector', { fields: { customer: ['ssn'] } }],
];

/**
 * Every copy the library derives from the selected value under a name of its
 * own, in the shape it rides — none of them a name the policy selects.
 */
function derivedCopies(ssn: string): Record<string, unknown> {
  return {
    args: { customer: { ssn } }, // the value under its own name
    // A validation issue quotes the argument it refuses.
    issues: [{ path: 'customer.ssn', value: ssn, expected: 'digits only', got: 'string' }],
    // A check-in renders the call's arguments as text.
    willDo: `Will run ${NOT_KEPT.tool} with customer.ssn = ${ssn}`,
    request: { evidence: { willDo: `Will run ${NOT_KEPT.tool} for ${ssn}` } },
    // A parser's message about the draft.
    error: `Unexpected token in "${ssn}"`,
    errorMessage: `amount "${ssn}" must be a number`,
    // A coverage declaration composed from the call.
    lookedFor: `records for ${ssn}`,
    checked: [{ what: `records for ${ssn}`, why: `asked about ${ssn}`, short: ssn }],
    notChecked: [{ what: `the archive of ${ssn}`, short: `archive ${ssn}`, kind: 'existence' }],
    // Words and counts beside them, which stay.
    status: 'ok',
    attempt: 2,
  };
}

describe('derived copies under a name-only policy, generated for every event type', () => {
  const META = {
    runId: 'run-1791438565771-3',
    runtimeStageId: 'call-llm#3',
    principal: 'alice@example.com',
    tenant: 'acme',
  } as unknown as EventMeta;

  for (const [index, type] of ALL_EVENT_TYPES.entries()) {
    it(type, () => {
      const ssn = `SSN-${index}-${(index * 7919) % 10007}`;
      const payload = derivedCopies(ssn);
      for (const [label, policy] of NAME_ONLY) {
        const rule = new RedactionRule(policy);
        const serving = eventServing(() => rule, namesAnything(policy));
        const served = serving.payload(type, payload) as Record<string, unknown>;
        expect(locationsOf(served, ssn), label).toEqual([]);
        expect(unknownStringsIn(served), label).toEqual([]);
        // The words and counts beside the copies stay where they were.
        expect(served.status, label).toBe('ok');
        expect(served.attempt, label).toBe(2);
        expect((served.notChecked as { kind: unknown }[])[0]?.kind, label).toBe('existence');
        // The meta's identity: served in its own slots, the address untouched.
        const meta = serving.meta(META);
        expect(meta, label).toEqual({
          ...META,
          principal: SERVED_PLACEHOLDER,
          tenant: SERVED_PLACEHOLDER,
        });
        expect(Object.keys(meta), label).toEqual(Object.keys(META));
      }
      // No policy: the very objects, byte-identical.
      const none = eventServing(() => new RedactionRule(undefined), false);
      expect(none.payload(type, payload)).toBe(payload);
      expect(none.meta(META)).toBe(META);
    });
  }
});

describe('ids, declared names and who asked are content in this release', () => {
  it('the stage ids, the run id and the call ids of the run itself — through the real wiring', () => {
    const emitted: unknown[] = [];
    const run = createRunRedaction({
      policy: { keys: ['ssn'] },
      dispatcher: new EventDispatcher(),
      getRunContext: () => ({ runId: NOT_KEPT.run, principal: 'alice@example.com' } as never),
    });
    const factory = run.scopeFactoryFor({
      scopeFactory: () => ({ $emit: (_name: string, payload?: unknown) => emitted.push(payload) }),
    } as unknown as FlowChart);
    const scope = factory(
      { runtimeStageId: NOT_KEPT.stage, getRedactionRule: () => undefined } as never,
      'stage',
      {},
      undefined as never,
    ) as { $emit(name: string, payload?: unknown): void };
    emitServed(scope, 'agentfootprint.stream.tool_start', {
      toolName: NOT_KEPT.tool,
      toolCallId: NOT_KEPT.call,
      tools: [NOT_KEPT.stage, NOT_KEPT.run, 'alice@example.com', 'ok'],
      iteration: 1,
    });
    expect(emitted[0]).toEqual({
      toolName: SERVED_PLACEHOLDER,
      toolCallId: SERVED_PLACEHOLDER,
      tools: [SERVED_PLACEHOLDER, SERVED_PLACEHOLDER, SERVED_PLACEHOLDER, 'ok'],
      iteration: 1,
    });
  });

  it('who asked is the placeholder on the meta under any policy — named or not', () => {
    const meta = {
      runId: NOT_KEPT.run,
      runtimeStageId: 'call-llm#3',
      principal: 'alice@example.com',
      tenant: 'acme',
    } as unknown as EventMeta;
    for (const policy of [
      { keys: ['ssn'] },
      { keys: ['principal'] },
      conversationRedaction(),
    ] as RedactionPolicy[]) {
      const rule = new RedactionRule(policy);
      expect(eventServing(() => rule, true).meta(meta)).toEqual({
        ...meta,
        principal: SERVED_PLACEHOLDER,
        tenant: SERVED_PLACEHOLDER,
      });
    }
  });
});

describe('the parts of the rule', () => {
  it('the library words are the code’s own types — event types, statuses, verdicts, fixed sentences', () => {
    for (const type of ALL_EVENT_TYPES) expect(LIBRARY_WORDS[type], type).toBe(true);
    for (const word of [
      'ok',
      'err',
      'success',
      'denied',
      'stop',
      'tool_use',
      'max_tokens',
      'nothing_found',
      'stage requested pause',
      'LLM produced no tool calls — final answer',
    ]) {
      expect(LIBRARY_WORDS[word], word).toBe(true);
    }
    expect(Object.isFrozen(LIBRARY_WORDS)).toBe(true);
    expect(Object.isFrozen(FIELD_NAMES)).toBe(true);
    for (const field of ['toolName', 'status', 'role', 'toolCalls', 'af_absent', 'looked_for']) {
      expect(FIELD_NAMES[field], field).toBe(true);
    }
  });

  it('a string that is not exactly a library word is content — every adversarial variant', () => {
    for (const text of [...adversarialStrings('S'), ...NOT_WORDS, 'OK', 'ok ', ' ok', 'o​k']) {
      expect(servedString(text), JSON.stringify(text)).toBe(SERVED_PLACEHOLDER);
    }
    for (const word of WORDS) expect(servedString(word), word).toBe(word);
  });

  it('a value that is not plain data cannot be vouched for', () => {
    for (const value of [new Date(0), new Map([['a', 1]]), new Set([1]), () => 1]) {
      expect(keepKnownValues({ value })).toEqual({ value: SERVED_PLACEHOLDER });
    }
  });

  it('always a fresh copy of plain data — nothing the walk did not check rides along', () => {
    const payload = { status: 'ok', count: 2, tools: [{ status: 'ok' }] };
    const served = keepKnownValues(payload) as typeof payload;
    expect(served).toEqual(payload);
    expect(served).not.toBe(payload);
    expect(served.tools).not.toBe(payload.tools);
    // A hidden property, a symbol key, a list's extra property: not copied.
    const hidden = { status: 'ok' } as Record<string | symbol, unknown>;
    Object.defineProperty(hidden, 'note', { value: 'SSN-HIDDEN', enumerable: false });
    hidden[Symbol('s')] = 'SSN-SYMBOL';
    const list = ['ok'] as string[] & { note?: string };
    list.note = 'SSN-ON-LIST';
    const out = keepKnownValues({ hidden, list }) as Record<string, unknown>;
    expect(Object.getOwnPropertyNames(out.hidden)).toEqual(['status']);
    expect(Object.getOwnPropertySymbols(out.hidden)).toEqual([]);
    expect(Object.keys(out.list as object)).toEqual(['0']);
    expect((out.list as { note?: unknown }).note).toBeUndefined();
    // A getter is read ONCE: what it returns later never reaches the copy.
    let reads = 0;
    const twoFaced = {
      get status() {
        reads += 1;
        return reads === 1 ? 'ok' : 'SSN-SECOND-READ';
      },
    };
    const once = keepKnownValues(twoFaced) as { status: unknown };
    expect(once.status).toBe('ok');
    expect(once.status).toBe('ok');
    expect(reads).toBe(1);
    // A list whose own methods lie is read by position, never through them.
    const liar = new Proxy(['SSN-IN-LIST'], {
      get: (target, key) =>
        key === 'map' || key === 'some' ? () => ['SSN-FROM-METHOD'] : Reflect.get(target, key),
    });
    expect(keepKnownValues({ edges: liar })).toEqual({ edges: [SERVED_PLACEHOLDER] });
    // `__proto__` is never a key of the copy.
    const proto = JSON.parse('{"__proto__": {"status": "SSN-PROTO"}, "status": "ok"}') as object;
    const noProto = keepKnownValues(proto) as Record<string, unknown>;
    expect(Object.getPrototypeOf(noProto)).toBe(Object.prototype);
    expect(JSON.stringify(noProto)).not.toContain('SSN-PROTO');
  });

  it('keys that are data and not library words are kept out together, as one placeholder entry', () => {
    const served = keepKnownValues({
      withheldReasons: { 'Ada Lovelace': 3, 'Grace Hopper': 4, ok: 1, lookup: 2 },
    }) as { withheldReasons: Record<string, unknown> };
    expect(served.withheldReasons).toEqual({ ok: 1, [SERVED_PLACEHOLDER]: SERVED_PLACEHOLDER });
  });
});
