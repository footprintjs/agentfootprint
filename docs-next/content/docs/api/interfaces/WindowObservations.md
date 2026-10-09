---
title: WindowObservations
---

# Interface: WindowObservations

Defined in: [src/core/agent/window/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L265)

What the last-tool-result pin did at one iteration boundary (9.57.0).

Plain data, `structuredClone`-safe, committed with the rest of the record —
because a pin that KEEPS something has to be as visible as a drop that
removes something. The whole point of this release is that a model was
working from evidence nobody could see had gone; evidence nobody can see
was kept is the same defect facing the other way.

Since 9.102.0 the ledger-fact pin files the same shape under
`WindowRecord.ledgerFacts`, with `limit` = `keepLedgerFacts`; every field
below reads the same way there.

## Properties

### limit

> `readonly` **limit**: `number`

Defined in: [src/core/agent/window/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L280)

The ceiling this visit measured against (`keepLastToolResults`).

***

### pinned

> `readonly` **pinned**: readonly `object`[]

Defined in: [src/core/agent/window/types.ts:272](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L272)

The turns the pin held, newest first. `chars` is the whole TURN's content
length (an assistant's call and its results leave together), so
`windowCharsAfter` minus these is what the window would have been without
the pin — the cost of the feature, computable by any reader.

***

### standDown?

> `readonly` `optional` **standDown?**: `true`

Defined in: [src/core/agent/window/types.ts:291](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L291)

Present and `true` when the pin STOOD DOWN for this visit: the two
previous visits both removed nothing AND both named `'last-tool-result'`,
so the pin is provably what is blocking progress, and it releases rather
than let the window grow without bound. Bounds the pin's blast radius at
two consecutive boundaries under ANY strategy, including one you wrote.

It is recorded rather than done quietly because a policy that reverses
itself has to say so — a silent reversal is indistinguishable from a bug.

***

### yielded

> `readonly` **yielded**: `number`

Defined in: [src/core/agent/window/types.ts:278](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L278)

How many otherwise-pinnable turns the ceiling turned away.
