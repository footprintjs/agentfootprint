/**
 * Every input shape a typed event's payload can take, through the one served
 * path (`src/redaction/served.ts` · `eventServing`) — what is kept out, and
 * what is DECLARED as passing through (`src/redaction/README.md`, "Named
 * limits"), so a change in either direction is noticed.
 *
 * The verdict is always footprintjs's `RedactionRule` (the one owner): this
 * file pins that served.ts hands every shape to it, and where the rule itself
 * cannot see (a Map, a Set, an Error's `cause`, a key it does not enumerate, a
 * `toJSON` that writes a name the object holds privately), the gap is named
 * there — never filled by a second walk here. Under `conversationRedaction()`
 * a tool's result is kept out WHOLE (`result`), so those shapes only bite a
 * policy that names a single field.
 */
import { RedactionRule } from 'footprintjs/advanced';
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { eventServing, SERVED_PLACEHOLDER } from '../../src/redaction/served.js';

const TYPE = 'agentfootprint.stream.tool_end';
const SECRET = 'SECRET-1234';

function served(policy: RedactionPolicy, payload: unknown): unknown {
  const rule = new RedactionRule(policy);
  return eventServing(() => rule, (policy.emitPatterns?.length ?? 0) > 0).payload(TYPE, payload);
}

/** Whether the secret survives in the served payload, read the way a consumer would. */
function reachable(value: unknown): boolean {
  const seen = new Set<unknown>();
  const visit = (v: unknown): boolean => {
    if (v === SECRET) return true;
    if (typeof v === 'string') return v.includes(SECRET);
    if (v === null || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    if (v instanceof Map) return [...v].some(([k, x]) => visit(k) || visit(x));
    if (v instanceof Set) return [...v].some(visit);
    const own = Reflect.ownKeys(v).map((k) => (v as Record<PropertyKey, unknown>)[k]);
    if (v instanceof Error && visit((v as Error & { cause?: unknown }).cause)) return true;
    return own.some(visit);
  };
  return visit(value);
}

describe('kept out — every shape the rule walks', () => {
  const ssn = { keys: ['ssn'] };
  const cases: Record<string, unknown> = {
    'a top-level key': { ssn: SECRET },
    'a nested key': { result: { customer: { ssn: SECRET } } },
    'an array element': { result: [{ ssn: SECRET }] },
    'nested arrays': { result: [[{ ssn: SECRET }]] },
    'a class instance': {
      result: new (class Row {
        ssn = SECRET;
      })(),
    },
    'a null-prototype object': { result: Object.assign(Object.create(null), { ssn: SECRET }) },
    'a frozen object': { result: Object.freeze({ ssn: SECRET }) },
  };
  for (const [name, payload] of Object.entries(cases)) {
    it(name, () => expect(reachable(served(ssn, payload))).toBe(false));
  }

  it('a shared reference — at every path that holds it', () => {
    const shared = { ssn: SECRET };
    const out = served(ssn, { a: shared, b: shared }) as {
      a: { ssn: unknown };
      b: { ssn: unknown };
    };
    expect(out.a.ssn).toBe(SERVED_PLACEHOLDER);
    expect(out.b.ssn).toBe(SERVED_PLACEHOLDER);
  });

  it('a cycle — the edge lands on the served copy, never the original', () => {
    const node: Record<string, unknown> = { ssn: SECRET };
    node.self = node;
    expect(reachable(served(ssn, { result: node }))).toBe(false);
  });

  it('a key a pattern matches, a dotted path, a declared field', () => {
    expect(reachable(served({ patterns: [/^s.n$/] }, { result: { ssn: SECRET } }))).toBe(false);
    expect(
      reachable(
        served(
          { patterns: [/^result\.customer\.ssn$/] },
          { result: { customer: { ssn: SECRET } } },
        ),
      ),
    ).toBe(false);
    expect(
      reachable(served({ fields: { customer: ['ssn'] } }, { x: { customer: { ssn: SECRET } } })),
    ).toBe(false);
  });

  it('case variants, when the policy asks for them — a pattern with the `i` flag', () => {
    expect(reachable(served({ patterns: [/^ssn$/i] }, { SSN: SECRET, Ssn: SECRET }))).toBe(false);
  });

  it('an event selected by NAME is the placeholder whole', () => {
    expect(served({ emitPatterns: [/tool_end$/] }, { anything: SECRET })).toBe(SERVED_PLACEHOLDER);
  });

  it('a payload the rule cannot read (a throwing getter) is the placeholder whole — fail closed', () => {
    const hostile = {
      get ssn(): string {
        throw new Error('no');
      },
    };
    expect(served(ssn, { result: hostile })).toBe(SERVED_PLACEHOLDER);
  });
});

describe('DECLARED — what passes through, by footprintjs’s law (README, "Named limits")', () => {
  const ssn = { keys: ['ssn'] };

  it('a name is matched exactly: another case, another script, another name', () => {
    expect(reachable(served(ssn, { SSN: SECRET }))).toBe(true);
    expect(reachable(served(ssn, { ｓｓｎ: SECRET }))).toBe(true);
    expect(reachable(served(ssn, { socialSecurityNumber: SECRET }))).toBe(true);
  });

  it('text has no name: a value inside a string, JSON in a string, an error message', () => {
    expect(reachable(served(ssn, { result: `ssn is ${SECRET}` }))).toBe(true);
    expect(reachable(served(ssn, { result: JSON.stringify({ ssn: SECRET }) }))).toBe(true);
  });

  it('what the rule does not enumerate: a Map, a Set, an Error’s cause, a non-enumerable key', () => {
    expect(reachable(served(ssn, { result: new Map([['ssn', SECRET]]) }))).toBe(true);
    expect(reachable(served(ssn, { result: new Set([{ ssn: SECRET }]) }))).toBe(true);
    expect(reachable(served(ssn, { result: new Error('x', { cause: { ssn: SECRET } }) }))).toBe(
      true,
    );
    const hidden = {};
    Object.defineProperty(hidden, 'ssn', { value: SECRET, enumerable: false });
    expect(reachable(served(ssn, { result: hidden }))).toBe(true);
  });

  it('a `toJSON` that writes a name the object holds privately reaches the JSON of the record', () => {
    class Citizen {
      readonly #ssn = SECRET;
      toJSON(): unknown {
        return { ssn: this.#ssn };
      }
    }
    const out = served(ssn, { result: new Citizen() });
    expect(JSON.stringify(out)).toContain(SECRET);
  });

  it('…and all of it is kept out when the policy names the value that carries it', () => {
    class Citizen {
      readonly #ssn = SECRET;
      toJSON(): unknown {
        return { ssn: this.#ssn };
      }
    }
    for (const result of [
      new Map([['ssn', SECRET]]),
      new Error('x', { cause: { ssn: SECRET } }),
      `ssn is ${SECRET}`,
      new Citizen(),
    ]) {
      const out = served({ keys: ['result'] }, { result });
      expect(reachable(out)).toBe(false);
      expect(JSON.stringify(out)).not.toContain(SECRET);
    }
  });
});
