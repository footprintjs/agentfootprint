---
type: changed
bump: major
---
**A streamed answer's standing line and limits block now reach the reader over record-only AG-UI and `toSSE({ format: 'text' })`.** At the turn's end, both write the rest of `turn_end.finalContent`. Record-only AG-UI writes it as its own text message. The text format can write one more chunk when it saw the turn start at the root. A filter that drops only trailing tokens gets those words back with the rest. If a filter leaves a gap so the written text no longer matches the answer's prefix, nothing is added. If the provider streams nothing or a filter drops every token, the whole answer is written. Refused answers produce no additional text. A fresh stream on resume writes only the tokens from the already-open turn, if any. Under a Sequence or Parallel the stream still stops at the first agent's turn. Its text can be the run's answer when that agent also answers last. `stream.token` still carries only the model's words.

**Migration.** If your UI appends the answer itself after either stream writes it, remove that step to avoid duplicate text. If you use a token filter to suppress answer text, use the full event format and select the events to display. Read a resumed or composed run's full answer from its returned outcome.
