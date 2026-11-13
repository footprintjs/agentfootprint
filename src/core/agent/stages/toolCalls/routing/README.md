**Walker** — the existing tool-return, step and skill transition decisions.

# Tool-call routing

The existing step plan, returned effects, leases and escalation callbacks stay in their original call order. Batch transition state remains caller-owned and no new router is introduced.

## A step is done only when its tool says so

`stepOutcome.ts` · `stepOutcomeOf` is the one rule for what a finished call means to the procedure step it ran. Every door that finishes a call (the batch loop's `execution/deliveredResult.ts` and the plain, check-in, ask and credential resumes in `resume/`) hands `stepsOperations.ts` · `applyStepReturn` the facts it already holds (`execution/callOutcome.ts` · `SettledCall`: did it run, did it run clean, what status did the tool declare), and the outcome is decided there, never at the door.

| the call | outcome | the step |
|---|---|---|
| declared `success` or `absent` | `succeeded` | advances; "Step 1 of 2 done." |
| no declared status | `not-reported` | advances; "Step 1 of 2 ran; its tool reported no outcome." |
| declared `failure`, `denied` or `invalid` | `failed` | holds; `skill.step_held`; "Step 1 of 2 was not completed: its tool reported 'failure'." |
| declared `pending` or `partial` | `not-finished` | holds the same way; the sentence adds "so its work was not finished" |
| did not run, threw, or its result was withheld | `stopped` | holds; no event and no sentence (the refusal or error already speaks) |

Why `absent` counts as done: it is the library's word for "looked and found nothing" (`semantics/toolOutcome.ts` keeps it apart from `failure` for exactly that reason). The look finished, so holding the step would trap a correct procedure that found nothing. Example: a step tool returning `{ content: 'lookup could not run: upstream down', effects: [], status: 'failure' }` stays the current step, the next step's tool stays out of the offer, and the model can call it again, skip it with a reason, or stop and say why. A tool that keeps failing is ended by the turn's own limits (`maxIterations`, a cost budget), recorded as `skill.steps_unfinished { action: 'cut-short' }`.
