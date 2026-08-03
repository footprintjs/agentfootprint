---
title: MessageMiddleware
---

# Interface: MessageMiddleware

Defined in: [src/core/agent/middleware/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L177)

One link in the message chain. Runs at both phases unless it decides
otherwise by reading `msg.phase`.

## Example

```ts
const scrubSSNs: MessageMiddleware = {
  name: 'scrub-ssns',
  onMessage: (msg) => {
    const clean = msg.content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[ssn]');
    return clean === msg.content ? allow() : allow(clean, 'masked a US SSN');
  },
};
```

## Properties

### name

> `readonly` **name**: `string`

Defined in: [src/core/agent/middleware/types.ts:178](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L178)

## Methods

### onMessage()

> **onMessage**(`msg`): [`MessageOutcome`](/docs/api/type-aliases/MessageOutcome) \| `Promise`\<[`MessageOutcome`](/docs/api/type-aliases/MessageOutcome)\>

Defined in: [src/core/agent/middleware/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L179)

#### Parameters

##### msg

[`MessageMiddlewareContext`](/docs/api/interfaces/MessageMiddlewareContext)

#### Returns

[`MessageOutcome`](/docs/api/type-aliases/MessageOutcome) \| `Promise`\<[`MessageOutcome`](/docs/api/type-aliases/MessageOutcome)\>
