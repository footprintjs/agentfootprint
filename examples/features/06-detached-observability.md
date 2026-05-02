---
name: Detached observability
group: Features
guide: https://footprintjs.github.io/agentfootprint/features/observability/#detach
---

# Detached observability — non-blocking telemetry export

`agent.enable.observability(...)` is sync by default — every event runs
through `strategy.exportEvent(event)` inline, on the dispatcher's hot
path. If your exporter does heavy work (HTTP POST to Datadog, Honeycomb,
S3 archive, etc.), it can block the agent loop and stretch every
turn's wall-clock.

agentfootprint v2.8.0 adds the `detach` option. When set, the strategy's
hot-path call is scheduled on a `footprintjs/detach` driver — agent loop
returns immediately, exports flush on the driver's schedule.

## When to use

- Your exporter does **synchronous** work that takes >1 ms (HTTP, file
  writes, deep serialization).
- You're shipping high-volume events (per-token streams) where inline
  cost compounds.
- You want a **graceful shutdown** that drains pending exports before
  exiting (`flushAllDetached()`).

## When NOT to use

- Exporter is fast (< 100 µs) — sync inline is cheaper than the detach
  scheduling overhead.
- You need strict in-process ordering observable to your test code —
  detached exports are still ordered FIFO per driver but are deferred
  past the synchronous slice.

## The pattern

```ts
import { microtaskBatchDriver, flushAllDetached } from 'footprintjs/detach';

const stop = agent.enable.observability({
  strategy: datadogExporter(...),
  detach: { driver: microtaskBatchDriver, mode: 'forget' },
});

// Later, in your shutdown handler:
process.on('SIGTERM', async () => {
  const stats = await flushAllDetached({ timeoutMs: 10_000 });
  console.log(`drained: ${stats.done} / failed: ${stats.failed} / pending: ${stats.pending}`);
  process.exit(stats.pending === 0 ? 0 : 1);
});
```

## Three modes

| `detach.mode` | Returns | Use when |
|---|---|---|
| `'forget'` (default) | `void` | Pure fire-and-forget telemetry |
| `'join-later'` | calls `onHandle(handle)` | You want to `await` exports later (tests, backpressure) |
| omitted (no `detach`) | sync | Default. Same as pre-v2.8 |

For `'join-later'`:

```ts
const handles: DetachHandle[] = [];
agent.enable.observability({
  strategy: datadogExporter(...),
  detach: {
    driver: microtaskBatchDriver,
    mode: 'join-later',
    onHandle: (h) => handles.push(h),
  },
});

// Later:
await Promise.all(handles.map((h) => h.wait()));
```

## Drivers

Pick by environment — see [`footprintjs/detach`](https://footprintjs.github.io/footPrint/guides/patterns/detach/) for the full list:

| Driver | Best for |
|---|---|
| `microtaskBatchDriver` | Default. Cross-runtime. Lowest latency. |
| `setImmediateDriver` | Node only. Yields to I/O before flushing. |
| `setTimeoutDriver` | Cross-runtime, configurable delay. |
| `sendBeaconDriver` | Browser. Survives page-unload. |
| `workerThreadDriver` | CPU-isolated. For heavy serialization. |

`enable.cost` accepts the same `detach` option for the same reasons.
`enable.thinking` and `enable.lens` stay sync — UI render must feel
responsive.
