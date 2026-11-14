---
type: internal
---
**Make the transparent Proxy checkpoint test deterministic.** Hold the capture clock steady for the two checkpoint reads while preserving equality of the complete checkpoints, then restore the clock before the next turn.
