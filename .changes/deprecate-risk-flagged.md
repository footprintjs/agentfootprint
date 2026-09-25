---
type: deprecated
---
**`agentfootprint.risk.flagged` is deprecated: nothing ever emitted it.** The
event (and its `RiskFlaggedPayload`) was the output of `RiskDetector`, which
has no caller, so a listener on it — say, for `prompt_injection` — heard
silence that looked exactly like "no risk found". Both go in 10.0.0. To screen
content, refuse in a `PermissionChecker`, a `.reliability({ preCheck })` rule or
a `.messageMiddleware(...)`, and listen to the events those already emit
(`permission.halt`, `reliability.*`, `middleware.decision`).
