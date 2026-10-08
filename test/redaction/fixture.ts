/**
 * The shared fixture for the agent redaction suite (`src/redaction/`).
 *
 * One agent, one tool, four secrets, each living somewhere different:
 *
 *   - `user`   — free text in the person's message
 *   - `ssn`    — a tool ARGUMENT the model produced, under the field `ssn`
 *   - `email`  — a tool RESULT field, under the field `email`
 *   - `answer` — free text in the model's final answer
 *
 * `conversationPolicy()` is the library's own vocabulary
 * (`src/redaction/conversation.ts` · `conversationRedaction`) with the tool's
 * fields (`/ssn|email/i`) joined on. Under it no secret may reach any record;
 * the one named limit is the answer leaving the chart as a bare string
 * (`run.exit`'s boundary payload has no name — footprintjs serves it as it is).
 */
import type { RedactionPolicy } from 'footprintjs';

import { Agent, defineTool, type Tool } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import type { LLMProvider, LLMRequest } from '../../src/adapters/types.js';
import { EVENT_CONTENT, type EventContent } from '../../src/events/content.js';

export const SECRET = {
  user: 'SECRET-USER-7731',
  ssn: 'SECRET-SSN-4410',
  email: 'SECRET-EMAIL-9902',
  answer: 'SECRET-ANSWER-5521',
} as const;

export const ALL_SECRETS: readonly string[] = Object.values(SECRET);

/** The content-free posture: the library's conversation vocabulary, plus the tool's own fields. */
export function conversationPolicy(): RedactionPolicy {
  return conversationRedaction({ patterns: [/ssn|email/i] });
}

/**
 * The same coverage with the app's names as KEYS, for a run handed its policy
 * per run and resumed without it: a checkpoint carries a pattern only as a
 * reference to one the resuming side holds (`redaction/policy.ts` ·
 * `policyFromCarried`), while names carry as they are.
 */
export function carriedConversationPolicy(): RedactionPolicy {
  return conversationRedaction({ keys: ['ssn', 'email'] });
}

/** What a run actually handed the model and the tool — the live-input control. */
export interface LiveTaps {
  /** Every request the provider received, JSON. */
  readonly requests: string[];
  /** Every argument object the tool received. */
  readonly toolArgs: Record<string, unknown>[];
}

export function liveTaps(): LiveTaps {
  return { requests: [], toolArgs: [] };
}

/** The tool: takes `ssn`, returns `email`. */
export function lookupTool(taps?: LiveTaps): Tool {
  return defineTool<{ citizenId: string; ssn: string }, unknown>({
    name: 'lookup',
    description: 'Look a citizen up.',
    inputSchema: {
      type: 'object',
      properties: { citizenId: { type: 'string' }, ssn: { type: 'string' } },
      required: ['citizenId', 'ssn'],
    },
    execute: (args) => {
      taps?.toolArgs.push({ ...args });
      return { name: 'Ada', email: SECRET.email };
    },
  });
}

/**
 * The scripted model: call `lookup` with the ssn, then answer with the answer
 * secret. Every request it receives is recorded (the live-input control).
 */
export function scriptedProvider(taps?: LiveTaps): LLMProvider {
  const inner = mock({
    chunkDelayMs: 0,
    replies: [
      { toolCalls: [{ id: 'c1', name: 'lookup', args: { citizenId: 'c-1', ssn: SECRET.ssn } }] },
      { content: `Found them. ${SECRET.answer}` },
    ],
  });
  // Untapped: the mock itself, so the agent STREAMS the answer (token events).
  if (taps === undefined) return inner;
  // Tapped: every request is recorded; `complete` only (no `stream`).
  return {
    name: inner.name,
    complete: async (req: LLMRequest) => {
      taps.requests.push(JSON.stringify(req));
      return inner.complete(req);
    },
  } as LLMProvider;
}

/** The fixture agent. `redact` undefined = no door — the byte-identity control. */
export function fixtureAgent(opts: { redact?: RedactionPolicy; taps?: LiveTaps } = {}) {
  return Agent.create({
    provider: scriptedProvider(opts.taps),
    model: 'mock',
    maxIterations: 4,
    ...(opts.redact !== undefined && { redact: opts.redact }),
  })
    .system('You look citizens up.')
    .tool(lookupTool(opts.taps))
    .build();
}

/** The person's message, carrying the user secret. */
export const MESSAGE = `Please find citizen ${SECRET.user}.`;

