---
type: internal
---
**The served-view complexity guard counts work instead of timing it.**
`test/lib/time-travel/served-view-complexity.test.ts` timed `servedViews`
against a per-epoch `servedAt` scrub and failed on CI with `src` unchanged: the
garbage collection its own JSON copies of the recording owed landed inside the
timed windows. It now counts fold bases built (`stateAt`) and log positions
walked (`splitStageId`), requires the scrub's counts to equal the batch's at 13
and 49 epochs, and shows the counter reads E times more for a rebuild per
question. The time-travel README states the law: a complexity claim is counted,
never timed. No library behaviour changed.
