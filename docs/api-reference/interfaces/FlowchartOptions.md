[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartOptions

# Interface: FlowchartOptions

Defined in: [src/recorders/observability/FlowchartRecorder.ts:179](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/FlowchartRecorder.ts#L179)

## Properties

### onUpdate?

> `readonly` `optional` **onUpdate?**: (`graph`) => `void`

Defined in: [src/recorders/observability/FlowchartRecorder.ts:182](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/FlowchartRecorder.ts#L182)

Called each time the graph changes; fires synchronously on the
 driving event so the UI updates the moment the structure changes.

#### Parameters

##### graph

[`StepGraph`](/agentfootprint/api/generated/interfaces/StepGraph.md)

#### Returns

`void`
