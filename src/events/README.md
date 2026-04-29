# `src/events/` — the event registry + dispatcher

## What lives here

The stable public event contract and the central dispatcher that routes events to subscribers.

```
events/
├── types.ts         Shared value objects (EventMeta, ContextSlot, ContextSource, …)
├── payloads.ts      47 payload interfaces (one per registered event)
├── registry.ts      EVENT_NAMES + AgentfootprintEventMap + ALL_EVENT_TYPES
└── dispatcher.ts    EventDispatcher + .on / .off / .once + wildcards
```

## Architectural decisions

### Decision 1: Events are a **typed discriminated union**, not raw strings

Every event implements `AgentfootprintEventEnvelope<type, payload>`. Consumers subscribe by exact type; TypeScript narrows the payload automatically. No hand-parsed strings, no shape drift.

Trade-off: the 47 event-type names are a **closed set** — new domain events require adding to `registry.ts` + a corresponding payload in `payloads.ts`. That's intentional. The registry IS the contract; keeping it in one file makes breakage reviewable in one diff.

### Decision 2: Three-segment dotted names: `agentfootprint.<domain>.<action>`

Low cardinality (~47 names total). Low cardinality is a hard requirement for observability systems (OTEL, Datadog, Prometheus) — they index by name, so explosive name growth kills them. High-cardinality fields live in the payload.

### Decision 3: Central dispatcher, NOT DOM-style bubbling

One `EventDispatcher` per runner. Every event flows into it. Consumers subscribe once at the runner level and receive every event from every nested composition/primitive.

DOM needs bubbling because it has no central bus — events originate at leaves and must propagate up. We have a central bus **by construction** (one executor per run, recorders drain into one dispatcher). Bubbling would add complexity with zero benefit.

Filter by inner-runner via `event.meta.compositionPath` instead.

### Decision 4: Observers are **fire-and-forget, never awaited**

Inherited from footprintjs's recorder contract. The dispatcher never awaits a listener's Promise. If a listener needs async work to complete before a run moves on, it collects promises and the consumer awaits them AFTER `run()` returns.

This is enforced four ways: TypeScript `(event) => void` signature, ESLint `no-misused-promises` rule, dev-mode runtime warning for Promise-returning listeners, and documentation.

### Decision 5: Zero-allocation fast path

`hasListenersFor(type)` returns `false` when nothing subscribes; emitters skip event-object construction entirely. The dispatcher adds no cost to runs without subscribers.

## What the contract promises

- **Additive within a major version.** Adding a new event is non-breaking.
- **Breaking changes bump the major.** No deprecation shims.
- **Payload fields never change shape.** Adding optional fields is OK; removing/renaming is breaking.
- **Event names never change.** Rename = delete + add (breaking).

## When to add a new event

1. Is the decision observable without this event? If yes, don't add it.
2. Does it fit an existing domain? If yes, use that domain's prefix.
3. Does the payload carry *evidence* (why), not just *outcome* (what)? It should.
4. Is the name low-cardinality (no interpolation like `myapp.tool.${name}`)? It must be.

Then: add to `registry.ts` (EVENT_NAMES, AgentfootprintEventMap, ALL_EVENT_TYPES), add a payload interface in `payloads.ts`, add to the union in `registry.ts`. Tests enforce exhaustiveness.

## How consumers use this layer

Three API tiers of progressive disclosure:

```typescript
// 1. Power users — typed .on() with full type narrowing
agent.on('agentfootprint.stream.llm_start', (e) => e.payload.iteration /* typed */);

// 2. Wildcard subscriptions for debugging
agent.on('agentfootprint.context.*', handleContextEvents);
agent.on('*', debugFirehose);

// 3. Fully-typed discriminated union for exhaustive handling
runner.on('*', (e: AgentfootprintEvent) => {
  switch (e.type) {
    case 'agentfootprint.context.injected': /* payload typed */; break;
    // …
  }
});
```
