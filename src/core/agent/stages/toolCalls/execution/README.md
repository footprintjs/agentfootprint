**Mixed** — tool invocation and its runtime adapters.
Walker: resource/artifact/credential admission, invocation, cleanup and result landing.
Fold: catalog and execution-context projections.

# Tool-call execution ports

The handler composes its existing operation families once. Each family names the configuration and callback ports it reads. The original dependency object preserves late reads; forward callback references stay lazy. Invocation-local phase cells carry mutable facts by reference without copying scalar snapshots into an earlier phase.

Initial and resumed invocation keep separate code paths and ordering. The native batch handler remains the only serial-loop and pause-return owner. Resource admission uses the existing native component adapter, a finite logical-call owner and its current tier view. Live views, callbacks and credentials never cross checkpoints.

Two rules the dispatch doors share live here. `callOutcome.ts` · `callOutcomeOf` decides `LLMMessage.outcome` (refused / failed / absent: did the call complete, not whether `execute` was entered) from how the call settled, for the batch loop and the check-in, ask and credential resumes alike; the check-in trail reads that field, and reads a result's words only for a message with no mark (a completed call, or any message of a history stored by an earlier version), by the earlier text test (`../../../../trailBeforeOutcomeMarker.ts`). A plain resume, a call a paused batch never dispatched and the host's notices commit tool messages without asking it (the file's header says why each is right). `initialInvocation.ts` · `toolPauseData` builds a tool's own pause: the real `toolCallId` / `toolName` win, and the keys the library recognises its own pauses by (`checkIn`, `ask`, `awaitingInput`, credential consent's `authorization`) are dropped whatever their value, so a tool cannot rename the call, open a gate or show a consent link the library never minted. Example: `askHuman({ question: 'ok?', toolName: 'other' })` from `lookup` pauses with `toolName: 'lookup'`. A pause raised on a resumed dispatch is refused naming the door it came through (`resumedInvocation.ts`).

Result landing preserves the existing order around script records, tool brackets, suffixes, history, result judging and skill activation. New async operation boundaries require cancellation and recording-order proof; a source split alone does not establish equivalence.
