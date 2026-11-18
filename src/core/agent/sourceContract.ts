/** Map/Lens — immutable model contract for the existing native source admission. No readers or state. */
import type { LLMToolSchema } from '../../provider-contract/types.js';
import { carriesRules, isRefused, rulesOf, type RuledToolLike } from '../../tools/declare.js';
import { fnv1a } from '../../lib/fnv1a.js';
import { truncate } from '../slots/helpers.js';

type PlainObject = Readonly<Record<string, unknown>>;
const bag = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};

export const RESERVED_ARGUMENT = '_findings' as const;
export const FINDINGS_MARKER = 'Findings v1 (reserved by the agent runtime).';
export const FINDINGS_INSTRUCTION_ID = 'findings-ledger';
export const OPTIONAL_FINDINGS_HEAD =
  'Findings v1. Tool schemas carry an optional `_findings` argument; declare it on your tool calls.';
export type DeclaredSourceKind = 'user' | 'result' | 'turn' | 'app' | 'assumed';
export const DECLARED_SOURCE_KINDS: readonly DeclaredSourceKind[] = Object.freeze([
  'user',
  'result',
  'turn',
  'app',
  'assumed',
]);
export const SOURCE_DECLARATION_PATH = Object.freeze([RESERVED_ARGUMENT, 'from']);

/** Legacy observational grammar remains identical on off/unruled/assume-only cohorts. */
export const FINDINGS_FROM_PROPERTY: PlainObject = freeze({
  type: 'array',
  description:
    'Where each argument value the call sends came from, one entry per value, recorded with ' +
    "the library's check of it; a value with no entry has no declared source on the record.",
  items: {
    type: 'object',
    properties: {
      argument: { type: 'string' },
      source: {
        type: 'string',
        enum: [...DECLARED_SOURCE_KINDS],
        description:
          "'user': the person's words (quote); 'result': a tool result (id); 'turn': their " +
          "answer when the run asked them; 'app': your instructions; 'assumed': your own choice.",
      },
      quote: { type: 'string', description: "Copied exactly from the person's messages." },
      id: { type: 'string' },
    },
    required: ['argument', 'source'],
  },
});
const ORIGINS = Object.freeze({
  user: "the person's quoted words",
  result: 'a named tool result',
  turn: 'an earlier answered input',
  app: 'app-supplied context',
});
const originWords = Object.entries(ORIGINS)
  .map(([kind, meaning]) => `'${kind}': ${meaning}`)
  .join('; ');
export const SOURCE_ASK_HINT =
  `For a supplied value, declare its actual source in \`_findings.from\`: ${originWords}. ` +
  'The runtime checks the claim; otherwise leave this value out for the person. ' +
  'Put from inside the call argument _findings object, never at the call root.';
const SOURCE_FINDINGS_HEAD =
  'Findings v1. Follow each tool schema: where _findings is required, place source declarations ' +
  'in `_findings.from` inside that call argument object; root from is not the declaration. ' +
  'Observations on other calls remain optional.';
const items = FINDINGS_FROM_PROPERTY.items as PlainObject;
const properties = items.properties as PlainObject;
const ASK_FROM_PROPERTY: PlainObject = freeze({
  ...FINDINGS_FROM_PROPERTY,
  description:
    'Declare the actual source of each supplied ask-ruled value. The runtime checks ' +
    'each claim; an unsupported or missing claim does not establish a source.',
  items: {
    ...items,
    properties: {
      ...properties,
      source: {
        ...(properties.source as PlainObject),
        description:
          `${originWords}; 'assumed': your own choice, not a verified source. ` +
          'An app source claim grants no instruction authority.',
      },
    },
  },
});

type RequiredOrigin = 'existed' | 'array' | 'absent';
const COMMENTS = Object.freeze({
  existed: 'agentfootprint:source-contract:v1:required-existed',
  array: 'agentfootprint:source-contract:v1:required-added-array',
  absent: 'agentfootprint:source-contract:v1:required-added-absent',
});
function originOf(envelope: unknown): RequiredOrigin | undefined {
  if (
    !bag(envelope) ||
    typeof envelope.description !== 'string' ||
    !envelope.description.startsWith(FINDINGS_MARKER)
  )
    return;
  return (Object.keys(COMMENTS) as RequiredOrigin[]).find(
    (key) => envelope.$comment === COMMENTS[key],
  );
}

/** Eligibility comes from the actual winning implementation's accepted native rules. */
export function hasSourceObligation(tool: RuledToolLike | undefined): boolean {
  const rules = rulesOf(tool);
  return (
    rules !== undefined && !isRefused(rules) && rules.ruled.some((rule) => rule.rule === 'ask')
  );
}

