---
type: changed
---
**A streamed answer's standing line and limits block now reach the reader, over AG-UI and over `toSSE({ format: 'text' })`.** With `.answerLayer({ standingLine })` or `.limitsTravelWithTheAnswer()` armed and a provider that streams, both channels carried only the model's streamed words; the text the library appends after the stream reached only `RUN_FINISHED.result` and `turn_end.finalContent`. At the turn's end, both now write what of `turn_end.finalContent` the stream did not carry — the AG-UI serializer as its own text message, the text format as one more chunk. When nothing streamed (a provider without `stream()`), the text format now writes the whole answer, as the AG-UI serializer already did; before, it wrote nothing. Nothing more is written for a refused answer, or when what was written is not the answer's start (a `filter` that dropped tokens). `stream.token` still carries only the model's words.

Migration: a UI that adds `turn_end.finalContent` (or the returned answer) itself after either stream now shows that text twice; drop that step.
