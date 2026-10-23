/**
 * `absent({ among })` through the real loop.
 *
 * What a run does with a named miss: a WELL-FORMED unknown value reaches the
 * tool and comes back an absence (status `'absent'`), never a refusal; a
 * SCHEMA-MALFORMED value is still refused before dispatch
 * (`tools/toolArgsValidation.ts`).
 *
 * The names a tool read for the caller are NEVER part of the result: the mint
 * keeps them on a library-owned channel keyed by the envelope it returned
 * (`coverage/among.ts` · `knownNamesFor`), so the after-tool middleware, every
 * event (`stream.tool_end`'s `result` and `modelResult`, `tools.absent`), the
 * ledger and the `coverageDeclared` row see a result that never held them —
 * whatever a middleware does to it. They are attached in ONE place, the
 * model-bound message (`stages/toolCalls.ts` · `messageTextOf`), after every
 * middleware, the placement and the cap, and only when no after-tool rule
 * denied the result. The conversation — that message, which history,
 * `iteration_end.history`, the messages slot's `context.injected` and a
 * narrative entry's `rawValue` copy — is the one place they live; that limit
 * is pinned here so it cannot widen unseen.
 *
 * Sections (Convention 3): Integration (batch door, a resumed door) ·
 * Security (middleware that stringifies, wraps or denies; truncation; a seeded
 * property over JSON-ish middleware transforms — no fast-check in the tree) ·
 * Scenario (malformed vs unknown).
 */

import { describe, expect, it, vi } from 'vitest';

import {
  absent,
  Agent,
  allow,
  ask,
  checkInApproved,
  defineTool,
  deny,
  isPaused,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';
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
  /** What each after-tool rule was handed, as JSON. */
  readonly ruleSaw: string[];
}

interface Options {
  readonly gate?: boolean;
  readonly maxToolResultChars?: number;
  /** An after-tool rule over the result (its return is the rule's outcome). */
  readonly onToolResult?: (result: unknown) => unknown;
}

function build(args: readonly unknown[], options: Options = {}): Run {
  const requests: LLMRequest[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const executed: unknown[] = [];
  const ruleSaw: string[] = [];
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
    ...(options.maxToolResultChars !== undefined && {
      maxToolResultChars: options.maxToolResultChars,
    }),
  }).tool(tool);
  if (options.gate === true) {
    builder = builder.toolMiddleware({ name: 'gate', onToolCall: () => ask({ question: 'ok?' }) });
  }
  const rule = options.onToolResult;
  if (rule !== undefined) {
    builder = builder.toolMiddleware({
      name: 'rule',
      onToolResult: (call) => {
        ruleSaw.push(JSON.stringify(call.result) ?? String(call.result));
        return rule(call.result) as ReturnType<typeof allow>;
      },
    });
  }
  const agent = builder.build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { agent, requests, events, executed, ruleSaw };
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

/** Run, capturing every console line. */
async function runLogged(r: Run, message: string): Promise<string[]> {
  const logged: string[] = [];
  const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...parts: unknown[]) => {
      logged.push(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '));
    }),
  );
  try {
    await r.agent.run({ message });
  } finally {
    for (const spy of spies) spy.mockRestore();
  }
  return logged;
}

/**
 * The law: no name outside the conversation. No event field, no log line, no
 * narrative sentence, nothing an after-tool rule was handed, and nothing on
 * the ledger rows names one.
 */
function expectNamesOnlyInTheConversation(r: Run, logged: readonly string[]): void {
  for (const e of r.events.filter((x) => JSON.stringify(x.payload).includes(NEAREST))) {
    expect(CONVERSATION_CARRIERS.has(e.type), e.type).toBe(true);
    if (e.type === 'agentfootprint.context.injected') expect(e.payload.slot).toBe('messages');
  }
  for (const end of payloadsOf(r, 'agentfootprint.stream.tool_end')) {
    expect(JSON.stringify(end)).not.toContain(NEAREST);
    expect(JSON.stringify(end)).not.toContain('known_names');
  }
  for (const line of logged) expect(line).not.toContain(NEAREST);
  for (const seen of r.ruleSaw) expect(seen).not.toContain(NEAREST);
  for (const entry of r.agent.getLastNarrativeEntries()) expect(entry.text).not.toContain(NEAREST);
  const state = r.agent.getSnapshot()?.sharedState as Record<string, unknown>;
  expect(JSON.stringify(state.coverageDeclared ?? null)).not.toContain(NEAREST);
  expect(JSON.stringify(state.toolCallLedger ?? null)).not.toContain(NEAREST);
}

