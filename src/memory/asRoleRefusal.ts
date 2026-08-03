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
 * Delivering it instead is not a one-line change. Role-differentiated
 * recall means putting non-system content into the message list, and the
 * messages slot does not reach the model today (see
 * `lib/injection-engine/messagesSlotRefusal.ts`): it is the observability
 * projection of the conversation, not a wire. Honouring `asRole: 'user'`
 * would have to route through that slot, which would trade a dead option
 * for a recorded-and-dropped one — strictly worse, because the recording
 * would then claim delivery.
 *
 * So the option is refused where it is written, and the refusal points at
 * the feature that would make it real: role-differentiated recall arrives
 * with messages delivery, if field evidence asks for it.
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
    `honoured, because honouring it means putting recall into the messages slot, ` +
    `which does not reach the model. Role-differentiated recall arrives with the ` +
    `messages-delivery feature, if field evidence asks for it. Drop the option: ` +
    `the behaviour you already had does not change.`
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
