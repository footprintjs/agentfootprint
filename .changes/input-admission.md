---
type: security
---
**Refused inputs no longer become conversation checkpoints.** Input middleware
denials now record their decision and stop before conversation state is seeded.
A later turn cannot inherit the refused request through the new run's history.
Hosted sessions retain their last accepted checkpoint under exit, async and sync
durability; a refused first request creates no stored conversation. Refused
retries restore no history, folded spans or findings. Allowed input paths,
output denials and tool pause/resume keep their existing behavior.

Migration: `checkpoint()` after input denial now returns `undefined`, and
`followUp()` raises `NoConversationError`. Keep an earlier accepted checkpoint
and pass it explicitly as `run({ message, continueFrom })`. Refused runs no
longer seed conversation fields or a clock; their integrity disposition reports
`workExisted: false`. Previously persisted unsafe conversations need separate
cleanup before reuse. This is admission protection, not audit redaction: run
inputs, rewrite evidence and middleware-authored reasons remain subject to your
retention policy.
