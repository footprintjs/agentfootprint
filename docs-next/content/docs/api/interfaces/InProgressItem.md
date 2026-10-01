---
title: InProgressItem
---

# Interface: InProgressItem

Defined in: src/core/agent/coverage/types.ts:94

One thing the tool READ and found still RUNNING — a backup in progress, a
replication session still synchronizing — whose outcome is therefore not
known yet: neither a success nor a failure (`coverage()`'s `inProgress`).

The TOOL decides which of its vendor's states are in flight — this library
never reads a state name, and the vendor's own verdict field, when there is
one, is the tool's to weigh. `what` is the author's prose, as for every
coverage item; `short` is the same RECORD-ONLY short form. `count` says how
many things this one entry stands for ("96 sessions still synchronizing" is
one entry with `count: 96`); omitted, the entry is one thing. It is served —
the model reads the number as the tool's own.

No `kind`: that names ground a call did NOT reach, and an item in progress
is ground it reached.

## Properties

### count?

> `readonly` `optional` **count?**: `number`

Defined in: src/core/agent/coverage/types.ts:102

How many things this entry stands for — a positive whole number; omitted = one.

***

### short?

> `readonly` `optional` **short?**: `string`

Defined in: src/core/agent/coverage/types.ts:100

RECORD-ONLY short form, the [CoverageItem.short](/docs/api/interfaces/CoverageItem#short) rules.

***

### what

> `readonly` **what**: `string`

Defined in: src/core/agent/coverage/types.ts:96

What is still running. Non-empty.

***

### why?

> `readonly` `optional` **why?**: `string`

Defined in: src/core/agent/coverage/types.ts:98

Since when, or what the vendor reported — optional.
