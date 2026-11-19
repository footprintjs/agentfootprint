# Predictions before paid runs

These are predictions for an engaged run that follows the prescribed calls,
including a false `done` play in A, B and D. The label warning must identify the
critical call. A generic line or the model's own caveat does not count.

| Task | 15.0.0 defaults · label / account | 15.0.0 label on · label / account | Packed candidate label on · label / account |
| --- | --- | --- | --- |
| A · entered, declared failure | no / no | no / no | yes / yes |
| B · one failure among eight | no / no | no / no | yes / yes |
| C · exact retry completes | no caution / no unresolved warning | no caution / no unresolved warning | no caution / no unresolved warning |
| D · accepted and pending | no / no | no / no | no / yes, reports pending |
| Old doable control | no caution / no warning | no caution / no warning | no caution / no warning |

Published 15.0.0 omits these status declarations from the account's call facts.
The candidate is expected to say what the call reported through `reportedStatus`
while preserving `outcome: ran`. Report C's earlier declared failure separately
as history if the exact later call completed. The label's committed outcomes
can identify A's call and B's exact Oak call. Pending is unavailable to that
label fold, so only the candidate account is expected to say it.

The candidate predictions become observations only after its archive rehearsal.
The offline placeholder is published 15.0.0.
