/**
 * `absent({ among })` through the real loop.
 *
 * What a run does with a named miss: a WELL-FORMED unknown value reaches the
 * tool and comes back an absence (status `'absent'`), never a refusal; a
 * SCHEMA-MALFORMED value is still refused before dispatch
 * (`tools/toolArgsValidation.ts`). The model is served the names the tool
 * read for the caller; no event FIELD carries them — `stream.tool_end` loses
 * `known_names` (`stages/toolCalls.ts` · `emitToolEnd`), `tools.absent` and
 * the `coverageDeclared` row never had it. The conversation itself — what the
 * model read, which `iteration_end.history` and the committed history copy —
 * and the messages slot's `context.injected` record copy — is the one place
 * the names live; that limit is pinned here so it cannot widen unseen.
 *
 * Sections (Convention 3): Integration (batch door, a resumed door) ·
 * Security (no event field carries a name) · Scenario (malformed vs unknown).
 */

import { describe, expect, it, vi } from 'vitest';

import { absent, Agent, ask, checkInApproved, defineTool, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';

const SOURCE = 'the PowerStore inventory export';
const INVENTORY = Array.from(
  { length: 25 },
  (_, i) => `PS-ARRAY-${String(i + 1).padStart(2, '0')}`,
);
/** A name only the nearest-names list can put in front of the model. */
const NEAREST = 'PS-ARRAY-09';

interface Run {
  readonly agent: Agent;
  readonly requests: LLMRequest[];
  readonly events: { type: string; payload: Record<string, unknown> }[];
  readonly executed: unknown[];
}

function build(args: readonly unknown[], gate = false, maxToolResultChars?: number): Run {
  const requests: LLMRequest[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const executed: unknown[] = [];
  const inner = mock({
    replies: [
      {
        toolCalls: args.map((value, i) => ({
          id: `c${i + 1}`,
          name: 'array_detail',
          args: { array_id: value },
        })),
      },
      { content: 'That name is not among the arrays in the inventory export read at 09:14.' },
    ],
  });
  const provider = {
    name: inner.name,
    complete: async (req: LLMRequest): Promise<LLMResponse> => {
      requests.push(JSON.parse(JSON.stringify(req)) as LLMRequest);
      return inner.complete(req);
    },
  };
  const tool = defineTool({
    name: 'array_detail',
    description: 'Details of one PowerStore array, by name.',
    inputSchema: {
      type: 'object',
      properties: { array_id: { type: 'string', pattern: '^PS-' } },
      required: ['array_id'],
    },
    execute: ({ array_id }: { array_id: string }) => {
      executed.push(array_id);
      if (INVENTORY.includes(array_id)) return { array_id, model: 'PowerStore 1200T' };
      return absent({
        what: array_id,
        among: {
          argument: 'array_id',
          source: SOURCE,
          measuredAt: '2026-10-22T09:14:00Z',
          count: INVENTORY.length,
          names: INVENTORY,
          visible: 'caller',
        },
      });
    },
  });
  let builder = Agent.create({
    provider,
    model: 'mock',
    ...(maxToolResultChars !== undefined && { maxToolResultChars }),
  }).tool(tool);
  if (gate) {
    builder = builder.toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'ok?' }) });
  }
  const agent = builder.build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { agent, requests, events, executed };
}

const toolMessages = (r: Run): string[] =>
  (r.requests[r.requests.length - 1]?.messages ?? [])
    .filter((m) => m.role === 'tool')
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));

const payloadsOf = (r: Run, type: string) =>
  r.events.filter((e) => e.type === type).map((e) => e.payload);

/**
 * The events that carry the conversation itself — what the model read: the
 * history at an iteration's end, and the messages slot's injection record.
 */
const CONVERSATION_CARRIERS = new Set([
  'agentfootprint.agent.iteration_end',
  'agentfootprint.context.injected',
]);

describe('integration — a well-formed unknown name is an absence, never a refusal', () => {
  it('reaches the tool, delivers status absent, and the model reads the nearest names', async () => {
    const r = build(['PS-ARRAY-99']);
    expect(await r.agent.run({ message: 'details of PS-ARRAY-99?' })).toContain('not among');
    expect(r.executed).toEqual(['PS-ARRAY-99']);
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.status).toBe('absent');
    expect(end?.error).toBeUndefined();
    const [served] = toolMessages(r);
    const read = JSON.parse(served!) as {
      known_names: { count: number; nearest: string[] };
      not_checked: unknown[];
    };
    expect(read.known_names.count).toBe(25);
    expect(read.known_names.nearest).toHaveLength(20);
    expect(read.known_names.nearest[0]).toBe(NEAREST);
    expect(read.not_checked[0]).toEqual({
      what: `names outside ${SOURCE}`,
      relevance: 'bears',
      bears: 'source',
    });
  });

  it('the coverageDeclared row carries the facet and the gap — never the names', async () => {
    const r = build(['PS-ARRAY-99']);
    await r.agent.run({ message: 'details of PS-ARRAY-99?' });
    const state = r.agent.getSnapshot()?.sharedState as {
      coverageDeclared: Record<string, unknown>[];
    };
    const [row] = state.coverageDeclared;
    expect(row).toMatchObject({
      kind: 'absence',
      toolName: 'array_detail',
      checked: [{ what: `the 25 array_id names listed in ${SOURCE}` }],
      notChecked: [{ what: `names outside ${SOURCE}`, kind: 'scope' }],
    });
    expect(JSON.stringify(row)).not.toContain(NEAREST);
    expect(JSON.stringify(row)).not.toContain('known_names');
  });
});

