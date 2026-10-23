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
  type ToolResultContext,
  type ToolResultOutcome,
} from '../../../src/index.js';
import { conversationRedaction } from '../../../src/doors/security.js';
import { mock } from '../../../src/llm-providers.js';
import { servedToModel } from '../../../src/semantics/coverage/read.js';
import { pausedRequest } from '../../helpers/pausedRequest.js';
import type { LLMRequest, LLMResponse } from '../../../src/provider-contract/types.js';

const SOURCE = 'the PowerStore inventory export';
const INVENTORY = Array.from(
  { length: 25 },
  (_, i) => `PS-ARRAY-${String(i + 1).padStart(2, '0')}`,
);
/** A name only the nearest-names list can put in front of the model. */
const NEAREST = 'PS-ARRAY-09';

const declarationFor = (arrayId: string) => ({
  what: arrayId,
  among: {
    argument: 'array_id',
    source: SOURCE,
    measuredAt: '2026-10-22T09:14:00Z',
    count: INVENTORY.length,
    names: INVENTORY,
    visible: 'caller' as const,
  },
});

interface Run {
  readonly agent: Agent;
  readonly requests: LLMRequest[];
  readonly events: { type: string; payload: Record<string, unknown> }[];
  readonly executed: unknown[];
  /** What each after-tool rule was handed, as JSON. */
  readonly ruleSaw: string[];
  /** The names each after-tool rule was handed beside the result. */
  readonly ruleNames: unknown[];
}

interface Options {
  readonly gate?: boolean;
  readonly maxToolResultChars?: number;
  /** An after-tool rule (its return is the rule's outcome). */
  readonly onToolResult?: (call: ToolResultContext) => ToolResultOutcome;
  /** The agent's redaction policy. */
  readonly redact?: ReturnType<typeof conversationRedaction>;
}

function build(args: readonly unknown[], options: Options = {}): Run {
  const requests: LLMRequest[] = [];
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const executed: unknown[] = [];
  const ruleSaw: string[] = [];
  const ruleNames: unknown[] = [];
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
      return absent(declarationFor(array_id));
    },
  });
  let builder = Agent.create({
    provider,
    model: 'mock',
    ...(options.maxToolResultChars !== undefined && {
      maxToolResultChars: options.maxToolResultChars,
    }),
    ...(options.redact !== undefined && { redact: options.redact }),
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
        ruleNames.push(call.knownNames);
        return rule(call);
      },
    });
  }
  const agent = builder.build();
  agent.on('*', (e) =>
    events.push({ type: e.type, payload: e.payload as unknown as Record<string, unknown> }),
  );
  return { agent, requests, events, executed, ruleSaw, ruleNames };
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

/** The `known_names` block the model read, parsed from its tool message. */
function namesBlockOf(r: Run): { count: number; nearest?: string[]; omitted?: number } | undefined {
  const [message] = toolMessages(r);
  if (message === undefined) return undefined;
  const line = message.lastIndexOf('\n\nknown_names: ');
  if (line !== -1) return JSON.parse(message.slice(line + 15)) as never;
  const find = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null) return undefined;
    const rec = v as Record<string, unknown>;
    if (rec.known_names !== undefined) return rec.known_names;
    for (const inner of Object.values(rec)) {
      const hit = find(inner);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  try {
    return find(JSON.parse(message)) as never;
  } catch {
    return undefined;
  }
}

describe("security — (1) the names are the rules' to keep, narrow or drop", () => {
  it('a rule is handed the names beside the result, never inside it', async () => {
    const r = build(['PS-ARRAY-99'], { onToolResult: () => allow() });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [names] = r.ruleNames as { nearest: string[] }[];
    expect(names?.nearest[0]).toBe(NEAREST);
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesBlockOf(r)?.nearest).toHaveLength(20);
  });

  it('a rule that narrows the names: the model reads only what it kept', async () => {
    const r = build(['PS-ARRAY-99'], {
      onToolResult: (call) =>
        allow(undefined, 'one name is enough', {
          knownNames: { count: call.knownNames!.count, nearest: [NEAREST] },
        }),
    });
    await runLogged(r, 'details of PS-ARRAY-99?');
    expect(namesBlockOf(r)).toEqual({ count: 25, nearest: [NEAREST] });
  });

  it('a rule that drops the names: the model reads none', async () => {
    const r = build(['PS-ARRAY-99'], {
      onToolResult: () => allow(undefined, 'no names here', { knownNames: null }),
    });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesTheModelRead(r)).toBe(false);
  });
});

