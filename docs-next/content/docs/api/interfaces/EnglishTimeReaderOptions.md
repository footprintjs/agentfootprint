---
title: EnglishTimeReaderOptions
---

# Interface: EnglishTimeReaderOptions

Defined in: src/core/time/readers/english.ts:742

Options for [englishTimeReader](/docs/api/functions/englishTimeReader).

## Properties

### locale?

> `readonly` `optional` **locale?**: `string`

Defined in: src/core/time/readers/english.ts:748

The language tag the time ask's labels are rendered in (`present.ts`),
e.g. `'en-GB'`. Default `'en-US'`. It never decides a date order — that is
the policy's (`dateOrder`) or the person's.
