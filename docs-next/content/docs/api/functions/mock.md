---
title: mock
---

# Function: mock()

> **mock**(`options?`): [`MockProvider`](/docs/api/classes/MockProvider)

Defined in: [src/adapters/llm/MockProvider.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/llm/MockProvider.ts#L251)

Lowercase factory for `MockProvider` — matches the v1 `mock()` import
shape so docs and quick-starts stay copy-pasteable. Equivalent to
`new MockProvider(options)`.

## Parameters

### options?

[`MockProviderOptions`](/docs/api/interfaces/MockProviderOptions) = `{}`

## Returns

[`MockProvider`](/docs/api/classes/MockProvider)

## Example

```ts
import { Agent, mock, defineTool } from 'agentfootprint';

  const agent = Agent.create({ provider: mock({ reply: 'hello' }) })
    .tool(defineTool({ name: 'echo', ... }))
    .build();
```
