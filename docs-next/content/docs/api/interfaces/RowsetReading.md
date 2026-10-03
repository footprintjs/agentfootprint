---
title: RowsetReading
---

# Interface: RowsetReading

Defined in: [src/integrity/column-types/check.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/check.ts#L96)

What the library could read about a finished result: the rows, or nothing.

Deliberately thin. The check needs the rows and nothing else, and a reading
that carried a verdict would be this file judging in two places.

## Properties

### rows

> `readonly` **rows**: readonly `Readonly`\<`Record`\<`string`, `unknown`\>\>[]

Defined in: [src/integrity/column-types/check.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/check.ts#L97)
