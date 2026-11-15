---
title: SourceEvidenceOptions
---

# Interface: SourceEvidenceOptions

Defined in: [src/tools/sourceEvidence.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L28)

An explicit native mount. The host must re-authorize every discovery and read.

## Properties

### admit

> `readonly` **admit**: (`candidate`, `context`) => [`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection) \| `Promise`\<[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection) \| `undefined`\> \| `undefined`

Defined in: [src/tools/sourceEvidence.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L30)

Return an exact permitted subset, or undefined. No source query or refresh occurs.

#### Parameters

##### candidate

[`SourceEvidenceCandidate`](/docs/api/interfaces/SourceEvidenceCandidate)

##### context

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection) \| `Promise`\<[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection) \| `undefined`\> \| `undefined`

***

### limits?

> `readonly` `optional` **limits?**: [`SourceEvidenceLimits`](/docs/api/interfaces/SourceEvidenceLimits)

Defined in: [src/tools/sourceEvidence.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L34)