/** The names the model read, from its last request. */
const namesTheModelRead = (r: Run): boolean => toolMessages(r).some((m) => m.includes(NEAREST));

describe('integration — a well-formed unknown name is an absence, never a refusal', () => {
  it('reaches the tool, delivers status absent, and the model reads the nearest names', async () => {
    const r = build(['PS-ARRAY-99']);
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
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
    expectNamesOnlyInTheConversation(r, logged);
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

  it('a resumed door attaches the same way (an approved middleware ask)', async () => {
    const r = build(['PS-ARRAY-99'], { gate: true });
    const first = await r.agent.run({ message: 'details of PS-ARRAY-99?' });
    expect(isPaused(first)).toBe(true);
    if (!isPaused(first)) return;
    await r.agent.resume(
      first.checkpoint,
      checkInApproved({ request: pausedRequest(first), by: 'alice' }),
    );
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.status).toBe('absent');
    expect(JSON.stringify(end)).not.toContain(NEAREST);
    expect(namesTheModelRead(r)).toBe(true);
  });
});

describe('security — no middleware can carry the names to an event', () => {
  it('a rule that turns the result into JSON text: the names reach the model, not the event', async () => {
    const r = build(['PS-ARRAY-99'], {
      onToolResult: (result) => allow(JSON.stringify(result), 'as text'),
    });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(typeof end?.modelResult).toBe('string');
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesTheModelRead(r)).toBe(true);
  });

  it('a rule that wraps the result in another object: the same', async () => {
    const r = build(['PS-ARRAY-99'], {
      onToolResult: (result) => allow({ wrapped: result, by: 'rule' }, 'wrapped'),
    });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.modelResult).toMatchObject({ by: 'rule' });
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesTheModelRead(r)).toBe(true);
  });

  it('a rule that denies the result: the model is served no names either', async () => {
    const r = build(['PS-ARRAY-99'], { onToolResult: () => deny('not for the model') });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesTheModelRead(r)).toBe(false);
  });

  it('a capped result: the event never held the names, and the model keeps them', async () => {
    // The absence serializes to about 900 characters; a 600-character cap
    // truncates it, and the names are attached after the cap.
    const r = build(['PS-ARRAY-99'], { maxToolResultChars: 600 });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(end?.result).toMatchObject({ truncated: true });
    expectNamesOnlyInTheConversation(r, logged);
    const [served] = toolMessages(r);
    expect(JSON.parse(served!)).toMatchObject({ truncated: true });
    expect(served).toContain(NEAREST);
  });
});

// ── Property — a seeded generator over JSON-ish middleware transforms ────

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Transform = { readonly name: string; readonly apply: (v: unknown) => unknown };

/** One JSON-ish thing a rule may do to a result. */
const TRANSFORMS: readonly Transform[] = [
  { name: 'identity', apply: (v) => v },
  { name: 'stringify', apply: (v) => JSON.stringify(v) },
  { name: 'pretty', apply: (v) => JSON.stringify(v, null, 2) },
  { name: 'clone', apply: (v) => JSON.parse(JSON.stringify(v ?? null)) as unknown },
  { name: 'wrap', apply: (v) => ({ data: v }) },
  { name: 'list', apply: (v) => [v, 'tail'] },
  {
    name: 'spread',
    apply: (v) => (typeof v === 'object' && v !== null ? { ...v, note2: 'x' } : v),
  },
  { name: 'pick', apply: (v) => (typeof v === 'object' && v !== null ? Object.values(v)[3] : v) },
  { name: 'replace', apply: () => ({ summary: 'nothing matched' }) },
  { name: 'prefix', apply: (v) => `rule says: ${typeof v === 'string' ? v : JSON.stringify(v)}` },
];

describe('property — whatever a rule does to the result, the names never reach an event', () => {
  it('60 generated rule chains', async () => {
    const next = rng(20261023);
    for (let n = 0; n < 60; n++) {
      const chain = Array.from(
        { length: 1 + Math.floor(next() * 3) },
        () => TRANSFORMS[Math.floor(next() * TRANSFORMS.length)]!,
      );
      const denies = next() < 0.15;
      const r = build(['PS-ARRAY-99'], {
        onToolResult: (result) =>
          denies
            ? deny('withheld by a rule')
            : allow(
                chain.reduce((v, t) => t.apply(v), result),
                chain.map((t) => t.name).join(' > '),
              ),
      });
      const logged = await runLogged(r, 'details of PS-ARRAY-99?');
      expectNamesOnlyInTheConversation(r, logged);
      // The model still receives them — unless the rule denied the result.
      expect(namesTheModelRead(r), chain.map((t) => t.name).join(' > ')).toBe(!denies);
    }
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
