/**
 * `artifacts.*` commentary — the claim-check lifecycle, read as prose.
 *
 * Every hop of a ref (minted, presented, resolved, expired, refused) already
 * lands on the record as it happens; before this batch the Story Lens rendered
 * all five raw, so a reader saw `{"ref":"…","bytes":42000,…}` where a sentence
 * belonged.
 *
 * The two laws these tests exist to hold:
 *
 *   1. META ONLY. A sentence may say how big an artifact was and what kind it
 *      was. It may never carry the payload — and it does not print the ref
 *      either, which is an identifier for the DETAILS panel, not something a
 *      person reads. Sizes are humanized ("41.0 KB"), never raw byte counts.
 *   2. ABSENT FIELD → ABSENT CLAUSE. `label`, `parentRefs` and `tool` are all
 *      optional on these payloads (the last one because a redemption can come
 *      through the hosting door instead of a tool call, 9.23.0). A missing
 *      field must leave a sentence that is shorter, never one with a hole or an
 *      invented actor in it.
 */

import { describe, expect, it } from 'vitest';

import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';

function ev(type: string, payload: Record<string, unknown>): AgentfootprintEvent {
  return { type, payload, meta: {} } as unknown as AgentfootprintEvent;
}

function line(event: AgentfootprintEvent): string {
  const key = selectCommentaryKey(event);
  expect(typeof key).toBe('string');
  const vars = extractCommentaryVars(event, { appName: 'Acme' });
  return renderCommentary(defaultCommentaryTemplates[key as string] ?? '', vars);
}

// ── minted ────────────────────────────────────────────────────────────

describe('artifacts.minted commentary', () => {
  const base = {
    ref: 'af-artifact://run-1/a1',
    kind: 'dataset/rows',
    mediaType: 'application/json',
    bytes: 42_000,
    tool: 'check_in_rows',
  };

  it('names the tool, the label, the kind and a humanized size', () => {
    expect(line(ev('agentfootprint.artifacts.minted', { ...base, label: '400-zone table' }))).toBe(
      '`check_in_rows` checked “400-zone table” (dataset/rows, 41.0 KB) into the store — ' +
        'the model got a one-line ticket, not the data.',
    );
  });

  it('falls back to the kind when the mint carried no label', () => {
    expect(line(ev('agentfootprint.artifacts.minted', base))).toBe(
      '`check_in_rows` checked a dataset/rows artifact (41.0 KB) into the store — ' +
        'the model got a one-line ticket, not the data.',
    );
  });

  it('says what it was built from when the mint declared parents', () => {
    const text = line(
      ev('agentfootprint.artifacts.minted', {
        ...base,
        label: '400-zone table',
        parentRefs: ['af-artifact://run-1/p1', 'af-artifact://run-1/p2'],
      }),
    );
    expect(text).toContain(', built from 2 earlier artifacts —');
  });

  it('says "1 earlier artifact", singular, for a single parent', () => {
    const text = line(
      ev('agentfootprint.artifacts.minted', {
        ...base,
        parentRefs: ['af-artifact://run-1/p1'],
      }),
    );
    expect(text).toContain(', built from 1 earlier artifact —');
  });

  it('omits the derivation clause entirely when there are no parents', () => {
    expect(line(ev('agentfootprint.artifacts.minted', base))).not.toContain('built from');
  });

  it('never prints the ref or the digest', () => {
    const text = line(
      ev('agentfootprint.artifacts.minted', {
        ...base,
        digest: 'sha-256:deadbeef',
        label: '400-zone table',
      }),
    );
    expect(text).not.toContain('af-artifact://');
    expect(text).not.toContain('sha-256');
    expect(text).not.toContain('42000');
  });
});

// ── presented ─────────────────────────────────────────────────────────

