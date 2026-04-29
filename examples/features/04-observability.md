---
name: Observability — enable.thinking + enable.logging
group: features
guide: ../../README.md#features
defaultInput: analyze the Q3 report
---

# Observability — `.enable.*` namespace

Every runner has an `.enable` namespace attaching pre-built Tier-3
observability recorders. They're one-liners over the typed dispatcher:

- `agent.enable.thinking({ onStatus })` — Claude-Code-style terse
  status line. Fires a human-readable status string on every
  interesting boundary (LLM call, tool call, route decision).
- `agent.enable.logging({ domains, logger })` — firehose structured
  logging. Filter by event domain; wrap your existing logger
  (console, pino, winston).

Both return an `Unsubscribe` — call to detach.

## When to use

- **Live UIs** — `thinking` pushes friendly status lines to a chat
  widget so users see what the agent is doing.
- **Debug / trace** — `logging` with `'all'` gets the firehose; with
  specific domains focuses on what's interesting.
- **Custom dashboards** — plug your structured logger directly in.

## Key API

```ts
// Status line
const stopThinking = agent.enable.thinking({
  onStatus: (s) => chatWidget.setStatus(s),
});

// Filtered logging
const stopLogging = agent.enable.logging({
  domains: [LoggingDomains.STREAM, LoggingDomains.COST],
  logger: myPinoLogger,
});

// Later:
stopThinking();
stopLogging();
```

## LoggingDomains

Use `LoggingDomains.*` constants for autocomplete + typo safety. Raw
strings still work (same literal type). 13 domains map one-to-one with
event namespaces (`agentfootprint.<domain>.*`).

## Related

- **[Events](./05-events.md)** — the raw `.on(type, listener)` surface
  the enable namespace wraps
