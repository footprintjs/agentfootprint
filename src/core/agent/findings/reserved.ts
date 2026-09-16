/**
 * findings/reserved — the reserved `_findings` argument: its schema, the one
 * decorator that adds it to a served tool, and the two peels that take it
 * back off before anything else reads the model's words.
 *
 * Pattern: pure functions over plain JSON; no scope, no I/O.
 * Role:    core/ layer leaf. `withFindingsArgument` runs at the ONE decoration
 *          site (the committed tool list in `buildToolsSlot`, and the seed
 *          fallback); `splitFindings` is the FIRST read of a tool call's args
 *          in the dispatch loop; `peelAnswerFindings` runs before the output
 *          schema judges an answer. `ledger.ts` turns what they return into rows.
 *
 * THE LAWS THIS FILE KEEPS
 *   - Never mutate a schema or an args object: every changed value is a
 *     rebuilt copy, and an unchanged one is the SAME reference (so an unarmed
 *     path, or a schema the author already decorated, is byte-identical).
 *   - `_findings` is never added to a tool's `required` and never touches
 *     `additionalProperties`; the author's own `_findings` property wins.
 *   - Never coerce, never infer: a field that fails its enum check is dropped
 *     and COUNTED (`malformed`), never defaulted. An absent declaration stays
 *     absent — `splitFindings` returns no `findings` for it.
 *
 * Both model-facing strings here (`FINDINGS_INSTRUCTION` and the schema's
 * description) say what the model may DO and never what the library
 * guarantees; `test/modelFacingSurfaces.test.ts` runs them through
 * `unprovable` so a later call cannot falsify a sentence.
 */

import type { LLMToolSchema } from '../../../adapters/types.js';
import {
  BASIS_VALUES,
  EXPECT_VALUES,
  RESERVED_ANSWER_KEY,
  RESERVED_ARGUMENT,
  STANDING_VALUES,
  type Basis,
  type DeclaredAssertion,
  type Expect,
  type FindingsDeclaration,
  type PreviousStanding,
  type Standing,
} from './types.js';

// ─── Helpers ───────────────────────────────────────────────────────────

type PlainObject = Readonly<Record<string, unknown>>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: PlainObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isOneOf<T extends string>(value: unknown, vocabulary: readonly T[]): value is T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value);
}

/** Freeze a JSON tree in place and return it — the schema is served, never edited. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

// ─── The schema ────────────────────────────────────────────────────────

/**
 * The description the model reads on every served tool. Versioned in its
 * first word so a rewrite is a different schema hash on the receipt.
 */
const FINDINGS_DESCRIPTION =
  'Findings v1 (reserved by the agent runtime). basis: why you make the call — ' +
  "'direct' when you expect the result to answer what you are after, 'exploratory' " +
  'when you are looking. expect: how useful you expect the result to be. previous: ' +
  'the standing of each earlier tool result, by its tool_result id — ' +
  "'fact' with the assertions you stand on (subject kind and id, predicate, value), " +
  "'open' with what would settle it, 'ruled-out' with one line naming what was ruled " +
  "out, 'noise' with nothing. On the record a fact's assertions are asserted, an open " +
  "or ruled-out result's are quoted, and noise carries none.";

/**
 * The JSON schema of the reserved property — frozen, served as-is, and NEVER
 * listed in the parent's `required`. `basis` is required INSIDE it so a model
 * that opens the object says why it made the call.
 */
export const FINDINGS_ARGUMENT_SCHEMA: PlainObject = deepFreeze({
  type: 'object',
  description: FINDINGS_DESCRIPTION,
  properties: {
    basis: {
      type: 'string',
      enum: [...BASIS_VALUES],
      description:
        "'direct': you expect this result to answer what you are after; " +
        "'exploratory': you are looking.",
    },
    expect: {
      type: 'string',
      enum: [...EXPECT_VALUES],
      description: 'How useful you expect the result to be.',
    },
    previous: {
      type: 'array',
      description:
        'The standing of each earlier tool result, by its tool_result id. Name only what ' +
        'you can stand on; leave a result unnamed rather than guess.',
      items: {
        type: 'object',
        properties: {
          toolCallId: { type: 'string', description: 'The tool_result id being judged.' },
          standing: { type: 'string', enum: [...STANDING_VALUES] },
          sought: {
            type: 'boolean',
            description: 'Whether the result was what the call was after.',
          },
          assertions: {
            type: 'array',
            description:
              'What you stand on (fact) or quote (open, ruled-out). Never restate the result.',
            items: {
              type: 'object',
              properties: {
                subject: {
                  type: 'object',
                  properties: { kind: { type: 'string' }, id: { type: 'string' } },
                  required: ['kind', 'id'],
                },
                predicate: { type: 'string' },
                value: {},
              },
              required: ['subject', 'predicate', 'value'],
            },
          },
          settles: { type: 'string', description: 'open: what would settle it.' },
          line: { type: 'string', description: 'ruled-out: one line naming what was ruled out.' },
        },
        required: ['toolCallId', 'standing'],
      },
    },
  },
  required: ['basis'],
});

