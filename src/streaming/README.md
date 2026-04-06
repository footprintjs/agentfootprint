# streaming/

Real-time lifecycle events emitted during agent execution.

## Why

Consumers (CLI, web, mobile) need visibility into what's happening — tokens streaming, tools executing, turns completing. The framework provides the hooks. The consumer builds the UX.

## Usage

```typescript
await agent.run('hello', {
  onEvent: (event) => {
    if (event.type === 'token') process.stdout.write(event.content);
    if (event.type === 'tool_start') console.log(`Running ${event.toolName}...`);
  },
});
```

## API

| Export | Type | Description |
|--------|------|-------------|
| `AgentStreamEvent` | Union | 9-event discriminated union (turn, llm, tool, error lifecycle) |
| `AgentStreamEventHandler` | Type | `(event: AgentStreamEvent) => void` |
| `StreamEmitter` | Class | Multi-subscriber emitter with error isolation |
| `SSEFormatter` | Class | Convert events to Server-Sent Events text format |

## Events

| Event | Requires `.streaming(true)` | Description |
|-------|---------------------------|-------------|
| `turn_start` | No | Turn begins |
| `llm_start` | No | LLM call begins |
| `thinking` | Yes | Extended thinking (Anthropic) |
| `token` | Yes | Text chunk from LLM |
| `llm_end` | No | LLM call complete |
| `tool_start` | No | Tool execution begins |
| `tool_end` | No | Tool execution complete |
| `turn_end` | No | Turn complete (or paused) |
| `error` | No | Error in any phase |

## See Also

- [Streaming Guide](../../docs/guides/streaming.md)
