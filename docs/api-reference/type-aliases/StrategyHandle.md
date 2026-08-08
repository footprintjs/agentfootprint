[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StrategyHandle

# Type Alias: StrategyHandle

> **StrategyHandle** = `Unsubscribe` & `AsyncDisposable` & `object`

Defined in: [src/strategies/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/strategies/types.ts#L93)

What every `enable.*` strategy call returns (8.12.0).

**It is still the `Unsubscribe` function.** `telemetry()` detaches the
subscription and nothing else, exactly as before — every call site written
against the old return type keeps compiling and keeps behaving identically.
What is new is that the function also carries two methods, so the object
that knows which strategy is attached is the object you can drain:

```ts
const telemetry = agent.enable.observability({ strategy: cloudwatch });

await telemetry.flush();   // ship what is buffered; keep exporting
telemetry();               // detach; strategy keeps running (unchanged law)
telemetry.stop();          // release the strategy — timers, clients, buffers
```

Or let the scope do it, which cannot be got wrong:

```ts
await using telemetry = agent.enable.observability({ strategy: cloudwatch });
```

`flush()` enforces the shutdown ORDER internally, which is the part no
consumer could do from outside: it drains the detach hop first (events
scheduled on a `detach` driver have not reached your strategy yet), then the
strategy's own buffer. `stop()` is refcounted — see `BaseStrategy.stop`.

## Type Declaration

### flush()

> **flush**(): `Promise`\<`void`\>

Ship everything this subscription has produced: first the events still
queued on a `detach` driver, then the strategy's own buffer. Safe to
call repeatedly and concurrently; never throws at you (a failing
exporter reports through its own `_onError`).

#### Returns

`Promise`\<`void`\>

### stop()

> **stop**(): `void`

Release this subscription AND, if it was the last one pointing at the
strategy, the strategy itself — timers cleared, clients closed. A
strategy another runner still shares is left running; stopping is
delivered at most once, ever.

Does not flush first: call `flush()` before it, or use
`agent.shutdown()` / `await using`, which do.

#### Returns

`void`
