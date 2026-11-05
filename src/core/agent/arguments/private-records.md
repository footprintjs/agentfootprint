# Private argument records

Migration: schema default sentences and hypothetical converted-window values have no actual
call context. When a tool carries an argument-view mapper, these sentences hide the value:
a one-field probe cannot establish what a mapper depending on sibling arguments would show.
Tools without a mapper keep their existing prose. Actual answered rows and result notes use
the complete filled call context, so arguments that the real view permits remain visible.

`resolutionRows.ts` contains the complete resolved-row composers extracted from `resolve.ts`, with explicit pure reader ports and full filled-call context for private views. `resolve.ts` remains the oversized declare/verify/resolve facade; `ask.ts` retains planning/validation/binding after complete answer-row composer extraction. Neither file is claimed structurally complete.

A private-only checkpoint explicitly declares that it had no caller policy. Removing a saved caller policy is refused even when internal private selectors remain. A pending private question retains its original field and member names; resuming it after the required tool view disappears is refused before the answer is bound. This checks retained capability, not semantic equality of a replacement view function.

`pendingPrivateAsk.ts` owns the closed request-bound field/member declaration and the `AskWaiting` type moved from `ask.ts`. A missing original private view refuses before answer binding; a missing tool follows the existing unavailable-call refusal. `privateCaller.ts` and `privateCheckpoint.ts` in redaction own explicit caller-none admission and the checkpoint projection. These are consistency declarations, not checkpoint authentication.
