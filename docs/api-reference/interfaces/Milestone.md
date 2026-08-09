[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / Milestone

# Interface: Milestone

Defined in: [src/conventions.ts:285](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/conventions.ts#L285)

A time-travel milestone: a domain-declared scrub stop. Conceptually each
milestone marks the boundary of a COLLECTION of commits (the commits that
belong to that step) — so the Lens slider can step stage-by-stage
(iteration → llm-turn → tool-call → …) instead of stopping only on
structural subflow boundaries. The renderer iterates whatever the domain
classifies; it never hardcodes agent vocabulary.

## Properties

### kind

> `readonly` **kind**: [`MilestoneKind`](/agentfootprint/api/generated/type-aliases/MilestoneKind.md)

Defined in: [src/conventions.ts:286](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/conventions.ts#L286)

***

### label

> `readonly` **label**: `string`

Defined in: [src/conventions.ts:288](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/conventions.ts#L288)

Human-readable base label ("LLM turn"); the renderer may add an ordinal.
