---
title: FlowchartOptions
---

# Interface: FlowchartOptions

Defined in: [src/recorders/observability/FlowchartRecorder.ts:204](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L204)

## Properties

### onUpdate?

> `readonly` `optional` **onUpdate?**: (`graph`) => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L207)

Called each time the graph changes; fires synchronously on the
 driving event so the UI updates the moment the structure changes.

#### Parameters

##### graph

`StepGraph`

#### Returns

`void`
