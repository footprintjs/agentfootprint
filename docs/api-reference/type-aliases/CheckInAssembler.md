[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInAssembler

# Type Alias: CheckInAssembler

> **CheckInAssembler** = (`input`) => [`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md) \| `Promise`\<[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)\>

Defined in: [src/core/checkin.ts:404](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/checkin.ts#L404)

Builds the evidence pack for one check-in. Two are built in
([standardEvidenceAssembler](/agentfootprint/api/generated/variables/standardEvidenceAssembler.md), [minimalEvidenceAssembler](/agentfootprint/api/generated/variables/minimalEvidenceAssembler.md));
pass your own to `.checkIn({ evidence })` for full control.

## Parameters

### input

[`CheckInAssemblerInput`](/agentfootprint/api/generated/interfaces/CheckInAssemblerInput.md)

## Returns

[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md) \| `Promise`\<[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)\>
