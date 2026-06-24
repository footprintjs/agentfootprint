---
title: SkillGraph
---

# Interface: SkillGraph

Defined in: [src/lib/injection-engine/skillGraph.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L227)

## Properties

### edges

> `readonly` **edges**: readonly [`SkillEdge`](/docs/api/interfaces/SkillEdge)[]

Defined in: [src/lib/injection-engine/skillGraph.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L232)

The declared edges (for tooling, overlays, tests).

***

### nodes

> `readonly` **nodes**: readonly [`SkillNode`](/docs/api/interfaces/SkillNode)[]

Defined in: [src/lib/injection-engine/skillGraph.ts:235](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L235)

Drawn nodes: skill boxes for the flat entry/route model; predicate diamonds
 + skill leaves for a decision `tree`. Always present.

***

### skills

> `readonly` **skills**: readonly [`Injection`](/docs/api/interfaces/Injection)[]

Defined in: [src/lib/injection-engine/skillGraph.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L230)

Skills with graph-derived triggers — feed to the Agent (`.skillGraph()` or
 `.skills({ list: () => graph.skills })`).

## Methods

### checkup()

> **checkup**(): [`GraphCheckup`](/docs/api/interfaces/GraphCheckup)

Defined in: [src/lib/injection-engine/skillGraph.ts:275](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L275)

Build-time check-up — inspect the declared graph for wiring mistakes (a skill
nobody can reach, an edge to an unknown skill, two un-prioritized edges from one
skill, no entry, a self-loop). Pure + side-effect-free; call it whenever.
`ok` is false iff there's an error-level problem (`unknown-skill` / `no-entry`).

#### Returns

[`GraphCheckup`](/docs/api/interfaces/GraphCheckup)

***

### nextSkill()

> **nextSkill**(`ctx`): `string` \| `undefined`

Defined in: [src/lib/injection-engine/skillGraph.ts:249](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L249)

The CURSOR resolver — given an iteration context, where is the graph next?
Returns the skill id the graph should be *in* after this iteration:
  • cold start (`ctx.currentSkillId` unset) → the first matching `entry`;
  • a `from`-gated route whose predicate matches `ctx.lastToolResult` → its target;
  • otherwise the current cursor unchanged (sticky stay).
Pure + deterministic — the single source of truth shared by the compiled
route triggers and the agent loop's cursor-update stage, so the two can never
disagree. Flat entry/route graphs only; a decision `tree()` routes per-iteration
by predicate (no cursor) and returns the unchanged `ctx.currentSkillId`.

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

#### Returns

`string` \| `undefined`

***

### reachableSkills()

> **reachableSkills**(`currentSkillId?`): readonly `string`[]

Defined in: [src/lib/injection-engine/skillGraph.ts:260](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L260)

The REACHABLE set — which skills the model may `read_skill`-jump to from the
current cursor. The agent's runtime gate rejects any `read_skill('id')` whose
`id` is not in this set (so the model can't leave the graph mid-run).
  • cold start (`currentSkillId` undefined) → the entry skills;
  • otherwise → the current skill's direct successors ∪ the entry skills, minus
    the current skill itself (deliberate "stay" is the no-tool-call ReAct stop).
Pure + deterministic. A decision `tree()` has no cursor, so it returns ALL leaf
skills — `read_skill` stays a full escape hatch there.

#### Parameters

##### currentSkillId?

`string`

#### Returns

readonly `string`[]

***

### scoreEntries()?

> `optional` **scoreEntries**(`ctx`, `signal?`): `Promise`\<[`EntryScoring`](/docs/api/interfaces/EntryScoring)\>

Defined in: [src/lib/injection-engine/skillGraph.ts:268](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L268)

Score the entry candidates by relevance to the user's message — present ONLY
when the graph was built with `.entryByRelevance(embedder)`. Embeds
`ctx.userMessage` and each `when`-passing entry's `description`, cosine-scores
them, and softmaxes into a `relevance` share. The agent's PickEntry stage uses
`chosen` as the starting cursor (LLM-free, off the hot loop). Flat graphs only.

#### Parameters

##### ctx

[`InjectionContext`](/docs/api/interfaces/InjectionContext)

##### signal?

`AbortSignal`

#### Returns

`Promise`\<[`EntryScoring`](/docs/api/interfaces/EntryScoring)\>

***

### toMermaid()

> **toMermaid**(): `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/injection-engine/skillGraph.ts#L237)

A Mermaid flowchart of the declared graph — declared === drawn.

#### Returns

`string`
