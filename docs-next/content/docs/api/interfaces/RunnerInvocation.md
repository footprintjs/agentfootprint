---
title: RunnerInvocation<T>
---

# Interface: RunnerInvocation\<T\>

Defined in: [src/core/runnerExecution.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L46)

## Type Parameters

### T

`T`

## Properties

### previous

> `readonly` **previous**: [`RunnerSelection`](/docs/api/interfaces/RunnerSelection)\<`T`\> \| `undefined`

Defined in: [src/core/runnerExecution.ts:51](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L51)

***

### run

> `readonly` **run**: `OwnedRun`

Defined in: [src/core/runnerExecution.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L48)

***

### value

> `readonly` **value**: `T`

Defined in: [src/core/runnerExecution.ts:47](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L47)

***

### view

> `readonly` **view**: `RunView`

Defined in: [src/core/runnerExecution.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L50)

Captured for this admission; never follows a later active/latest selection.

## Methods

### context()

> **context**(): [`RunContext`](/docs/api/interfaces/RunContext)

Defined in: [src/core/runnerExecution.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L52)

#### Returns

[`RunContext`](/docs/api/interfaces/RunContext)

***

### execute()

> **execute**(`entry`, `setup?`, `binding?`): `Promise`\<`ExecutorResult`\>

Defined in: [src/core/runnerExecution.ts:53](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runnerExecution.ts#L53)

#### Parameters

##### entry

`RunEntry`

##### setup?

`RunSetup`

##### binding?

###### bindScope?

(`scope`, `context`) => `void`

###### metadata?

[`RunnerMetadata`](/docs/api/type-aliases/RunnerMetadata)

#### Returns

`Promise`\<`ExecutorResult`\>
