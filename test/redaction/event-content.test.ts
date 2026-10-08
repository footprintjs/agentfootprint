/**
 * The event registry's own classification (`src/events/content.ts` ·
 * `EVENT_CONTENT`) — what the served path reads to be DEFAULT-DENY.
 *
 *   - Exhaustive: every registered event type is classified, and nothing else
 *     is (compile-time too: the table is a mapped type over the registry, and
 *     each structure name is checked against its payload's own fields).
 *   - Consistent: a field is structure OR words, never both; no structure
 *     field is a name the conversation vocabulary keeps out; every words row's
 *     sources are kept out by the vocabulary.
 *   - Default-deny: under a policy that keeps the conversation out, every
 *     top-level field an event type does not declare structure is served as
 *     the placeholder, and every words path inside a structure field is too —
 *     generated for EVERY event type, plus a type the registry does not know.
 *   - No policy is byte-identical; a narrow by-name policy stays by-name.
 */
import { RedactionRule } from 'footprintjs/advanced';
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { EVENT_CONTENT, type EventContent } from '../../src/events/content.js';
import { ALL_EVENT_TYPES } from '../../src/events/registry.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { eventServing, SERVED_PLACEHOLDER } from '../../src/redaction/served.js';
import { carriersOf, eventPayloadFor, INNER_MARKER } from './fixture.js';

const serve = (policy: RedactionPolicy | undefined, type: string, payload: unknown): unknown => {
  const rule = new RedactionRule(policy);
  return eventServing(() => rule, (policy?.emitPatterns?.length ?? 0) > 0).payload(type, payload);
};

const contentOf = (type: string): EventContent =>
  (EVENT_CONTENT as Readonly<Record<string, EventContent>>)[type] as EventContent;

describe('the classification is exhaustive over the event registry', () => {
  it('every registered type is classified, and nothing else is', () => {
    expect(Object.keys(EVENT_CONTENT).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it('the classification is frozen to the last list', () => {
    expect(Object.isFrozen(EVENT_CONTENT)).toBe(true);
    for (const type of ALL_EVENT_TYPES) {
      const content = contentOf(type);
      expect(Object.isFrozen(content) && Object.isFrozen(content.structure), type).toBe(true);
      for (const row of content.words ?? []) {
        expect(
          Object.isFrozen(row) && Object.isFrozen(row.paths) && Object.isFrozen(row.from),
        ).toBe(true);
      }
    }
  });

  it('no structure list names a field twice', () => {
    for (const type of ALL_EVENT_TYPES) {
      const structure = contentOf(type).structure;
      expect(new Set(structure).size, type).toBe(structure.length);
    }
  });
});

describe('the classification is consistent with the vocabulary', () => {
  const vocabulary = new RedactionRule(conversationRedaction());

  it('a field is structure or words, never both', () => {
    const both = ALL_EVENT_TYPES.flatMap((type) => {
      const structure = new Set<string>(contentOf(type).structure);
      return (contentOf(type).words ?? [])
        .flatMap((row) => row.paths)
        .filter((path) => structure.has(path))
        .map((path) => `${type} · ${path}`);
    });
    expect(both).toEqual([]);
  });

  it('no structure field is a name the vocabulary keeps out', () => {
    const named = ALL_EVENT_TYPES.flatMap((type) =>
      contentOf(type)
        .structure.filter((field) => vocabulary.verdict([field]).kind !== 'clear')
        .map((field) => `${type} · ${field}`),
    );
    expect(named).toEqual([]);
  });

  it('every words row comes from a value the vocabulary keeps out', () => {
    const unsourced = ALL_EVENT_TYPES.flatMap((type) =>
      (contentOf(type).words ?? [])
        .filter((row) => !row.from.some((name) => vocabulary.verdict([name]).kind !== 'clear'))
        .map((row) => `${type} · ${row.paths.join(',')}`),
    );
    expect(unsourced).toEqual([]);
  });
});

describe('default-deny — generated for every event type in the registry', () => {
  for (const type of ALL_EVENT_TYPES) {
    it(type, () => {
      const canary = `CANARY-${type}`;
      const payload = eventPayloadFor(type, (field) => `structure-${field}`, canary);
      const carriers = carriersOf(type);
      // Under the vocabulary: no canary, undeclared or quoted; structure stays.
      const covered = serve(conversationRedaction(), type, payload) as Record<string, unknown>;
      expect(JSON.stringify(covered)).not.toContain(canary);
      expect(covered.__undeclared__).toBe(SERVED_PLACEHOLDER);
      for (const field of contentOf(type).structure) {
        if (carriers.has(field)) {
          // Its own structure stays readable; only the words below it go.
          expect(covered[field], field).not.toBe(SERVED_PLACEHOLDER);
          expect(JSON.stringify(covered[field]), field).toContain(INNER_MARKER);
        } else {
          expect(covered[field], field).toEqual(payload[field]);
        }
      }
      // No policy: the very object, byte-identical.
      expect(serve(undefined, type, payload)).toBe(payload);
      // A narrow by-name policy stays by-name: nothing it names, nothing kept out.
      expect(serve({ keys: ['nothingNamedHere'] }, type, payload)).toEqual(payload);
    });
  }

  it('a type the registry does not know (an app’s own) is content in every field', () => {
    const payload = { latencyMs: 12, customer: { name: 'Ada' } };
    expect(serve(conversationRedaction(), 'app.custom', payload)).toEqual({
      latencyMs: SERVED_PLACEHOLDER,
      customer: SERVED_PLACEHOLDER,
    });
    // …and a payload that is not a record is kept out whole.
    expect(serve(conversationRedaction(), 'app.custom', 'Ada said hi')).toBe(SERVED_PLACEHOLDER);
  });

  it('a type string that names an Object.prototype member is not classified by it', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(serve(conversationRedaction(), type, { x: 1 }), type).toEqual({
        x: SERVED_PLACEHOLDER,
      });
    }
  });
});
