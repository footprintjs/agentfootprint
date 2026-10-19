---
title: SessionArtifactAdmissionOptions
---

# Interface: SessionArtifactAdmissionOptions

Defined in: [src/tools/sessionArtifactAdmission.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sessionArtifactAdmission.ts#L14)

A policy that can only narrow already-scoped artifact admission.

## Properties

### check?

> `readonly` `optional` **check?**: (`record`, `context`) => `boolean` \| `Promise`\<`boolean`\>

Defined in: [src/tools/sessionArtifactAdmission.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sessionArtifactAdmission.ts#L19)

Only an explicit true admits the frozen snapshot; this cannot replace its data.

#### Parameters

##### record

[`ArtifactRecord`](/docs/api/interfaces/ArtifactRecord)

##### context

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### kinds

> `readonly` **kinds**: readonly `string`[]

Defined in: [src/tools/sessionArtifactAdmission.ts:15](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sessionArtifactAdmission.ts#L15)

***

### maxBytes

> `readonly` **maxBytes**: `number`

Defined in: [src/tools/sessionArtifactAdmission.ts:17](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/sessionArtifactAdmission.ts#L17)

Positive safe integer, at most the existing 1 MiB JSON input ceiling.
