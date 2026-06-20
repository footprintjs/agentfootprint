---
title: ValidationArgsInvalidPayload
---

# Interface: ValidationArgsInvalidPayload

Defined in: [src/events/payloads.ts:444](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L444)

Emitted when LLM-produced tool args fail validation against the tool's
declared `inputSchema` (backlog #9). Fires for BOTH modes that validate:
`enforced: true` means the call was rejected before dispatch and the
model received a structured retry message as the tool result;
`enforced: false` ('warn' mode) means the tool executed anyway.
`issues` name paths, expectations, and received TYPES — never the
supplied values (they can carry PII / injection payloads).

## Properties

### enforced

> `readonly` **enforced**: `boolean`

Defined in: [src/events/payloads.ts:453](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L453)

***

### issues

> `readonly` **issues**: readonly `object`[]

Defined in: [src/events/payloads.ts:448](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L448)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:447](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L447)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/events/payloads.ts:446](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L446)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/events/payloads.ts:445](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L445)
