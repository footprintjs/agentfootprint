---
title: ServedGap
---

# Interface: ServedGap

Defined in: src/lib/time-travel/servedView.ts:221

One named limit on the rebuild, with the fields it covers — a hole the log
 cannot fill, or a boundary the record cannot see past.

## Properties

### cause?

> `readonly` `optional` **cause?**: [`ServedGapCause`](/docs/api/type-aliases/ServedGapCause)

Defined in: src/lib/time-travel/servedView.ts:318

WHY this gap fired, where the site could establish it — [ServedGapCause](/docs/api/type-aliases/ServedGapCause).

Carried by `no-receipt-on-chart`, which is the gap whose sentence used to
list its causes. Absent elsewhere: a gap carries a cause when the site that
raised it read something that told it, and supplying one anywhere else
would be the enumeration coming back as a field.

***

### fields

> `readonly` **fields**: readonly `string`[]

Defined in: src/lib/time-travel/servedView.ts:282

The fields this gap covers, in dotted `Receipt` form. A reader that
renders one of them should render this gap's sentence beside it.

TWO RELATIONS LIVE ON THIS LIST, and a consumer that treats them as one
will draw a wrong conclusion in one direction or the other:

- MOST gaps mean *the rebuild cannot produce this field* — the recording
  does not hold what it would take. `no-fold-base`, `no-run-log`,
  `no-conversation-on-record`, `no-receipt-on-chart`, `forced-tool-schema`,
  and the `cache.*` entries of `cache-transform` are all this kind. A
  checker may treat these as an EXCUSE.
- `cache-transform`'s COMPOSITION fields (`system.*`, `messages.*`,
  `tools.*`) are the other kind. WHEN NO OTHER GAP ON THE SAME VIEW NAMES
  THE SAME FIELD, the rebuild produces them and they agree with the
  receipt; both describe the request handed TO the cache strategy, and the
  port may have got something else. That is a CAVEAT to print, not an
  excuse to grant — a checker that excused these would stop checking
  fields the record proves perfectly well.

  The qualifier is load-bearing and was missing until 9.88.0. Every view
  carries `cache-transform`, including one that also carries
  `no-fold-base`, where the rebuild does NOT agree: measured on a
  base-less recording, the receipt said 27 system chars over 3 turns and
  the rebuild produced 0 over 1. Read this entry as "up to the cache
  strategy" and read the OTHER gaps on the view for whether the rebuild
  got there at all.

`provider-defaults`/`params` is the caveat kind too, and is the one field
read past the strategy: it describes the request the port really got, and
only the vendor lies beyond it. Its opposite number is
`no-receipt-on-chart`, which is the missing kind: no receipt was minted, so
`params` and everything else only a receipt carries is simply absent.

`Receipt` paths WHEREVER THE TWO SHAPES HOLD THE SAME FACT, even though the
thing rendered beside them is usually a [ServedView](/docs/api/interfaces/ServedView), because the two
sides of the law are checked field by field and only one of them can name
the fields. Three spellings differ and a renderer has to map them:
`system.hash` / `system.chars` are the view's `system.text`,
`messages.entries` / `messages.count` are its `messages.asSent`, and
`tools.schemaHashes` is its `tools.schemas`. The rest — `system.pieces`,
`messages.requestOnly`, `tools.names`, `tools.forced`, `params`, `cache.*`
— are spelled the same on both.

THE ONE EXCEPTION is the epoch number, and it is an exception because the
two shapes do not hold one fact there: they hold two RECORDS of it that can
disagree. The view's `epoch` is what the fold produced (a position, when it
could not read `iteration`) and `no-fold-base` names it under that
spelling; the receipt's `basis.epoch` was minted live from the run's own
counter and `no-receipt-on-chart` names it, because losing the receipt is
the only thing that loses it. Translating one to the other would print
whichever sentence is wrong: a missing base does not touch the receipt's
number, and a missing receipt does not touch the view's.

A list rather than one name because a single missing fact can leave
several fields unproved: losing the run log costs the forced tool's name,
the tool list it belongs on, and the request-only lines composed from
`toolWantsByName`.

***

### gap

> `readonly` **gap**: [`ServedGapKind`](/docs/api/type-aliases/ServedGapKind)

Defined in: src/lib/time-travel/servedView.ts:222

***

### why

> `readonly` **why**: `string`

Defined in: src/lib/time-travel/servedView.ts:309

The gap in the words a renderer prints — WHICH FIELDS it covers, WHAT THEY
MEAN ON THIS VIEW, WHAT TO DO DIFFERENTLY, and nothing else.

IT NAMES NO MECHANISM. Not a module, not a function, not a key, not a
version, not a chart, not a strategy, not an option — because naming one
makes a sentence read like a description of code a reader cannot open, and
because the enumerations that went false in five review rounds all arrived
through that door. The mechanism is in the comment above each catalogue
entry, and the cause is data on [ServedGap.cause](/docs/api/interfaces/ServedGap#cause).

IT STILL MAKES CLAIMS, AND THAT IS THE POINT. The rule was sold for one
release as ending the class of sentences a code edit can falsify. Measured
sentence by sentence against real runs, it does not: ten of the eleven
reduced sentences claim something the code decides — that a count may be
short, that an empty list means unknown, that a tool list is complete. Only
`UNGAPPED_FIELDS.gaps` is claim-free, and only because it describes the
account rather than the request. A sentence that claims nothing cannot
inform, so the claims stay.

WHAT MAKES THEM TRUE is `test/lib/time-travel/gap-sentences.test.ts`: one
real run per entry, and an assertion for each claim the sentence makes —
not that the gap fired, but that what it says about the view holds. The
checker keeps the sentences short and readable; the assertions keep them
true. The blind spot is a claim nobody wrote an assertion for.
