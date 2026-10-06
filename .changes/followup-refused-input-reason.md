---
type: fixed
---

**`followUp()` after a refused input now says why, truthfully.** It used to
raise `NoConversationError` with the unfinished-run advice — catch
`RunCheckpointError.checkpoint` — but a refusal raises `MessageDeniedError`,
which carries no checkpoint. The error now has `reason: 'last-input-refused'`
and points at the earlier accepted checkpoint (a refused FIRST turn, with no
earlier one, stays `'never-run'`): pass the one `checkpoint()`
returned after the last accepted run to `run({ message, continueFrom })`.
`NoConversationError.reason` (`NoConversationReason`: `'never-run'`,
`'last-run-unfinished'`, `'last-input-refused'`) lets a caller branch on it.
