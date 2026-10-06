---
type: fixed
---
**Enforce declared tool arguments at resumed, inner, and MCP-server dispatch.**
These dispatch paths now use the same supported-schema validator as normal
Agent calls. Invalid arguments are refused before credentials or execution;
middleware output is validated after the chain, before artifact references
are resolved. Agent resumes preserve `toolArgValidation` enforce/warn/off;
warn mode can report another invalid-arguments event at resumed admission.
Inner `ctx.tools.call` throws the shared correction; `mcpServe` returns an MCP
tool error. Neither has an Agent validation dial.

Migration: correct arguments that formerly bypassed admission, or declare
intentional extra fields in the tool schema. Open schemas stay open, accepted
arguments are not coerced or stripped, and `defineTool` still preserves the
original `execute` function. Direct `.execute`, client-side MCP coercion, and
the validator's existing subset limits are unchanged. A credential-consent
checkpoint that already contains resolved `wants` data remains unsupported:
it may now fail schema admission before the existing artifact-ref refusal.