/** Every JSON path in `value` whose string contains `needle`, with array indices folded. */
export function locationsOf(value: unknown, needle: string): string[] {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (node: unknown, at: string): void => {
    if (typeof node === 'string') {
      if (node.includes(needle)) out.add(at);
      return;
    }
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, `${at}.${/^\d+$/.test(key) ? '[]' : key}`);
    }
  };
  walk(value, '$');
  return [...out];
}

/**
 * `value` with the ONE named limit taken out: the run's `run.exit` boundary
 * payload — the chart's bare-string return, which has no name for a policy to
 * select (README, "Named limits"). It sits on a `run.exit` domain event
 * (`payload`) and, rebuilt into a step graph, on the run node (`primitiveKind:
 * 'Run'`, `exitPayload`). Everything else in `value` is kept, so a secret found
 * after this is a leak.
 */
export function withoutAnswerBoundary(value: unknown): unknown {
  const seen = new Map<object, unknown>();
  const copy = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') return node;
    const known = seen.get(node);
    if (known !== undefined) return known;
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      seen.set(node, out);
      for (const child of node) out.push(copy(child));
      return out;
    }
    const record = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    seen.set(node, out);
    for (const [key, child] of Object.entries(record)) {
      if (key === 'payload' && record['type'] === 'run.exit') continue;
      if (key === 'exitPayload' && record['primitiveKind'] === 'Run') continue;
      out[key] = copy(child);
    }
    return out;
  };
  return copy(value);
}

/** Assert no secret appears in `value` (with the answer's named limit removed). */
export function leaksIn(value: unknown, secrets: readonly string[] = ALL_SECRETS): string[] {
  const scrubbedOfLimit = withoutAnswerBoundary(value);
  return secrets.flatMap((secret) =>
    locationsOf(scrubbedOfLimit, secret).map((path) => `${secret} at ${path}`),
  );
}

/** The marker a structure field that CARRIES words holds beside them, at every level. */
export const INNER_MARKER = 'structure-inner';

const contentOfType = (type: string): EventContent =>
  (EVENT_CONTENT as Readonly<Record<string, EventContent>>)[type] as EventContent;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * `value` planted at `segments` in `node`, building the shape on the way
 * (`name[]` = a list of one record), with {@link INNER_MARKER} beside it at
 * every level and, when the row names its argument (`namedBy`), an unrelated
 * path there — so only the rule's own verdict can keep the value out.
 */
function plantAt(
  node: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
  namedBy: string | undefined,
): void {
  const [head, ...rest] = segments as [string, ...string[]];
  const list = head.endsWith('[]');
  const key = list ? head.slice(0, -2) : head;
  if (rest.length === 0) {
    node[key] = list ? [value] : value;
    if (namedBy !== undefined) node[namedBy] = 'unrelated.arg';
    return;
  }
  if (list) {
    if (!Array.isArray(node[key])) node[key] = [{ kind: INNER_MARKER }];
    plantAt((node[key] as Record<string, unknown>[])[0]!, rest, value, namedBy);
  } else {
    if (!isRecord(node[key])) node[key] = { kind: INNER_MARKER };
    plantAt(node[key] as Record<string, unknown>, rest, value, namedBy);
  }
}

/** The top-level fields of the registered event `type` that hold words below them. */
export function carriersOf(type: string): Set<string> {
  return new Set(
    (contentOfType(type).words ?? [])
      .flatMap((row) => row.paths)
      .filter((path) => path.includes('.'))
      .map((path) => path.split('.')[0]!.replace(/\[\]$/, '')),
  );
}

/**
 * A payload for the registered event `type`, GENERATED from its classification
 * (`src/events/content.ts` · `EVENT_CONTENT`), never listed by hand:
 * `structure(field)` in every structure field, `quote` at every words path
 * (a field that carries words holds a walkable shape with
 * {@link INNER_MARKER} beside them) and in one field the type does not declare.
 */
export function eventPayloadFor(
  type: string,
  structure: (field: string) => unknown,
  quote: unknown,
): Record<string, unknown> {
  const content = contentOfType(type);
  const payload: Record<string, unknown> = { __undeclared__: quote };
  for (const field of content.structure) payload[field] = structure(field);
  for (const row of content.words ?? []) {
    for (const path of row.paths) plantAt(payload, path.split('.'), quote, row.namedBy);
  }
  return payload;
}