describe('artifacts.presented commentary', () => {
  const presented = (label?: string): AgentfootprintEvent =>
    ev('agentfootprint.artifacts.presented', {
      ref: 'af-artifact://run-1/a1',
      as: 'bar-chart',
      snapshot: {
        kind: 'chart/spec',
        mediaType: 'application/json',
        bytes: 2048,
        ...(label !== undefined && { label }),
      },
      toolCallId: 'call-1',
      iteration: 2,
    });

  it('says what was handed to the screen and how it is to be shown', () => {
    expect(line(presented('Q3 sales by region'))).toBe(
      'The model handed “Q3 sales by region” (chart/spec, 2.0 KB) to the screen to show as ' +
        '`bar-chart` — the screen fetches the data itself.',
    );
  });

  it('falls back to the kind when the snapshot carried no label', () => {
    expect(line(presented())).toBe(
      'The model handed a chart/spec artifact (2.0 KB) to the screen to show as `bar-chart` — ' +
        'the screen fetches the data itself.',
    );
  });
});

// ── resolved ──────────────────────────────────────────────────────────

describe('artifacts.resolved commentary', () => {
  it('`head` reads as describing without paying for the data', () => {
    expect(
      line(
        ev('agentfootprint.artifacts.resolved', {
          ref: 'af-artifact://run-1/a1',
          via: 'head',
          kind: 'dataset/rows',
          bytes: 42_000,
          tool: 'describe_rows',
        }),
      ),
    ).toBe(
      '`describe_rows` looked up what a ticket describes — a dataset/rows artifact (41.0 KB) — ' +
        'without reading the data.',
    );
  });

  it('`get` reads as redeeming the ticket', () => {
    expect(
      line(
        ev('agentfootprint.artifacts.resolved', {
          ref: 'af-artifact://run-1/a1',
          via: 'get',
          kind: 'dataset/rows',
          bytes: 42_000,
          tool: 'read_rows',
        }),
      ),
    ).toBe('`read_rows` redeemed a ticket and read the dataset/rows artifact (41.0 KB).');
  });

  it('a hosting-door redemption names no tool — and invents none', () => {
    const text = line(
      ev('agentfootprint.artifacts.resolved', {
        ref: 'af-artifact://run-1/a1',
        via: 'get',
        kind: 'chart/spec',
        bytes: 2048,
      }),
    );
    expect(text).toBe(
      'The app itself (not a tool) redeemed a ticket and read the chart/spec artifact (2.0 KB).',
    );
    expect(text).not.toContain('``');
  });
});

// ── refused ───────────────────────────────────────────────────────────

describe('artifacts.refused commentary', () => {
  it('names the door and why it said no', () => {
    expect(
      line(
        ev('agentfootprint.artifacts.refused', {
          op: 'get',
          reason: 'missing-or-expired',
          ref: 'af-artifact://run-1/a1',
          tool: 'read_rows',
        }),
      ),
    ).toBe(
      '`read_rows` was refused reading an artifact — the ticket named nothing this run can ' +
        'still read.',
    );
  });

  it('a storeless agent gets the fail-closed teaching, through the hosting door', () => {
    expect(line(ev('agentfootprint.artifacts.refused', { op: 'head', reason: 'no-store' }))).toBe(
      'The app itself (not a tool) was refused describing an artifact — this agent has no ' +
        'artifact store attached.',
    );
  });

  it('a dispatch refusal says the tool never ran', () => {
    expect(
      line(
        ev('agentfootprint.artifacts.refused', {
          op: 'dispatch',
          reason: 'kind-mismatch',
          tool: 'render_chart',
        }),
      ),
    ).toBe(
      '`render_chart` never ran — the artifact it asked for could not be delivered (the ticket ' +
        'pointed at a different kind of artifact than the tool asked for), and the model was ' +
        'told what it can ask for instead.',
    );
  });

  it('a dispatch refusal with no tool named keeps the generic sentence', () => {
    const text = line(
      ev('agentfootprint.artifacts.refused', { op: 'dispatch', reason: 'invalid-input' }),
    );
    expect(text).toBe(
      'The app itself (not a tool) was refused delivering an artifact a tool asked for — the ' +
        'request was not well formed.',
    );
  });

  it('never leaks the thrown refusal detail into prose', () => {
    const text = line(
      ev('agentfootprint.artifacts.refused', {
        op: 'get',
        reason: 'digest-mismatch',
        tool: 'read_rows',
        detail: 'token=SECRET-123 failed integrity check',
      }),
    );
    expect(text).not.toContain('SECRET-123');
    expect(text).toContain('did not match the checksum');
  });

  it('an unknown reason says so rather than leaving a hole', () => {
    const text = line(
      ev('agentfootprint.artifacts.refused', { op: 'get', reason: 'from-a-later-build' }),
    );
    expect(text).toContain('the store did not say why in words this build knows');
  });
});

