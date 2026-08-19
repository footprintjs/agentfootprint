---
title: Milestone
---

# Interface: Milestone

Defined in: [src/conventions.ts:366](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L366)

A time-travel milestone: a domain-declared scrub stop. Conceptually each
milestone marks the boundary of a COLLECTION of commits (the commits that
belong to that step) — so the Lens slider can step stage-by-stage
(iteration → llm-turn → tool-call → …) instead of stopping only on
structural subflow boundaries. The renderer iterates whatever the domain
classifies; it never hardcodes agent vocabulary.

## Properties

### kind

> `readonly` **kind**: [`MilestoneKind`](/docs/api/type-aliases/MilestoneKind)

Defined in: [src/conventions.ts:367](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L367)

***

### label

> `readonly` **label**: `string`

Defined in: [src/conventions.ts:369](https://github.com/footprintjs/agentfootprint/blob/main/src/conventions.ts#L369)

Human-readable base label ("LLM turn"); the renderer may add an ordinal.
