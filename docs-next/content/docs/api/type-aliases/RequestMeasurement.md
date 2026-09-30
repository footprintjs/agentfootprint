---
title: RequestMeasurement
---

# Type Alias: RequestMeasurement

> **RequestMeasurement** = `MeasurementBoundary` & \{ `slots`: \{ `messages?`: [`RequestJsonSize`](/docs/api/interfaces/RequestJsonSize); `systemPrompt?`: [`RequestJsonSize`](/docs/api/interfaces/RequestJsonSize); `tools?`: [`RequestJsonSize`](/docs/api/interfaces/RequestJsonSize); \}; `status`: `"measured"`; `total`: [`RequestJsonSize`](/docs/api/interfaces/RequestJsonSize); \} \| \{ `reason`: `"unsupported-value"` \| `"cyclic-value"` \| `"measurement-limit"`; `status`: `"unavailable"`; \}

Defined in: src/lib/time-travel/requestMeasurement.ts:18

Sizes describe JSON of the canonical request, excluding its root `signal`.
Slot values are serialized separately and do not sum to the request total.
Missing slots were absent/undefined; an empty array still has JSON size.
