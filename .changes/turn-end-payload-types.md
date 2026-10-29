---
type: fixed
---
**`turn_end`'s payload type now declares two fields the event already carried.** `answerCoverage.inProgress` (what a read found still running, per declaring call) and a negatives check row's `staleSince` (the turn, and the time, a cited read went stale on) rode on `agentfootprint.agent.turn_end` without a type. Both are optional, so existing code compiles unchanged, and a reader can now type them instead of casting.
