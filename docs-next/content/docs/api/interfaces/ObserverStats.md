---
title: ObserverStats
---

# Interface: ObserverStats

Defined in: node\_modules/footprintjs/dist/types/lib/runner/DeferredObserverTier.d.ts:88

The Block 9 observability surface — `snapshot.observerStats`. The A4
dispatcher stats plus the terminal-flush stranding count from Block 8.
Present on `RuntimeSnapshot` only when a deferred observer was attached.

## Extends

- `DispatcherStats`

## Properties

### budgetExhausted

> `readonly` **budgetExhausted**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:100

Flushes cut short by `flushBudgetMs` (A1).

#### Inherited from

`DispatcherStats.budgetExhausted`

***

### depth

> `readonly` **depth**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:94

Current backlog.

#### Inherited from

`DispatcherStats.depth`

***

### drops

> `readonly` **drops**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:96

Events LOST (overflow) — never silent; also visible as seq gaps.

#### Inherited from

`DispatcherStats.drops`

***

### flushes

> `readonly` **flushes**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:98

Completed checkpoint flushes.

#### Inherited from

`DispatcherStats.flushes`

***

### inflight

> `readonly` **inflight**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:106

Async listener continuations not yet settled.

#### Inherited from

`DispatcherStats.inflight`

***

### inlineDeliveries

> `readonly` **inlineDeliveries**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:104

`'block'`-policy refusals delivered synchronously inline.

#### Inherited from

`DispatcherStats.inlineDeliveries`

***

### p95FlushMs

> `readonly` **p95FlushMs**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:102

p95 flush duration, ms (rolling window).

#### Inherited from

`DispatcherStats.p95FlushMs`

***

### perListener

> `readonly` **perListener**: `Readonly`\<`Record`\<`string`, `ListenerStats`\>\>

Defined in: node\_modules/footprintjs/dist/types/lib/observer-queue/deferredDispatcher.d.ts:108

Per-listener time accounting — "name the hog" (A2).

#### Inherited from

`DispatcherStats.perListener`

***

### terminalStranded

> `readonly` **terminalStranded**: `number`

Defined in: node\_modules/footprintjs/dist/types/lib/runner/DeferredObserverTier.d.ts:95

Envelopes still queued when a terminal flush hit its runaway-cascade
round cap (Block 8). `0` in any sane run — a non-zero value means a
listener kept enqueueing work at end-of-run and delivery was cut off
(also dev-warned at the moment it happened). Never silent.
