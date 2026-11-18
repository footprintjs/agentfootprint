---
type: changed
bump: major
---

**Show the possible sources of a recorded read.** `trace_node` attributes reads
using the reader's recorded Foottrace window. If several writes could have
supplied the value, the tool shows a bounded list of possible sources with
Foottrace reason codes. The list keeps the before-window candidate and counts
any omitted possibilities.

Migration: a read can have several possible data parents, including candidates
omitted from the `trace_node` display. If a stamped read has no tracked writer,
the tool reports that the reason is unavailable for its window. Unstamped
records still use the before-commit rule and retain its absence codes. Variable
recall keeps alternatives in `orWriteIdxs` and shows the read on every
candidate's custody trail. The root walk ends at an ambiguous read with
`ambiguous-read-source`.
