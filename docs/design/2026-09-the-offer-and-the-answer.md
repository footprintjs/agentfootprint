# The offer and the answer — one owner per tool name (design, 2026-09-11)

**Status:** BUILT 2026-09-11 as 9.92.0. Approved by the owner 2026-09-11 ("ok go ahead"). Closes
recorded-not-built entries 1, 2, 3, the `claim-swallowed` family named under entry 1, and the
9.91.0 follow-up "the tools slot accumulates". Read this page whole first.

## Where the build differed from this page (the code's law won)

- **A name not on the wire is refused ONLY when its offered party can no longer answer.**
  This page's `lookupTool` bullet says a name absent from the epoch's wire is refused as a
  recorded tool result. The capability law (`buildToolRegistry.ts`) and its pins —
  `epoch-laws.test.ts` 1(a)(b)(c1)(c2)(e) — say a narrowing takes a name off the WIRE,
  never out of DISPATCH: a held-out step tool, a parked map's tool, a scoped tool named from
  a restored transcript all still run. The review of the first build then showed the
  unqualified fallback reopening entry 1 through the side door: a provider withdraws a name
  the model read under its contract and the never-activated skill answers; a fresh-instance
  resume does the same. So the rule as built: a name ON the wire resolves to the wire's
  party; a name OFF the wire resolves to the party the model LAST read it under
  (`ServedToolParties.lastServed`), or to its only holder when it was never served, and that
  dispatch is put on the record by `agentfootprint.tools.answered_off_wire`; a name whose
  last-served party cannot answer — the provider withdrew it, or the resume is in a fresh
  instance that never resolved the provider's list — is refused with `toolCalls.ts` ·
  `notServedResult`, never handed to a stranger. A pause that re-dispatches on resume carries
  the served party on its checkpoint (`pausedToolParty`, pause-path-only). An unknown name
  keeps `unknownToolResult`.
- **The event is `agentfootprint.tools.claim_swallowed`**, not `claimSwallowed`: the registry
  pins every event to `agentfootprint.<domain>.<action>` in `[a-z_]` (`test/events/unit/
  registry.test.ts`). The `EVENT_NAMES.tools.claimSwallowed` key keeps the camel name.
- **The payload mirrors its sibling:** `{ toolName, iteration, lostBy, lostById?, wonBy,
  wonById? }` — the `*Id` twins `tools.shadowed` already carries, in the shared vocabulary
  `ToolNameChannel = 'provider' | 'registry' | 'skill' | 'framework'` (`'framework'` is new;
  the walk used the nearest true word before).