// ── expired ───────────────────────────────────────────────────────────

describe('artifacts.expired commentary', () => {
  it('says why it left and who noticed', () => {
    expect(
      line(
        ev('agentfootprint.artifacts.expired', {
          ref: 'af-artifact://run-1/a1',
          reason: 'ttl',
          kind: 'dataset/rows',
          bytes: 1_048_576,
          tool: 'check_in_rows',
        }),
      ),
    ).toBe(
      'A dataset/rows artifact (1.0 MB) left the store because the lifetime stated when it was ' +
        'checked in ran out, noticed while `check_in_rows` was checking something in — a ticket ' +
        'for it no longer resolves.',
    );
  });

  it('omits the "noticed while" clause when no tool is named', () => {
    const text = line(
      ev('agentfootprint.artifacts.expired', {
        ref: 'af-artifact://run-1/a1',
        reason: 'max-bytes',
        kind: 'dataset/rows',
        bytes: 900,
      }),
    );
    expect(text).toBe(
      'A dataset/rows artifact (900 bytes) left the store to keep the store inside its size ' +
        'budget — a ticket for it no longer resolves.',
    );
    expect(text).not.toContain('noticed while');
  });

  it('a count-budget sweep says which budget', () => {
    expect(
      line(
        ev('agentfootprint.artifacts.expired', {
          ref: 'af-artifact://run-1/a1',
          reason: 'max-count',
          kind: 'chart/spec',
          bytes: 2048,
          tool: 'check_in_rows',
        }),
      ),
    ).toContain('to keep the store inside its count budget');
  });
});

// ── anti-drift ────────────────────────────────────────────────────────

describe('routing anti-drift', () => {
  const routed: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['agentfootprint.artifacts.minted', { kind: 'k', bytes: 1, tool: 't', ref: 'r' }],
    [
      'agentfootprint.artifacts.presented',
      { ref: 'r', as: 'table', snapshot: { kind: 'k', mediaType: 'm', bytes: 1 } },
    ],
    ['agentfootprint.artifacts.resolved', { ref: 'r', via: 'head', kind: 'k', bytes: 1 }],
    ['agentfootprint.artifacts.resolved', { ref: 'r', via: 'get', kind: 'k', bytes: 1 }],
    ['agentfootprint.artifacts.expired', { ref: 'r', reason: 'ttl', kind: 'k', bytes: 1 }],
    ['agentfootprint.artifacts.refused', { op: 'get', reason: 'no-store' }],
    ['agentfootprint.artifacts.refused', { op: 'dispatch', reason: 'no-store', tool: 't' }],
    [
      'agentfootprint.tools.result_refused',
      { toolName: 't', toolCallId: 'c', iteration: 1, sizeChars: 2, maxChars: 1 },
    ],
    [
      'agentfootprint.tools.repeated_call',
      {
        toolName: 't',
        toolCallId: 'c',
        iteration: 1,
        occurrences: 2,
        argsFingerprint: 'a',
        resultFingerprint: 'b',
      },
    ],
  ];

  it('every newly routed event resolves to a key that actually exists', () => {
    for (const [type, payload] of routed) {
      const key = selectCommentaryKey(ev(type, payload));
      expect(key, type).toBeTypeOf('string');
      expect(defaultCommentaryTemplates[key as string], `${type} → ${String(key)}`).toBeDefined();
    }
  });

  it('every rendered sentence is complete — no unsubstituted placeholders', () => {
    for (const [type, payload] of routed) {
      expect(line(ev(type, payload)), type).not.toMatch(/\{\{/);
    }
  });

  it('an event with no template still falls through to the caller’s humanizer', () => {
    // `undefined` (fall through, render raw) — NOT `null` (deliberate skip).
    expect(
      selectCommentaryKey(
        ev('agentfootprint.tools.discovery_failed', { providerName: 'p', error: 'e' }),
      ),
    ).toBeUndefined();
  });
});
