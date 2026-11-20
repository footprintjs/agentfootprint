**Mixed** — tool invocation and its runtime adapters.
Walker: resource/artifact/credential admission, invocation, cleanup and result landing.
Fold: catalog and execution-context projections.

# Tool-call execution ports

The handler composes its existing operation families once. Each family names the configuration and callback ports it reads. The original dependency object preserves late reads; forward callback references stay lazy. Invocation-local phase cells carry mutable facts by reference without copying scalar snapshots into an earlier phase.

Initial and resumed invocation keep separate code paths and ordering. The native batch handler remains the only serial-loop and pause-return owner. Resource admission uses the existing native component adapter, a finite logical-call owner and its current tier view. Live views, callbacks and credentials never cross checkpoints.

A composed call's admission finishes at its tool entry. Other calls can enter while it is still running. A halt closes the admission queue, takes precedence over a new pause, and uses the halted invocation's identity.

The dispatch doors use the settlement rule from `semantics/toolOutcome.ts`. `outcomeField.ts` uses that rule to record whether the call completed in `LLMMessage.outcome` (refused / failed / absent). The batch loop and the check-in, ask and credential resumes all use this function. The check-in trail reads the field and uses the earlier text test for unmarked tool messages, for example a completed result or a tool message from a history stored before the mark (`../../../../trailBeforeOutcomeMarker.ts`). A completed result that begins with a library refusal form still reads `ok: false`. A plain resume, a call a paused batch never dispatched and the host's notices commit tool messages without asking it (the settlement rule’s documentation gives the reason for each). `toolPauseData.ts` · `toolPauseData` builds a tool's own pause: the real `toolCallId` / `toolName` win, and the keys the library recognises its own pauses by (`checkIn`, `ask`, `awaitingInput`, credential consent's `authorization`) are dropped whatever their value, so a tool cannot rename the call, open a gate or show a consent link the library never minted. Example: `askHuman({ question: 'ok?', toolName: 'other' })` from `lookup` pauses with `toolName: 'lookup'`. A pause raised on a resumed dispatch is refused naming the door it came through (`resumedInvocation.ts`).

Result landing preserves the existing order around script records, tool brackets, suffixes, history, result judging and skill activation. New async operation boundaries require cancellation and recording-order proof; a source split alone does not establish equivalence.
