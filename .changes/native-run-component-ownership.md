---
type: breaking
---

Runs now use footprintjs's native lifecycle. Independently mounted components keep separate private state, and cleanup and typed-answer processing remain inside the owning run.

Migration: await each operation before starting another on the same runner. Use separate instances for independent conversations. `RunInFlightError` is the native class: match `ERR_RUN_IN_FLIGHT`; `runnerId` replaces `agentId`, and `activeRunId` can be absent. Its message no longer includes recovery advice. Read run IDs from execution events; `makeRunId` is removed.

Migration: recreate saved pauses with this version. They now retain explicit caller/session origins, finite resource references and the declared tool parties the model saw. Resume must keep the paused identity and transport session; a supplied `sessionId` must match. Missing or inconsistent data refuses before tool effects. Provider IDs are cooperative labels, not authentication. Continue protecting checkpoints at the host boundary.

Migration: retain and answer the returned pause. On a fresh instance, a partial typed answer that has not reached native execution has no local pending-question guard; its checkpoint still holds the question. Hosted agents keep that question in their session store. During a new call's short preparation, snapshot and conversation readers return `undefined`, commit counts are zero and narrative entries are empty. Capture prior records before starting the call.

Migration: custom `RunnerBase` subclasses must supply `initChart`'s execution configuration and initializer, execute through `runExecution().withRun`, use the invocation's view and `execute`, and pass that invocation to `detectPause`. `lastExecutor` and `openRunRedaction` are gone; use `prepareRunRedaction` and native setup. The corresponding `RunnerInvocation`, `RunnerSelection`, `RunnerMetadata` and `RunnerCoreValues` types are exported. Old subclasses must be rebuilt.

Migration: `session` and `shutdown` resource scopes still reuse one registration per tenant/principal/session; they do not restart an interpreter each turn. `call` and `run` resources use native turn/call ownership, with exclusive borrowing on resume. Pauses retain resources; accepted answers join cleanup. Refused answers keep the question. A local reference is not a live handle or proof of remote closure. The `agentfootprint.tools.resource_restore` event reports `retained`, `none-known-locally` or `unconfirmed` for local state; remote state stays `unknown`. Use explicit host abandon, close or shutdown controls when discarding a stored question.

Migration: causal memory readers require `schemaVersion: 2` and skip/count older or invalid rows. Evidence covers one component leg, with explicit availability and omissions. Custom evidence callbacks must use their supplied native parent binding, not another run's selected snapshot. Resume creates new observation handles without resetting conversation budgets.

Migration: use `swarm({ agents, router })` instead of separately sequencing `router.route` and `router.step`; the old step chain can pass an empty message. Native event run IDs replace separately minted domain IDs. Log IDs and resume-leg IDs can differ. Records include explicit ownership metadata and may show Messages/System Prompt in a different observed order; preserve recorded order. The fixture manifest pins those named changes and unchanged model-facing content.
