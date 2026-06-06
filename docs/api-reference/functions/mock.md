[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mock

# Function: mock()

> **mock**(`options?`): [`MockProvider`](/agentfootprint/api/generated/classes/MockProvider.md)

Defined in: [src/adapters/llm/MockProvider.ts:251](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/adapters/llm/MockProvider.ts#L251)

Lowercase factory for `MockProvider` — matches the v1 `mock()` import
shape so docs and quick-starts stay copy-pasteable. Equivalent to
`new MockProvider(options)`.

## Parameters

### options?

[`MockProviderOptions`](/agentfootprint/api/generated/interfaces/MockProviderOptions.md) = `{}`

## Returns

[`MockProvider`](/agentfootprint/api/generated/classes/MockProvider.md)

## Example

```ts
import { Agent, mock, defineTool } from 'agentfootprint';

  const agent = Agent.create({ provider: mock({ reply: 'hello' }) })
    .tool(defineTool({ name: 'echo', ... }))
    .build();
```
