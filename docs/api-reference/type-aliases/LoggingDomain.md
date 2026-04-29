[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LoggingDomain

# Type Alias: LoggingDomain

> **LoggingDomain** = *typeof* [`LoggingDomains`](/agentfootprint/api/generated/variables/LoggingDomains.md)\[keyof *typeof* [`LoggingDomains`](/agentfootprint/api/generated/variables/LoggingDomains.md)\]

Defined in: [agentfootprint/src/recorders/observability/LoggingRecorder.ts:75](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/LoggingRecorder.ts#L75)

Domain name — the middle segment of event types
(`agentfootprint.<domain>.<action>`). Consumers already see these in
the events they subscribe to; reusing them here avoids teaching a
new taxonomy.
