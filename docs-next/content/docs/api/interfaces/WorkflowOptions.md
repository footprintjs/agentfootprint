---
title: WorkflowOptions
---

# Interface: WorkflowOptions

Defined in: [src/core-flow/Workflow.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L102)

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/core-flow/Workflow.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L106)

Stable id used for topology + events. Default `'workflow'`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/core-flow/Workflow.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L104)

Human-friendly name for events + topology. Default `'Workflow'`.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: [src/core-flow/Workflow.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/core-flow/Workflow.ts#L113)

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory — they observe this workflow's own nodes (Seed +
one mount per step + Finalize). Not propagated into the mounted step
charts; attach them to each step runner for full coverage.
