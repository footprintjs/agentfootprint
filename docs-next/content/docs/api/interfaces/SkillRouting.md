---
title: SkillRouting
---

# Interface: SkillRouting

Defined in: [src/lib/injection-engine/skillGraph.ts:214](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L214)

The routing PROVENANCE stamped onto a compiled skill's `metadata.skillGraph`
— *why* this skill is reachable. It rides through to the `context.evaluated`
event when the skill activates, so commentary + the lens can narrate the real
routing (not just "a skill activated"). Observability only; the trigger logic
is unchanged.

## Properties

### from?

> `readonly` `optional` **from?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:229](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L229)

Source skill id (route only).

***

### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:227](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L227)

Entry/route edge caption.

***

### path?

> `readonly` `optional` **path?**: readonly [`SkillRoutingStep`](/docs/api/interfaces/SkillRoutingStep)[]

Defined in: [src/lib/injection-engine/skillGraph.ts:221](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L221)

Decision path (tree only): the predicates from root→leaf + branch taken.
 For a skill used as MULTIPLE tree leaves this is the FIRST path; all
 paths are in `paths`.

***

### paths?

> `readonly` `optional` **paths?**: readonly readonly [`SkillRoutingStep`](/docs/api/interfaces/SkillRoutingStep)[][]

Defined in: [src/lib/injection-engine/skillGraph.ts:225](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L225)

All decision paths reaching this skill (tree only; present when the same
 skill is the leaf of more than one branch — the compiler merges repeated
 leaves into ONE injection whose trigger ORs the path predicates).

***

### triggerKind?

> `readonly` `optional` **triggerKind?**: `string`

Defined in: [src/lib/injection-engine/skillGraph.ts:231](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L231)

The compiled trigger kind for a route (`rule` / `on-tool-return`).

***

### via

> `readonly` **via**: `"entry"` \| `"model"` \| `"tree"` \| `"route"`

Defined in: [src/lib/injection-engine/skillGraph.ts:217](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/lib/injection-engine/skillGraph.ts#L217)

How the skill is reached: a decision `tree` leaf, a flat `entry`, a
 deterministic `route` edge, or `model` (read_skill-reachable).
