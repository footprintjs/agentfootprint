/**
 * The event registry's own classification (`src/events/content.ts` ·
 * `EVENT_CONTENT`) — what the served path reads to be DEFAULT-DENY, BY KIND.
 *
 *   - Exhaustive: every registered event type is classified, and nothing else
 *     is (compile-time too: the table is a mapped type over the registry, and
 *     every structure field at every depth is checked against its payload's
 *     own type — a verdict word's members listed exhaustively).
 *   - Consistent: a field is structure or words, never both; no structure
 *     field is a name the conversation vocabulary keeps out; every words row's
 *     sources are kept out by the vocabulary.
 *   - Default-deny by kind, GENERATED for every event type in the registry:
 *     under a policy that keeps the conversation out, a payload whose
 *     structure fits its kinds is served as it is, an undeclared field is the
 *     placeholder — and EVERY structure field, at every depth, fed a value
 *     outside its kind (text in a count, a flag, a verdict word or an id; a
 *     name nothing declared; text where a list, a record or a map belongs) is
 *     the placeholder.
 *   - No policy is byte-identical; a narrow by-name policy stays by-name.
 */
import { RedactionRule } from 'footprintjs/advanced';
import type { RedactionPolicy } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { EVENT_CONTENT, type StructureKind } from '../../src/events/content.js';
import { ALL_EVENT_TYPES } from '../../src/events/registry.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { eventServing, SERVED_PLACEHOLDER } from '../../src/redaction/served.js';
import {
  classificationOf,
  declaredNamesForTests,
  eventPayloadFor,
  kindLeaves,
  outOfKindValueOf,
  valueAtPath,
  validValueOf,
  withValueAt,
} from './fixture.js';

const serve = (policy: RedactionPolicy | undefined, type: string, payload: unknown): unknown => {
  const rule = new RedactionRule(policy);
  return eventServing(
    () => rule,
    (policy?.emitPatterns?.length ?? 0) > 0,
    declaredNamesForTests(),
  ).payload(type, payload);
};

/** The structure leaves a value can be planted at: map KEYS are names too. */
const leavesOf = (type: string) => kindLeaves(classificationOf(type).structure);

describe('the classification is exhaustive over the event registry', () => {
  it('every registered type is classified, and nothing else is', () => {
    expect(Object.keys(EVENT_CONTENT).sort()).toEqual([...ALL_EVENT_TYPES].sort());
  });

  it('the classification is frozen to the last kind', () => {
    const unfrozen: string[] = [];
    const walk = (value: unknown, at: string): void => {
      if (value === null || typeof value !== 'object') return;
      if (!Object.isFrozen(value)) unfrozen.push(at);
      for (const [key, child] of Object.entries(value as object)) walk(child, `${at}.${key}`);
    };
    walk(EVENT_CONTENT, 'EVENT_CONTENT');
    expect(unfrozen).toEqual([]);
  });
});

describe('the classification is consistent with the vocabulary', () => {
  const vocabulary = new RedactionRule(conversationRedaction());

  it('a field is structure or words, never both', () => {
    const both = ALL_EVENT_TYPES.flatMap((type) => {
      const declared = new Set(leavesOf(type).map((leaf) => leaf.path.join('.')));
      return (classificationOf(type).words ?? [])
        .flatMap((row) => row.paths)
        .filter((path) => declared.has(path))
        .map((path) => `${type} · ${path}`);
    });
    expect(both).toEqual([]);
  });

  it('no structure field is a name the vocabulary keeps out', () => {
    const named = ALL_EVENT_TYPES.flatMap((type) =>
      leavesOf(type)
        .map((leaf) => leaf.path[leaf.path.length - 1] as string)
        .filter((name) => !name.startsWith('[') && !name.startsWith('{'))
        .filter((name) => vocabulary.verdict([name]).kind !== 'clear')
        .map((name) => `${type} · ${name}`),
    );
    expect(named).toEqual([]);
  });

  it('every words row comes from a value the vocabulary keeps out', () => {
    const unsourced = ALL_EVENT_TYPES.flatMap((type) =>
      (classificationOf(type).words ?? [])
        .filter((row) => !row.from.some((name) => vocabulary.verdict([name]).kind !== 'clear'))
        .map((row) => `${type} · ${row.paths.join(',')}`),
    );
    expect(unsourced).toEqual([]);
  });
});

