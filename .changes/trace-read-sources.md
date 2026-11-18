---
type: changed
bump: major
---
**Show the possible sources of a recorded read.** `trace_node` attributes reads
using the reader's recorded Foottrace window. If several writes could have
supplied the value, the tool lists each candidate with its Foottrace reason
code. A read with no tracked writer and a read whose source was not recorded
have separate answers.

Migration: a read can have several possible data parents. Variable recall
keeps those alternatives in `orWriteIdxs` and shows the read on every
candidate's custody trail. The root walk ends at an ambiguous read with
`ambiguous-read-source`. Unstamped records still use the before-commit rule.
