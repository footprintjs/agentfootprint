---
title: RunTime
---

# Interface: RunTime

Defined in: src/core/time/clock.ts:89

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

Defined in: src/core/time/clock.ts:96

The turn's anchor — the MESSAGE's time, so a replay or a late resume
reads "yesterday" the same way. An ISO 8601 instant with a zone (upper
case `T` and `Z`, no leap second), or a `Date`. Omitted: the turn's start,
recorded `nowSource: 'default'`.

***

### window?

> `readonly` `optional` **window?**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: src/core/time/clock.ts:103

A window set in a UI — a brushed chart range, a range picker — as a
half-open `{ from, to }` of instants. Recorded with `source: 'control'`.

***

### zone?

> `readonly` `optional` **zone?**: `string`

Defined in: src/core/time/clock.ts:98

The person's IANA zone for this run (`'America/Los_Angeles'`). Never an abbreviation.
