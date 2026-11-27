**Mixed** — the skill-context decision over the agent's build facts, and the call gate that enforces it.
The Fold is `decide.ts`; the Lens is `gate.ts` (what a refused call is told) and `apply.ts` (what the prompt and tool list show).

# `core/agent/skillContext/` — how skills reach a model that binds its reasoning

On a model whose thinking is bound to the context it was written under (`thinkingBinding`
answers `bound`, or `unknown` for an id the adapter cannot place), a skill that joins the system
prompt or the tool list in the middle of a tool turn invalidates the signed thinking before it, and
slice 1 (`../contextBinding/`) refuses that request by name. This folder makes the common skill
load change nothing instead.

| File | Job |
|---|---|
| `decide.ts` | `decideSkillContext`: the strictest binding over every provider and model the agent's own calls reach (the agent, each skill brain, the escalation), then the two tables of `injection-engine/skillContext.ts` evaluated with footprintjs `decideFromFacts`; `decisionRecord` / `fixedRecord` make the records. Evaluated ONCE, by `runtime/configuration/configure.ts` · `configureAgent`. |
| `apply.ts` | Keeps the decision on the configuration. Under `listed` every skill gets `metadata.skillContext: 'listed'`, and the evidence gate gets the registered bodies. |
| `bodies.ts` | `skillBodyOf`: the current body definition held by a recorded `read_skill` occurrence. The window and the system slot verify the same body record. |
| `honestyView.ts` | `honestyHistory`: the history the evidence gate's two moments read under `listed`, where a body result reads as the `declared` confirmation and the body is exempt app text. |
| `systemBodies.ts` | Capture the accepted request’s system skill pieces and keep eligible pieces in slot order for the current turn. |
| `gate.ts` | `notLoadedFor`: after role admission, a visible scoped tool that isn't loaded is refused with fixed words. |

## The rule tables

The fenced skill core owns them as data (`injection-engine/skillContext.ts`, pure-core zone):
`SKILL_TOOL_TABLE` over the flat fact `binding` (`bound` → `listed`, `unknown` → `listed`, default
`declared`) and `SKILL_BODY_TABLE` over the flat fact `tools` (`listed` → `tool-result`, default
`declared`), with `SKILL_BODY_MEASUREMENT` (the script and run that chose the body channel). An app
that states `AgentOptions.skillContext` gets `fixedRecord(value, undefined, 'app')` for the tools;
the body table still runs.

## Where `listed` takes effect

- `buildToolRegistry` · `listedScopedTools`: scoped tools join the static list; no skill-scope
  omission is reported; `listedScopedTools` names them for the gate.
- `core/slots/composeSkillCatalog.ts`: the static list drops every tool whose declaring skills are
  ALL hidden from this iteration's role. The catalog, roster and dispatch all check the
  actual registered claim through `toolVisibility.ts` and the shared skill-role predicate.
- `injection-engine/skillToolDescriptors.ts`: `read_skill` returns the body of ANY skill it loads,
  a graph route or step target included.
- `injection-engine/skillContext.ts` · `servedSurfaceMode`, asked by `projectActiveInjection`: the
  body is `tool-only` exactly while its `read_skill` result is in the history this request sends;
  otherwise the skill's own declaration (the system prompt by default), so a body is never lost.
- `stages/window.ts` + `window/turns.ts`: a turn holding the NEWEST body result of a still-active
  skill refuses to leave (`'active-skill-body'`); older copies are ordinary history.
- `stages/toolCalls/execution/finalizeCallResult.ts`: a re-read whose body is already in the history
  this request sends answers the `declared` confirmation, never a second copy.
- `stages/toolCalls/routing/readSkillRoute.ts`: a listed self-read acknowledges instructions that
  already rode the system slot or tool history. Declared `'both'` keeps its explicit repeat.
- `stages/callLLM/executeCall.ts` checks the request given to the provider port. The accepted
  response records the matching system skill pieces; the next slot may retain those pieces in
  their original positions after a cursor move. The current role filter still governs retention.
- `core/slots/buildMessagesSlot.ts`: a body result is credited to its skill (`source: 'skill'`), so
  the answer account (`answer-account/facts/understood.ts`) records the skill as delivered.
- `stages/route.ts` and `stages/toolCalls/evidence/towers.ts`: the evidence gate's two moments read
  `honestyHistory`. The other readers of tool messages (`figures.ts` is handed the view by
  `judgeEvidence`; `groundedText.ts` grounds on the system prompt under `declared` too;
  `settledToolCalls.ts` is a call ledger, not a value corpus) put no body value anywhere a person
  reads as tool evidence.
- `runtime/skills/owner.ts` · `readSkillOfferFor`: the description leaves out the cursor, the
  menu and the reachable set (a tree's grantable set is its open skills, which do not move).
- `stages/toolCalls/execution/callStart.ts`: the gate. `finalizeCallResult.ts`: a result from the
  library's own `read_skill` (`skillTools.ts` · `isLibrarySkillReader`) is neither placed nor capped.
- `stages/callLLM/prepareCall.ts`: `skillContext` on the `llm_start` of iteration 1, absent when
  the default chose `declared`.

## Known limits

- A graph can activate a skill before `read_skill` has carried its body. The system slot
  supplies that body. An already-served piece can survive an in-turn cursor move; a newly
  introduced piece still changes the signed context.
- A body result removed by a summary, window or middleware does not suppress the system
  slot for that definition. A signed call still refuses a change to the protected prefix.
  The refusal identifies middleware only when the recorded tool result lost the body there.
- Old histories without a producer record cannot establish that a result carried a skill
  body. The current definition then follows its declared system-delivery rules.
  The evidence reader keeps that unverified result out of both tool evidence and app text.
- The role is asked once per iteration, as before (`hiddenSkillIdsOf`). A role changed between
  turns re-lists on the next turn's first request; a role revoked inside a signed tool turn is
  slice 1's named refusal.
- Under `declared` nothing here runs: an UNSCOPED tool of a hidden skill stays on the wire and
  runs when called by name, as before this folder existed (its own card).
- A `withFallback` pair answers for its primary, so a bound fallback behind an unbound primary
  stays `declared` unless the app states `listed`.
- Decided at build from the build-time provider; a `.configure()` that swaps the provider per run
  does not re-decide it.
