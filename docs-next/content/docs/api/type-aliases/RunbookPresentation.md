---
title: RunbookPresentation
---

# Type Alias: RunbookPresentation

> **RunbookPresentation** = `"prose"` \| `"panel"`

Defined in: [src/core/runbook/types.ts:93](https://github.com/footprintjs/agentfootprint/blob/main/src/core/runbook/types.ts#L93)

WHO RENDERS THE ROWSET — the one thing about its client a runbook cannot
work out for itself.

`'prose'` — the model's prose is the rowset's only surface (a chat client,
a log line, an email). The envelope ships the pre-rendered `table` and tells
the model to output it verbatim, because retyping is the only alternative.

`'panel'` — the host draws the rowset itself (a data panel, a grid, a
report page). The envelope ships NO `table`, and says so: reproducing rows
the reader is already looking at is the same transcription risk, run for no
gain.
