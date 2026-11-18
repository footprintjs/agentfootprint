---
type: changed
---
A check-in tells the approver which argument values were hidden. The request binds that list to the call and carries it into the decision record.

**Migration**

- Show `CheckInRequest.hiddenArgs` next to the arguments on approval screens. The request omits the list when the view hides nothing. The built-in `evidence.willDo` names the hidden arguments in quoted text. A custom assembler receives the same list on `CheckInAssemblerInput.hiddenArgs`.
- A view that throws or returns unsupported data displays placeholders for all arguments. An inconclusive string probe masks that argument and lists its name. Custom views should depend only on their arguments. An unchanged non-string value can be indistinguishable from a custom placeholder of that type.
- An approval binds the hidden names and the arguments that will run. Empty lists leave the request id unchanged. Handle the new `view-changed` refusal when the resumed view would hide a different set of names. The decision stays unspent, and the host can ask again. An edited checkpoint list continues to be refused as `call-changed`.
- Decision readers should accept `hiddenArgs: 'not-recorded'` when a pause predates the list. On new pauses, `checkin.decision` and `CheckInRecorder` keep the names from the request. The private check-in marks use those names too. The app's redaction policy can mask argument names in served records.
- On `stream.tool_start`, use `shownArgs` and `hiddenArgs` when showing arguments to a person. The built-in AG-UI translation streams this view in `TOOL_CALL_ARGS`, and `TOOL_CALL_START` names the arguments hidden from the proposal. When input fills or middleware can change the proposal, the early display masks all values. The check-in interrupt gives its own list and evidence from the bound call. The `toolArguments` projector applies to calls without a protected view.
- Tool argument views receive frozen copies. Update custom views that modify their inputs. The library checks unchanged strings separately for private argument marks.

The app's run-wide redaction policy governs original arguments in `stream.tool_start.args`, `agent.iteration_end.history`, recorded history and snapshots. The answer account exposes the approval flag, tool name and call id. A check-in on a hidden view records the person's consent with limited visibility. Tool results retain their separate delivery policy.
