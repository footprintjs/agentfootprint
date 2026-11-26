---
title: RunTime
---

# Interface: RunTime

Defined in: [src/time/clock.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L93)

The run's time input — `agent.run({ message, time })`, or the options bag of
`run`, `followUp`, `resume` and `resumeOnError`. Every key is optional; a
run with no zone here needs the builder's fallback.

## Example

```ts
await agent.run({ message: 'errors since 8?', time: { now: sentAt, zone: 'America/Los_Angeles' } });
```

## Properties

### now?

> `readonly` `optional` **now?**: `string` \| `Date`

Defined in: [src/time/clock.ts:100](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L100)

The turn's anchor — the MESSAGE's time, so a replay or a late resume
reads "yesterday" the same way. An ISO 8601 instant with a zone (upper
case `T` and `Z`, no leap second), or a `Date`. Omitted: the turn's start,
recorded `nowSource: 'default'`.

***

### window?

> `readonly` `optional` **window?**: `ControlWindowInput`

Defined in: [src/time/clock.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L108)

A window set in a UI — a brushed chart range, a range picker — as a
range of instants. The end is exclusive unless `end: 'inclusive'` is supplied.
Optional `precision` keeps the displayed precision even when the ISO spelling is padded.

***

### zone?

> `readonly` `optional` **zone?**: `string`

Defined in: [src/time/clock.ts:102](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L102)

The person's IANA zone for this run (`'America/Los_Angeles'`). Never an abbreviation.
