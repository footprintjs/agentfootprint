---
type: changed
---
**`route_decided` names the citation correction, and `tool_end.changedArgKeys` names the keys a redrawn look-back ran with.** An agent with typed negative claims (`.outputSchema()` + `.negativeClaims({ field, tools })`) whose answer cited a result that does not resolve announced `chosen: 'final'` and then took the correction branch; it now announces `'negative-recheck'`, one announcement per iteration. Under `.time()`, when a drifted look-back is redrawn at the batch dispatch, `tool_end.changedArgKeys` now names `start_time` and `end_time`, the keys the tool ran with, instead of the removed `window`. A resumed call (after a check-in pause) still carries no `changedArgKeys`.

Migration: a listener that took `chosen: 'final'` as the end of the turn waits for the `'final'` that follows a `'negative-recheck'`; a reader of `changedArgKeys` reads the names the event carries, as before.
