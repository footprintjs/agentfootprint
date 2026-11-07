---
type: fixed
---
**`ProceedWithTurn` now says when the record is filed outside the wrapper.** When a turn fails in the agent's own work around a run that settled (a typed run that refuses a pause, for example), `proceed` rejects first, and the run's finalizers run after the wrapper returns, outside its context, so the end stays failed. The API reference used to promise the record inside the wrapper in every case.
