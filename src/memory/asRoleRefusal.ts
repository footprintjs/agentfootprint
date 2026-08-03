/**
 * The `asRole` refusal — one sentence, said in every place the option
 * could be declared.
 *
 * WHY this exists at all: `defineMemory({ asRole })` and
 * `defineRAG({ asRole })` accepted a role, stored it on the returned
 * `MemoryDefinition`, and NOTHING ever read it. Every formatter this
 * library ships writes `role: 'system'` — `formatDefault`, `formatFacts`,
 * `formatAsNarrative`, the causal `loadSnapshot`, and the auto pipeline —
 * so recall has always been injected as system, whatever the option said.
 * `defineRAG` even defaulted it to `'user'` and documented why, which made
 * the lie legible: a reader could pick a role, read it back off the
 * definition, and be told a role the run would never use.
 *
 * When this was written the messages slot did not reach the model at all,
 * so honouring `asRole` would have traded a dead option for a
 * recorded-and-dropped one. Since 7.21.0 it DOES reach the model: a
 * `slot: 'messages'` injection is delivered into `scope.history`, subject to
 * what the provider carries and to the sequence rule
 * (`lib/injection-engine/messagesSlotRefusal.ts`). The mechanism a
 * role-differentiated recall would ride now exists.
 *
 * The refusal still stands, and the reason it stands is now the only reason
 * it ever really had: **nobody has asked for it.** A recall formatter that
 * emits a non-system role can be written today — it becomes a messages-slot
 * injection with a declared role, checked like any other. What is missing is
 * evidence that role-differentiated recall answers a real question better
 * than the system prompt does. Building it because the machinery exists is
 * how a library grows options nobody reads — which is exactly the thing this
 * refusal is here to undo. Field evidence decides, not availability.
 *
 * A throw where there was a silent lie is a fix, not a break: nothing that
 * worked stops working, and something that never worked stops pretending.
 */

/**
 * The refusal text, addressed from `site` (e.g. `defineRAG('product-docs')`).
 * States the truth (never read; always system) and names what would change
 * it, because a refusal that does not teach just moves the puzzle.
 */
export function asRoleRefusal(site: string): string {
  return (
    `${site}: \`asRole\` has never been read. Every formatter this library ships ` +
    `writes \`role: 'system'\`, so recall is always injected as system — the option ` +
    `was stored on the definition and ignored by the run. It is removed rather than ` +
    `honoured: it was refused before the messages slot could deliver anything, and ` +
    `it stays refused now that it can, because no field evidence asks for ` +
    `role-differentiated recall. The machinery is there — a recall formatter that ` +
    `emits a non-system role becomes a \`slot: 'messages'\` injection with a declared ` +
    `role — so this is a decision, not a limitation. Drop the option: the behaviour ` +
    `you already had does not change.`
  );
}

/**
 * Throw the refusal when a caller passed `asRole`. Presence, not value —
 * an explicit `asRole: 'system'` was just as unread as `asRole: 'user'`,
 * and letting the "harmless" one through would teach that the option
 * works.
 */
export function refuseAsRole(options: object, site: string): void {
  if ('asRole' in options) throw new Error(asRoleRefusal(site));
}
