[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RequestMeasurement

# Type Alias: RequestMeasurement

> **RequestMeasurement** = `MeasurementBoundary` & \{ `slots`: \{ `messages?`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); `systemPrompt?`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); `tools?`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); \}; `status`: `"measured"`; `total`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); \} \| \{ `reason`: `"unsupported-value"` \| `"cyclic-value"` \| `"measurement-limit"`; `status`: `"unavailable"`; \}

Defined in: [src/lib/time-travel/requestMeasurement.ts:18](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/lib/time-travel/requestMeasurement.ts#L18)

Sizes describe JSON of the canonical request, excluding its root `signal`.
Slot values are serialized separately and do not sum to the request total.
Missing slots were absent/undefined; an empty array still has JSON size.