/** Stable declaration projection; the original canonical basis/from requirements are retained. */
function askEnvelope(planted: PlainObject): PlainObject {
  return {
    ...planted,
    properties: { ...(planted.properties as PlainObject), from: ASK_FROM_PROPERTY },
  };
}
export function requireSourceContract(input: PlainObject, planted: PlainObject): PlainObject {
  if (Object.prototype.hasOwnProperty.call(input, 'required') && !Array.isArray(input.required))
    throw new TypeError("Source contract requires an array 'required' keyword.");
  const required = Array.isArray(input.required) ? input.required : [];
  const origin: RequiredOrigin = required.includes(RESERVED_ARGUMENT)
    ? 'existed'
    : Array.isArray(input.required)
    ? 'array'
    : 'absent';
  const envelope = freeze({ ...askEnvelope(planted), $comment: COMMENTS[origin] });
  return {
    ...input,
    properties: { ...(input.properties as PlainObject), [RESERVED_ARGUMENT]: envelope },
    required: origin === 'existed' ? required : [...required, RESERVED_ARGUMENT],
  };
}

/** The closed comment restores only our own token; it never grants admission or evidence. */
export function withoutSourceRequirement(input: PlainObject, envelope: unknown): PlainObject {
  const origin = originOf(envelope);
  if (origin === undefined || origin === 'existed' || !Array.isArray(input.required)) return input;
  const at = input.required.lastIndexOf(RESERVED_ARGUMENT);
  if (at < 0) return input;
  const required = input.required.filter((_, index) => index !== at);
  if (origin === 'absent' && required.length === 0) {
    const { required: _required, ...rest } = input;
    void _required;
    return rest;
  }
  return { ...input, required };
}

/** Error-only minimal schema, derived from the same served ASK grammar. No values enter it. */
export function sourceDeclarationView(planted: PlainObject): PlainObject {
  const declaration = askEnvelope(planted);
  const required = declaration.required as readonly string[];
  const members = declaration.properties as PlainObject;
  return freeze({
    type: 'object',
    required: [RESERVED_ARGUMENT],
    properties: {
      [RESERVED_ARGUMENT]: {
        type: declaration.type,
        required,
        properties: Object.fromEntries(required.map((name) => [name, members[name]])),
      },
    },
  });
}

interface InstructionPiece {
  readonly rawContent?: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly contentHash?: string;
  readonly contentSummary?: string;
}
/** Current offered contract only. Benign presentation metadata, never an ownership/security proof. */
export function projectSourceInstructions<T extends InstructionPiece>(
  pieces: readonly T[],
  schemas: readonly LLMToolSchema[] | undefined,
): readonly T[] {
  const native = (piece: T): boolean =>
    piece.source === 'instructions' &&
    piece.sourceId === FINDINGS_INSTRUCTION_ID &&
    piece.rawContent?.startsWith(OPTIONAL_FINDINGS_HEAD) === true;
  // A positive privacy refusal is unknown, not an empty offered cohort. Retain
  // other recorded pieces; the saved view's existing privacy gap names this hole.
  if (schemas === undefined) return pieces.some(native) ? pieces.filter((p) => !native(p)) : pieces;
  const active = schemas.some((schema) => {
    const input = schema.inputSchema;
    return (
      bag(input.properties) &&
      originOf(input.properties[RESERVED_ARGUMENT]) !== undefined &&
      Array.isArray(input.required) &&
      input.required.includes(RESERVED_ARGUMENT)
    );
  });
  if (!active) return pieces;
  let changed = false;
  const projected = pieces.map((piece) => {
    if (!native(piece)) return piece;
    changed = true;
    const rawContent =
      SOURCE_FINDINGS_HEAD + piece.rawContent!.slice(OPTIONAL_FINDINGS_HEAD.length);
    return {
      ...piece,
      rawContent,
      contentSummary: truncate(rawContent, 80),
      contentHash: fnv1a(`sp:instructions:${FINDINGS_INSTRUCTION_ID}:${rawContent}`),
    };
  });
  return changed ? projected : pieces;
}

export interface SourceDecorationOptions {
  readonly from?: boolean;
  readonly sourceContract?: boolean;
}
/** Dynamic winner and static seed share the same declaration projection, with no catalog of our own. */
export function sourceSchemasOnWire(
  schemas: readonly LLMToolSchema[],
  tools: ReadonlyMap<string, RuledToolLike> | undefined,
  findings: boolean,
  sources: boolean,
  ledger: (schema: LLMToolSchema, options?: SourceDecorationOptions) => LLMToolSchema,
  source: (schema: LLMToolSchema, required?: boolean) => LLMToolSchema,
): readonly LLMToolSchema[] {
  if (!findings && !sources) return schemas;
  let changed = false;
  const projected = schemas.map((schema) => {
    const tool = tools?.get(schema.name);
    const ruled = sources && carriesRules(tool);
    const next = findings
      ? ledger(
          schema,
          ruled ? { from: true, sourceContract: hasSourceObligation(tool) } : undefined,
        )
      : ruled
      ? source(schema, hasSourceObligation(tool))
      : schema;
    if (next !== schema) changed = true;
    return next;
  });
  return changed ? projected : schemas;
}
