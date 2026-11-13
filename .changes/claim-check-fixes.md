---
type: fixed
---

**Placement tickets are recognised by the library's own receipt, and small corrections to the claim checks.**

- A tool result shaped like a placement ticket counts as one only when the library placed it. The run keeps a receipt of the tickets it placed (`placedTickets` in its state), the staged-refs nudge and the declared-sources check read it, and a stored conversation carries it as the new optional `AgentRunCheckpoint.placedTickets`, so a ticket placed in an earlier turn is still named after `followUp()`, `run({ continueFrom })` or `resumeOnError()`. An agent that declares `wants` now commits `placedTickets: []` at seed. A recording made before this change is rebuilt by `servedAt` exactly as it was sent. Migration: store and hand back a checkpoint whole; a store that copies known fields only must also keep `placedTickets`, and a malformed one is refused at the door.
- The prior-turn check no longer starts a new turn at a line the library wrote (a wrap-up frame, a step nudge, a drop notice, a compaction summary, a delivered injection), so fewer `prior-turn-evidence` findings are filed and the turn numbers on grounding rows can be lower. Migration: none; a finding that disappears was filed against this turn's own result.
- The dispatch moment of the contingent check now exempts the same values as the answer moment: a value the person gave the inputs layer's batch ask, a declared default the turn assumed, and under `.time()` a time the person said no longer file a contingent row at the next call. Migration: none.
- `resultColumns` counts a column as present only when the row has it as its own key, so a declared column named `constructor` or `toString` that no row delivered is reported as `missing-column` instead of a mismatch, and under `enforce` a valid result is no longer refused for it.
- The negative-prose note codes and claim kinds are declared once: the row types and checkpoint admission read the same list (what is admitted does not change).
- The tools slot's compose-seam backstop files its findings through the same path every other seam uses, so its dedup identity names the compose seam it reports.
- The findings DATA frame is measured with a running byte total instead of being re-encoded after every entry; the frame is byte-identical.
- The two private-argument refusals that shared the code `ERR_PRIVATE_ARGUMENT_RECORD` are now one error class with that code, so the resumed-question refusal's `error.name` is now `PrivateArgumentRecordError` (was `PendingPrivateAskError`). Migration: match on `code`, which is unchanged.
