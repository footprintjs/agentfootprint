---
title: ArtifactDetailOptions
---

# Interface: ArtifactDetailOptions

Defined in: [src/tools/artifactDetailTool.ts:11](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactDetailTool.ts#L11)

Trusted host admission and presentation; neither callback is controlled by model arguments.

## Properties

### admit

> `readonly` **admit**: (`ref`, `ctx`) => `Promise`\<`unknown`\>

Defined in: [src/tools/artifactDetailTool.ts:14](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactDetailTool.ts#L14)

Re-authorize this reference for the caller on EVERY navigation call. No implicit store read occurs.

#### Parameters

##### ref

`string`

##### ctx

[`ToolExecutionContext`](/docs/api/interfaces/ToolExecutionContext)

#### Returns

`Promise`\<`unknown`\>

***

### context?

> `readonly` `optional` **context?**: (`root`, `path`) => `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/tools/artifactDetailTool.ts:16](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactDetailTool.ts#L16)

Presentation only, nested under context; it cannot override ref, path, mode or pagination.

#### Parameters

##### root

`unknown`

##### path

`string`

#### Returns

`Readonly`\<`Record`\<`string`, `unknown`\>\>

***

### name

> `readonly` **name**: `string`

Defined in: [src/tools/artifactDetailTool.ts:12](https://github.com/footprintjs/agentfootprint/blob/main/src/tools/artifactDetailTool.ts#L12)
