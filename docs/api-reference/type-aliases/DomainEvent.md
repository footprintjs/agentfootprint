[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / DomainEvent

# Type Alias: DomainEvent

> **DomainEvent** = [`DomainRunEvent`](/agentfootprint/api/generated/interfaces/DomainRunEvent.md) \| [`DomainSubflowEvent`](/agentfootprint/api/generated/interfaces/DomainSubflowEvent.md) \| `DomainCompositionEvent` \| [`DomainForkBranchEvent`](/agentfootprint/api/generated/interfaces/DomainForkBranchEvent.md) \| [`DomainDecisionBranchEvent`](/agentfootprint/api/generated/interfaces/DomainDecisionBranchEvent.md) \| [`DomainLoopIterationEvent`](/agentfootprint/api/generated/interfaces/DomainLoopIterationEvent.md) \| [`DomainLLMStartEvent`](/agentfootprint/api/generated/interfaces/DomainLLMStartEvent.md) \| [`DomainLLMEndEvent`](/agentfootprint/api/generated/interfaces/DomainLLMEndEvent.md) \| [`DomainToolStartEvent`](/agentfootprint/api/generated/interfaces/DomainToolStartEvent.md) \| [`DomainToolEndEvent`](/agentfootprint/api/generated/interfaces/DomainToolEndEvent.md) \| [`DomainContextInjectedEvent`](/agentfootprint/api/generated/interfaces/DomainContextInjectedEvent.md)

Defined in: [src/recorders/observability/BoundaryRecorder.ts:306](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/BoundaryRecorder.ts#L306)

Discriminated union covering every observable moment in a run.
