**Mixed** — tool invocation and its runtime adapters.
Walker: resource/artifact/credential admission, invocation, cleanup and result landing.
Fold: catalog and execution-context projections.

# Tool-call execution ports

The handler composes its existing operation families once. Each family names the configuration and callback ports it reads. The original dependency object preserves late reads; forward callback references stay lazy. Invocation-local phase cells carry mutable facts by reference without copying scalar snapshots into an earlier phase.

Initial and resumed invocation keep separate code paths and ordering. The native batch handler remains the only serial-loop and pause-return owner. Resource admission uses the existing native component adapter, a finite logical-call owner and its current tier view. Live views, callbacks and credentials never cross checkpoints.

Two rules every door shares live here. `callOutcome.ts` · `callOutcomeOf` decides `LLMMessage.outcome` (refused / failed / absent) from how the call settled, for the batch loop and the check-in, ask and credential resumes alike; the check-in trail reads that field, never the result's words. `initialInvocation.ts` · `toolPauseData` builds a tool's own pause: the real `toolCallId` / `toolName` win, and the gate keys (`checkIn`, `ask`, `awaitingInput`) are dropped, so a tool cannot rename the call or open a consent gate the library never minted. Example: `askHuman({ question: 'ok?', toolName: 'other' })` from `lookup` pauses with `toolName: 'lookup'`. A pause raised on a resumed dispatch is refused naming the door it came through (`resumedInvocation.ts`).

Result landing preserves the existing order around script records, tool brackets, suffixes, history, result judging and skill activation. New async operation boundaries require cancellation and recording-order proof; a source split alone does not establish equivalence.
