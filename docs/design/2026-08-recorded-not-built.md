# Recorded, not built — the 9.59.0 packet's deferred design questions

Five things surfaced while fixing the mount kernel and the cache meter that are
**real, understood, and deliberately not built here**. Each one is a design
round of its own. This note exists so none of them has to be rediscovered.

Written 2026-08-20, against 9.59.0.

---

## 1. `read_skill` is doing two jobs

**The observation.** `read_skill` currently means both *move the cursor* and
*establish the right to contribute*. 9.59.0 made that worse before it made it
better: a pick of a parked map's member is now routed by INTENT and treated as
a re-engagement that does **not** move the cursor. That is the right behaviour
and the wrong shape — one tool name whose meaning depends on hidden state is
exactly the kind of thing this framework exists to make visible.

**The clean answer.** Separate primitives that never move a cursor:

- `engage(mapId)` — ask for a map's contributions to ride again.
- `release(mapId)` — say this map is not what the turn needs.

`read_skill` then becomes sugar: a pick of an unreachable-but-parked member
desugars to `engage`, a pick of a reachable member desugars to a cursor move.
The model gains a vocabulary for the axis the kernel owns, instead of having to
express engagement in the language of position.

**Why not now.** It is a new public tool surface, so it needs a name round, a
refusal grammar, an event pair, and a migration story for every agent whose
prompt teaches `read_skill`. Shipping the intent routing first is what makes
the sugar definable later without guessing.

**Cost of waiting.** The behaviour is correct today; only the vocabulary is
overloaded. The park card names the way back explicitly, so a model is not left
to infer the double meaning.

---

## 2. Should a weak lexical entry place a cursor at all?

**The observation.** A keyword match currently **places the cursor**, and the
ledger then records "we entered audit" when the person never asked to audit
anything. Parking hides the *contribution*, but the position record is still
false provenance — the map says the model went somewhere it never chose to go.

**The clean answer.** A weak clause NOMINATES rather than places. The cursor
stays where it was (or nowhere), the nomination is recorded with its strength
and its witness, and the contribution rides only once something confirms it.
Position evidence would then never be weaker than `semantic`.

**Why not now.** Entry placement is load-bearing for every graph that starts a
turn from a keyword: making entries nominate changes the first-pass behaviour of
every existing skill map, and needs a compatibility posture (a dial, a major, or
both). 9.59.0's separation of position evidence from engagement evidence is the
prerequisite — the record can now *state* that the cursor was placed by a guess,
which is what makes the stronger rule specifiable.

**Cost of waiting.** The ledger still says "we entered audit" on a weak match.
It now says so with `atBy: 'lexical'` beside it, so the claim is qualified
rather than bare, but the sentence is still stronger than the evidence.

---

## 3. Stale affordances — VERIFIED, and the ask is recorded

**The question.** A person can move the screen cursor between the model
generating a call and the runtime dispatching it. Does a served affordance carry
a cursor or frame version that is checked at invocation?

**What the source says (verified, `src/core/agent/stages/toolCalls.ts`).**
No version stamp exists. The gate reads `scope.currentSkillId` **live at
dispatch** and recomputes the reachable set from it, so a pick offered under an
older cursor is judged against the newer one.

The good news: this **fails closed**. A stale pick is refused, not silently
accepted, so nothing runs against a frame that has moved.

The gap: the refusal says *"not reachable from here"*, which describes the new
world and not what happened. The model is told its choice was invalid, never
that the ground moved between the offer and the call. It cannot distinguish
"I misread the menu" from "the menu changed under me", so it has no way to
respond correctly (retry vs. re-read).

**The ask.** Stamp the offer with the cursor (or frame) it was built from, carry
it through the tool call, and compare at dispatch. On a mismatch, refuse with
the *true* reason — "the cursor moved from X to Y after this menu was built" —
and emit it as its own event. Cheap, since both values already exist at both
moments; the only new thing is carrying one identifier and one branch in the
refusal.

---

## 4. The durable working-evidence projector

**The observation.** Parking a wrong prompt saves tokens. It does **not** fix
the three other recorded failures, and it is important not to let a token win
be mistaken for a correctness win:

- identifiers that vanish from the window and are then invented,
- a final summary that denies work the run actually completed,
- the same tool sequence repeated because nothing said it was already done.

All three are failures of the same missing thing: a **durable projection of what
this turn has established**, maintained across the ledger → turn read model →
call frame path, rather than reconstructed from whatever survived the window.

**Why not now.** It is the largest item on this list and the least like the
others: a new state artefact with its own lifetime, retention policy, and
serialization, plus a rule for what earns a place in it. It should be designed
against the recorded traces, not against intuition.

**Cost of waiting.** Unchanged by 9.59.0. Nothing in this packet claims to
address it, and the mount kernel's docs should not be read as doing so.

---

## 5. R4 — the `read_skill` description rewrites the prompt cache

**The finding.** `describeOffer` builds the `read_skill` tool DESCRIPTION from
the cursor every iteration ("Reachable from here", "Not reachable from here",
the turn menu). Cache prefixes are built TOOLS → SYSTEM → MESSAGES, tools sit at
position zero, and modifying a tool definition invalidates the **entire** cache.
So every cursor move rebuilds all three tiers.

**The measurement (shipped, `test/cache/read-skill-cache-cost.test.ts`).**
A five-call turn over a five-skill chain with four cursor moves produces
**five distinct `read_skill` descriptions** — one full cache rebuild per call.
The control arm holds the cursor still and produces **exactly one** description
across the same number of iterations, which isolates the cause: it is the
cursor, not the iteration count. On the recorded 29-call turn there were 11
cursor moves, so the cache was being rebuilt about a dozen times per turn,
independently of the meter bug.

**The decision: not built in this packet, and why.** Making the description
stable is one function. The hard half is where the volatile guidance goes: it
has to land **after the last cache breakpoint** to be re-sendable cheaply, and
breakpoint placement is the cache layer's business — there are at most four
breakpoints per request (a fifth is a 400), top-level automatic caching consumes
one, and each looks back at most 20 content blocks. So a correct fix is a
cross-layer change spanning the tools slot, a message-or-system slot, and marker
placement.

It also carries a **model-behaviour risk** that a token measurement cannot
settle: the reachability guidance is what stops the model picking ids the gate
will refuse. Moving it to a less prominent position may cost routing quality,
and that trade needs an A/B on real traces, not a guess.

**What to preserve when it is built.** The teaching value. The guidance must not
simply be deleted; it must be relocated. Two shapes worth evaluating:

- the volatile part as a system or message block placed after the last
  breakpoint, leaving the tool description a stable sentence that points at it;
- the reachable set as an **argument the model passes** (it already knows where
  it is), turning a definition change into an argument change, which does not
  invalidate anything.

The measurement test fails the moment the description becomes stable. That is
deliberate: it is the alarm that brings someone back to this note.
