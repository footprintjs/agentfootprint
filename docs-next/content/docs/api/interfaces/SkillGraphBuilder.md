---
title: SkillGraphBuilder
---

# Interface: SkillGraphBuilder

Defined in: [src/lib/injection-engine/skillGraph.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L278)

## Methods

### build()

> **build**(`opts?`): [`SkillGraph`](/docs/api/interfaces/SkillGraph)

Defined in: [src/lib/injection-engine/skillGraph.ts:321](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L321)

#### Parameters

##### opts?

[`BuildOptions`](/docs/api/interfaces/BuildOptions)

#### Returns

[`SkillGraph`](/docs/api/interfaces/SkillGraph)

***

### entry()

> **entry**(`skill`, `opts?`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L280)

Mark a skill as reachable at turn start (optionally intent-conditional).

#### Parameters

##### skill

[`Injection`](/docs/api/interfaces/Injection)

##### opts?

[`SkillEntryOptions`](/docs/api/interfaces/SkillEntryOptions)

#### Returns

`SkillGraphBuilder`

***

### entryBy()

> **entryBy**(`scorer`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:297](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L297)

Pick the STARTING entry with a pluggable scorer STRATEGY — `keywordScorer()`
(no dependency, word overlap), `embeddingScorer(embedder)` (semantic), or your
own `EntryScorer`. The agent's PickEntry stage runs it ONCE per turn off the
hot loop and starts the cursor at the winner. Like `.entryByRead()`, this makes
the entries EXCLUSIVE (only the chosen one loads, token-efficient). The surfaced
`relevance` % powers the "Why this skill?" panel. Flat graphs only (a decision
`tree()` already routes by predicate). Mutually exclusive with `.entryByRead()`.

#### Parameters

##### scorer

[`EntryScorer`](/docs/api/interfaces/EntryScorer)

#### Returns

`SkillGraphBuilder`

***

### entryByRead()

> **entryByRead**(): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:320](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L320)

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

Defined in: [src/lib/injection-engine/skillGraph.ts:304](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L304)

Sugar for `.entryBy(embeddingScorer(embedder))` — pick the starting entry by
SEMANTIC relevance (embed the message + each entry's `description`, cosine-score,
softmax → best match). LLM-free (an embedder, no extra model call), reproducible.
For a no-embedder router, use `.entryBy(keywordScorer())`.

#### Parameters

##### embedder

[`Embedder`](/docs/api/interfaces/Embedder)

#### Returns

`SkillGraphBuilder`

***

### route()

> **route**(`from`, `to`, `opts?`): `SkillGraphBuilder`

Defined in: [src/lib/injection-engine/skillGraph.ts:282](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L282)

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

Defined in: [src/lib/injection-engine/skillGraph.ts:287](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L287)

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
