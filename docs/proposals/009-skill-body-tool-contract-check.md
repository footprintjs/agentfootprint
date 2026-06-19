# Proposal 009 — Skill-body ↔ tool-contract consistency check

**Status:** DESIGN (no code yet — gated on approval)
**Motivation:** a real adopter bug (Neo / `neo-agentfootprint`).

## The bug this prevents

A skill's `body` (prose injected into the system prompt) can contradict its tools'
*actual* contracts. The model then **refuses a tool that is right there in the request**.

Real instance (Neo, commit `1424a8f`): the `fabric-inventory` skill body wrote
`influx_get_switch_inventory(switch_name)` as if `switch_name` were **required**. The
tool's `inputSchema.required` does **not** list it (it's optional, no-arg = whole
fleet). Result: *"'give me the switch inventory' was being refused — the model claimed
it needed a hostname."* The tool was registered, visible, and callable. The **system
prompt's skill body lied about the contract.**

The library already *knows* the real contract (`tool.schema.inputSchema`). It can flag
the mismatch at dev time instead of letting it surface as a model refusal in prod.

## Two tiers (deterministic first, LLM-advisory second)

### Tier 1 — deterministic, build-time, no LLM

Pure static checks over each skill's `body` text + its `tools[]` schemas:

| Code | Checks | Catches |
|---|---|---|
| `body-tool-uncallable` | a tool NAME appears in the body but is not in this skill's `tools[]` (nor a global `.tool()`) | "told the model about a tool it can't call" (the §5(e) trap; Neo's intentional cross-skill handoff hints would be flagged → allow an opt-out marker) |
| `body-unknown-param` | the body references `tool(param)` / a `param` that is not in that tool's `inputSchema.properties` | typo'd / stale param names |
| `body-tool-unused` (off by default) | a tool in `tools[]` is never named in the body | forgotten/dead tool in a bundle |

**API:** extend `graph.checkup()` (the skill graph already has a build-time check-up)
with the new codes, AND export a standalone `checkSkillContract(skill)` so plain
(non-graph) skills get it too. Pure + side-effect-free, dev-mode gated for warnings.

### Tier 2 — LLM-advisory, dev-time, opt-in (the part that catches the EXACT bug)

Tier 1 is deterministic but **cannot** catch the friend's exact bug: `switch_name` *is*
a real param — the body just wrongly calls it *required*. "Required vs optional stated
in prose" is **semantic**, not pattern-matchable. That needs an LLM.

A dev-time pass reads each skill's `body` + its tools' `inputSchema` (which args are
truly `required`) and flags contradictions like *"the body says `switch_name` is
required, but the schema marks it optional."* Rendered **advisory, copy-only** (never
auto-rewrite), reusing the agentThinkingUI **description-doctor** diff UI + the existing
`onExplain` seam. Honest dependency: Tier 2 needs an LLM; Tier 1 does not.

## Honest scope

- **Tier 1** catches *adjacent* contract bugs (uncallable tool, unknown param)
  deterministically and cheaply — high value, ships standalone.
- **Tier 1 alone would NOT have caught the friend's exact case** (optional-stated-as-
  required). **Tier 2 would.** Be upfront about this split.

## Recommendation

Build **Tier 1 first** (deterministic checkup codes + `checkSkillContract`) — immediate,
no LLM dependency, slots into the existing `graph.checkup()`. Then **Tier 2** as the
description-doctor extension (opt-in, LLM-advisory), which closes the semantic gap that
produced the originating bug.

Connects: the skill-graph `checkup()` (build-time validation), the description-doctor
vision, and the self-explainability thesis (the prompt should not contradict the tool
contract).
