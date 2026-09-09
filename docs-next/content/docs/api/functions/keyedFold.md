---
title: keyedFold
---

# Function: keyedFold()

> **keyedFold**(`source`): [`KeyedFold`](/docs/api/interfaces/KeyedFold)

Defined in: [src/lib/time-travel/keyedFold.ts:251](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/keyedFold.ts#L251)

The keyed fold for one source, memoized on the source object.

Memoized because a per-epoch reader asks the same source for the same keys
at many different commits, and the index is the expensive half: building it
is one pass over the log, and answering a read afterwards is a binary search
plus a replay from the nearest full-value write (normally exactly one).

## Parameters

### source

`FoldSourceLike` \| `undefined`

## Returns

[`KeyedFold`](/docs/api/interfaces/KeyedFold)

## Example

```ts
import { keyedFold } from 'agentfootprint';

const fold = keyedFold(agent.getSnapshot());
fold.basis;                      // 'initial+log' — the base travelled
fold.valueAt('history', 12);     // the conversation after the 13th commit
fold.valueAt('history', -1);     // …and what the run STARTED from
```
