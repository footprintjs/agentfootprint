---
title: SourceEvidenceDescriptor<TServed>
---

# Interface: SourceEvidenceDescriptor\<TServed\>

Defined in: [src/tools/sourceEvidence.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L15)

Producer metadata only. It is consulted by native final delivery, never by execute.

## Type Parameters

### TServed

`TServed` = `unknown`

## Properties

### datasets?

> `readonly` `optional` **datasets?**: readonly [`SourceEvidenceDatasetDeclaration`](/docs/api/interfaces/SourceEvidenceDatasetDeclaration)[]

Defined in: [src/tools/sourceEvidence.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L16)

***

### describe

> `readonly` **describe**: (`served`, `sources`) => readonly [`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration)[] \| `Promise`\<readonly [`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration)[] \| `undefined`\> \| `undefined`

Defined in: [src/tools/sourceEvidence.ts:18](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sourceEvidence.ts#L18)

Receives a detached final model payload and only explicitly authorized stored fields.

#### Parameters

##### served

`TServed`

##### sources

`Readonly`\<`Record`\<`string`, [`SourceEvidenceSource`](/docs/api/interfaces/SourceEvidenceSource)\>\>

#### Returns

readonly [`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration)[] \| `Promise`\<readonly [`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration)[] \| `undefined`\> \| `undefined`
