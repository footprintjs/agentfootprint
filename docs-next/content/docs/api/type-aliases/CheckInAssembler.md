---
title: CheckInAssembler
---

# Type Alias: CheckInAssembler

> **CheckInAssembler** = (`input`) => [`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence) \| `Promise`\<[`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence)\>

Defined in: [src/core/checkin.ts:404](https://github.com/footprintjs/agentfootprint/blob/main/src/core/checkin.ts#L404)

Builds the evidence pack for one check-in. Two are built in
([standardEvidenceAssembler](/docs/api/variables/standardEvidenceAssembler), [minimalEvidenceAssembler](/docs/api/variables/minimalEvidenceAssembler));
pass your own to `.checkIn({ evidence })` for full control.

## Parameters

### input

[`CheckInAssemblerInput`](/docs/api/interfaces/CheckInAssemblerInput)

## Returns

[`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence) \| `Promise`\<[`CheckInEvidence`](/docs/api/interfaces/CheckInEvidence)\>
