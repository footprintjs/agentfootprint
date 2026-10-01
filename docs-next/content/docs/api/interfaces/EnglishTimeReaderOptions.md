---
title: EnglishTimeReaderOptions
---

# Interface: EnglishTimeReaderOptions

Defined in: [src/core/time/readers/english.ts:685](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/readers/english.ts#L685)

Options for [englishTimeReader](/docs/api/functions/englishTimeReader).

## Properties

### locale?

> `readonly` `optional` **locale?**: `string`

Defined in: [src/core/time/readers/english.ts:691](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/readers/english.ts#L691)

The language tag the time ask's labels are rendered in (`present.ts`),
e.g. `'en-GB'`. Default `'en-US'`. It never decides a date order — that is
the policy's (`dateOrder`) or the person's.
