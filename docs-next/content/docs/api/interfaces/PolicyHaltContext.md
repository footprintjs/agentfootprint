---
title: PolicyHaltContext
---

# Interface: PolicyHaltContext

Defined in: [src/security/PolicyHaltError.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L41)

## Properties

### checkerId?

> `readonly` `optional` **checkerId?**: `string`

Defined in: [src/security/PolicyHaltError.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L56)

Identifier of the PermissionChecker that returned `'halt'`.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/security/PolicyHaltError.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L52)

Conversation history at halt time, including the synthetic tool_result.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/security/PolicyHaltError.ts:50](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L50)

ReAct iteration the halt fired on.

***

### proposed

> `readonly` **proposed**: `object`

Defined in: [src/security/PolicyHaltError.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L54)

The proposed tool call that triggered the halt (not executed).

#### args

> `readonly` **args**: `unknown`

#### name

> `readonly` **name**: `string`

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/security/PolicyHaltError.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L43)

Telemetry tag from the matched rule. Stable across versions.

***

### sequence

> `readonly` **sequence**: readonly [`ToolCallEntry`](/docs/api/interfaces/ToolCallEntry)[]

Defined in: [src/security/PolicyHaltError.ts:48](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L48)

Sequence of tool calls dispatched this run, including the proposed
 call that triggered the halt (which did NOT execute).

***

### tellLLM?

> `readonly` `optional` **tellLLM?**: `string`

Defined in: [src/security/PolicyHaltError.ts:45](https://github.com/footprintjs/agentfootprint/blob/main/src/security/PolicyHaltError.ts#L45)

Content delivered to the LLM as the synthetic tool_result.
