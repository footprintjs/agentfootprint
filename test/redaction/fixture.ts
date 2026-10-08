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
import {
  EVENT_CONTENT,
  type ClassifiedContent,
  type StructureKind,
} from '../../src/events/content.js';
import { RunNames } from '../../src/redaction/names.js';

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
 * The names a generated payload's `declaredName` fields hold — declared to the
 * serving under test (`declaredNamesForTests`), one per space.
 */
export const DECLARED = Object.freeze({
  tool: 'declared_tool',
  argument: 'declared_arg',
  skill: 'declared-skill',
  config: 'declared-config',
});

/** A names registry that declares exactly {@link DECLARED}. */
export function declaredNamesForTests(): RunNames {
  return new RunNames({
    tool: [DECLARED.tool],
    argument: [DECLARED.argument],
    skill: [DECLARED.skill],
    config: [DECLARED.config],
  });
}

/** The classification of a registered type, as the served path reads it. */
export const classificationOf = (type: string): ClassifiedContent =>
  (EVENT_CONTENT as unknown as Readonly<Record<string, ClassifiedContent>>)[
    type
  ] as ClassifiedContent;

/** A value that FITS `kind` — its declared names from {@link DECLARED}. */
export function validValueOf(kind: StructureKind): unknown {
  switch (kind.kind) {
    case 'count':
      return 3;
    case 'flag':
      return true;
    case 'enum':
      return Object.keys(kind.of)[0];
    case 'mintedId':
      return 'id_7f3c';
    case 'declaredName':
      return DECLARED[kind.of];
    case 'list':
      return [validValueOf(kind.of)];
    case 'record':
      return Object.fromEntries(
        Object.entries(kind.fields as Record<string, StructureKind>).map(([field, inner]) => [
          field,
          validValueOf(inner),
        ]),
      );
    case 'map':
      return { [validValueOf(kind.key) as string]: validValueOf(kind.value) };
    case 'anyOf':
      return validValueOf(kind.of[0] as StructureKind);
  }
}

/**
 * A value OUTSIDE `kind`, carrying `canary` — text where a number, a flag, a
 * verdict word or an id belongs; a name nothing declared; text where a list,
 * a record or a map belongs.
 */
export function outOfKindValueOf(kind: StructureKind, canary: string): unknown {
  switch (kind.kind) {
    case 'count':
    case 'flag':
    case 'enum':
    case 'mintedId':
    case 'list':
    case 'record':
    case 'map':
    case 'anyOf':
      return `said ${canary} in free text`;
    case 'declaredName':
      // One token, like a name — but one nothing declared.
      return `invented_${canary}`;
  }
}

/** One leaf of a classification: its path from the payload root, and its kind. */
export interface KindLeaf {
  /** Field names, `[]` for a list's element, `{key}` for a map key, `{value}` for a map value. */
  readonly path: readonly string[];
  readonly kind: StructureKind;
}

/** Every leaf kind of `structure`, at every depth. */
export function kindLeaves(structure: Readonly<Record<string, StructureKind>>): KindLeaf[] {
  const out: KindLeaf[] = [];
  const walk = (kind: StructureKind, path: readonly string[]): void => {
    out.push({ path, kind });
    if (kind.kind === 'list') walk(kind.of, [...path, '[]']);
    else if (kind.kind === 'record') {
      for (const [field, inner] of Object.entries(kind.fields as Record<string, StructureKind>)) {
        walk(inner, [...path, field]);
      }
    } else if (kind.kind === 'map') {
      out.push({ path: [...path, '{key}'], kind: kind.key });
      walk(kind.value, [...path, '{value}']);
    }
  };
  for (const [field, kind] of Object.entries(structure)) walk(kind, [field]);
  return out;
}

/**
 * `payload` with the value at `path` replaced (copy, built along the path;
 * `[]` = the first element, `{key}` = the map's one key, `{value}` = its value).
 */
export function withValueAt(payload: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path as [string, ...string[]];
  if (head === '[]') {
    const list = Array.isArray(payload) ? [...payload] : [];
    list[0] = withValueAt(list[0], rest, value);
    return list;
  }
  const record = isRecord(payload) ? { ...payload } : {};
  if (head === '{key}' || head === '{value}') {
    const [key, inner] = Object.entries(record)[0] ?? ['k', undefined];
    if (head === '{key}') return { [String(value)]: inner };
    return { [key]: withValueAt(inner, rest, value) };
  }
  record[head] = withValueAt(record[head], rest, value);
  return record;
}

/** The value at `path` (same path grammar as {@link withValueAt}). */
export function valueAtPath(payload: unknown, path: readonly string[]): unknown {
  let at: unknown = payload;
  for (const segment of path) {
    if (segment === '[]') at = Array.isArray(at) ? at[0] : undefined;
    else if (segment === '{key}') return isRecord(at) ? Object.keys(at)[0] : undefined;
    else if (segment === '{value}') at = isRecord(at) ? Object.values(at)[0] : undefined;
    else at = isRecord(at) ? at[segment] : undefined;
  }
  return at;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A payload for the registered event `type`, GENERATED from its classification
 * (`src/events/content.ts` · `EVENT_CONTENT`), never listed by hand: every
 * structure field holding a value that fits its kind (`validValueOf`), and
 * `quote` in one field the type does not declare.
 */
export function eventPayloadFor(type: string, quote: unknown): Record<string, unknown> {
  const payload: Record<string, unknown> = { __undeclared__: quote };
  for (const [field, kind] of Object.entries(classificationOf(type).structure)) {
    payload[field] = validValueOf(kind);
  }
  return payload;
}
