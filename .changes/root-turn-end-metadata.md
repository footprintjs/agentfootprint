---
type: added
---
**Identify the owning Agent's completed turn.** Its `turn_end` event carries
`meta.rootTurn: true` on both fresh and resumed runs. Older records can lack
the field.
