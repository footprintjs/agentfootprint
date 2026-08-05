/**
 * outputSchema — declarative terminal contract for an Agent's final answer.
 *
 * The Block A6 piece. Lets a consumer say:
 *
 *   "Whatever this agent says at the end of a run, it MUST be JSON
 *    matching this Zod (or Zod-like) schema. Auto-instruct the LLM,
 *    parse + validate the final answer for me."
 *
 * Why a typed contract matters: agentic code that calls an LLM and
 * then JSON.parses the string answer is brittle. The schema serves
 * three jobs at once:
 *
 *   1. **Instruction**: a system-prompt sentence telling the LLM the
 *      output shape (auto-generated from `schema.description` /
 *      JSON-schema introspection where available, or from a consumer-
 *      supplied `instruction` override).
 *
 *   2. **Validation**: a `parser.parse(rawString)` step on the run's
 *      final answer, throwing `OutputSchemaError` on parse / shape
 *      failure rather than returning malformed data.
 *
 *   3. **Type narrowing**: `agent.runTyped({...})` returns the inferred
 *      shape `T` instead of `string`, so callers stop reaching for
 *      `as MyType` casts.
 *
 * Pattern: Strategy (GoF) over the parser interface; structural
 *          duck-typing (Zod / Valibot / ArkType / hand-written —
 *          anything with a `parse(unknown): T` method satisfies it).
 *
 * Role:    Layer-6 (Agent) — terminal contract on the run output.
 *          NOT a context-engineering Injection per se, but composes
 *          with the InjectionEngine (auto-injects an Instruction).
 *
 * @example  zod schema
 *   import { z } from 'zod';
 *   const Output = z.object({ status: z.enum(['ok', 'err']), items: z.array(z.string()) });
 *
 *   const agent = Agent.create({ ... })
 *     .system('You answer support tickets.')
 *     .outputSchema(Output)
 *     .build();
 *
 *   const typed = await agent.runTyped({ message: 'list pending tickets' });
 *   typed.status; // narrowed to 'ok' | 'err'
 *
 * @example  valibot / arktype / hand-written parser
 *   const Output = { parse(v: unknown): MyType { ... } };
 *   const agent = Agent.create({...}).outputSchema(Output, { instruction: '...' }).build();
 */

/**
 * Minimum shape any validation library must expose to satisfy
 * `outputSchema`. Covers Zod (`schema.parse`), Valibot
 * (`v.parse(schema, value)` — pass `{ parse: v => v.parse(schema, v) }`),
 * ArkType (`type.assert`), and hand-written parsers.
 *
 * Implementations MUST throw on validation failure (the runtime
 * catches the throw, wraps it in `OutputSchemaError`, and emits the
 * diagnostic event).
 */
export interface OutputSchemaParser<T> {
  parse(value: unknown): T;
  /**
   * Human-readable description of the output shape. Used by
   * `outputSchema` to auto-build the system-prompt instruction when
   * `opts.instruction` is not provided. Zod schemas expose this via
   * `.describe('...')`; consumers can attach the field directly on
   * hand-written parsers.
   */
  readonly description?: string;
}

/**
 * How the schema reaches the model.
 *
 *   • `'instruct'` (default) — the shape is described in the system prompt
 *     and the model is asked for JSON. Works on every provider, because it
 *     is only words.
 *   • `'tool-forced'` — the shape is presented as a synthetic tool and the
 *     provider's tool choice is FORCED to it, so generation is constrained
 *     at the source instead of requested in prose. Requires a provider that
 *     declares `carriesForcedToolChoice`; a provider that does not is
 *     refused BY NAME at run start rather than quietly downgraded, because
 *     a strategy that silently falls back to the other one is config that
 *     lies.
 */
export type OutputSchemaStrategy = 'instruct' | 'tool-forced';

/**
 * Optional configuration for `outputSchema`.
 */
