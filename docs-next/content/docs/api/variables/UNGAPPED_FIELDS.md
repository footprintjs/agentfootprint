---
title: UNGAPPED_FIELDS
---

# Variable: UNGAPPED\_FIELDS

> `const` **UNGAPPED\_FIELDS**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/lib/time-travel/servedView.ts:706](https://github.com/footprintjs/agentfootprint/blob/main/src/lib/time-travel/servedView.ts#L706)

The fields no gap names, and the reason each one needs none — the OTHER half
of the account.

WHY IT EXISTS. `SERVED_GAPS` was hand-checked against the two shapes three
times in one release and came up short every time, because "is every field
named by a gap?" was a question a person answered by reading. It is now a
question a walk answers: `test/lib/time-travel/gap-catalogue-walk.test.ts`
enumerates every field a real `Receipt` and a real `ServedView` carry and
requires each one to be named by a gap OR to be a key here. A field in
neither fails, by name.

So this is not an exemption list. It is the place a field goes when NO GAP'S
MECHANISM EXPLAINS IT, and the value is the reason in one sentence, for the
next person who asks why the field has no gap. Adding a key here is as
reviewable as adding one to a gap, and that is the point: both are a claim
somebody wrote down.

TWO reasons qualified when this list was written, and one of them has since
emptied out:

  • NO FOLD CAN FAIL TO PRODUCE IT — the field is read straight off the
    located epoch, never through a fold. `callRuntimeStageId` is this kind.
  • ITS ABSENCE IS UNIVERSAL AND HAS NOTHING TO DO WITH THIS RECORDING — no
    chart IN THIS LIBRARY supplies it, on any run, so no gap about a limit of
    the rebuild describes it. `omittedForAttention` WAS this kind from
    9.88.0's fourth review round to 9.93.0, and is not any more: the
    measurement it rested on ("no chart drops for attention") had missed the
    agent chart's window stage, which evicts turns for budget on every run
    whose strategy engages and now files them on the receipt. A recorded
    drop can be lost in exactly one way — with the receipt — so the field is
    named by `no-receipt-on-chart` and is not here. The kind is kept on this
    list because the next universally-absent field will need it, and because
    a reason that was true for five releases and then measured false is
    worth a sentence where the next person looks.

A field a gap DOES name never belongs here, whatever else is also true of it.
`epoch` was a key here through three rounds, on the true-but-irrelevant
ground that `servedAt(k)` hands `k` back; what a base-less fold changes is
what that number MEANS, `servedViews()` returns the fold's number outright,
and `no-fold-base` names it now.

Paths are spelled as they are on the shape that HAS the field — both keys
here are `ServedView` fields. Gap `fields` are spelled as `Receipt` paths —
see [ServedGap.fields](/docs/api/interfaces/ServedGap#fields) for the places the two shapes differ.

## Example

```ts
import { SERVED_GAPS, UNGAPPED_FIELDS } from 'agentfootprint';

// Why does nothing explain `callRuntimeStageId`? Because nothing has to.
UNGAPPED_FIELDS['callRuntimeStageId'];
Object.keys(SERVED_GAPS).length; // 7 gap kinds
```
