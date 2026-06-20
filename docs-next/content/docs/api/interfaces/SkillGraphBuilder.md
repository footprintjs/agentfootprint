---
title: SkillGraphBuilder
---

# Interface: SkillGraphBuilder

Defined in: [src/lib/injection-engine/skillGraph.ts:288](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L288)

## Methods

### build()

> **build**(`opts?`): [`SkillGraph`](/docs/api/interfaces/SkillGraph)

Defined in: [src/lib/injection-engine/skillGraph.ts:323](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L323)

#### Parameters

##### opts?

[`BuildOptions`](/docs/api/interfaces/BuildOptions)

#### Returns

[`SkillGraph`](/docs/api/interfaces/SkillGraph)

***

### entry()

> **entry**(`skill`, `opts?`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L290)

Mark a skill as reachable at turn start (optionally intent-conditional).

#### Parameters

##### skill

[`Injection`](/docs/api/interfaces/Injection)

##### opts?

[`SkillEntryOptions`](/docs/api/interfaces/SkillEntryOptions)

#### Returns

`SkillGraphBuilder`

***

### entryByRead()

> **entryByRead**(): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:322](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L322)

Let the LLM pick the STARTING entry by reading the menu — no embedder, no extra
model call. Like `.entryByRelevance()`, the entries become EXCLUSIVE (only the
chosen one loads, token-efficient), but the choice is the model's: on the first
turn no entry auto-loads, the agent is offered the entries via `read_skill`, and
its pick becomes the cursor. Use this when you have NO embedder (or embeddings
route poorly for your domain) — the agent's own LLM understands the request.
Flat graphs only; mutually exclusive with `.entryByRelevance()`.

Caveat: prefer UNCONDITIONAL entries here. A `when`-gated entry may still be
offered in the read_skill menu (the cold-start gate can't evaluate `when`), but
if the model picks it while its `when` is false it won't load — the turn wastes
an iteration with no skill. For intent-gating, use `.entryByRelevance()` or plain
`.entry(s, { when })` (v1 always-on) instead.

#### Returns

`SkillGraphBuilder`

***

### entryByRelevance()

> **entryByRelevance**(`embedder`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:306](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L306)

Pick the STARTING entry by relevance to the user's message — embed the message
+ each entry skill's `description`, cosine-score, softmax → start at the best
match. LLM-free (an embedder, no extra model call), reproducible given the
embedder. The surfaced `relevance` % powers the "Why this skill?" panel.
Use INSTEAD of regex `.entry(skill, { when })` for natural-language routing.
Flat graphs only (a decision `tree()` already routes by predicate).

#### Parameters

##### embedder

[`Embedder`](/docs/api/interfaces/Embedder)

#### Returns

`SkillGraphBuilder`

***

### route()

> **route**(`from`, `to`, `opts?`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L292)

Declare an edge: after `from`'s work, `to` activates when the edge fires.

#### Parameters

##### from

[`Injection`](/docs/api/interfaces/Injection)

##### to

[`Injection`](/docs/api/interfaces/Injection)

##### opts?

[`SkillRouteOptions`](/docs/api/interfaces/SkillRouteOptions)

#### Returns

`SkillGraphBuilder`

***

### tree()

> **tree**(`root`, `opts?`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L297)

Declare a decision TREE (v3): predicate nodes → skill leaves. Compiles each
 leaf to a path-conjunction trigger; renders as diamonds → boxes. By default
 each leaf is tool-scoped (`autoActivate: 'currentSkill'`) so only the routed
 skill's tools reach the LLM — opt out with `{ scopeTools: false }`.

#### Parameters

##### root

[`Injection`](/docs/api/interfaces/Injection) \| [`DecisionNode`](/docs/api/interfaces/DecisionNode)

##### opts?

[`TreeOptions`](/docs/api/interfaces/TreeOptions)

#### Returns

`SkillGraphBuilder`
