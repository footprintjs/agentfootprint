---
title: LLMStartPayload
---

# Interface: LLMStartPayload

Defined in: [src/events/payloads.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L144)

## Properties

### estimatedPromptTokens?

> `readonly` `optional` **estimatedPromptTokens?**: `number`

Defined in: [src/events/payloads.ts:160](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L160)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L145)

***

### messagesCount

> `readonly` **messagesCount**: `number`

Defined in: [src/events/payloads.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L149)

***

### model

> `readonly` **model**: `string`

Defined in: [src/events/payloads.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L147)

***

### provider

> `readonly` **provider**: [`LLMProviderName`](/docs/api/type-aliases/LLMProviderName)

Defined in: [src/events/payloads.ts:146](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L146)

***

### providerRequestRef?

> `readonly` `optional` **providerRequestRef?**: `string`

Defined in: [src/events/payloads.ts:162](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L162)

***

### systemPromptChars

> `readonly` **systemPromptChars**: `number`

Defined in: [src/events/payloads.ts:148](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L148)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/events/payloads.ts:161](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L161)

***

### tools?

> `readonly` `optional` **tools?**: readonly `object`[]

Defined in: [src/events/payloads.ts:159](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L159)

The tool CATALOG the model saw for this call — what was at its disposal when
it chose (the menu behind its tool-selection reasoning). One `{ name,
description }` per tool sent to the provider, in request order. Absent when
the call had no tools. The structured "what the model saw" payload: pair it
with the iteration's reasoning to debug WHY a tool was (or wasn't) picked.
Names + descriptions only — full input schemas live in the snapshot.

***

### toolsCount

> `readonly` **toolsCount**: `number`

Defined in: [src/events/payloads.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L150)
