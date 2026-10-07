---
title: EnglishTimeReaderOptions
---

# Interface: EnglishTimeReaderOptions

Defined in: [src/core/time/readers/english.ts:801](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/readers/english.ts#L801)

Options for [englishTimeReader](/docs/api/functions/englishTimeReader).

## Properties

### locale?

> `readonly` `optional` **locale?**: `string`

Defined in: [src/core/time/readers/english.ts:807](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/readers/english.ts#L807)

The language tag the time ask's labels are rendered in (`present.ts`),
e.g. `'en-GB'`. Default `'en-US'`. It never decides a date order — that is
the policy's (`dateOrder`) or the person's.
