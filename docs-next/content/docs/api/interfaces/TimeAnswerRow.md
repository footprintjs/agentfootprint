---
title: TimeAnswerRow
---

# Interface: TimeAnswerRow

Defined in: src/core/time/rows.ts:150

The window the person settled for one mention in the time ask — the ONLY
door by which a window of words becomes the person's (the owner's decision
"Always confirm", time design TQ29). Filed by the batch ask when a window
answer binds (`arguments/ask.ts` · `bindAnswer`); read back by
`bind.ts` · `turnWindowsOf`, so the rest of the turn uses it as an
`answered` window and the served sentence names it with its source.

## Extends

- [`TimeRange`](/docs/api/interfaces/TimeRange)

## Properties

### from

> `readonly` **from**: `string`

Defined in: src/core/time/range.ts:60

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`from`](/docs/api/interfaces/TimeRange#from)

***

### how

> `readonly` **how**: `"confirmed"` \| `"edited"`

Defined in: src/core/time/rows.ts:163

`confirmed`: the person picked a reading the library offered (the
pre-filled choice — their click); `edited`: they wrote a window of their
own. Both are the person's answer.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/time/rows.ts:153

***

### kind

> `readonly` **kind**: `"time-answer"`

Defined in: src/core/time/rows.ts:151

***

### mention

> `readonly` **mention**: `number`

Defined in: src/core/time/rows.ts:155

The `time-reading` row's mention the answer settles.

***

### to

> `readonly` **to**: `string`

Defined in: src/core/time/range.ts:61

#### Inherited from

[`TimeRange`](/docs/api/interfaces/TimeRange).[`to`](/docs/api/interfaces/TimeRange#to)

***

### turn

> `readonly` **turn**: `number`

Defined in: src/core/time/rows.ts:152

***

### zone

> `readonly` **zone**: `string`

Defined in: src/core/time/rows.ts:157

The zone the window was answered in — the reading's, or the turn's clock for free entry.
