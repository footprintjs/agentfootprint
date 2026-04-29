[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / mock

# Function: mock()

> **mock**(`options?`): [`MockProvider`](/agentfootprint/api/generated/classes/MockProvider.md)

Defined in: [agentfootprint/src/adapters/llm/MockProvider.ts:249](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/llm/MockProvider.ts#L249)

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
