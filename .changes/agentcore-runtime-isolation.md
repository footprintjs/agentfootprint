---
type: internal
---
Isolation hardening of the not-yet-released AgentCore Runtime MCP transport, folded into its own entry above: `'per-call'` is the default session strategy, `'reuse'` keeps one runtime session per client rather than per transport, keyed by a handle the transport issues rather than the server's session id, what the MCP client reads of a failure is rewritten from fixed sentences and safe ids rather than the service's text, and a bearer token is vended in `machine` mode only.