export interface OutputSchemaOptions {
  /**
   * Injection id for the auto-generated "respond with this shape"
   * instruction. Defaults to `'output-schema'`. Override when you
   * have multiple agents with different schemas in one process and
   * want the diagnostic events to disambiguate.
   */
  readonly name?: string;
  /**
   * Custom system-prompt instruction text. Defaults to a generic
   * "Respond with valid JSON matching the output schema. Do not
   * include prose." sentence (extended with `parser.description`
   * when present). Override when the LLM benefits from a
   * domain-specific framing.
   */
  readonly instruction?: string;
  /**
   * How many corrective re-asks the run may spend when the final answer
   * fails the schema. Default `0` — the historical behaviour, where the
   * first answer is the only answer and `runTyped()` throws on a bad one.
   *
   * Each retry is a REAL turn: the failed answer and an authored corrective
   * message join the conversation, the ReAct loop re-enters, and the next
   * attempt gets its own `llm_start`/`llm_end` bracket and its own
   * `cost.tick` against `costBudget`. A retry therefore consumes one
   * iteration of the agent's budget, the same way a tool call does.
   *
   * When the cap is spent the last answer stands and `runTyped()` throws
   * `OutputSchemaError` exactly as it always has — `.outputFallback()`
   * composes on top, unchanged.
   */
  readonly retries?: number;
  /**
   * How the schema reaches the model. Default `'instruct'`.
   * See {@link OutputSchemaStrategy}.
   */
  readonly strategy?: OutputSchemaStrategy;
  /**
   * The JSON Schema for the synthetic tool, required by
   * `strategy: 'tool-forced'` unless the parser can produce one itself
   * (a `toJsonSchema()` method, which ArkType has). The library will not
   * infer a shape from a `parse()` function — guessing what your schema
   * means is not a thing it gets to do.
   *
   * This value and the parser CAN disagree. Nothing here prevents that,
   * and nothing needs to: the forced shape satisfies the wire, the parser
   * still judges the answer, and a disagreement surfaces as an ordinary
   * validation failure that the retry loop corrects using the validator's
   * own words. The schema constrains generation; the parser remains the
   * judge.
   */
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
}

/**
 * Thrown by `agent.parseOutput(...)` / `agent.runTyped(...)` when the
 * agent's final answer fails JSON parsing OR schema validation.
 *
 * `cause` carries the underlying parse error (Zod's ZodError, etc.).
 * `rawOutput` carries the agent's untyped string output so callers
 * can log / persist the failed response for triage.
 */
export class OutputSchemaError extends Error {
  readonly rawOutput: string;
  readonly stage: 'json-parse' | 'schema-validate';
  override readonly cause?: unknown;

  constructor(
    message: string,
    opts: { rawOutput: string; stage: 'json-parse' | 'schema-validate'; cause?: unknown },
  ) {
    super(message);
    this.name = 'OutputSchemaError';
    this.rawOutput = opts.rawOutput;
    this.stage = opts.stage;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/**
 * Default instruction template — used when `opts.instruction` is not
 * provided. Concatenates the parser's `.description` (if present) so
 * Zod schemas authored with `.describe('...')` propagate naturally.
 */
export function buildDefaultInstruction(parser: OutputSchemaParser<unknown>): string {
  const tail = parser.description ? ` The output shape: ${parser.description}.` : '';
  return (
    'Respond ONLY with valid JSON matching the output schema. ' +
    'Do NOT include prose, markdown fences, or explanatory text.' +
    tail
  );
}

/**
 * Parse + validate a raw string answer against a parser. Used by
 * `agent.parseOutput()` / `agent.runTyped()`. Centralized here so
 * both call sites share identical error-mapping behavior.
 *
 * Two-stage error reporting:
 *   - JSON parse failure → `stage: 'json-parse'` (LLM emitted prose
 *     or malformed JSON)
 *   - Schema validation failure → `stage: 'schema-validate'` (JSON
 *     was valid but didn't match the contracted shape)
 */
export function applyOutputSchema<T>(raw: string, parser: OutputSchemaParser<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new OutputSchemaError(
      'Agent final answer is not valid JSON. The LLM emitted prose or malformed JSON.',
      { rawOutput: raw, stage: 'json-parse', cause },
    );
  }
  try {
    return parser.parse(parsed);
  } catch (cause) {
    throw new OutputSchemaError('Agent final answer parsed as JSON but failed schema validation.', {
      rawOutput: raw,
      stage: 'schema-validate',
      cause,
    });
  }
}