describe('security — no event field carries a name the tool read', () => {
  it('tool_end loses known_names on result and modelResult; tools.absent never had it', async () => {
    const r = build(['PS-ARRAY-99']);
    await r.agent.run({ message: 'details of PS-ARRAY-99?' });
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.result).not.toHaveProperty('known_names');
    expect(end?.modelResult).not.toHaveProperty('known_names');
    // The rest of the envelope rides as the tool wrote it.
    expect(end?.result).toMatchObject({ af_absent: true, looked_for: 'PS-ARRAY-99' });
    const [absence] = payloadsOf(r, 'agentfootprint.tools.absent');
    expect(absence).toBeDefined();
    expect(JSON.stringify(absence)).not.toContain('known_names');
  });

  it('only the conversation carries the names — no other event mentions one', async () => {
    const r = build(['PS-ARRAY-99']);
    await r.agent.run({ message: 'details of PS-ARRAY-99?' });
    const carrying = r.events.filter((e) => JSON.stringify(e.payload).includes(NEAREST));
    for (const e of carrying) {
      expect(CONVERSATION_CARRIERS.has(e.type), e.type).toBe(true);
      if (e.type === 'agentfootprint.context.injected') expect(e.payload.slot).toBe('messages');
    }
  });

  it('a resumed door strips the same way (an approved middleware ask)', async () => {
    const r = build(['PS-ARRAY-99'], true);
    const first = await r.agent.run({ message: 'details of PS-ARRAY-99?' });
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    await r.agent.resume(first.checkpoint, checkInApproved({ by: 'alice' }));
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.status).toBe('absent');
    expect(end?.result).not.toHaveProperty('known_names');
    expect(toolMessages(r)[0]).toContain('known_names');
  });
});

describe('security — a truncated result never carries the names to an event', () => {
  // The absence serializes to about 1,230 characters with `known_names` at
  // about 520, so a 900-character cap keeps the names inside the truncated
  // head: a cap that truncated FIRST and stripped after would ship them in a
  // string the strip cannot read.
  const CAP = 900;

  it('the event channel is stripped before it is capped; the model channel is capped as served', async () => {
    const r = build(['PS-ARRAY-99'], false, CAP);
    const logged: string[] = [];
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
        logged.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
      }),
    );
    try {
      await r.agent.run({ message: 'details of PS-ARRAY-99?' });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    // The model read a truncated head that still carries the names.
    const [served] = toolMessages(r);
    expect(JSON.parse(served!)).toMatchObject({ truncated: true });
    expect(served).toContain(NEAREST);
    // tool_end carries a truncated head too — of the STRIPPED envelope.
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.result).toMatchObject({ truncated: true });
    expect(JSON.stringify(end?.result)).toContain('looked_for');
    expect(JSON.stringify(end?.result)).not.toContain(NEAREST);
    expect(JSON.stringify(end?.modelResult ?? null)).not.toContain(NEAREST);
    // No event outside the conversation carries a name; no log line does.
    for (const e of r.events.filter((x) => JSON.stringify(x.payload).includes(NEAREST))) {
      expect(CONVERSATION_CARRIERS.has(e.type), e.type).toBe(true);
    }
    for (const line of logged) expect(line).not.toContain(NEAREST);
    // The narrative SAYS no name the tool read. (An entry's `rawValue` is a
    // live reference to the state it describes — the conversation: history,
    // `lastToolResult`, `toolResults` — the one copy the names live in.)
    const narrative = r.agent.getLastNarrativeEntries();
    expect(narrative.length).toBeGreaterThan(0);
    for (const entry of narrative) expect(entry.text).not.toContain(NEAREST);
  });
});

describe('scenario — a schema-malformed value still refuses before dispatch', () => {
  it('the malformed call never runs; its refusal names no absence and no names', async () => {
    const r = build([42, 'PS-ARRAY-99']);
    await r.agent.run({ message: 'details of 42 and PS-ARRAY-99?' });
    expect(r.executed).toEqual(['PS-ARRAY-99']);
    const [refused, absence] = toolMessages(r);
    expect(refused).toContain('the call was not executed');
    expect(refused).not.toContain('af_absent');
    expect(refused).not.toContain('known_names');
    expect(absence).toContain('"af_absent":true');
  });
});
