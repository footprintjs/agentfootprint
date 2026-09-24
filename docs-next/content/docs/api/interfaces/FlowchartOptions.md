---
title: FlowchartOptions
---

# Interface: FlowchartOptions

Defined in: [src/recorders/observability/FlowchartRecorder.ts:187](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L187)

## Properties

### onUpdate?

> `readonly` `optional` **onUpdate?**: (`graph`) => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:190](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/observability/FlowchartRecorder.ts#L190)

Called each time the graph changes; fires synchronously on the
 driving event so the UI updates the moment the structure changes.

#### Parameters

##### graph

`StepGraph`

#### Returns

`void`
