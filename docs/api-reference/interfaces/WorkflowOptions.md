[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WorkflowOptions

# Interface: WorkflowOptions

Defined in: [src/core-flow/Workflow.ts:101](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Workflow.ts#L101)

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Workflow.ts:105](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Workflow.ts#L105)

Stable id used for topology + events. Default `'workflow'`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Workflow.ts:103](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Workflow.ts#L103)

Human-friendly name for events + topology. Default `'Workflow'`.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Workflow.ts:112](https://github.com/footprintjs/agentfootprint/blob/1f27a25722e893a7b412ef966f7c9c12ebef3b6c/src/core-flow/Workflow.ts#L112)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory — they observe this workflow's own nodes (Seed +
one mount per step + Finalize). Not propagated into the mounted step
charts; attach them to each step runner for full coverage.
