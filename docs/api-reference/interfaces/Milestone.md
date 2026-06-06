[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Milestone

# Interface: Milestone

Defined in: [src/conventions.ts:256](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/conventions.ts#L256)

A time-travel milestone: a domain-declared scrub stop. Conceptually each
milestone marks the boundary of a COLLECTION of commits (the commits that
belong to that step) — so the Lens slider can step stage-by-stage
(iteration → llm-turn → tool-call → …) instead of stopping only on
structural subflow boundaries. The renderer iterates whatever the domain
classifies; it never hardcodes agent vocabulary.

## Properties

### kind

> `readonly` **kind**: [`MilestoneKind`](/agentfootprint/api/generated/type-aliases/MilestoneKind.md)

Defined in: [src/conventions.ts:257](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/conventions.ts#L257)

***

### label

> `readonly` **label**: `string`

Defined in: [src/conventions.ts:259](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/conventions.ts#L259)

Human-readable base label ("LLM turn"); the renderer may add an ordinal.
