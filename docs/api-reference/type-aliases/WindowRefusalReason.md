[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / WindowRefusalReason

# Type Alias: WindowRefusalReason

> **WindowRefusalReason** = `"system-envelope"` \| `"current-request"` \| `"unresolved-tool-call"` \| `"paused-tool"` \| `"pending-check-in"` \| `"inside-keep-window"` \| `"last-tool-result"` \| `"only-existing-summary"` \| `"summarizer-failed"` \| `"replacement-not-smaller"`

Defined in: [src/core/agent/window/types.ts:43](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/window/types.ts#L43)

Why a turn refused to leave the window. Every one of these is NAMED in the
commit — a removal that took less than it could have has to say why, or the
next person debugging an oversized window has to guess.

The set is closed and shared: the same reason means the same thing under
every strategy, because every strategy resolves it through the same
function (`refusalFor`, bound into `WindowStrategyInput.planRemoval`).
