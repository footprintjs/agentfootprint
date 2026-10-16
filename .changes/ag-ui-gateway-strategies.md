---
type: added
---
**AG-UI behind a gateway: your own request body, your own envelope, and the request's credential through a hosted run.** `agUi()` is now three strategies you can replace one at a time. `reader` maps a gateway's own request body onto the AG-UI turn (`AgUiRequestReader` → `AgUiTurnRequest`). `translation` turns a run's events into AG-UI events, and the default `agUiSerializer` is unchanged. `framing` writes each event, for example as `{"eventType":"TextMessageContentEvent","event":{…,"eventSequence":n}}`. With no options, `agUi()` writes the same bytes as before.

The untrusted-input rules stay in the core, whichever reader you use. A custom reader's output is copied as plain JSON, so each value is read once, and then checked exactly like a `RunAgentInput`. That means the id format checks, no system or developer message, frontend tools only from the allow-list, `state` and `context` only through your validators, and answers only for the pause the server keeps.

`SseFraming.frame(event, at)` now receives `{ sequence }`, the frame's number in its own stream. `streamHandler` and `toSSE` count it per stream, so a framing that numbers its frames keeps no counter, and two runs at once never share one. A caller that drives a framing itself passes the number.

`standingAgent` and `streamHandler` take `sealRequest`. It seals the credential a request carries, for example a gateway's per-request token in a header, with `requestContext` for that request's run only. A resume gets the credential of the request that resumes it. `nodeHost` and `httpHost` deliver the headers. The credential never reaches a frame, a reply, a stored session or a checkpoint. A sealer that returns the same handle twice, or a plain object, is refused. A sealer that throws refuses the request with `ERR_REQUEST_NOT_SEALED` (400) and a fixed message.
