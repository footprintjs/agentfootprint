[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Milestone

# Interface: Milestone

Defined in: [src/conventions.ts:378](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/conventions.ts#L378)

A time-travel milestone: a domain-declared scrub stop. Conceptually each
milestone marks the boundary of a COLLECTION of commits (the commits that
belong to that step) — so the Lens slider can step stage-by-stage
(iteration → llm-turn → tool-call → …) instead of stopping only on
structural subflow boundaries. The renderer iterates whatever the domain
classifies; it never hardcodes agent vocabulary.

## Properties

### kind

> `readonly` **kind**: [`MilestoneKind`](/agentfootprint/api/generated/type-aliases/MilestoneKind.md)

Defined in: [src/conventions.ts:379](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/conventions.ts#L379)

***

### label

> `readonly` **label**: `string`

Defined in: [src/conventions.ts:381](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/conventions.ts#L381)

Human-readable base label ("LLM turn"); the renderer may add an ordinal.
