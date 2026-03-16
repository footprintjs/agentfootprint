# Providers

Providers are active strategies that shape what the LLM sees. There are three provider types:

| Provider | Controls | Interface |
|----------|----------|-----------|
| **PromptProvider** | System prompt per turn | `resolve(context) → string` |
| **MessageStrategy** | Message array sent to LLM | `prepare(history, context) → Message[]` |
| **ToolProvider** | Which tools are available | `resolve(context) → LLMToolDescription[]` |

All three are swappable. The agent builder uses simple defaults (static prompt, full history, static tools from `.tool()`), but for advanced use cases you can plug in custom providers via the low-level `agentLoop()`.

---

## PromptProvider

Resolves the system prompt for each turn. Receives a `PromptContext` with the current message, turn number, history, and signal.

### Built-in Strategies

#### staticPrompt

Returns the same prompt every turn.

```typescript
import { staticPrompt } from 'agentfootprint';

const provider = staticPrompt('You are a helpful assistant.');
// provider.resolve(context) → "You are a helpful assistant."
```

#### templatePrompt

String interpolation with `{{variable}}` placeholders. Variables are resolved from context or a custom resolver.

```typescript
import { templatePrompt } from 'agentfootprint';

const provider = templatePrompt(
  'You are {{role}}. The user asked: {{message}}',
  { role: 'a research assistant' },
);
// {{message}} is auto-filled from context.message
```

#### skillBasedPrompt

Dynamically selects from a set of "skills" based on the user message. Each skill has a trigger pattern and a prompt.

```typescript
import { skillBasedPrompt } from 'agentfootprint';

const provider = skillBasedPrompt({
  defaultPrompt: 'You are a general assistant.',
  skills: [
    { name: 'code', trigger: /code|program|function/i, prompt: 'You are a coding expert.' },
    { name: 'math', trigger: /math|calculate|equation/i, prompt: 'You are a math tutor.' },
  ],
});
```

#### compositePrompt

Chains multiple prompt providers. Each provider's output is concatenated.

```typescript
import { compositePrompt, staticPrompt, templatePrompt } from 'agentfootprint';

const provider = compositePrompt({
  providers: [
    staticPrompt('You are a helpful assistant.'),
    templatePrompt('Current turn: {{turnNumber}}.'),
  ],
  separator: '\n\n',
});
```

### Custom PromptProvider

```typescript
import type { PromptProvider, PromptContext } from 'agentfootprint';

const adaptive: PromptProvider = {
  resolve(context: PromptContext): string {
    if (context.turnNumber === 0) return 'You are a helpful assistant. Introduce yourself.';
    return 'You are a helpful assistant. Continue the conversation.';
  },
};
```

---

## MessageStrategy

Controls which messages are sent to the LLM each turn. Critical for managing context window limits.

### Built-in Strategies

| Strategy | Behavior |
|----------|----------|
| `fullHistory()` | Send all messages (default) |
| `slidingWindow({ maxMessages })` | Keep last N messages |
| `charBudget({ maxChars })` | Trim to character budget |
| `summaryStrategy({ summarizer, ... })` | Summarize old messages via LLM |
| `withToolPairSafety(strategy)` | Ensure tool calls always have matching results |
| `compositeMessages(strategies)` | Chain strategies sequentially |
| `persistentHistory({ store })` | Persist history to external storage |

#### slidingWindow

```typescript
import { slidingWindow } from 'agentfootprint';

const strategy = slidingWindow({ maxMessages: 20 });
// Keeps the system message + last 20 messages
```

#### charBudget

```typescript
import { charBudget } from 'agentfootprint';

const strategy = charBudget({ maxChars: 10_000 });
// Trims oldest messages to stay under character budget
```

#### withToolPairSafety

Wraps another strategy to ensure tool-call/tool-result pairs are never split. Many LLM APIs reject orphaned tool results.

```typescript
import { slidingWindow, withToolPairSafety } from 'agentfootprint';

const strategy = withToolPairSafety(slidingWindow({ maxMessages: 20 }));
```

#### persistentHistory

Persists conversation history to an external store. Ships with `InMemoryStore` for testing.

```typescript
import { persistentHistory, InMemoryStore } from 'agentfootprint';

const store = new InMemoryStore();
const strategy = persistentHistory({
  store,
  conversationId: 'conv-123',
});
```

### Custom MessageStrategy

```typescript
import type { MessageStrategy, MessageContext } from 'agentfootprint';

const custom: MessageStrategy = {
  prepare(history, context) {
    // Keep system message + last 5 messages
    const system = history.filter((m) => m.role === 'system');
    const recent = history.filter((m) => m.role !== 'system').slice(-5);
    return [...system, ...recent];
  },
};
```

---

## ToolProvider

Controls which tools are offered to the LLM each turn. Optionally handles tool execution.

### Built-in Strategies

| Strategy | Behavior |
|----------|----------|
| `staticTools(toolDefs)` | Always offer the same tools |
| `dynamicTools(resolver)` | Resolve tools per-turn based on context |
| `noTools()` | Disable tool use |
| `agentAsTool(config)` | Wrap a runner as a callable tool |
| `compositeTools(providers)` | Merge tools from multiple providers |

#### agentAsTool

Wraps any `RunnerLike` as a tool definition. Used internally by Swarm to expose specialists.

```typescript
import { agentAsTool } from 'agentfootprint';

const tool = agentAsTool({
  id: 'researcher',
  description: 'Research a topic thoroughly.',
  runner: researchAgent,
});
// Now the orchestrator can call the researcher via tool use
```

#### compositeTools

Merges tools from multiple providers into one.

```typescript
import { compositeTools, staticTools } from 'agentfootprint';

const combined = compositeTools([
  staticTools([searchTool, calculatorTool]),
  mcpToolProvider({ client: mcpClient }),
]);
```

### Custom ToolProvider

```typescript
import type { ToolProvider, ToolContext } from 'agentfootprint';

const contextual: ToolProvider = {
  resolve(context: ToolContext) {
    // Only offer the search tool on the first iteration
    if (context.loopIteration === 0) {
      return [{ name: 'search', description: 'Search the web', inputSchema: {} }];
    }
    return [];
  },
};
```

---

## Using Providers with agentLoop

The high-level concepts (Agent, LLMCall, etc.) use sensible defaults. For full control, use `agentLoop()` directly:

```typescript
import { agentLoop, staticPrompt, slidingWindow, staticTools } from 'agentfootprint';

const result = await agentLoop({
  provider: myLLMProvider,
  promptProvider: staticPrompt('You are helpful.'),
  messageStrategy: slidingWindow({ maxMessages: 20 }),
  toolProvider: staticTools([searchTool]),
  message: 'Hello!',
  maxIterations: 10,
});
```

See the [Adapters Guide](adapters.md) for LLM provider configuration.
