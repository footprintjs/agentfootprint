/**
 * The fixture reducer and the declarations validator.
 *
 *   - REDUCER (M10): keeps every event at its index (a pointer in a golden lands
 *     on the event the archived recording holds), keeps only the state keys the
 *     account reads, blanks injection bodies and token text, and is IDEMPOTENT —
 *     the checked-in fixture is its own fixed point. A secret scan runs on it.
 *   - DECLARATIONS: a caller error throws, by name; a valid set passes through.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { accountForAnswer } from '../../../src/lib/answer-account/account.js';
import { validateDeclarations } from '../../../src/lib/answer-account/declarations.js';
import type { AnswerAccountDeclarations } from '../../../src/lib/answer-account/types.js';
// @ts-expect-error — a plain .mjs script, no types
import { reduceRecording } from './fixtures/reduce-recording.mjs';
import { fixtureA, HERE } from './helpers.js';

describe('the fixture reducer', () => {
  it('is idempotent — the checked-in fixture is its own fixed point', () => {
    const text = readFileSync(resolve(HERE, 'fixtures/turn2.recorded.json'), 'utf8');
    expect(`${JSON.stringify(reduceRecording(JSON.parse(text)), null, 1)}\n`).toBe(text);
  });

  it('keeps every event at its index; blanks bodies; keeps only the state the account reads', () => {
    const raw = {
      meta: { origin: { runId: 'r1' } },
      snapshot: {
        runId: 'x',
        commitLog: [1],
        sharedState: {
          history: [],
          userMessage: 'q',
          turnNumber: 1,
          resolvedInstructions: 'APP PROMPT',
          dynamicToolSchemas: [1],
        },
      },
      events: [
        {
          type: 'agentfootprint.context.injected',
          payload: {
            slot: 'system-prompt',
            rawContent: 'SKILL BODY',
            contentSummary: 'SKILL',
            reason: 'why',
          },
          meta: {},
        },
        { type: 'agentfootprint.stream.token', payload: { content: 'tok' }, meta: {} },
        {
          type: 'agentfootprint.stream.llm_start',
          payload: { tools: [{ name: 't', description: 'APP TOOL DOC' }] },
          meta: {},
        },
      ],
      structure: { big: true },
    };
    const reduced = reduceRecording(raw);
    expect(reduced.events).toHaveLength(3);
    expect(Object.keys(reduced.snapshot.sharedState).sort()).toEqual([
      'history',
      'turnNumber',
      'userMessage',
    ]);
    const text = JSON.stringify(reduced);
    for (const secret of ['SKILL BODY', 'APP PROMPT', 'APP TOOL DOC', '"tok"', 'commitLog'])
      expect(text).not.toContain(secret);
  });

  it('secret scan — no key, token or password shape in the checked-in fixture', () => {
    const text = readFileSync(resolve(HERE, 'fixtures/turn2.recorded.json'), 'utf8');
    for (const shape of [
      /sk-[A-Za-z0-9]{16,}/,
      /AKIA[0-9A-Z]{16}/,
      /ghp_[A-Za-z0-9]{20,}/,
      /xox[bap]-[A-Za-z0-9-]{10,}/,
      /Bearer\s+[A-Za-z0-9._-]{16,}/,
      /password\s*[:=]/i,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ]) {
      expect(shape.test(text), String(shape)).toBe(false);
    }
  });
});

describe('the declarations', () => {
  const bad = (d: unknown) => () => validateDeclarations(d as AnswerAccountDeclarations);

  it('a valid set passes through; none is {}', () => {
    const d: AnswerAccountDeclarations = {
      id: 'neo',
      version: '1',
      skills: { a: { label: 'a report' } },
      tools: { t: { rowsAt: 'volumes' } },
      routing: { appDecides: true },
    };
    expect(validateDeclarations(d)).toBe(d);
    expect(validateDeclarations(undefined)).toEqual({});
  });

  it.each([
    ['an unknown top-level key', { colour: 'red' }, /unknown key "colour"/],
    ['an unknown skill key', { skills: { a: { title: 'x' } } }, /unknown key "title" in skills.a/],
    ['an empty label', { skills: { a: { label: '  ' } } }, /non-empty/],
    ['a label over 60 characters', { skills: { a: { label: 'x'.repeat(61) } } }, /over 60/],
    ['a two-line label', { skills: { a: { label: 'a\nb' } } }, /one line/],
    ['a nested rowsAt', { tools: { t: { rowsAt: 'data.rows' } } }, /top-level key/],
    ['a pointer rowsAt', { tools: { t: { rowsAt: '/rows' } } }, /top-level key/],
    ['an empty rowsAt', { tools: { t: { rowsAt: '' } } }, /non-empty key/],
    ['a non-boolean appDecides', { routing: { appDecides: 'yes' } }, /boolean/],
  ])('refuses %s, by name', (_label, d, message) => {
    expect(bad(d)).toThrow(message);
  });

  it('the account throws only on a caller error — never on content', () => {
    expect(() => accountForAnswer(null as never)).toThrow(TypeError);
    expect(() => accountForAnswer(fixtureA(), { colour: 'red' } as never)).toThrow(/unknown key/);
    expect(() => accountForAnswer({ events: 'not a list', snapshot: 7 } as never)).not.toThrow();
    expect(() => accountForAnswer({} as never)).not.toThrow();
  });
});
