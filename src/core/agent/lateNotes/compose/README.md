**Lens** — renders already served evidence into one bounded model-facing note.

# Compose the late record note

`renderLateRecordNote()` receives ranked points after the caller has applied
redaction. It emits the fixed attribution line and one JSON array. Authored
values stay in their JSON fields, including strings containing apparent
delimiters or line separators.

The highest-priority distinct whole rows that fit are retained, up to five
rows and 512 UTF-8 bytes including the attribution and framing. A row that
exceeds the remaining budget is skipped, with no partial text or omitted count.
The result is absent when no whole row fits. Dispatch and submission evidence
belong to the requesting stages and the selected provider's encoder.
