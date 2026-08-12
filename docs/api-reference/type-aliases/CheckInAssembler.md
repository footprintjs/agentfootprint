[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInAssembler

# Type Alias: CheckInAssembler

> **CheckInAssembler** = (`input`) => [`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md) \| `Promise`\<[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)\>

Defined in: [src/core/checkin.ts:321](https://github.com/footprintjs/agentfootprint/blob/32e104eb37eda8e9e784e72e32543ab6d97d2318/src/core/checkin.ts#L321)

Builds the evidence pack for one check-in. Two are built in
([standardEvidenceAssembler](/agentfootprint/api/generated/variables/standardEvidenceAssembler.md), [minimalEvidenceAssembler](/agentfootprint/api/generated/variables/minimalEvidenceAssembler.md));
pass your own to `.checkIn({ evidence })` for full control.

## Parameters

### input

[`CheckInAssemblerInput`](/agentfootprint/api/generated/interfaces/CheckInAssemblerInput.md)

## Returns

[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md) \| `Promise`\<[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)\>
