[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageMiddleware

# Interface: MessageMiddleware

Defined in: [src/core/agent/middleware/types.ts:290](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/agent/middleware/types.ts#L290)

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

Defined in: [src/core/agent/middleware/types.ts:291](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/agent/middleware/types.ts#L291)

## Methods

### onMessage()

> **onMessage**(`msg`): [`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md) \| `Promise`\<[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:292](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/agent/middleware/types.ts#L292)

#### Parameters

##### msg

[`MessageMiddlewareContext`](/agentfootprint/api/generated/interfaces/MessageMiddlewareContext.md)

#### Returns

[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md) \| `Promise`\<[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md)\>
