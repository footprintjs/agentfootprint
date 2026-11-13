---
type: fixed
---
**A streamed answer's standing line and limits block now reach an AG-UI frontend.** With `.answerLayer({ standingLine })` or `.limitsTravelWithTheAnswer()` armed and a provider that streams, the AG-UI text carried only the model's streamed words; the line the library appended after the stream reached only `RUN_FINISHED.result`. The serializer now writes the rest of `turn_end.finalContent` — what the stream did not carry — as its own text message at the turn's end. `stream.token` still carries only the model's words, as documented.

`route_decided` now names the citation correction a typed-negative-claims agent takes (`'negative-recheck'`), instead of the `'final'` the Route decider announced before the correction was decided — one announcement per iteration. And under `.time()`, when a drifted look-back is redrawn at dispatch, `tool_end.changedArgKeys` names the keys the tool ran with (`start_time`, `end_time`) instead of the removed look-back key.