/**
 * The always-on system instruction `.findings()` registers (the twin of
 * `outputSchema()`'s piece). It asks; it promises nothing about serving.
 */
export const FINDINGS_INSTRUCTION = [
  'Findings v1. Tool schemas carry an optional `_findings` argument; declare it on your tool calls.',
  "`_findings.basis` on each call: 'direct' when you expect the result to answer what you are " +
    "after, 'exploratory' when you are looking; add `expect` ('low' | 'medium' | 'high') for how " +
    'useful you expect it to be.',
  'On your next tool call — or, when you answer in JSON, as a top-level `_findings.previous` — ' +
    'state the standing of each previous tool result by its tool_result id:',
  "- 'fact' with the assertions you stand on (subject kind and id, predicate, value);",
  "- 'open' with what would settle it (`settles`);",
  "- 'ruled-out' with one line naming what was ruled out (`line`);",
  "- 'noise' with nothing.",
  'Never restate a result in a standing. A result you leave unnamed has no standing; leave it ' +
    'unnamed rather than guess.',
].join('\n');

// ─── The decorator ─────────────────────────────────────────────────────

/**
 * True when the schema's own `inputSchema.properties` carry `_findings` —
 * the AUTHOR's property. The ONE predicate every reader of that fact asks:
 * `withFindingsArgument` leaves such a schema by reference, the registry
 * refusal (`buildToolRegistry · assertReservedArgument`) names such a tool at
 * build, and the dispatch peel (`toolCalls · peelCall`) leaves such a call's
 * value alone — it is the author's argument, not the model's declaration.
 * `undefined` (a name nothing answers) owns nothing.
 */
export function ownsReservedArgument(schema: LLMToolSchema | undefined): boolean {
  const properties = schema?.inputSchema?.properties;
  return isPlainObject(properties) && hasOwn(properties, RESERVED_ARGUMENT);
}

/**
 * A REBUILT copy of the schema with `_findings` among its properties, leaving
 * `required` and `additionalProperties` exactly as the author wrote them.
 * Returns the SAME reference when `properties._findings` already exists —
 * the author's property wins and is recorded by the committed schema itself;
 * that same rule is what makes the decorator idempotent.
 */
export function withFindingsArgument(schema: LLMToolSchema): LLMToolSchema {
  if (ownsReservedArgument(schema)) return schema;
  const properties = schema.inputSchema.properties;
  const existing = isPlainObject(properties) ? properties : undefined;
  return {
    ...schema,
    inputSchema: {
      ...schema.inputSchema,
      properties: { ...(existing ?? {}), [RESERVED_ARGUMENT]: FINDINGS_ARGUMENT_SCHEMA },
    },
  };
}

/**
 * The served `inputSchema` WITHOUT the library's decoration: when
 * `properties._findings` is `FINDINGS_ARGUMENT_SCHEMA` itself (the reference
 * `withFindingsArgument` planted), a rebuilt copy minus that property;
 * otherwise the SAME reference — an author's own `_findings` is not the
 * decoration and is read as written. Asked by readers that judge the model's
 * ARGUMENTS against the schema (`callLLM` · the choice seam's enum fence), so
 * the reserved words (`direct`, `fact`, `noise`, …) never excuse a value.
 */
export function withoutFindingsArgument(inputSchema: unknown): unknown {
  if (!isPlainObject(inputSchema)) return inputSchema;
  const properties = inputSchema.properties;
  if (!isPlainObject(properties) || properties[RESERVED_ARGUMENT] !== FINDINGS_ARGUMENT_SCHEMA) {
    return inputSchema;
  }
  const { [RESERVED_ARGUMENT]: _decoration, ...rest } = properties;
  return { ...inputSchema, properties: rest };
}

// ─── Reading a declaration ─────────────────────────────────────────────

interface ReadDeclaration {
  readonly declaration?: FindingsDeclaration;
  /** Entries and fields dropped as malformed. */
  readonly malformed: number;
}

function isDeclaredAssertion(value: unknown): value is DeclaredAssertion {
  if (!isPlainObject(value) || !hasOwn(value, 'value')) return false;
  const subject = value.subject;
  return (
    isPlainObject(subject) &&
    typeof subject.kind === 'string' &&
    typeof subject.id === 'string' &&
    typeof value.predicate === 'string'
  );
}

