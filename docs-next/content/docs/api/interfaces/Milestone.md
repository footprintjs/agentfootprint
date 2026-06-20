---
title: Milestone
---

# Interface: Milestone

Defined in: [src/conventions.ts:260](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/conventions.ts#L260)

A time-travel milestone: a domain-declared scrub stop. Conceptually each
milestone marks the boundary of a COLLECTION of commits (the commits that
belong to that step) — so the Lens slider can step stage-by-stage
(iteration → llm-turn → tool-call → …) instead of stopping only on
structural subflow boundaries. The renderer iterates whatever the domain
classifies; it never hardcodes agent vocabulary.

## Properties

### kind

> `readonly` **kind**: [`MilestoneKind`](/docs/api/type-aliases/MilestoneKind)

Defined in: [src/conventions.ts:261](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/conventions.ts#L261)

***

### label

> `readonly` **label**: `string`

Defined in: [src/conventions.ts:263](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/conventions.ts#L263)

Human-readable base label ("LLM turn"); the renderer may add an ordinal.
