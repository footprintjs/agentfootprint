[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingDomain

# Type Alias: LoggingDomain

> **LoggingDomain** = *typeof* [`LoggingDomains`](/agentfootprint/api/generated/variables/LoggingDomains.md)\[keyof *typeof* [`LoggingDomains`](/agentfootprint/api/generated/variables/LoggingDomains.md)\]

Defined in: [src/recorders/observability/LoggingRecorder.ts:75](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/recorders/observability/LoggingRecorder.ts#L75)

Domain name — the middle segment of event types
(`agentfootprint.<domain>.<action>`). Consumers already see these in
the events they subscribe to; reusing them here avoids teaching a
new taxonomy.
