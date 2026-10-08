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
import { FIELD_NAMES, servedString } from '../../src/redaction/knownStrings.js';

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

/**
 * Every string in `value` that the value-kind rule must NOT let through: not
 * a library word (`src/redaction/knownStrings.ts`), not the placeholder —
 * keys included. The rule's own assertion, for any served record.
 */
export function unknownStringsIn(value: unknown): string[] {
  const out = new Set<string>();
  const seen = new Set<unknown>();
  const check = (text: string): void => {
    if (servedString(text) !== text) out.add(text);
  };
  const walk = (node: unknown): void => {
    if (typeof node === 'string') return check(node);
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (!Object.prototype.hasOwnProperty.call(FIELD_NAMES, key)) check(key);
      walk(child);
    }
  };
  walk(value);
  return [...out];
}

/**
 * Strings an app's configuration would name — a tool, an argument path, a
 * skill, an agent — and ids the library mints: the (c) and (b) this release
 * does NOT keep (`src/redaction/knownStrings.ts`). Under a policy, each is the
 * placeholder like any other string.
 */
export const NOT_KEPT = Object.freeze({
  tool: 'lookup',
  argument: 'customer.ssn',
  skill: 'billing',
  config: 'agent-under-test',
  run: 'run-1791438565771-3',
  stage: 'sf-tools/call-llm#12',
  call: 'call-1',
});

/**
 * Strings an attacker would try against a closed set of words: a prefix, an
 * extension, a case variant, a homoglyph, a trailing space, a zero-width
 * character, a non-NFC spelling, an over-long string, an injected path
 * segment — and strings shaped like the ids the library mints. None of them
 * is a library word.
 */
export function adversarialStrings(secret: string): readonly string[] {
  return [
    `said ${secret}`,
    secret,
    `${NOT_KEPT.tool}_${secret}`,
    NOT_KEPT.tool.slice(0, 3),
    `${NOT_KEPT.tool}x`,
    NOT_KEPT.tool.toUpperCase(),
    'l\u043eokup', // Cyrillic о
    `${NOT_KEPT.tool} `,
    ` ${NOT_KEPT.tool}`,
    `${NOT_KEPT.tool}\u200b`,
    `look\u200bup`,
    'billing\u0301', // combining mark — not NFC-identical
    'bi\u0301lling',
    'x'.repeat(300),
    `customer.${secret}.ssn`,
    `customer.ssn.${secret}`,
    'customer[x].ssn',
    'customer..ssn',
    `run-1-1 ${secret}`,
    `stage#1 ${secret}`,
    // Shaped like a minted id, minted by no one in this run: content.
    `${secret}#0`,
    `sf-tools/${secret}#1`,
    'sf-tools/call-llm#13',
    'call-llm#0',
    'run-1791438565771-4',
    'run-1-1',
    'call-2',
    'toolu_01AbCdEf',
  ];
}