- **No `offered: false` on `tools.shadowed`.** That flag was written against the OLD dispatch
  (entry 1's bullet). Once dispatch follows the offer, `dispatchTo` can never truthfully name a
  party that was not on the wire, so there is nothing for the flag to mark. What it would have
  said is carried by WHICH event fires: `tools.shadowed` only when the loser's contract
  competed this epoch; `tools.claim_swallowed` for every loss, competing or reserved.
- **Build-time refusals stand.** A static `.tool()` or a skill tool named `skip_step` /
  `present` is still refused at build (the walk ratchets 26 refusals); "a claimant like any
  other" applies to the pair build time cannot see — a provider.
- **Identity is by implementation, not by party.** Two skills sharing ONE `Tool` reference
  (documented-legal) are one claim: `WireCandidate.tool` / `ToolClaim.tool` decide, and a
  same-`tool` claimant is never a loser. The first build judged by party and reported the
  shared reference as swallowed every epoch.
- **The reference set for byte-identity** is `test/core/tools/reference/` (15 collision-free
  runs, `commitLog` + `servedAt(k)`, generated on the 9.91.0 tree — the shared-reference pair
  on a 9.91.0 worktree); the receipt-conformance suite itself is unchanged and green on all
  four chart shapes.

## The question

At every LLM call the model is OFFERED a list of tool contracts (the wire; the receipt hashes
each one). When the model calls a name, something ANSWERS. The family's promise is that the
record says what was offered and what answered. Today, for one tool name claimed by more than
one party, the offer and the answer can come from different places and the record can say
nothing (entry 1), name the wrong source (entry 2), or let the framework answer a call the model
believed was a third party's (entry 3). And a claimant can lose both the wire and the dispatch
and simply be dead, unreported (`claim-swallowed`, 22 baseline rows).

## The law

**For every tool name on a call, exactly one party owns the OFFER and the same party owns the
ANSWER — or the record names the disagreement.** Three consequences:

1. **Dispatch follows the offer.** The implementation that answers a call is looked up by the
   contract the model was served on THAT epoch, never by a build-time map that ignores
   activation. An inactive skill's tool that was never on the wire never answers.
2. **The report's subject is the wire.** The shadowing report answers "did the contract on the
   wire and the implementation that answered come from different places", computed from the
   MERGED wire list crossed with the dispatch resolution — not from `activeInjections`, which
   cannot see an inactive skill, a static `.tool()`, or a framework auto-attach.
3. **A dead claim is reported.** A party whose tool name is held by another party — losing the
   wire AND the dispatch — is named once per epoch it lost, with who won and why. Silence is
   the defect this family exists to prevent.

## Sites (read the entries' "The cause" paragraphs; they cite file · symbol)

- `buildToolRegistry.ts` (the backfill loop that maps every skill tool with no activation gate):
  the registry keeps EVERY claimant per name — a list, not a winner — with each claimant's
  source (`provider` | `skill:<id>` | `static` | `framework`). Build time decides nothing.
- `toolCalls.ts · lookupTool`: resolves against the epoch's served tool list (the same list
  `composeRequest` assembled and the receipt hashed — one owner, do not re-derive), then to the
  claimant whose contract that entry came from. A name not on the wire this epoch is refused
  with the library's reason (the model called a tool it was not offered), recorded as a tool
  result the receipt can see — never silently answered by whoever is first in a map.
- `buildToolsSlot.ts · reportShadowedTools`: subject = wire × dispatch, per epoch; emits the
  existing `agentfootprint.tools.shadowed` with `schemaFrom`/`dispatchTo` truthful (an inactive
  skill id is a truthful answer; say `offered: false` beside it), plus a new
  `agentfootprint.tools.claimSwallowed` for a dead claimant (`toolName`, `lostBy`, `wonBy`,
  `iteration`). Both events ride the emit channel (telemetry law); neither changes the wire.
- `skip_step` (entry 3): the framework's auto-attach is a claimant like any other. If a provider
  or skill also claims `skip_step`, the framework does NOT silently win: the wire carries the
  framework's contract only when no other party claims the name; otherwise the disagreement is
  reported and dispatch follows the offer. The procedure never advances on a call whose
  contract the model read from someone else.
- `buildAgentMessageApiChart` tools slot (9.91.0 follow-up): `arrayMerge: Replace` on that
  outputMapper so turn 2 does not hand the model `['weather','weather']`; pinned by asserting
  the wire's tool list equals the declared set at every turn.

## What must be proven (each red before)

The five reproductions in the entries, verbatim, now produce: (1) inactive skill → the provider
answers, `shadowed` 0×, and the inactive skill's execute is never called; (2) stepped skill vs
provider → `schemaFrom`/`dispatchTo` agree with the wire on every epoch; (3) `skip_step` vs
provider → the provider answers, the procedure does NOT advance, one `shadowed` event names it;
(4) `claim-swallowed`: the 22 baseline rows each produce one `claimSwallowed` event naming
loser and winner; (5) the accumulate follow-up: tool list == declared set on turns 1..3.
Then the receipt conformance suite on every chart shape (the wire is unchanged for every
run that has no name collision — byte-identity of `commitLog` and the served view against
references generated on 9.91.0 for the existing fixtures).

## Docs

Tools README (WHY + the law + one example per consequence); the two events in the events
catalogue with their shapes; CHANGELOG [9.92.0]; recorded-not-built entries 1–3 marked built
with the date; the `claim-swallowed` bullet under entry 1 and the 9.91.0 follow-up marked closed.
