[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRefusalReason

# Type Alias: WindowRefusalReason

> **WindowRefusalReason** = `"system-envelope"` \| `"unresolved-tool-call"` \| `"paused-tool"` \| `"pending-check-in"` \| `"inside-keep-window"` \| `"only-existing-summary"` \| `"summarizer-failed"` \| `"summary-not-smaller"`

Defined in: [src/core/agent/window/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/d88e6fac2f21cbe1cf33c05b6ad2e016ecf61a67/src/core/agent/window/types.ts#L37)

Why a turn refused to leave the window. Every one of these is NAMED in the
commit — a removal that took less than it could have has to say why, or the
next person debugging an oversized window has to guess.

The set is closed and shared: the same reason means the same thing under
every strategy, because every strategy resolves it through the same
function (`refusalFor`, bound into `WindowStrategyInput.planRemoval`).
