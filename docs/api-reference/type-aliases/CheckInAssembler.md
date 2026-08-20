[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CheckInAssembler

# Type Alias: CheckInAssembler

> **CheckInAssembler** = (`input`) => [`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md) \| `Promise`\<[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)\>

Defined in: [src/core/checkin.ts:404](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/checkin.ts#L404)

Builds the evidence pack for one check-in. Two are built in
([standardEvidenceAssembler](/agentfootprint/api/generated/variables/standardEvidenceAssembler.md), [minimalEvidenceAssembler](/agentfootprint/api/generated/variables/minimalEvidenceAssembler.md));
pass your own to `.checkIn({ evidence })` for full control.

## Parameters

### input

[`CheckInAssemblerInput`](/agentfootprint/api/generated/interfaces/CheckInAssemblerInput.md)

## Returns

[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md) \| `Promise`\<[`CheckInEvidence`](/agentfootprint/api/generated/interfaces/CheckInEvidence.md)\>
