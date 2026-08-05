[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Milestone

# Interface: Milestone

Defined in: [src/conventions.ts:277](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/conventions.ts#L277)

A time-travel milestone: a domain-declared scrub stop. Conceptually each
milestone marks the boundary of a COLLECTION of commits (the commits that
belong to that step) — so the Lens slider can step stage-by-stage
(iteration → llm-turn → tool-call → …) instead of stopping only on
structural subflow boundaries. The renderer iterates whatever the domain
classifies; it never hardcodes agent vocabulary.

## Properties

### kind

> `readonly` **kind**: [`MilestoneKind`](/agentfootprint/api/generated/type-aliases/MilestoneKind.md)

Defined in: [src/conventions.ts:278](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/conventions.ts#L278)

***

### label

> `readonly` **label**: `string`

Defined in: [src/conventions.ts:280](https://github.com/footprintjs/agentfootprint/blob/a7bc648325994ed8e4f49f22420056b84917c151/src/conventions.ts#L280)

Human-readable base label ("LLM turn"); the renderer may add an ordinal.
