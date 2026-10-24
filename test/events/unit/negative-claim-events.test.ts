/** The prose warning is a bounded projection of filed findings, never answer content. */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import {
  ALL_EVENT_TYPES,
  EVENT_NAMES,
  type AgentfootprintEventMap,
  type Payloads,
} from '../../../src/events.js';
import { recordFindings, type FindingsScope } from '../../../src/core/agent/findings/ledger.js';
import type { NegativeProseFinding } from '../../../src/core/agent/findings/types.js';
import { noPolicyScope } from '../../helpers/noPolicy.js';
import { eventServing, SERVED_PLACEHOLDER } from '../../../src/redaction/served.js';

const EVENT = 'agentfootprint.findings.negative_claim';

function fixture() {
  const events: { name: string; payload: unknown }[] = [];
  const scope: FindingsScope = noPolicyScope({
    $emit(name: string, payload?: unknown) {
      events.push({ name, payload });
    },
  });
  return { scope, events };
}

type ClaimFinding = Extract<NegativeProseFinding, { readonly kind: 'negative-claim' }>;

function claim(overrides: Partial<ClaimFinding> = {}): ClaimFinding {
  return {
    kind: 'negative-claim',
    iteration: 3,
    field: '/summary',
    span: { start: 4, end: 12 },
    claim: 'none',
    phraseId: 'en.none.no-matches',
    packVersion: '1',
    notes: ['coverage-gap'],
    results: ['native-result-1'],
    ...overrides,
  };
}

describe('negative prose warning event', () => {
  it('keeps the no-read code under selected redaction without exposing private content', () => {
    const { scope, events } = fixture();
    recordFindings(
      scope,
      [
        Object.assign(
          {
            kind: 'negative-claim-note' as const,
            iteration: 1,
            field: '/private-customer-field',
            span: { start: 0, end: 27 },
            code: 'no-read' as const,
            packVersion: 'private-custom-pack',
          },
          { candidate: 'private candidate answer', toolValue: 'private tool content' },
        ),
      ],
      { turn: 1 },
    );
    const raw = events[0].payload;
    const serving = eventServing(() => new RedactionRule({ keys: ['history'] }), true);
    const served = serving.payload(EVENT, raw);
    expect(served).toMatchObject({
      kind: 'negative-claim-note',
      code: 'no-read',
      iteration: 1,
      turn: 1,
      span: { start: 0, end: 27 },
      field: SERVED_PLACEHOLDER,
      packVersion: SERVED_PLACEHOLDER,
    });
    expect(JSON.stringify(served)).not.toContain('private');
    expect(raw).toMatchObject({ field: '/private-customer-field' });
    expect(raw).not.toHaveProperty('candidate');
    expect(raw).not.toHaveProperty('toolValue');

    // A known library word still obeys an explicit selection of its own key.
    const selected = eventServing(() => new RedactionRule({ keys: ['code'] }), true);
    expect(selected.payload(EVENT, raw)).toMatchObject({ code: SERVED_PLACEHOLDER });
  });

  it('is registered and exported through the public events door', () => {
    expect(EVENT_NAMES.findings.negative_claim).toBe(EVENT);
    expect(ALL_EVENT_TYPES.filter((type) => type === EVENT)).toHaveLength(1);
    expectTypeOf<
      AgentfootprintEventMap[typeof EVENT]['payload']
    >().toEqualTypeOf<Payloads.FindingsNegativeClaimPayload>();
  });

  it('emits once for each filed claim and unread-unit note, with stamps and no values', () => {
    const { scope, events } = fixture();
    const row = Object.assign(
      claim({
        candidates: ['private customer label'],
        staleSince: { turn: 1, readAt: 'private read instant' },
      }),
      { answer: 'private answer text', toolValue: 'private result value' },
    );
    recordFindings(
      scope,
      [
        row,
        {
          kind: 'negative-claim-note',
          iteration: 3,
          field: '/summary',
          span: { start: 15, end: 21 },
          code: 'in-code-block',
          packVersion: '1',
          phraseId: 'en.none.no-matches',
        },
      ],
      { turn: 2 },
    );
    expect(events).toEqual([
      {
        name: EVENT,
        payload: {
          kind: 'negative-claim',
          iteration: 3,
          turn: 2,
          field: '/summary',
          span: { start: 4, end: 12 },
          claim: 'none',
          phraseId: 'en.none.no-matches',
          packVersion: '1',
          notes: ['coverage-gap'],
          results: ['native-result-1'],
        },
      },
      {
        name: EVENT,
        payload: {
          kind: 'negative-claim-note',
          iteration: 3,
          turn: 2,
          field: '/summary',
          span: { start: 15, end: 21 },
          code: 'in-code-block',
          packVersion: '1',
          phraseId: 'en.none.no-matches',
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('private');
    expect(scope.findingsLedger).toHaveLength(2);
  });

  it('includes a zero-note claim without inventing a pass or enforcement decision', () => {
    const { scope, events } = fixture();
    recordFindings(scope, [claim({ notes: [], results: [] })], { turn: 1 });
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ kind: 'negative-claim', notes: [], results: [] });
    expect(events[0].payload).not.toHaveProperty('passed');
    expect(events[0].payload).not.toHaveProperty('decision');
  });

  it('detaches arrays and span from the filed row before emission', () => {
    const { scope, events } = fixture();
    const span = { start: 1, end: 10 };
    const notes: ('coverage-gap' | 'record-incomplete')[] = ['coverage-gap'];
    const results = ['native-result-1'];
    recordFindings(scope, [claim({ span, notes, results })], { turn: 1 });
    span.end = 100;
    notes.push('record-incomplete');
    results.push('native-result-2');
    expect(events[0].payload).toMatchObject({
      span: { start: 1, end: 10 },
      notes: ['coverage-gap'],
      results: ['native-result-1'],
    });
    expect(structuredClone(events)).toEqual(events);
  });

  it('bounds metadata and marks omissions without shortening native reference identities', () => {
    const { scope, events } = fixture();
    const results = ['x'.repeat(257), ...Array.from({ length: 40 }, (_, i) => `native-${i}`)];
    recordFindings(
      scope,
      [
        claim({
          field: '/'.repeat(5000),
          phraseId: 'p'.repeat(200),
          packVersion: 'v'.repeat(200),
          notes: Array.from({ length: 40 }, () => 'coverage-gap' as const),
          results,
        }),
      ],
      { turn: 1 },
    );
    const payload = events[0].payload as Payloads.FindingsNegativeClaimPayload;
    expect(payload.truncated).toBe(true);
    expect(payload.field).toHaveLength(4096);
    expect(payload.phraseId).toHaveLength(128);
    expect(payload.packVersion).toHaveLength(128);
    expect(payload.kind).toBe('negative-claim');
    if (payload.kind !== 'negative-claim') throw new Error('expected claim event');
    expect(payload.notes).toHaveLength(32);
    expect(payload.results).toEqual(results.slice(1, 32));
    expect(JSON.stringify(payload).length).toBeLessThan(16_000);
    expect(scope.findingsLedger?.[0]).toMatchObject({ results });
  });

  it('does not bypass the ordinary fail-closed event serving boundary', () => {
    const events: unknown[] = [];
    const scope: FindingsScope = {
      $emit(_name: string, payload?: unknown) {
        events.push(payload);
      },
    };
    recordFindings(scope, [claim()], { turn: 1 });
    expect(events).toEqual(['[REDACTED]']);
    expect(scope.findingsLedger).toHaveLength(1);
  });
});
