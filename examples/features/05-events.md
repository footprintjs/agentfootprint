---
name: Events — typed .on() + wildcards + runner.emit()
group: features
guide: ../../README.md#features
defaultInput: find info
---

# Events — typed `.on()` + wildcards + `runner.emit()`

Every runner has a typed EventDispatcher with three subscription forms:

1. **Specific type** — `.on('agentfootprint.stream.llm_start', listener)`.
   Compile-time payload checking.
2. **Domain wildcard** — `.on('agentfootprint.stream.*', listener)`.
   Untyped payload (union of the domain's events).
3. **Global wildcard** — `.on('*', listener)`. Everything, for tracing /
   debugging.

Plus `runner.emit(name, payload)` for consumer-owned events the library
doesn't emit (eval, memory, skill domains).

## When to use

- **Domain-specific recorders** — attach per-domain bridges for
  metrics dashboards, cost heatmaps, audit logs.
- **Custom evaluation** — your own code emits `agentfootprint.eval.score`
  after grading responses; downstream consumers subscribe to the typed
  event.
- **Debugging** — wildcard listener dumps every event to a log file.

## Key API

```ts
// Specific typed subscription
const off = agent.on('agentfootprint.stream.llm_start', (e) => {
  // e.payload is fully typed: iteration, provider, model, ...
});

// Domain wildcard
agent.on('agentfootprint.stream.*', (e) => console.log(e.type));

// Global wildcard
agent.on('*', (e) => fullAuditLog.push(e));

// Consumer emit — typed payload checking
agent.emit('agentfootprint.eval.score', {
  metricId: 'grounding',
  value: 0.92,
  target: 'run',
  targetRef: 'run-123',
});

off();
```

## Event domains (13)

`composition · agent · stream · context · memory · tools · skill ·
permission · risk · fallback · cost · eval · error · pause · embedding`

47 typed events total. See `src/events/registry.ts` for the full list.

## Related

- **[Observability](./04-observability.md)** — `.enable.*` wraps
  `.on()` with pre-built formatters
