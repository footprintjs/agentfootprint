[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / RequestMeasurement

# Type Alias: RequestMeasurement

> **RequestMeasurement** = `MeasurementBoundary` & \{ `slots`: \{ `messages?`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); `systemPrompt?`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); `tools?`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); \}; `status`: `"measured"`; `total`: [`RequestJsonSize`](/agentfootprint/api/generated/interfaces/RequestJsonSize.md); \} \| \{ `reason`: `"unsupported-value"` \| `"cyclic-value"` \| `"measurement-limit"`; `status`: `"unavailable"`; \}

Defined in: [src/lib/time-travel/requestMeasurement.ts:18](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/lib/time-travel/requestMeasurement.ts#L18)

Sizes describe JSON of the canonical request, excluding its root `signal`.
Slot values are serialized separately and do not sum to the request total.
Missing slots were absent/undefined; an empty array still has JSON size.
