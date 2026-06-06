[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingDomain

# Type Alias: LoggingDomain

> **LoggingDomain** = *typeof* [`LoggingDomains`](/agentfootprint/api/generated/variables/LoggingDomains.md)\[keyof *typeof* [`LoggingDomains`](/agentfootprint/api/generated/variables/LoggingDomains.md)\]

Defined in: [src/recorders/observability/LoggingRecorder.ts:78](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/LoggingRecorder.ts#L78)

Domain name — the middle segment of event types
(`agentfootprint.<domain>.<action>`). Consumers already see these in
the events they subscribe to; reusing them here avoids teaching a
new taxonomy.
