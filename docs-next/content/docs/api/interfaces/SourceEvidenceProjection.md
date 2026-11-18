---
title: SourceEvidenceProjection
---

# Interface: SourceEvidenceProjection

Defined in: [src/artifacts/sourceEvidence/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L34)

Historical source facts. Status, coverage and period are stamped by native delivery.

## Extends

- [`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration)

## Extended by

- [`SourceEvidenceCandidate`](/docs/api/interfaces/SourceEvidenceCandidate)

## Properties

### coverage?

> `readonly` `optional` **coverage?**: [`Coverage`](/docs/api/interfaces/Coverage)

Defined in: [src/artifacts/sourceEvidence/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L36)

***

### datasets?

> `readonly` `optional` **datasets?**: readonly [`SourceEvidenceDataset`](/docs/api/interfaces/SourceEvidenceDataset)[]

Defined in: [src/artifacts/sourceEvidence/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L30)

#### Inherited from

[`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration).[`datasets`](/docs/api/interfaces/SourceEvidenceDeclaration#datasets)

***

### operation

> `readonly` **operation**: `string`

Defined in: [src/artifacts/sourceEvidence/types.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L27)

#### Inherited from

[`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration).[`operation`](/docs/api/interfaces/SourceEvidenceDeclaration#operation)

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/artifacts/sourceEvidence/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L37)

***

### scalars?

> `readonly` `optional` **scalars?**: `Readonly`\<`Record`\<`string`, [`SourceEvidenceScalar`](/docs/api/type-aliases/SourceEvidenceScalar)\>\>

Defined in: [src/artifacts/sourceEvidence/types.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L29)

#### Inherited from

[`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration).[`scalars`](/docs/api/interfaces/SourceEvidenceDeclaration#scalars)

***

### scope

> `readonly` **scope**: [`SourceEvidenceScope`](/docs/api/type-aliases/SourceEvidenceScope)

Defined in: [src/artifacts/sourceEvidence/types.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L28)

#### Inherited from

[`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration).[`scope`](/docs/api/interfaces/SourceEvidenceDeclaration#scope)

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/artifacts/sourceEvidence/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L35)

***

### subject

> `readonly` **subject**: [`SourceEvidenceSubject`](/docs/api/interfaces/SourceEvidenceSubject)

Defined in: [src/artifacts/sourceEvidence/types.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L26)

#### Inherited from

[`SourceEvidenceDeclaration`](/docs/api/interfaces/SourceEvidenceDeclaration).[`subject`](/docs/api/interfaces/SourceEvidenceDeclaration#subject)
