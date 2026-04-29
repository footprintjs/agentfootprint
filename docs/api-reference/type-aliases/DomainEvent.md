[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainEvent

# Type Alias: DomainEvent

> **DomainEvent** = [`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md) \| [`DomainForkBranchEvent`](/agentfootprint/api/generated/interfaces/DomainForkBranchEvent.md) \| [`DomainDecisionBranchEvent`](/agentfootprint/api/generated/interfaces/DomainDecisionBranchEvent.md) \| [`DomainLoopIterationEvent`](/agentfootprint/api/generated/interfaces/DomainLoopIterationEvent.md) \| [`DomainLLMStartEvent`](/agentfootprint/api/generated/interfaces/DomainLLMStartEvent.md) \| [`DomainLLMEndEvent`](/agentfootprint/api/generated/interfaces/DomainLLMEndEvent.md) \| [`DomainToolStartEvent`](/agentfootprint/api/generated/interfaces/DomainToolStartEvent.md) \| [`DomainToolEndEvent`](/agentfootprint/api/generated/interfaces/DomainToolEndEvent.md) \| [`DomainContextInjectedEvent`](/agentfootprint/api/generated/interfaces/DomainContextInjectedEvent.md)

Defined in: [agentfootprint/src/recorders/observability/BoundaryRecorder.ts:247](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/BoundaryRecorder.ts#L247)

Discriminated union covering every observable moment in a run.
