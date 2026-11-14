---
type: fixed
---

**Private argument metadata no longer hides unrelated public facts in the final step.**
Both agent chart modes select Final inputs through one mapper that skips the
runtime-only private selector anchor before reading values. Real private
arguments and caller policies keep their native privacy handling. Replay tests
also recognize a native policy-served starting state when the engine provides
one, while older records without a base retain their explicit limitation.
