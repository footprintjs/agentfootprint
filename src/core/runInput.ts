/**
 * runInput — the one door every runner's `run()` input goes through.
 *
 * Pattern: normalize-or-refuse at a boundary (the shape `toolArgsValidation`
 *          uses for a model's arguments, applied to a caller's).
 * Role:    core/ layer. `Agent`, `LLMCall` and the compositions all take the
 *          same `{ message }` bag, and until 8.18.0 none of them looked at it.
 *          A caller who wrote `agent.run('go')` — the shape every chat SDK
 *          takes — reached `buildMessagesSlot` with `content: undefined` and
 *          got `TypeError: Cannot read properties of undefined (reading
 *          'length')` five frames inside the engine. `LLMCall.run('go')` was
 *          worse: it called the model with ZERO messages and returned an
 *          answer, so the mistake looked like it worked.
 * Emits:   N/A — this runs before any chart does.
 *
 * ## Two answers, and the rule that picks between them
 *
 * A bare string is **adapted**: `run('go')` means `run({ message: 'go' })`.
 * `AgentInput` has one required field, so a lone string has exactly one
 * possible reading, and refusing it would be a speed bump rather than a
 * teaching. The adaptation is stated here, in the types, and in the docs —
 * an adaptation nobody can see is indistinguishable from a guess.
 *
 * Everything else is **refused, by name**. `{}`, `{ message: undefined }`,
 * `{ message: 42 }`, `null`, `''` are not one sane meaning each; they are a
 * caller who believes they passed a message and did not. The refusal says
 * what arrived, and spells the two accepted forms. It fires before the run
 * starts, so nothing is billed and no half-run has to be explained.
 *
 * An empty (or whitespace-only) message is refused for the same reason it
 * cannot work: `Agent` used to send a `content: ''` turn and `LLMCall` used
 * to send no turn at all — the two runners disagreed, and both shapes are a
 * 400 on a real provider wire. "Run with only the system prompt" is a real
 * intention, and the refusal names how to say it: put the instruction in
 * the message.
 */

/**
 * Thrown by `run()` (and `runTyped()`) when the input is not a message.
 *
 * `received` is a short, non-leaking description of what arrived — the type
 * and, for an object, its keys. Never the value: an input that was refused
 * for being the wrong shape is still the caller's data.
 */
export class InvalidRunInputError extends Error {
  readonly code = 'ERR_INVALID_RUN_INPUT' as const;
  /** Short description of what was passed, e.g. `'object with keys: text'`. */
  readonly received: string;
  /** Which runner refused, e.g. `'Agent.run'`. */
  readonly runner: string;

  constructor(ctx: { runner: string; received: string; hint: string }) {
    super(`${ctx.runner}: ${ctx.hint} (received ${ctx.received}).`);
    this.name = 'InvalidRunInputError';
    this.received = ctx.received;
    this.runner = ctx.runner;
  }
}

/** Describe a value for the refusal without quoting it. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return keys.length === 0
      ? 'an object with no keys'
      : `an object with keys: ${keys.slice(0, 6).join(', ')}`;
  }
  return `a ${typeof value}`;
}

/** The two spellings, quoted the same way in every refusal. */
const SPELLINGS = "pass a message: run('your message') or run({ message: 'your message' })";

/**
 * Normalize a runner input to `{ message, ...rest }`, or refuse.
 *
 * `runner` names the door in the error (`'Agent.run'`, `'LLMCall.run'`, …).
 * Extra fields on an object input are preserved untouched — `identity` and
 * anything a subclass adds ride through.
 */
export function normalizeRunInput<T extends { message: string }>(
  input: unknown,
  runner: string,
): T {
  if (typeof input === 'string') {
    return assertMessage({ message: input } as T, runner);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new InvalidRunInputError({
      runner,
      received: describe(input),
      hint: SPELLINGS,
    });
  }
  return assertMessage(input as T, runner);
}

/** The message field itself, judged once for both entry shapes. */
function assertMessage<T extends { message: string }>(input: T, runner: string): T {
  const { message } = input;
  if (typeof message !== 'string') {
    throw new InvalidRunInputError({
      runner,
      received: `${describe(input)}, whose \`message\` is ${describe(message)}`,
      hint: `\`message\` must be a string — ${SPELLINGS}`,
    });
  }
  if (message.trim() === '') {
    throw new InvalidRunInputError({
      runner,
      received: message === '' ? 'an empty message' : 'a whitespace-only message',
      hint:
        'a run needs something to answer. An empty message is not a shorter question — it ' +
        'reaches the provider as a turn with no content, which real wires reject. To run on ' +
        'the system prompt alone, say so in the message (e.g. run({ message: "begin" }))',
    });
  }
  return input;
}
