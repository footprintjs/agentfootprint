---
type: changed
---
**`tool_end.modelResult` also appears when the framework removed the record-only coverage fields.** It used to mean "a rule made what the model read differ from `result`" (an `onToolResult` link or the result cap). A call whose tool declares a coverage item's `short` or `kind` is now served without them, so its `tool_end` carries the tool's envelope as `result` and what the model read as `modelResult` — about 4 KB more per declaring call for a typical absence, in the recording and in any exporter that ships `modelResult` (the OpenTelemetry adapter exports what the model read, as before). A call whose tool declares neither gets no stamp and no new byte.
