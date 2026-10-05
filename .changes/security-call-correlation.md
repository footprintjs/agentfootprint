---
type: fixed
---
**Permission and credential events identify the tool call they belong to.**
Library-produced `permission.check`, `permission.halt` and credential lifecycle
events now carry `toolCallId` and `iteration`, captured at dispatch. Resumed calls
keep the paused call's identity; failures from nested `ctx.tools` credential
requests name the inner call. Same-name calls no longer require an order-based
guess. Existing event counts, decisions and tool execution are unchanged.

New correlation fields are optional on public payloads for caller-emitted events
and older recordings; `permission.halt.iteration` remains required.
Qualify them with the event's run identity; missing fields mean attribution is
unavailable, not approval. This does not add credential-success events to the
pull API, sanitize existing reason text, or assign events to commit indices.
