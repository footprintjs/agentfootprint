/**
 * The messages-slot refusal — one sentence, said in every place the
 * declaration can be made.
 *
 * WHY this exists at all: an Injection targeting the messages slot was
 * RECORDED as injected — `context.injected` fired with its content, the
 * slot composition counted it, the engine routed it — while the request
 * assembled its message list from the conversation itself, so the model
 * never saw it. The recording said one thing and the wire said another.
 *
 * Delivering it instead is not a one-line change, and doing it badly
 * would be worse than the gap: the wire has no system role INSIDE the
 * message list (the Anthropic and Bedrock adapters drop such a message —
 * system is a separate top-level field — while the OpenAI adapters carry
 * it), and `'system'` was the default role here. Wiring the slot up
 * without a per-provider notion of what a provider can carry would
 * replace one uniform gap with a provider-dependent one, and nothing in
 * the recording would tell the two apart. Honest delivery needs a
 * wire-carrying key out of the slot, that provider capability, and a
 * message-sequence rule — a designed feature, not a patch.
 *
 * So until that exists, the declaration is refused where it is written.
 * Absence beats a lie: nothing that worked stops working, and something
 * that never worked stops pretending.
 */

/**
 * The refusal text, addressed from `site` (e.g. `defineFact('turn-time')`).
 * Names the limitation and the three placements that DO reach the model,
 * because a refusal that does not teach just moves the puzzle.
 */
export function messagesSlotRefusal(site: string): string {
  return (
    `${site}: the messages slot does not reach the model, so this content would be ` +
    `recorded as injected and never sent. The request's message list is assembled from ` +
    `the conversation itself; the messages slot is the observability projection of it. ` +
    `Three placements do reach the model: \`slot: 'system-prompt'\` (the default — ` +
    `delivered by every provider), a tool's return value (tool results are real ` +
    `messages, at the recency this option was reaching for), and the text passed to ` +
    `\`agent.run({ message })\`.`
  );
}