describe('default-deny by kind — generated for every event type in the registry', () => {
  for (const type of ALL_EVENT_TYPES) {
    describe(type, () => {
      it('structure that fits its kinds is served as it is; an undeclared field is the placeholder', () => {
        const canary = `CANARY-${type}`;
        const payload = eventPayloadFor(type, canary);
        const covered = serve(conversationRedaction(), type, payload) as Record<string, unknown>;
        expect(JSON.stringify(covered)).not.toContain(canary);
        expect(covered.__undeclared__).toBe(SERVED_PLACEHOLDER);
        const { __undeclared__: _dropped, ...structure } = covered;
        void _dropped;
        const { __undeclared__: _planted, ...expected } = payload;
        void _planted;
        expect(structure).toEqual(expected);
        // No policy: the very object, byte-identical.
        expect(serve(undefined, type, payload)).toBe(payload);
        // A narrow by-name policy stays by-name: nothing it names, nothing kept out.
        expect(serve({ keys: ['nothingNamedHere'] }, type, payload)).toEqual(payload);
      });

      const leaves = leavesOf(type);
      if (leaves.length === 0) return;
      it(`every structure field (${leaves.length}), fed a value outside its kind, is masked`, () => {
        const unmasked: string[] = [];
        for (const leaf of leaves) {
          const canary = `CANARY-${leaf.path.join('.')}`;
          const base = eventPayloadFor(type, 'undeclared');
          const planted = withValueAt(base, leaf.path, outOfKindValueOf(leaf.kind, canary));
          const covered = serve(conversationRedaction(), type, planted);
          if (JSON.stringify(covered).includes(canary)) unmasked.push(leaf.path.join('.'));
        }
        expect(unmasked).toEqual([]);
      });

      it('a value outside its kind leaves its siblings readable — masked where it is, not whole', () => {
        for (const leaf of leaves.filter((l) => !l.path.includes('{key}'))) {
          const base = eventPayloadFor(type, 'undeclared');
          const planted = withValueAt(base, leaf.path, outOfKindValueOf(leaf.kind, 'X'));
          const covered = serve(conversationRedaction(), type, planted);
          expect(valueAtPath(covered, leaf.path), leaf.path.join('.')).toBe(SERVED_PLACEHOLDER);
        }
      });
    });
  }

  it('the generator plants a fitting value for every kind', () => {
    const kinds: StructureKind[] = [
      { kind: 'count' },
      { kind: 'flag' },
      { kind: 'enum', of: { only: true } },
      { kind: 'mintedId' },
      { kind: 'declaredName', of: 'tool' },
    ];
    for (const kind of kinds) expect(validValueOf(kind)).toBeDefined();
  });

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

  it('MINOR 2 — a tool name or an argument path the model invented is content', () => {
    const start = serve(conversationRedaction(), 'agentfootprint.stream.tool_start', {
      toolName: 'lookup_SSN_123456789',
      toolCallId: 'c1',
      args: {},
    }) as Record<string, unknown>;
    expect(start.toolName).toBe(SERVED_PLACEHOLDER);
    const declared = serve(conversationRedaction(), 'agentfootprint.stream.tool_start', {
      toolName: 'declared_tool',
      toolCallId: 'c1',
    }) as Record<string, unknown>;
    expect(declared.toolName).toBe('declared_tool');
    const invalid = serve(conversationRedaction(), 'agentfootprint.validation.args_invalid', {
      toolName: 'declared_tool',
      toolCallId: 'c1',
      iteration: 1,
      issues: [
        { path: 'note_for_SSN_987654321', expected: 'nothing', got: 'string' },
        { path: 'declared_arg', expected: 'string', got: 'number' },
        { path: 'declared_arg[0].declared_arg', expected: 'string', got: 'number' },
      ],
      enforced: true,
    }) as { issues: { path: unknown }[] };
    expect(invalid.issues.map((i) => i.path)).toEqual([
      SERVED_PLACEHOLDER,
      'declared_arg',
      'declared_arg[0].declared_arg',
    ]);
    const end = serve(conversationRedaction(), 'agentfootprint.stream.tool_end', {
      toolCallId: 'c1',
      durationMs: 1,
      changedArgKeys: ['declared_arg', 'invented_SSN_1'],
    }) as { changedArgKeys: unknown[] };
    expect(end.changedArgKeys).toEqual(['declared_arg', SERVED_PLACEHOLDER]);
  });
});
