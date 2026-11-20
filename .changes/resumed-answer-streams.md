---
type: fixed
---
**Finish the streamed answer after a pause.** A new text SSE or record-only
AG-UI stream can deliver the final answer when it attaches before resuming.
Text SSE respects the refusal decision associated with the final answer.
An SSE stream now closes when its `filter` drops the final event. It used
to stay open.
