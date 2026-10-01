---
title: epochLocations
---

# Function: epochLocations()

> **epochLocations**(`source`): readonly [`EpochLocation`](/docs/api/interfaces/EpochLocation)[]

Defined in: [src/lib/time-travel/epochs.ts:217](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/epochs.ts#L217)

Every epoch in a recording, in run order — the ONE owner of the flat /
grouped fork.

Returns `[]` for a recording with no LLM call in it at all (an empty log, a
chart with no `call-llm` stage). That is a different fact from "the epoch you
asked for is not here", which is what [epochAt](/docs/api/functions/epochAt) says with `undefined`.

MEMOIZED on the recording object, because the cost of locating epochs is a
pass over the log and a per-epoch reader asks for one epoch at a time: before
this, scrubbing a 600-turn run epoch by epoch relocated every epoch on every
call and took 20.8 s. Holding the snapshot and asking it repeatedly is the
shape a reader's UI actually has, so the memo is keyed on exactly that
object; a caller that hands in a runner and gets a fresh snapshot each time
pays the pass each time, which is the cost of asking a different question.

FROZEN, because it is memoized: the array and each location on it are the
very objects the next caller gets, so an edit here would be an edit to
everybody's answer. The same law `keyedFold.ts` · `freezeDeep` states for a
folded value. What is NOT frozen is what a location POINTS AT — `log`,
`source`, `runSource` are the caller's own recording, and this file does not
get to lock down an object it was merely handed.

## Parameters

### source

`unknown`

## Returns

readonly [`EpochLocation`](/docs/api/interfaces/EpochLocation)[]

## Example

```ts
import { epochLocations } from 'agentfootprint';

epochLocations(agent.getSnapshot()!).map((e) => [e.epoch, e.callRuntimeStageId]);
// dynamic:         [[1, 'call-llm#12'], [2, 'call-llm#31']]
// dynamic-grouped: [[1, 'sf-llm-call/call-llm#9'], [2, 'sf-llm-call/call-llm#28']]
```
