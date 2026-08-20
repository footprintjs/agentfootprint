[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowObservations

# Interface: WindowObservations

Defined in: [src/core/agent/window/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/types.ts#L201)

What the last-tool-result pin did at one iteration boundary (9.57.0).

Plain data, `structuredClone`-safe, committed with the rest of the record —
because a pin that KEEPS something has to be as visible as a drop that
removes something. The whole point of this release is that a model was
working from evidence nobody could see had gone; evidence nobody can see
was kept is the same defect facing the other way.

## Properties

### limit

> `readonly` **limit**: `number`

Defined in: [src/core/agent/window/types.ts:216](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/types.ts#L216)

The ceiling this visit measured against (`keepLastToolResults`).

***

### pinned

> `readonly` **pinned**: readonly `object`[]

Defined in: [src/core/agent/window/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/types.ts#L208)

The turns the pin held, newest first. `chars` is the whole TURN's content
length (an assistant's call and its results leave together), so
`windowCharsAfter` minus these is what the window would have been without
the pin — the cost of the feature, computable by any reader.

***

### standDown?

> `readonly` `optional` **standDown?**: `true`

Defined in: [src/core/agent/window/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/types.ts#L227)

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

Defined in: [src/core/agent/window/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/types.ts#L214)

How many otherwise-pinnable turns the ceiling turned away.
