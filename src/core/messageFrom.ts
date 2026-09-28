/**
 * messageFrom — which runners read `AgentInput.messageFrom`, and the one input
 * a composition hands them.
 *
 * Pattern: a registry of readers (a `WeakSet`), and one helper every
 *          composition calls where it hands one runner another runner's output
 *          as its message.
 * Role:    core/ leaf. No imports, no state beyond the set. A composition
 *          (`core-flow/Sequence.ts`, `core-flow/Loop.ts`) passes
 *          `messageFrom: 'composed'` ONLY to a runner that reads it — an
 *          `Agent` whose declared sources are armed
 *          (`.findings({ argumentSources: true })`) — so every other
 *          composition hands its steps the input it always did, byte for byte.
 * Emits:   N/A.
 *
 * ## Why a composition marks the message
 *
 * The inputs layer's declared sources check a quote the model says came from
 * the PERSON against the person's own messages (`core/agent/arguments/checks.ts`
 * · `checkSource`). In a composition, a later step's message is an earlier
 * step's output — another model's words. A quote found only there must never
 * count as "the person said it" (`failed: 'composed-message'`), and only the
 * composition knows where its step's message came from.
 */

/** The runners that read `AgentInput.messageFrom`. */
const readers = new WeakSet<object>();

/**
 * Register a runner that reads `AgentInput.messageFrom` — `Agent` calls this
 * for itself when its declared sources are armed. Nothing else needs to.
 */
export function readsMessageFrom(runner: object): void {
  readers.add(runner);
}

/**
 * A composition that holds a reader reads the marker too: nested in another
 * composition, it may be handed a composed message itself, and it passes that
 * on to the child it hands its own message to — the handed-in input is a key
 * of its own scope (`parent.messageFrom` in its children's input mappings).
 * Called by each composition's constructor with its children.
 */
export function readsMessageFromIfAny(composition: object, children: readonly object[]): void {
  if (children.some((child) => readers.has(child))) readers.add(composition);
}

/**
 * The input a composition hands `runner` when its message is ANOTHER runner's
 * output: `input` with `messageFrom: 'composed'` for a runner that reads the
 * marker, and `input` itself — the same reference — for every other runner.
 *
 * @example
 * ```ts
 * inputMapper: (parent) => composedInput(step.runner, { message: parent.current as string }),
 * ```
 */
export function composedInput<I extends { readonly message: string }>(
  runner: object,
  input: I,
): I | (I & { readonly messageFrom: 'composed' }) {
  return readers.has(runner) ? { ...input, messageFrom: 'composed' as const } : input;
}
