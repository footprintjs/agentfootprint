---
type: fixed
---
**A hosted answer that `.answerValidation()` withheld is a 422 refusal, not a 500.** `ERR_ANSWER_VALIDATION` had no row in the hosting refusal table, so a person whose answer an enforcing validation withheld received HTTP 500 — the status for "the agent broke" — from `nodeHost`, `httpHost` and the hosts built on them. Nothing broke: the request was fine and the agent ran, but the answer did not pass the app's checks. It is now a 422 with code `ERR_ANSWER_VALIDATION`, and on a stream the closing `error` frame carries the same code. The message now says what happened: "The answer was withheld: answer validation '…' did not pass (failed)." The refusal withholds the answer only: tools the turn already called have run, and nothing undoes them.