/** One `previous[]` entry: the identity and the standing are required; the rest is checked per field. */
function readPrevious(raw: unknown): { entry?: PreviousStanding; malformed: number } {
  if (!isPlainObject(raw) || typeof raw.toolCallId !== 'string') return { malformed: 1 };
  if (!isOneOf<Standing>(raw.standing, STANDING_VALUES)) return { malformed: 1 };
  let malformed = 0;
  const entry: {
    toolCallId: string;
    standing: Standing;
    sought?: boolean;
    assertions?: DeclaredAssertion[];
    settles?: string;
    line?: string;
  } = { toolCallId: raw.toolCallId, standing: raw.standing };
  if (raw.sought !== undefined) {
    if (typeof raw.sought === 'boolean') entry.sought = raw.sought;
    else malformed += 1;
  }
  if (raw.settles !== undefined) {
    if (typeof raw.settles === 'string') entry.settles = raw.settles;
    else malformed += 1;
  }
  if (raw.line !== undefined) {
    if (typeof raw.line === 'string') entry.line = raw.line;
    else malformed += 1;
  }
  if (raw.assertions !== undefined) {
    if (!Array.isArray(raw.assertions)) malformed += 1;
    else {
      const assertions: DeclaredAssertion[] = [];
      for (const a of raw.assertions) {
        if (isDeclaredAssertion(a)) {
          assertions.push({
            subject: { kind: a.subject.kind, id: a.subject.id },
            predicate: a.predicate,
            value: a.value,
          });
        } else malformed += 1;
      }
      entry.assertions = assertions;
    }
  }
  return { entry, malformed };
}

/**
 * The one validator both peels share. Enum-checks every field; a field that
 * fails is dropped and counted; nothing is defaulted. No `declaration` comes
 * back when nothing readable survived.
 */
function readDeclaration(raw: unknown): ReadDeclaration {
  if (!isPlainObject(raw)) return { malformed: 1 };
  let malformed = 0;
  const out: { basis?: Basis; expect?: Expect; previous?: PreviousStanding[] } = {};
  if (raw.basis !== undefined) {
    if (isOneOf<Basis>(raw.basis, BASIS_VALUES)) out.basis = raw.basis;
    else malformed += 1;
  }
  if (raw.expect !== undefined) {
    if (isOneOf<Expect>(raw.expect, EXPECT_VALUES)) out.expect = raw.expect;
    else malformed += 1;
  }
  if (raw.previous !== undefined) {
    if (!Array.isArray(raw.previous)) malformed += 1;
    else {
      const previous: PreviousStanding[] = [];
      for (const item of raw.previous) {
        const read = readPrevious(item);
        malformed += read.malformed;
        if (read.entry !== undefined) previous.push(read.entry);
      }
      out.previous = previous;
    }
  }
  const readable =
    out.basis !== undefined || out.expect !== undefined || out.previous !== undefined;
  return { ...(readable && { declaration: out }), malformed };
}

// ─── The two peels ─────────────────────────────────────────────────────

export interface SplitFindings {
  /** The SAME reference when the key was absent; a fresh object without it otherwise. */
  readonly args: PlainObject;
  readonly findings?: FindingsDeclaration;
  /** Present only when something was dropped. */
  readonly malformed?: number;
}

/**
 * Take `_findings` off a tool call's args. The first read of `tc.args` in the
 * dispatch loop when armed: what comes back as `args` is what the call runs
 * with, and the model's declaration rides on `findings`.
 */
export function splitFindings(args: PlainObject): SplitFindings {
  if (!isPlainObject(args) || !hasOwn(args, RESERVED_ARGUMENT)) return { args };
  const { [RESERVED_ARGUMENT]: raw, ...rest } = args;
  const { declaration, malformed } = readDeclaration(raw);
  return {
    args: rest,
    ...(declaration !== undefined && { findings: declaration }),
    ...(malformed > 0 && { malformed }),
  };
}

export interface PeeledAnswer {
  /** `raw` itself unless it parsed to a plain object carrying the key. */
  readonly content: string;
  readonly findings?: FindingsDeclaration;
  readonly malformed?: number;
}

/**
 * Take the top-level `_findings` off a JSON answer. Identity on prose, on
 * arrays, and on objects without the key; otherwise the declaration plus the
 * object re-serialised without it — what the output schema then judges.
 */
export function peelAnswerFindings(raw: string): PeeledAnswer {
  if (typeof raw !== 'string' || raw.trimStart()[0] !== '{') return { content: raw };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { content: raw };
  }
  if (!isPlainObject(parsed) || !hasOwn(parsed, RESERVED_ANSWER_KEY)) return { content: raw };
  const { [RESERVED_ANSWER_KEY]: declared, ...rest } = parsed;
  const { declaration, malformed } = readDeclaration(declared);
  return {
    content: JSON.stringify(rest),
    ...(declaration !== undefined && { findings: declaration }),
    ...(malformed > 0 && { malformed }),
  };
}
