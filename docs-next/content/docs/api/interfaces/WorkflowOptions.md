---
title: WorkflowOptions
---

# Interface: WorkflowOptions

Defined in: src/core-flow/Workflow.ts:105

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: src/core-flow/Workflow.ts:109

Stable id used for topology + events. Default `'workflow'`.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/core-flow/Workflow.ts:107

Human-friendly name for events + topology. Default `'Workflow'`.

***

### structureRecorders?

> `readonly` `optional` **structureRecorders?**: readonly `StructureRecorder`[]

Defined in: src/core-flow/Workflow.ts:116

Optional build-time recorders passed through to footprintjs's
`flowChart()` factory — they observe this workflow's own nodes (Seed +
one mount per step + Finalize). Not propagated into the mounted step
charts; attach them to each step runner for full coverage.
