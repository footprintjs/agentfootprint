/**
 * serializeTrace + redactContent — UI-free, JSON-lossless run snapshot.
 *
 * Convention-3 types (pure functions → these are the load-bearing four;
 * integration lives in local-observability.test.ts):
 *   - Unit:        Trace shape, defaults, label; redactContent per field.
 *   - Functional:  redact runs per event; summary/capturedAt pass through.
 *   - Property:    output length == input; JSON round-trips losslessly.
 *   - Security:    redactContent leaves NO raw content in the serialized JSON,
 *                  across EVERY content-bearing event (incl. subflow payloads).
 */

import { describe, expect, it } from 'vitest';

import {
  serializeTrace,
  redactContent,
  type Trace,
} from '../../../src/recorders/observability/trace.js';
import type { DomainEvent } from '../../../src/recorders/observability/BoundaryRecorder.js';

const base = {
  subflowPath: ['__root__'] as const,
  depth: 0,
  ts: 1000,
  commitIdxBefore: 0,
  commitIdxAfter: 0,
};

const SECRET = 'ssn 123-45-6789';

/** One event per content surface, each carrying SECRET. */
function fixtureEvents(): DomainEvent[] {
  return [
    {
      ...base,
      runtimeStageId: '__root__#0',
      type: 'run.entry',
      isRoot: true,
      payload: { q: SECRET },
    },
    {
      ...base,
      runtimeStageId: 'sf#1',
      type: 'subflow.entry',
      subflowId: 'sf-x',
      localSubflowId: 'sf-x',
      subflowName: 'X',
      isAgentInternal: false,
      payload: { in: SECRET },
    },
    {
      ...base,
      runtimeStageId: 'call-llm#2',
      type: 'llm.end',
      content: `Here is the ${SECRET}`,
      toolCallCount: 1,
      usage: { input: 1200, output: 80 },
      actorArrow: 'llm→tool',
    },
    {
      ...base,
      runtimeStageId: 'tool#3',
      type: 'tool.start',
      toolName: 'lookup',
      toolCallId: 't1',
      args: { u: SECRET },
    },
    {
      ...base,
      runtimeStageId: 'tool#3',
      type: 'tool.end',
      toolCallId: 't1',
      result: { v: SECRET },
      durationMs: 12,
    },
    {
      ...base,
      runtimeStageId: 'ctx#4',
      type: 'context.injected',
      slot: 'system-prompt',
      source: 'memory',
      contentSummary: SECRET,
    },
    {
      ...base,
      runtimeStageId: 'sf#1',
      type: 'subflow.exit',
      subflowId: 'sf-x',
      localSubflowId: 'sf-x',
      subflowName: 'X',
      isAgentInternal: false,
      payload: { out: SECRET },
    },
    {
      ...base,
      runtimeStageId: '__root__#0',
      type: 'run.exit',
      isRoot: true,
      payload: { answer: SECRET },
    },
  ];
}

describe('serializeTrace — unit', () => {
  it('produces a versioned Trace with events passed through and no stored graph', () => {
    const events = fixtureEvents();
    const trace = serializeTrace(events);
    expect(trace.version).toBe(1);
    expect(trace.events).toHaveLength(events.length);
    expect('finalGraph' in trace).toBe(false); // graph is derived at render, never stored
  });

  it('defaults redaction to "none" and returns a fresh (detached) events array', () => {
    const events = fixtureEvents();
    const trace = serializeTrace(events);
    expect(trace.redaction).toBe('none');
    expect(trace.events).not.toBe(events);
  });

  it('omits optional fields when not supplied', () => {
    const trace = serializeTrace([]);
    expect(trace.summary).toBeUndefined();
    expect(trace.capturedAtMs).toBeUndefined();
  });
});

describe('redactContent — unit (per content surface)', () => {
  it('markers every content field and leaves non-content events identical', () => {
    const events = fixtureEvents();
    const out = events.map(redactContent);
    // llm.end content → length marker
    const llmEnd = out.find((e) => e.type === 'llm.end') as Extract<
      DomainEvent,
      { type: 'llm.end' }
    >;
    expect(llmEnd.content).toMatch(/^\[\d+ chars\]$/);
    // every event's JSON is secret-free
    for (const e of out) expect(JSON.stringify(e)).not.toContain(SECRET);
  });

  it('returns the SAME reference for events with no content (cheap)', () => {
    const e: DomainEvent = {
      ...base,
      runtimeStageId: 'llm#0',
      type: 'llm.start',
      model: 'm',
      provider: 'p',
      actorArrow: 'user→llm',
    };
    expect(redactContent(e)).toBe(e);
  });
});

describe('serializeTrace — functional', () => {
  it('runs redact once per event and labels redaction "pii" by default', () => {
    let count = 0;
    const trace = serializeTrace(fixtureEvents(), {
      redact: (e) => {
        count += 1;
        return e;
      },
    });
    expect(count).toBe(8);
    expect(trace.redaction).toBe('pii');
  });

  it('passes summary + capturedAtMs + redactionLabel through', () => {
    const trace = serializeTrace(fixtureEvents(), {
      summary: { tokens: { input: 1200, output: 80 }, llmCalls: 1, toolCalls: 1, durationMs: 42 },
      capturedAtMs: 1_700_000_000_000,
      redactionLabel: 'policy',
      redact: (e) => e,
    });
    expect(trace.summary).toEqual({
      tokens: { input: 1200, output: 80 },
      llmCalls: 1,
      toolCalls: 1,
      durationMs: 42,
    });
    expect(trace.capturedAtMs).toBe(1_700_000_000_000);
    expect(trace.redaction).toBe('policy');
  });
});

describe('serializeTrace — property', () => {
  it('preserves event count for any input length', () => {
    for (const n of [0, 1, 5, 50]) {
      const events = Array.from({ length: n }, (_, i) => ({
        ...base,
        runtimeStageId: `s#${i}`,
        type: 'tool.start' as const,
        toolName: `t${i}`,
        toolCallId: `c${i}`,
      }));
      expect(serializeTrace(events).events).toHaveLength(n);
    }
  });

  it('JSON round-trips losslessly (no Map/Date surprises)', () => {
    const trace = serializeTrace(fixtureEvents(), {
      redact: redactContent,
      summary: { tokens: { input: 1, output: 2 }, llmCalls: 1, toolCalls: 1 },
      capturedAtMs: 123,
    });
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });
});

describe('serializeTrace — security', () => {
  it('redactContent leaves NO raw content anywhere in the serialized JSON', () => {
    const trace = serializeTrace(fixtureEvents(), { redact: redactContent });
    expect(JSON.stringify(trace)).not.toContain(SECRET); // covers run/subflow payloads, llm, tool, context
    expect(trace.redaction).toBe('pii');
  });

  it('does not mutate the caller-owned live events', () => {
    const events = fixtureEvents();
    const llmEnd = events[2];
    serializeTrace(events, { redact: redactContent });
    expect(events[2]).toBe(llmEnd);
    expect((events[2] as { content?: string }).content).toBe(`Here is the ${SECRET}`);
  });

  it('a NARROW redact (one event type) still leaks — proving you need full coverage', () => {
    // Documents the footgun: redacting only llm.end leaves run/subflow payloads exposed.
    const trace = serializeTrace(fixtureEvents(), {
      redact: (e) => (e.type === 'llm.end' ? { ...e, content: '[x]' } : e),
    });
    expect(JSON.stringify(trace)).toContain(SECRET); // → use redactContent, not a narrow fn
  });
});

// Type sanity: Trace is JSON-serializable.
const _t: Trace = serializeTrace([]);
void _t;
