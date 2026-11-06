---
title: EnglishTimeReaderOptions
---

# Interface: EnglishTimeReaderOptions

Defined in: [src/time/readers/english.ts:460](https://github.com/footprintjs/agentfootprint/blob/main/src/time/readers/english.ts#L460)

Options for [englishTimeReader](/docs/api/functions/englishTimeReader).

## Properties

### locale?

> `readonly` `optional` **locale?**: `string`

Defined in: [src/time/readers/english.ts:466](https://github.com/footprintjs/agentfootprint/blob/main/src/time/readers/english.ts#L466)

The language tag the time ask's labels are rendered in (`present.ts`),
e.g. `'en-GB'`. Default `'en-US'`. It never decides a date order — that is
the policy's (`dateOrder`) or the person's.
