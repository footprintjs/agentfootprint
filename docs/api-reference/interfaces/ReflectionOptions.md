[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ReflectionOptions

# Interface: ReflectionOptions

Defined in: [src/patterns/Reflection.ts:20](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L20)

## Properties

### criticPrompt

> `readonly` **criticPrompt**: `string`

Defined in: [src/patterns/Reflection.ts:31](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L31)

System prompt for the critic. Should instruct the critic to return
"DONE" (or a consumer-chosen sentinel) when the proposal is good
enough — that string is checked by `untilCritiqueContains` to stop
the refinement loop.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/Reflection.ts:43](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L43)

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: [src/patterns/Reflection.ts:39](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L39)

Max refinement iterations. Default 3.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/patterns/Reflection.ts:41](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L41)

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/Reflection.ts:22](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L22)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/Reflection.ts:42](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L42)

***

### proposerPrompt

> `readonly` **proposerPrompt**: `string`

Defined in: [src/patterns/Reflection.ts:24](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L24)

System prompt for the initial / revision proposer.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/patterns/Reflection.ts:21](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L21)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/patterns/Reflection.ts:40](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L40)

***

### untilCritiqueContains?

> `readonly` `optional` **untilCritiqueContains?**: `string`

Defined in: [src/patterns/Reflection.ts:37](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/patterns/Reflection.ts#L37)

Stop string the critic should emit when satisfied. When the critic's
response contains this substring, the loop exits and the last
proposal is returned. Default: 'DONE'.
