---
title: SkillGraphOptions
---

# Interface: SkillGraphOptions

Defined in: [src/core/agent/AgentBuilder.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L119)

Mount options for `.skillGraph(graph, options)` (SG-C, 9.17.0; brains
SG-D, 9.19.0). Every field is zero-cost when absent — an agent that passes
none is byte-identical in behavior AND events to one built before the
options existed.

## Properties

### continuity?

> `readonly` `optional` **continuity?**: `"turn"` \| `"conversation"`

Defined in: [src/core/agent/AgentBuilder.ts:163](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L163)

What the cursor spans. Default `'turn'` — today's per-run cursor,
unchanged. `'conversation'`: the turn's final cursor rides the
conversation checkpoint (`agent.checkpoint()` / the crash carrier) and
becomes the DEFAULT entry when that conversation is continued
(`followUp()` / `run({ continueFrom })`) — a sticky default the new
message can still decisively beat, never a lock. Without `continueFrom`
nothing carries: a bare second `run()` starts cold exactly as today —
this option changes what a CONTINUED conversation defaults to; it does
not invent persistence.

***

### decider?

> `readonly` `optional` **decider?**: [`ProviderChoice`](/docs/api/interfaces/ProviderChoice)

Defined in: [src/core/agent/AgentBuilder.ts:193](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L193)

The tier-3 DECIDER (9.19.0): an out-of-band constrained pick over an
outstanding turn-start menu ∪ {stay} (the `llmClassifier` enum
machinery), resolved before the loop — `turn_routed { by: 'decider' }`.
The sanctioned resolver for `'rails'` menus: constrained, off-loop, and
recorded, i.e. a scorer in posture terms. Needs a graph that runs the
turn-start cascade (a classifier, or `continuity: 'conversation'`) —
refused at build otherwise, because no other graph ever has a menu for
it to resolve.

***

### escalation?

> `readonly` `optional` **escalation?**: [`EscalationPolicy`](/docs/api/interfaces/EscalationPolicy)

Defined in: [src/core/agent/AgentBuilder.ts:182](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L182)

Escalate-on-evidence (9.19.0): `afterRefusals` recorded gate refusals
(`skill.rejected` — reachability, posture, OR a self-call: all three
refusal arms count) in ONE turn flip the rest
of the turn onto this brain — `skill.escalated` goes on the record at
the flip, and the next turn's seed de-escalates. Never on vibes: only
real refusals count.

***

### providers?

> `readonly` `optional` **providers?**: `Readonly`\<`Record`\<`string`, [`ProviderChoice`](/docs/api/interfaces/ProviderChoice)\>\>

Defined in: [src/core/agent/AgentBuilder.ts:173](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L173)

Per-skill BRAINS (9.19.0) — "the cursor picks the brain": while the
graph's cursor is on a named skill, `callLLM` runs on its declared
provider/model instead of the agent's. Keys are skill ids; an id that
is not a graph node is refused at build, as is a foreign provider with
no model (the agent's model id belongs to another vendor's namespace).
The other declaration home is `defineSkill({ provider, model })` — the
same id in both homes with different choices is refused naming both.

***

### strictness?

> `readonly` `optional` **strictness?**: `"assist"` \| `"guard"` \| `"rails"`

Defined in: [src/core/agent/AgentBuilder.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/AgentBuilder.ts#L151)

How much routing authority the model has. Default `'assist'` — today,
always: any REACHABLE `read_skill` pick is admitted, and a pick off an
offered menu is stamped on the record (`cursorMove.declinedOffer`)
rather than refused.
  • `'guard'` — a routing pick is admitted only while the turn's menu is
    outstanding AND names an offered id (the framework declared the
    ambiguity; the model resolves exactly that). Everything else gets a
    teaching refusal + `skill.rejected { posture: 'guard' }`.
  • `'rails'` — the model never routes: turn starts resolve by rule or
    scorer, transitions by declared routes. A menu verdict then proceeds
    on the base prompt with `turn_routed { by: 'none' }` recorded — the
    honest cost of rails without a resolver. OPEN skills
    (`.selfExplain()`, `.skill()` beside the graph) stay admitted from
    anywhere under every posture.

WHAT A POSTURE GOVERNS, EXACTLY: the MODEL's routing door — a `read_skill`
hop — and nothing else. It is NOT a lock on the cursor. Two other doors
stay open under all three postures, deliberately:
  • OPEN skills, above — the debugging door.
  • A `propose-transition` tool effect. A proposal comes from a TOOL —
    deterministic code you shipped, not the model's guess — so it is
    framework-tier evidence: admitted under `assist`, `guard` AND
    `rails`, checked only against the graph's own reachability law, and
    recorded as `cursorMove.by: 'tool-proposal'` (the resolver ranks it
    BETWEEN a declared edge and a model pick, for that reason).
So `'rails'` means "the MODEL never routes", never "nothing but my
declared edges routes": a tool of yours that proposes IS a route you
declared, in code instead of in the graph. To close that door, don't
ship the effect — the posture will not second-guess your own code.
