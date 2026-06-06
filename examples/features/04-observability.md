---
name: Observability — enable.liveStatus + enable.observability
group: features
guide: ../../README.md#features
defaultInput: analyze the Q3 report
---

# Observability — `.enable.*` namespace

Every runner has an `.enable` namespace attaching Tier-3 observability via
uniform **strategies**. They're one-liners over the typed dispatcher:

- `agent.enable.liveStatus({ strategy })` — Claude-Code-style terse status
  line. With `chatBubbleLiveStatus({ onLine })`, fires a human-readable
  status string on every interesting boundary (LLM call, tool call, route
  decision).
- `agent.enable.observability({ strategy })` — firehose structured logging.
  With `consoleObservability()` it prints every typed event; swap in a
  vendor strategy (pino, OTel, CloudWatch, AgentCore) at the same call site.

Both return an `Unsubscribe` — call to detach. Import the built-in
strategies from `agentfootprint/strategies`.

## When to use

- **Live UIs** — `liveStatus` pushes friendly status lines to a chat
  widget so users see what the agent is doing.
- **Debug / trace** — `observability` with `consoleObservability()` gets
  the firehose; a vendor strategy ships it to your backend.
- **Custom dashboards** — plug your structured logger into a strategy.

## Key API

```ts
import { chatBubbleLiveStatus, consoleObservability } from 'agentfootprint/strategies';

// Status line
const stopThinking = agent.enable.liveStatus({
  strategy: chatBubbleLiveStatus({ onLine: (s) => chatWidget.setStatus(s) }),
});

// Structured logging (swap consoleObservability for a vendor strategy)
const stopLogging = agent.enable.observability({
  strategy: consoleObservability({ logger: myPinoLogger }),
});

// Later:
stopThinking();
stopLogging();
```

## Migration (4.0.0)

The flat `enable.thinking()` / `enable.logging()` one-liners were removed.
Replace `enable.thinking({ onStatus })` with
`enable.liveStatus({ strategy: chatBubbleLiveStatus({ onLine: onStatus }) })`,
and `enable.logging()` with
`enable.observability({ strategy: consoleObservability() })`.

## Related

- **[Events](./05-events.md)** — the raw `.on(type, listener)` surface
  the enable namespace wraps