describe('security — (2) a rewritten result keeps no names unless the rule says so', () => {
  it('JSON text, not kept: no names, and no event names one', async () => {
    const r = build(['PS-ARRAY-99'], {
      onToolResult: (call) => allow(JSON.stringify(call.result), 'as text'),
    });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [end] = payloadsOf(r, 'agentfootprint.stream.tool_end');
    expect(typeof end?.modelResult).toBe('string');
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesTheModelRead(r)).toBe(false);
  });

  it('JSON text, kept: the names follow the text on one line', async () => {
    const r = build(['PS-ARRAY-99'], {
      onToolResult: (call) =>
        allow(JSON.stringify(call.result), 'as text', { knownNames: call.knownNames! }),
    });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    expectNamesOnlyInTheConversation(r, logged);
    expect(toolMessages(r)[0]).toContain('\n\nknown_names: ');
    expect(namesBlockOf(r)?.nearest?.[0]).toBe(NEAREST);
  });

  it('wrapped, not kept: no names; wrapped, kept: beside the wrapper', async () => {
    const dropped = build(['PS-ARRAY-99'], {
      onToolResult: (call) => allow({ wrapped: call.result, by: 'rule' }, 'wrapped'),
    });
    const loggedDropped = await runLogged(dropped, 'details of PS-ARRAY-99?');
    expect(payloadsOf(dropped, 'agentfootprint.stream.tool_end')[0]?.modelResult).toMatchObject({
      by: 'rule',
    });
    expectNamesOnlyInTheConversation(dropped, loggedDropped);
    expect(namesTheModelRead(dropped)).toBe(false);

    const kept = build(['PS-ARRAY-99'], {
      onToolResult: (call) =>
        allow({ wrapped: call.result, by: 'rule' }, 'wrapped', { knownNames: call.knownNames! }),
    });
    const loggedKept = await runLogged(kept, 'details of PS-ARRAY-99?');
    expectNamesOnlyInTheConversation(kept, loggedKept);
    expect(JSON.parse(toolMessages(kept)[0]!)).toMatchObject({ by: 'rule' });
    expect(namesBlockOf(kept)?.nearest?.[0]).toBe(NEAREST);
  });

  it('the served result handed back unchanged keeps its names', async () => {
    const r = build(['PS-ARRAY-99'], { onToolResult: (call) => allow(call.result, 'checked') });
    await runLogged(r, 'details of PS-ARRAY-99?');
    expect(namesTheModelRead(r)).toBe(true);
  });

  it('a rule that denies the result: no names', async () => {
    const r = build(['PS-ARRAY-99'], { onToolResult: () => deny('not for the model') });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    expectNamesOnlyInTheConversation(r, logged);
    expect(namesTheModelRead(r)).toBe(false);
  });
});

describe('security — (3) the names count against maxToolResultChars', () => {
  /** The served envelope's own text — what the cap measures before any name. */
  const servedLength = JSON.stringify(servedToModel(absent(declarationFor('PS-ARRAY-99')))).length;

  it('the list is trimmed to fit, never the result, and says how many were left out', async () => {
    const cap = servedLength + 120;
    const r = build(['PS-ARRAY-99'], { maxToolResultChars: cap });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [message] = toolMessages(r);
    expect(message!.length).toBeLessThanOrEqual(cap);
    const read = JSON.parse(message!) as Record<string, unknown>;
    expect(read.truncated).toBeUndefined(); // the result itself was not cut
    expect(read.af_absent).toBe(true);
    const block = namesBlockOf(r)!;
    expect(block.nearest!.length).toBeGreaterThan(0);
    expect(block.nearest!.length).toBeLessThan(20);
    expect(block.omitted).toBe(20 - block.nearest!.length);
    expect(block.nearest![0]).toBe(NEAREST);
    expectNamesOnlyInTheConversation(r, logged);
  });

  it('no room for even the count: no names, and the result untouched', async () => {
    const cap = servedLength + 5;
    const r = build(['PS-ARRAY-99'], { maxToolResultChars: cap });
    await runLogged(r, 'details of PS-ARRAY-99?');
    const [message] = toolMessages(r);
    expect(message).toBe(JSON.stringify(servedToModel(absent(declarationFor('PS-ARRAY-99')))));
    expect(namesTheModelRead(r)).toBe(false);
  });

  it('a result the cap truncated: the names follow the marker, within the cap', async () => {
    const r = build(['PS-ARRAY-99'], { maxToolResultChars: 600 });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    const [message] = toolMessages(r);
    expect(message!.length).toBeLessThanOrEqual(600);
    expect(JSON.parse(message!)).toMatchObject({ truncated: true });
    expectNamesOnlyInTheConversation(r, logged);
  });
});

describe('security — (4) under a redact policy the names are kept out with the result', () => {
  it('conversationRedaction(): no record names one; the model still reads them', async () => {
    const r = build(['PS-ARRAY-99'], { redact: conversationRedaction() });
    const logged = await runLogged(r, 'details of PS-ARRAY-99?');
    for (const e of r.events) expect(JSON.stringify(e.payload), e.type).not.toContain(NEAREST);
    expect(JSON.stringify(r.agent.getLastSnapshot())).not.toContain(NEAREST);
    expect(JSON.stringify(r.agent.getLastNarrativeEntries())).not.toContain(NEAREST);
    for (const line of logged) expect(line).not.toContain(NEAREST);
    expect(namesTheModelRead(r)).toBe(true);
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
      const roll = next();
      const denies = roll < 0.15;
      const keeps = roll > 0.6;
      let unchanged = false;
      const r = build(['PS-ARRAY-99'], {
        onToolResult: (call) => {
          if (denies) return deny('withheld by a rule');
          const value = chain.reduce((v, t) => t.apply(v), call.result);
          unchanged = value === call.result;
          const why = chain.map((t) => t.name).join(' > ');
          return keeps ? allow(value, why, { knownNames: call.knownNames! }) : allow(value, why);
        },
      });
      const logged = await runLogged(r, 'details of PS-ARRAY-99?');
      expectNamesOnlyInTheConversation(r, logged);
      // The model reads them only when the rule let them through: it kept
      // them, or handed the served result back unchanged — never on a denial.
      const label = `${chain.map((t) => t.name).join(' > ')} keeps=${keeps} denies=${denies}`;
      expect(namesTheModelRead(r), label).toBe(!denies && (keeps || unchanged));
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
