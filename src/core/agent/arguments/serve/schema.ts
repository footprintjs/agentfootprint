/** Lens: the unchanged served copy of ruled tool schemas. */
import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import { carriesArgumentView } from '../../../toolShownArgs.js';
import type { InputValue } from '../../../../tools/inputRequest.js';
import { isRefused, rulesOf, type RuledToolLike } from '../../../../tools/declare.js';
import { assumeSentence } from './values.js';

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// LENS · tool-description · persistent-history
// reads: the tool's own `ask` rule — nothing about the call, the model or the person
// law: says what the model may do and what the record keeps; promises no outcome (the call may still
// be denied by permission, refused, or asked about again).
/**
 * The sentence a ruled `ask` property carries in the served schema: the rule
 * asks the person for the value, so the model may leave it out — and should,
 * unless the person gave it. No value is printed: an `ask` rule has no default.
 */
export const ASK_SENTENCE =
  "The tool's rule asks the person for this value; leave it out unless the person gave it.";

// LENS · tool-description · persistent-history
// reads: the tool's own `ask` rule and the declared-sources arm — nothing about the call, the model or
//        the person
// law: says what the model may do and where it declares it; promises no outcome (the call may still be
// denied by permission, refused, or asked about again).
/**
 * The sentence a ruled `ask` property carries under DECLARED SOURCES
 * (`.findings({ argumentSources: true })`, `.inputsLayer({ argumentSources:
 * true })`) in place of `ASK_SENTENCE`: the same rule, and — at the place the
 * model decides whether to send the value — where it says the person gave it.
 * Under the arm a present value with no traced source is asked of the person
 * (`resolve.ts`), so "leave it out unless the person gave it" alone told the
 * model that SENDING the value was the whole of its statement: in the paid
 * step-5 run (`bench/inputs/runs/haiku45-step5`) it left the period out on 32
 * of 32 calls where the person gave none — and a period the person HAD given
 * was traced to their words, unasked, on 7 of 88 calls.
 */
export const ASK_SOURCES_SENTENCE =
  "The tool's rule asks the person for this value; leave it out unless the person gave it, and " +
  'then quote their words for it in `_findings.from`.';

/** The options every served-schema composer here takes. */
export interface ServeOptions {
  /**
   * Declared sources are armed (`.findings({ argumentSources: true })` or
   * `.inputsLayer({ argumentSources: true })`) AND this tool's served schema
   * carries `_findings.from`: an `ask` property says where the model declares
   * the person's words, and an answered note says a later call may cite the
   * answer. The CALLER decides it per tool, by the rule the planters and the
   * dispatch peel ask (`findings/reserved.ts` · `ownsReservedArgument`, which
   * this leaf cannot import): a tool whose author owns `_findings` is served
   * undecorated, so a sentence naming `_findings.from` would tell the model to
   * write into the author's own argument. Absent → the sentences steps 3 and 4
   * serve, byte for byte.
   */
  readonly sources?: boolean;
}

function withSentence(property: PlainObject, sentence: string): PlainObject {
  const description = property.description;
  const text =
    typeof description === 'string' && description.trim() !== ''
      ? `${description.trimEnd()} ${sentence}`
      : sentence;
  return { ...property, description: text };
}

// FOLD · the one owner of how a ruled tool's schema is SERVED
// consumers read this and never re-derive it: core/slots/buildToolsSlot.ts · commitWire (the one
// decoration site, through `rulesOnWire`) and core/agent/stages/seed.ts (its static twin), each
// loading this module through `import()` under the arm; servedView rebuilds from the committed
// list, so the decoration is a pure function of (schema, tool).
/**
 * The served copy of a ruled tool's schema: every argument an `assume` or an
 * `ask` rule governs leaves `required` (the library fills it, or asks the
 * person for it, when the call leaves it out) and its property's description
 * gains the rule's sentence (an `ask` rule's names `_findings.from` under the
 * sources arm, `options.sources`). A rebuilt copy — the registry schema, which
 * `validateToolArgs` judges and `mcpServe` serves, is never edited. The SAME
 * reference back for a tool with no rules, rules that cannot be read (the
 * dispatch re-read refuses its calls) or no tool at all (a chart with no
 * claimant record) — so an agent whose tools declare nothing serves the bytes
 * it always did.
 *
 * @example
 * ```ts
 * withArgumentRules(searchLogs.schema, searchLogs).inputSchema.required; // ['service']
 * ```
 */
export function withArgumentRules(
  schema: LLMToolSchema,
  tool: RuledToolLike | undefined,
  options?: ServeOptions,
): LLMToolSchema {
  const rules = rulesOf(tool);
  if (rules === undefined || isRefused(rules)) return schema;
  const served = rules.ruled.filter(
    (r) =>
      (r.rule === 'assume' && r.assume !== undefined) || (r.rule === 'ask' && r.ask !== undefined),
  );
  if (served.length === 0) return schema;
  const input = schema.inputSchema;
  const properties = isPlainObject(input.properties) ? { ...input.properties } : {};
  for (const r of served) {
    const property = properties[r.argument];
    if (!isPlainObject(property)) continue;
    if (r.rule === 'ask') {
      const sentence = options?.sources === true ? ASK_SOURCES_SENTENCE : ASK_SENTENCE;
      properties[r.argument] = withSentence(property, sentence);
      continue;
    }
    const value = r.assume as InputValue;
    properties[r.argument] = withSentence(
      property,
      assumeSentence(value, carriesArgumentView(tool)),
    );
  }
  const ruledNames = new Set(served.map((r) => r.argument));
  const required = Array.isArray(input.required)
    ? (input.required as readonly unknown[]).filter(
        (name) => !(typeof name === 'string' && ruledNames.has(name)),
      )
    : undefined;
  const { required: _required, ...rest } = input;
  void _required;
  return {
    ...schema,
    inputSchema: {
      ...rest,
      properties,
      ...(required !== undefined && required.length > 0 && { required }),
    },
  };
}

/**
 * The served list with each ruled tool's schema decorated (`withArgumentRules`,
 * from the rules of the implementation that WINS each name), or the SAME list
 * when no served schema changed — so an armed agent whose wire carries no
 * ruled tool commits the bytes it always did. The tools slot's one decoration
 * site (`core/slots/buildToolsSlot.ts` · `commitWire`) calls it under the arm.
 * `optionsOf` gives each schema its own `ServeOptions`: under declared sources
 * one wire can hold a tool that carries `_findings.from` beside a provider's
 * tool whose author owns `_findings`, which does not.
 */
export function rulesOnWire(
  served: readonly LLMToolSchema[],
  winningTools: ReadonlyMap<string, RuledToolLike>,
  optionsOf?: (schema: LLMToolSchema) => ServeOptions | undefined,
): readonly LLMToolSchema[] {
  let changed = false;
  const decorated = served.map((schema) => {
    const next = withArgumentRules(schema, winningTools.get(schema.name), optionsOf?.(schema));
    if (next !== schema) changed = true;
    return next;
  });
  return changed ? decorated : served;
}
