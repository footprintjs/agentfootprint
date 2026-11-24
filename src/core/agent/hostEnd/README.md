**Walker** — admits and records a host-ended turn through the native flowchart.

Set `hostEndedTurns: true` in `Agent.create` before the first turn to enable
`agent.endTurn` and record the origin of settled replies. By default, ordinary
turns keep their existing chart addresses and checkpoint format. Calling
`endTurn` while disabled rejects before opening a run.

The host supplies a reply at the start of a native turn. The run holds the
candidate privately while output policy decides what may be delivered. Its
reason is a finite code on the recording. The accepted assistant message carries
its run ID and host origin in checkpoints. Request composition removes origin
before the next provider call.

To continue a saved conversation, pass `{ continueFrom: checkpoint }` as the
second argument. Add `message` there when the caller supplied a new message.
A turn wrapper that processes inbound messages requires one. Call options
belong under `options`, for example `{ options: { signal } }`.

A refused output records the middleware name and outcome. Its explanation
uses fixed wording because an application callback can quote the private
candidate in a refusal or exception. Cancellation reaches the output middleware
through the same signal as the run.

After the chart finishes admission, the turn owner checks its terminal verdict,
integrity and cancellation. It commits the checkpoint entry, then emits the reply
and its root turn-end through the owning run's serving policy. A saved recording
carries delivery in that turn-end event, joined by run ID. The admission reason
alone cannot establish delivery. Each episodic projection reuses its compiled
writer and native input mapper and finishes under the same agent lease. A
rejection after a store wrote data leaves persistence unknown for that writer.
