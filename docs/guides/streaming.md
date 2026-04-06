# Streaming & Lifecycle Events

agentfootprint provides real-time lifecycle events during agent execution via `AgentStreamEvent`. Consumers (CLI, web, mobile) use these to build smooth UX.

## Quick Start

```typescript
import { Agent } from 'agentfootprint';

const agent = Agent.create({ provider })
  .system('You are helpful.')
  .tool(searchTool)
  .streaming(true)  // enables token-by-token streaming
  .build();

const result = await agent.run('Search for TypeScript tutorials', {
  onEvent: (event) => {
    switch (event.type) {
      case 'turn_start':
        console.log(`User: ${event.userMessage}`);
        break;
      case 'llm_start':
        console.log(`\n--- LLM call ${event.iteration} ---`);
        break;
      case 'token':
        process.stdout.write(event.content);
        break;
      case 'tool_start':
        console.log(`\nRunning ${event.toolName}...`);
        break;
      case 'tool_end':
        console.log(`Done (${event.latencyMs}ms)`);
        break;
      case 'llm_end':
        console.log(`\n[${event.model}, ${event.latencyMs}ms, ${event.toolCallCount} tools]`);
        break;
      case 'turn_end':
        console.log(`\n=== Complete (${event.iterations} iterations) ===`);
        break;
      case 'error':
        console.error(`Error in ${event.phase}: ${event.message}`);
        break;
    }
  },
});
```

## Event Timeline

A typical multi-turn execution with tool calls:

```
agent.run('Check order ORD-1003')
  → turn_start { userMessage: 'Check order ORD-1003' }

  [Iteration 1 — LLM decides to call a tool]
    → llm_start { iteration: 1 }
    → token 'I'
    → token "'ll"
    → token ' look'
    → token ' that'
    → token ' up'
    → llm_end { iteration: 1, toolCallCount: 1, content: "I'll look that up" }

  [Tool execution]
    → tool_start { toolName: 'lookup_order', toolCallId: 'tc-1', args: { orderId: 'ORD-1003' } }
    → tool_end { toolName: 'lookup_order', result: '{"status":"denied",...}', latencyMs: 42 }

  [Iteration 2 — LLM responds with final answer]
    → llm_start { iteration: 2 }
    → token 'Your'
    → token ' order'
    → ...
    → llm_end { iteration: 2, toolCallCount: 0, content: 'Your order was denied...' }

  → turn_end { content: 'Your order was denied...', iterations: 2 }
```

## All 9 Event Types

```typescript
type AgentStreamEvent =
  | { type: 'turn_start'; userMessage: string }
  | { type: 'llm_start'; iteration: number }
  | { type: 'thinking'; content: string }              // extended thinking (Anthropic)
  | { type: 'token'; content: string }                  // requires .streaming(true)
  | { type: 'llm_end'; iteration: number; toolCallCount: number;
      content: string; model?: string; latencyMs: number }
  | { type: 'tool_start'; toolName: string; toolCallId: string;
      args: Record<string, unknown> }
  | { type: 'tool_end'; toolName: string; toolCallId: string;
      result: string; error?: boolean; latencyMs: number }
  | { type: 'turn_end'; content: string; iterations: number; paused?: boolean }
  | { type: 'error'; phase: 'prompt' | 'llm' | 'tool' | 'message';
      message: string }
```

## Streaming vs Non-Streaming

`onEvent` works in both modes. The difference:

| Event | `.streaming(false)` | `.streaming(true)` |
|-------|--------------------|--------------------|
| `turn_start` | Yes | Yes |
| `llm_start` | Yes | Yes |
| `token` | **No** | Yes |
| `thinking` | **No** | Yes |
| `llm_end` | Yes | Yes |
| `tool_start` | Yes | Yes |
| `tool_end` | Yes | Yes |
| `turn_end` | Yes | Yes |
| `error` | Yes | Yes |

Tool lifecycle and turn lifecycle events always fire. Only `token` and `thinking` require streaming mode.

## Backward Compatibility

The deprecated `onToken` callback still works:

```typescript
// Old way (still works, deprecated)
await agent.run('hello', {
  onToken: (token) => process.stdout.write(token),
});

// New way (recommended)
await agent.run('hello', {
  onEvent: (e) => {
    if (e.type === 'token') process.stdout.write(e.content);
  },
});
```

If both `onEvent` and `onToken` are provided, `onToken` is ignored and a dev-mode warning is emitted.

## SSE (Server-Sent Events)

For web backends streaming to browsers:

```typescript
import { SSEFormatter } from 'agentfootprint';

app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');

  agent.run(req.query.message, {
    onEvent: (event) => {
      res.write(SSEFormatter.format(event));
    },
  }).then(() => res.end());
});
```

Output:
```
event: token
data: {"type":"token","content":"Hello"}

event: tool_start
data: {"type":"tool_start","toolName":"search","toolCallId":"tc-1","args":{"q":"test"}}
```

## Error Isolation

`onEvent` handler errors are swallowed — they never crash the agent pipeline. This is the same pattern as `RecorderBridge` (passive observers never break execution).

## Pause Events

When the agent pauses (ask_human tool), `turn_end` fires with `paused: true`:

```typescript
onEvent: (e) => {
  if (e.type === 'turn_end' && e.paused) {
    showResumeUI();  // show input for human response
  }
}
```

## Key Design Decisions

- **footprintjs: zero changes** — tokens flow through footprintjs StreamCallback, agentfootprint adds semantics
- **NOT a recorder** — streaming events are push-to-consumer, not passive observation
- **Error isolation** — consumer callback errors are swallowed
- **Latency on llm_end and tool_end** — measured before instruction processing overhead
