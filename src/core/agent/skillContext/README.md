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
| `apply.ts` | Keeps the decision on the configuration. Under `listed`, a skill `read_skill` activates gets `surfaceMode: 'tool-only'` and every skill gets `metadata.skillContext: 'listed'` (the `read_skill` description reads it to say where a body goes). |
| `gate.ts` | `notLoadedFor`: a call to a scoped skill tool, served under a skill's claim, while none of the skills that declare it is active, is refused with fixed words. |

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
- `runtime/skills/owner.ts` · `readSkillOfferFor`: the description leaves out the cursor, the
  menu and the reachable set (a tree's grantable set is its open skills, which do not move).
- `stages/toolCalls/execution/callStart.ts`: the gate.
- `stages/toolCalls/execution/finalizeCallResult.ts`: a result from the library's own
  `read_skill` (`skillTools.ts` · `isLibrarySkillReader`, provenance, never the name) is neither
  placed nor capped.
- `stages/callLLM/prepareCall.ts`: `skillContext` on the `llm_start` of iteration 1, absent when
  the default chose `declared`.

## Known limits

- A skill the graph activates has no `read_skill` result: its body stays in the system prompt from
  the first request it is active on, so a cursor move inside a signed tool turn is still refused
  by name. The measured append channel (a library line after the tool results) is the follow-up.
- The evidence gate still reads a body in a `read_skill` result as tool output, not as the app's
  text (`stages/turnExempt.ts` does not add it).
- A `withFallback` pair answers for its primary, so a bound fallback behind an unbound primary
  stays `declared` unless the app states `listed`.
- Decided at build from the build-time provider; a `.configure()` that swaps the provider per run
  does not re-decide it.
