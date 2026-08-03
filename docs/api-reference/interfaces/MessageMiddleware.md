[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageMiddleware

# Interface: MessageMiddleware

Defined in: src/core/agent/middleware/types.ts:177

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

Defined in: src/core/agent/middleware/types.ts:178

## Methods

### onMessage()

> **onMessage**(`msg`): [`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md) \| `Promise`\<[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md)\>

Defined in: src/core/agent/middleware/types.ts:179

#### Parameters

##### msg

[`MessageMiddlewareContext`](/agentfootprint/api/generated/interfaces/MessageMiddlewareContext.md)

#### Returns

[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md) \| `Promise`\<[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md)\>
