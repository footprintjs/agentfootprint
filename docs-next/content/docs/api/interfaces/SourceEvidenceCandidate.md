---
title: SourceEvidenceCandidate
---

# Interface: SourceEvidenceCandidate

Defined in: [src/artifacts/sourceEvidence/types.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L41)

Native authority is membership in the admitted checkpoint index, never this shape or kind.

## Extends

- [`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection)

## Properties

### coverage?

> `readonly` `optional` **coverage?**: [`Coverage`](/docs/api/interfaces/Coverage)

Defined in: [src/artifacts/sourceEvidence/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L36)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`coverage`](/docs/api/interfaces/SourceEvidenceProjection#coverage)

***

### datasets?

> `readonly` `optional` **datasets?**: readonly [`SourceEvidenceDataset`](/docs/api/interfaces/SourceEvidenceDataset)[]

Defined in: [src/artifacts/sourceEvidence/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L30)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`datasets`](/docs/api/interfaces/SourceEvidenceProjection#datasets)

***

### operation

> `readonly` **operation**: `string`

Defined in: [src/artifacts/sourceEvidence/types.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L27)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`operation`](/docs/api/interfaces/SourceEvidenceProjection#operation)

***

### origin?

> `readonly` `optional` **origin?**: [`ArtifactOrigin`](/docs/api/interfaces/ArtifactOrigin)

Defined in: [src/artifacts/sourceEvidence/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L46)

***

### period?

> `readonly` `optional` **period?**: [`DeclaredPeriod`](/docs/api/interfaces/DeclaredPeriod)

Defined in: [src/artifacts/sourceEvidence/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L37)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`period`](/docs/api/interfaces/SourceEvidenceProjection#period)

***

### producer

> `readonly` **producer**: `object`

Defined in: [src/artifacts/sourceEvidence/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L43)

#### name

> `readonly` **name**: `string`

#### source?

> `readonly` `optional` **source?**: `string`

***

### recordedAt

> `readonly` **recordedAt**: `number`

Defined in: [src/artifacts/sourceEvidence/types.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L45)

Retention time stamped by the artifact store; never source collection time.

***

### ref

> `readonly` **ref**: `string`

Defined in: [src/artifacts/sourceEvidence/types.ts:42](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L42)

***

### scalars?

> `readonly` `optional` **scalars?**: `Readonly`\<`Record`\<`string`, [`SourceEvidenceScalar`](/docs/api/type-aliases/SourceEvidenceScalar)\>\>

Defined in: [src/artifacts/sourceEvidence/types.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L29)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`scalars`](/docs/api/interfaces/SourceEvidenceProjection#scalars)

***

### scope

> `readonly` **scope**: [`SourceEvidenceScope`](/docs/api/type-aliases/SourceEvidenceScope)

Defined in: [src/artifacts/sourceEvidence/types.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L28)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`scope`](/docs/api/interfaces/SourceEvidenceProjection#scope)

***

### status?

> `readonly` `optional` **status?**: [`ToolResultStatus`](/docs/api/type-aliases/ToolResultStatus)

Defined in: [src/artifacts/sourceEvidence/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L35)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`status`](/docs/api/interfaces/SourceEvidenceProjection#status)

***

### subject

> `readonly` **subject**: [`SourceEvidenceSubject`](/docs/api/interfaces/SourceEvidenceSubject)

Defined in: [src/artifacts/sourceEvidence/types.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/artifacts/sourceEvidence/types.ts#L26)

#### Inherited from

[`SourceEvidenceProjection`](/docs/api/interfaces/SourceEvidenceProjection).[`subject`](/docs/api/interfaces/SourceEvidenceProjection#subject)
