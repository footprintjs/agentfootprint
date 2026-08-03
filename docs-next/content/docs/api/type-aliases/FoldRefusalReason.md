---
title: FoldRefusalReason
---

# Type Alias: FoldRefusalReason

> **FoldRefusalReason** = `"system-envelope"` \| `"unresolved-tool-call"` \| `"paused-tool"` \| `"pending-check-in"` \| `"inside-keep-window"` \| `"only-existing-summary"` \| `"summarizer-failed"` \| `"summary-not-smaller"`

Defined in: src/core/agent/compaction/types.ts:78

Why a turn refused to fold. Every one of these is NAMED in the commit —
a fold that took less than it could have has to say why, or the next
person debugging an over-budget window has to guess.
