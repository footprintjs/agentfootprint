---
title: ZoneAbbreviation
---

# Interface: ZoneAbbreviation

Defined in: [src/time/resolveRecord.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L135)

One zone abbreviation the app's people write, as data (§ 11): the zone it
stands for, and the fixed offset it literally spells. `PST` in October is
both `America/Los_Angeles` (−07:00, what a person on the US west coast
usually means) and −08:00 (what the letters say) — so a mismatch offers
BOTH readings, never corrects one into the other.

## Properties

### offset

> `readonly` **offset**: `string`

Defined in: [src/time/resolveRecord.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L138)

`±HH:MM` (or `±HH`, `±HHMM`).

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/resolveRecord.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L136)
