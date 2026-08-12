[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRefusalReason

# Type Alias: WindowRefusalReason

> **WindowRefusalReason** = `"system-envelope"` \| `"unresolved-tool-call"` \| `"paused-tool"` \| `"pending-check-in"` \| `"inside-keep-window"` \| `"only-existing-summary"` \| `"summarizer-failed"` \| `"replacement-not-smaller"`

Defined in: [src/core/agent/window/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/e9ad2ae7d4f6e95b31cc59d0c258cbf2c46ef350/src/core/agent/window/types.ts#L43)

Why a turn refused to leave the window. Every one of these is NAMED in the
commit — a removal that took less than it could have has to say why, or the
next person debugging an oversized window has to guess.

The set is closed and shared: the same reason means the same thing under
every strategy, because every strategy resolves it through the same
function (`refusalFor`, bound into `WindowStrategyInput.planRemoval`).
