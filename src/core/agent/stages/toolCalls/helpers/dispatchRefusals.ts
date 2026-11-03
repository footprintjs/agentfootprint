import type { SpokenIds } from '../../../../../lib/spokenIds.js';

// LENS · tool-result · persistent-history
// reads: the dispatchable roster ← `toolCalls.ts` · dispatchRoster: registry ∪ provider cache, filtered through scope.hiddenSkillIds
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * What a call to a name nothing can dispatch gets back (9.86.0).
 *
 * `Unknown tool: X` was the whole sentence, on both dispatch doors, while
 * `mcpServe` — the same library, one directory away — had been answering
 * "Unknown tool 'rm_rf'. Served tools: echo, delete_account." for releases. The
 * model that mistyped a name, or named one from a restored transcript, was told
 * only that it was wrong, never what would have worked, and the cheapest repair
 * (read the roster) was the one it could not make.
 *
 * The roster is the DISPATCH set — `registryByName` plus the provider cache —
 * because that is the true statement about resolution: these are the names that
 * answered to something. It is deliberately NOT the offer: the wire is narrowed
 * by steps, parks and postures, and a held-out tool still dispatches by name, so
 * an offer-shaped list would be a different (and here, false) claim.
 *
 * ── AND IT SAYS "RESOLVED", NOT "COULD BE DISPATCHED" ───────────────────
 *
 * The first draft said "Tools that could be dispatched on that call". Two gates
 * sit between resolution and a tool running — the `tool_call` permission check
 * and the middleware chain — so a name in this map can resolve and still be
 * refused, and the sentence promised the model a dispatch the very next gate
 * would decline. Neither gate is asked here: a `PermissionChecker` is a port
 * (a hub call per name, with its own events and its own audit rows), and
 * spending a whole permission sweep to phrase an error is a cost the sentence
 * does not need. It reports what this map DID — resolve a name — and claims
 * nothing about what would have happened next.
 *
 * The roster is role-filtered before it gets here (`dispatchRoster`), so a tool
 * belonging to a skill the caller's policy hides is never named; and when the
 * filter empties a stocked roster the clause is DROPPED, because "no tool name
 * resolved" would be a denial of what the dispatch map is holding.
 *
 * Anchored past tense, like every other persistent result: "on that call" binds
 * the roster to the finished call the result answers, so a later iteration that
 * adds or drops a provider tool cannot make this sentence wrong. No exhortation
 * — the model does not need to be told to try again.
 *
 * Exported for the producer registry, and used by BOTH dispatch doors so they
 * cannot drift.
 */
/**
 * What a call gets back when the party whose contract the model read under
 * this name cannot answer it, and no other party may (9.92.0).
 *
 * Two doors reach here. A name that LEFT the wire — the model read a
 * provider's contract on an earlier call and the provider withdrew the name —
 * whose only remaining holder is a party the model was never shown under that
 * name (a scoped skill that never activated): dispatching that holder would
 * hand the model's belief to a stranger's function, which is the silent
 * identity swap this release closed. And a resume in a fresh Agent instance
 * of a provider-served call, where the served party is on the checkpoint but
 * the provider's list has not been resolved on this instance.
 *
 * It names no roster on purpose: `unknownToolResult`'s roster is the DISPATCH
 * map, and the map here holds exactly the implementation this sentence is
 * refusing. Anchored past tense, one clause, like every persistent result.
 */
export function notServedResult(toolName: string): string {
  return (
    `Tool '${toolName}' did not run on that call: the implementation whose contract was ` +
    `offered under that name was not available to answer it.`
  );
}

export function unknownToolResult(toolName: string, dispatchable: SpokenIds): string {
  const head = `Unknown tool '${toolName}' on that call.`;
  if (dispatchable.named.length > 0) {
    return (
      `${head} Tool names that resolved to an implementation on that ` +
      `call: ${dispatchable.named.join(', ')}.`
    );
  }
  // Held-but-unnameable: the map had entries this caller may not be told about.
  // Omission is free; the negative below would be false.
  return dispatchable.held
    ? head
    : `${head} No tool name resolved to an implementation on that call.`;
}
