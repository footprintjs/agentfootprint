# tools/

Tool definition, registry, and built-in tools.

## Define a Tool

```typescript
import { defineTool } from 'agentfootprint';

const searchTool = defineTool({
  id: 'search',
  description: 'Search the web for information',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
  handler: async ({ query }) => ({
    content: `Results for "${query}": ...`,
  }),
});
```

`inputSchema` accepts JSON Schema or Zod schema (duck-typed detection, zero Zod dependency).

## ToolRegistry

Internal registry for tool lookup and LLM formatting:

```typescript
const registry = new ToolRegistry();
registry.register(searchTool);
registry.register(calcTool);

registry.get('search');      // ToolDefinition
registry.has('search');      // true
registry.ids;                // ['search', 'calc']
registry.formatForLLM();     // [{ name, description, inputSchema }, ...]
```

Builders manage the registry — you just call `.tool(searchTool)`:

```typescript
Agent.create({ provider })
  .tool(searchTool)
  .tool(calcTool)
  .build();
```

## Built-in: ask_human

Pauses the agent loop for human input:

```typescript
import { askHuman } from 'agentfootprint';

Agent.create({ provider })
  .tool(askHuman('Ask the user a clarifying question'))
  .build();
```

When the LLM calls `ask_human`, the agent pauses. Resume with `agent.resume(checkpoint, humanResponse)`.

## Validation

Tool inputs are validated against `inputSchema` before handler execution. Validation errors are returned to the LLM as a tool result so it can self-correct.

Supports: JSON Schema validation (built-in lightweight validator) and Zod schemas (auto-converted via `zodToJsonSchema()`).
