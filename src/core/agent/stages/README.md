# `src/core/agent/stages/` — the ReAct loop's stage functions

One file per stage of the Agent chart, mounted by `buildAgentChart` /
`buildDynamicAgentChart` (never imported by consumers):

| file | stage |
|---|---|
| seed.ts | run-start state seeding (history, counters, injection arrays; restores the conversation's skill cursor under `continuity: 'conversation'`) |
| pickEntry.ts | off-loop entry scoring for `.entryBy()` skill graphs (subsumed by routeTurn.ts on cascade graphs) |
| routeTurn.ts | the turn-start routing cascade (SG-C): rules → classifier/scorer → menu, continuity judged, verdict on `scope.turnRoute` + `skill.turn_routed`. Mounts in PickEntry's slot under the SAME id (`STAGE_IDS.PICK_ENTRY`) only when the graph runs the cascade (`classify` or `continuity: 'conversation'`). 9.19.0: the tier-3 DECIDER arm — `SkillGraphOptions.decider` resolves an outstanding menu ∪ {stay} out-of-band via `constrainedEnumPick` (`by: 'decider'`, the sanctioned rails resolver); a decider-RESOLVED verdict (move or stay) writes the scope `TurnRoute` WITHOUT `offered` while the event keeps the full set |
| window.ts | `.window()` compaction (loop head when configured) |
| deliver.ts | messages-slot delivery (role-checked, sequence-checked) |
| callLLM.ts | provider invocation + streaming + reliability retry loop. 9.19.0: ONE `brainFor(nextSkillCursor ?? currentSkillId, skillEscalated)` consult at the top — the cursor picks the brain; precedence escalation > skill brain > `.configure()` > build default; `llm_start.brain` stamps the winning rung (absent = the agent's own config answered) |
| route.ts | the decider: tool-calls / output-retry / step-nudge / evidence-recheck / final. Three judges over a would-be-final answer, in this order: schema (a broken shape is replaced wholesale) → steps (`steps_unfinished` accepted/cut-short) → evidence (9.35.0 — every name and number must appear in a tool result). A DENIED answer is judged by none of them |
| toolCalls.ts | tool dispatch (pausable): permission gate → middleware → validation → credentials → execute; the read_skill gate; the step boundary (9.18.0) — advance/skip at EVERY result-finalization site, the batch loop AND all four resume paths. 9.19.0: the escalation counter (both `skill.rejected` sites feed `skillRefusalsThisTurn`; at `afterRefusals` the flip is committed + `skill.escalated` fires once) and the typed tool-effects judge (`applyToolEffects` — envelope unwrapped at every execute boundary; propose-transition reachability-checked, first-accepted-wins with `route_conflict { source: 'tool-proposal' }`; require-instruction leases granted from the declared catalog — but lease DEATH is owned by the injection engine's Evaluate tenure sweep (`nextInstructionLeases`), which is what keeps a dead lease dead across cyclic re-entry; `status` rides `tool_end` + the batch; a status-only near-miss missing its `effects: []` marker stays data and gets a dev-mode warning naming the fix). This release: `declareCoverage` at those SAME two execute boundaries — `absent()` / `coverage()` recognized on the UNWRAPPED content and BEFORE the ceiling (a declared boundary is not the channel that overflows), files `tools.absent` / `tools.coverage_declared`, appends to `coverageDeclared`, and returns the delivered status: `'absent'` when an absence is in play, and only when the envelope declared none |
| outputRetry.ts | `.outputSchema()` re-ask branch |
| stepNudge.ts | the unfinished-steps teaching re-ask (9.18.0): appends the premature answer + the nudge, once per turn, loops like SchemaRetry |
| evidenceRecheck.ts | the evidence correction (9.35.0): names the values that appear in no tool result back to the model, once per turn, loops like SchemaRetry. Mounted only under `posture: 'guard' \| 'rails'`; the check itself lives in ../evidence/ |
| reliabilityExecution.ts | in-loop reliability rules |
| prepareFinal.ts / breakFinal.ts | final answer + `$break`. ONE body (`captureTurnPayload`), TWO entry points: `prepareFinalWithLimitsStage` folds the run's declared coverage into the answer first and is mounted in place of `prepareFinalStage` (same id, same position) only under `.limitsTravelWithTheAnswer()`. The answer is a PARAMETER because `llmLatestContent` is a read-only input to this branch subflow — the capture is the only place `finalContent`, `newMessages` and `turn_end` can be made to agree |

## Tool-result wiring (9.16.0)

`toolCalls` maintains TWO scope keys as each result lands (collect during
traversal — a pause mid-batch commits the partial batch, resume paths append):

- `lastToolResult` — the last result; unchanged contract, kept for every
  existing reader (context-bisect's proximate-tool key among them);
- `toolResults` — EVERY result of the iteration's batch, in call order with
  `toolCallId`, reset at dispatch start. This is what `on-tool-return`
  triggers and skill-graph routes read (via the injection-engine mappers), so
  a parallel batch routes on all its calls, not only the last.

Any NEW dispatch path must write both (and apply `capResults` — see the note
on the five `tool_end`-emitting paths in toolCalls.ts).

A new EXECUTE boundary (not a new dispatch path — a new place a handler's
return first lands) must also call `declareCoverage`, for the same reason it
must call `refuseOverCeiling`: a limit that only some doors record is a limit
the record cannot be trusted about.

## The `read_skill` gate: role visibility is a FILTER every composer applies (9.86.0)

**Which skill ids a role may see is resolved ONCE per iteration, by the tools
slot, and published on `scope.hiddenSkillIds`. Every model-facing composer in
this stage filters through it before naming an id — in a sentence or in an
event payload.**

**Why.** It used to be a property of one builder. `Agent.hiddenSkillIdsNow()`
was resolved for the `read_skill` DESCRIPTION and nowhere else, so the
description carefully named nothing a role could not see while the gate, one
stage downstream, composed its refusal from `deps.allowedSkillIds(cursor)` —
the graph's raw hop set — and emitted the same raw set as
`skill.rejected.allowed`. A support role that could not see `beta` was told
"Reachable skills: beta" the moment it asked for anything unreachable. The
omission is free and the naming is what leaks, which is why the filter has to
reach every producer rather than the one that happened to be written first.

**And admission still reads the graph.** The filter governs what the model is
TOLD, never what the gate admits: a narrowing may take a schema off the wire,
never a name out of the dispatch map. So the gate keeps two sets — the raw one
it judges with, the filtered one it speaks with.

```typescript
// toolCalls.ts — the read_skill gate
const hidden = new Set(scope.hiddenSkillIds ?? []);
const visible = (ids: readonly string[]) => ids.filter((id) => !hidden.has(id));

const hops = deps.allowedSkillIds(currentSkillId); // the LAW: admission
const admissible = dedupeIds([...hops, ...(deps.openSkillIds ?? [])]);
const allowed = dedupeIds([...visible(hops), ...visible(deps.openSkillIds ?? [])]); // the SENTENCE

result = composeReadSkillRefusal({ requestedId, targetClass, hops: visible(hops), openIds: … });
typedEmit(scope, 'agentfootprint.skill.rejected', { requestedId, allowed, … });
```

`composeReadSkillRefusal` is the ONE composer for every arm — reachability,
posture, tree — because the two it replaced disagreed: one offered
"Reachable skills: beta", the other refused that very pick forty lines below.
Its sentences obey the same tense law as anything that lands in `history`: a
tool result is re-read on every later call of the turn, so every clause is a
past fact about the ONE call it names ("was not granted on that call"), it
names the cursor rather than saying "here", and it never offers a hop the
posture would decline. `unknownToolResult` is the same shape for a name
nothing can dispatch, and it names the DISPATCH roster (not the offer —
a held-out tool still runs when named).

### The filter's other half: a Lens may OMIT, a Lens may never DENY

**When the role filter empties a set, the clause that named it is DROPPED. It is
never replaced by the sentence for a set that was empty all along.**

**Why.** The filter's first draft passed the filtered array and nothing else, so
every composer branched on `length > 0` — and "the graph held nothing" and "the
filter emptied it" produced the same sentence. A cursor whose only declared hop
was hidden answered `read_skill` with *"No skill was reachable from 'alpha' when
that call was made."* The graph was routing `alpha` the whole time. Omission is
free and is always true; the negative is a denial of what the run is holding, and
a model told the map is a dead end stops asking for the door it may not be shown.
The same shape sat in the `'guard'` arm ("no menu was outstanding", plus
"Declared routes moved the cursor instead") and in the unknown-tool roster.
(9.86.1 then dropped the "Declared routes" tail from every no-menu arm for a
second reason: it was composed for all six `TurnRoute.by` values and true of
none in particular — false for a carried-over cursor, false for a menu the
model's own pick had resolved. The arm now takes `turnStartedBy` and states the
one past fact that value stands for.)

**How.** `SpokenIds` is the fact, and `held` is REQUIRED so the compiler asks
every caller the question the call sites each forgot:

```typescript
// src/lib/spokenIds.ts — one set, both halves
export interface SpokenIds {
  readonly named: readonly string[]; // what this sentence may name
  readonly held: boolean; // did the UNFILTERED set hold anything?
}

const hidden = new Set(scope.hiddenSkillIds ?? []);
const hops = spoken(deps.allowedSkillIds(cursor), (id) => !hidden.has(id));
// hops = { named: [], held: true }  ⇒ the hop clause is omitted, not negated.
```

**It is a leaf, and that is the point.** It began life in `toolCalls.ts`, which
put it on the wrong side of the skill-graph fence: the `read_skill` DESCRIPTION
is composed in `src/lib/injection-engine/`, which may not import this stage, so
the one surface the model reads to CHOOSE went on printing "Nothing is reachable
from here" over a graph whose only hop the role filter had removed — the repaired
law, and the surface it mattered most on left out of it. `src/lib/spokenIds.ts`
imports nothing and is reachable from both.

**Tool NAMES are governed by the same fact.** A role that may not see a skill may
not be told the names of the tools that skill brought, so `dispatchRoster` filters
the dispatch map through `scope.hiddenSkillIds` before `unknownToolResult` names
it — using `ToolRegistryArtifacts.toolDeclaringSkills`, the build-time owner of
"which skills declare this tool name". A tool two skills share survives one of
them being hidden (the sole-owner rule the step hold-out already uses), and
dispatch is untouched: `lookupTool` still resolves every name in the map.

And the sentence reports RESOLUTION, not dispatch — `Tool names that resolved to
an implementation on that call: …`. The permission check and the middleware chain
sit between a name resolving and a tool running, and neither is asked to phrase an
error.

Under `reactMode: 'dynamic-grouped'` the tools slot runs inside `sf-llm-call`
and this stage runs outside it, so the boundary's outputMapper bubbles
`hiddenSkillIds`, `dynamicToolSchemas` and `activeInjections` out. A chart
shape is a rendering choice and must not change what the model is told —
`test/skillGraphSelfCallGrouped.test.ts` pins the two shapes to the same
answer.

### A self-call skips the policy only while the cursor is MOUNTED

**`read_skill` naming the cursor's own skill is answered before the `skill_read`
permission check — but only when that cursor is mounted. At a PARKED cursor the
same id is a re-engagement, so the policy keeps the question.**

**Why.** The skip rests on one claim: a stay activates nothing, moves nothing,
and reveals nothing the request did not already carry, so there is no capability
for a checker to grant. That is true of a mounted cursor, whose body is in that
call's system prompt and whose tools are on that call's wire. Parking makes it
false: it suppresses the map's contribution and leaves the cursor exactly where
it was, which is why the gate below reads the same id as a RE-ENGAGEMENT and puts
the body and its tools back on the wire next pass. Skipping the check there let a
role whose policy hides the skill un-park and re-activate it — strictly more than
9.85.0 allowed, and a narrowing is only ever allowed to run the other way.

**How.** One predicate, `atMountedCursor`, asked by both gates over the parked
set `parkedNow` computes from `parkedMemberIds` (the maps kernel's own owner of
the fact — the engine imports it, never the reverse):

```typescript
// toolCalls.ts — the skill_read permission gate
const stay = atMountedCursor({
  ...(typeof scope.currentSkillId === 'string' && { cursor: scope.currentSkillId }),
  target: requestedSkillId,
  parked: parkedNow(scope), // undefined for any agent that never called .maps()
});
if (!stay) {
  await askCapability('skill_read', skillTarget(requestedSkillId), …);
}
```

`classifySkillTarget` alone cannot answer this: it owns POSITION (is the target
where the cursor stands?), and a park is a fact about ENGAGEMENT. The dispatch
gate writes the same rule as two ordered arms — re-engagement first, then the
self-call notice — and this gate, which has no arms to order, asks the predicate.

## Anything a stage appends as a `role: 'user'` turn (9.86.0)

Two stages here write a message in a person's voice: `wrapUp.ts` (the
out-of-budget instruction) and `stepNudge.ts` (the unfinished-steps teaching
re-ask). Both obey one law, and any new stage that appends a user turn obeys it
too:

1. **It opens with a prefix registered in `src/lib/saidByPerson.ts`.** The
   writer imports the constant the recogniser matches on — never retypes it.
   Without the opening, `isSaidByPerson` credits the framework's own words to a
   person: the window's refusal engine can pin "the current request" on our
   instruction and let the real request be dropped underneath it, and a routing
   rule reading `InjectionContext.history` matches on our bookkeeping (the
   wrap-up used to say "Do not request tools"; the nudge names a skill id and
   every unrun step's tool name).
2. **Every clause is a past fact about the call it was written for.** The
   message stays in `history` and is re-read on every later call of the turn —
   including a schema retry or an evidence recheck — so a present-tense claim
   or a standing instruction is a prediction about a call that has not
   happened.

```typescript
// wrapUp.ts
import { WRAP_UP_FRAME_PREFIX } from '../../../lib/saidByPerson.js';

export const WRAP_UP_INSTRUCTION =
  `${WRAP_UP_FRAME_PREFIX} — the action budget was exhausted before this call, so no tools ` +
  'were offered on it. This call was for the final answer, from what the messages above ' +
  'already hold: what was completed, what remained undone, and anything the person should ' +
  'know.]';
```

The tools are still withheld by `scope.wrapUpAsked` at request assembly in
`callLLM` — a mechanism, never a sentence asking the model to abstain.

`test/lib/injection-engine/userTurnProducers.test.ts` walks `src/` for every
`role: 'user'` construction site and fails on one that is neither a registered
frame, nor a person's own words, nor request-only (`callLLM`'s staged-refs
nudge and `reliabilityExecution`'s ephemeral feedback line are the two
request-only producers here — they never touch `history`, which is why they
need no frame).

## Every model-facing sentence this stage composes is REGISTERED (9.86.0)

**A composer here is registered as a row in `test/modelFacingSurfaces.test.ts`,
the row calls the shipped code, and the checker
(`test/helpers/modelFacingClaims.ts`) reads its real output at
`TOOL_RESULT` — the persistent lifetime, because everything this stage
composes lands on a `role: "tool"` message and is re-read for the rest of the
turn.**

**Why registration is not optional.** The checker existed before this release
and it caught nothing new, because coverage was decided by which suite happened
to import it: the `read_skill` refusals and the unknown-tool result were live
producers matching its own rules, and neither had a row. A registered producer
cannot be an unchecked one — the row IS the check — and
`test/modelFacingScan.test.ts` now walks `src/` so an unregistered one fails
with its file and line instead of shipping.

```typescript
// test/modelFacingSurfaces.test.ts — one row per producer, composing the REAL code
{
  id: 'skill-graph — the read_skill REFUSAL composer',
  module: 'src/core/agent/stages/toolCalls.ts',
  surface: TOOL_RESULT,
  lifetimeBecause:
    'the gate returns it as the result of the `read_skill` call it declined, so it is ' +
    'written onto a `role: "tool"` message and re-read on every later call of the turn',
  reaches: [/was not reachable from 'billing'/, /'rails' posture reserves routing/],
  compose: async () => [
    composeReadSkillRefusal({ requestedId: 'vault', targetClass: 'unreachable', cursorId: 'billing', hops: ['refunds'], openIds: ['debug'] }),
    // … one call per ARM: tree, rails, guard-with-menu, guard-without-menu
  ],
}
```

Two things a new row must carry, because both were assertions with no argument
before: `lifetimeBecause` (a lifetime is what the rules judge on) and, on the
checker side, `exemptBecause` beside any `provableWhen` — the two are now one
discriminated union, so a rule cannot exempt a lifetime without saying why.

