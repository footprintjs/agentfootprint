[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageMiddleware

# Interface: MessageMiddleware

Defined in: [src/core/agent/middleware/types.ts:298](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L298)

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

Defined in: [src/core/agent/middleware/types.ts:299](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L299)

## Methods

### onMessage()

> **onMessage**(`msg`): [`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md) \| `Promise`\<[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md)\>

Defined in: [src/core/agent/middleware/types.ts:300](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L300)

#### Parameters

##### msg

[`MessageMiddlewareContext`](/agentfootprint/api/generated/interfaces/MessageMiddlewareContext.md)

#### Returns

[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md) \| `Promise`\<[`MessageOutcome`](/agentfootprint/api/generated/type-aliases/MessageOutcome.md)\>
