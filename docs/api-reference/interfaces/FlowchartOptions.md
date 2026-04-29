[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / FlowchartOptions

# Interface: FlowchartOptions

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:170](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L170)

## Properties

### onUpdate?

> `readonly` `optional` **onUpdate?**: (`graph`) => `void`

Defined in: [agentfootprint/src/recorders/observability/FlowchartRecorder.ts:173](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/FlowchartRecorder.ts#L173)

Called each time the graph changes; fires synchronously on the
 driving event so the UI updates the moment the structure changes.

#### Parameters

##### graph

[`StepGraph`](/agentfootprint/api/generated/interfaces/StepGraph.md)

#### Returns

`void`
