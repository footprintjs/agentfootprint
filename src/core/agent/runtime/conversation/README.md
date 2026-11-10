**Mixed** — preserve the accepted conversation across native turns.
`checkpointParts.ts` is the **Fold** of detached checkpoint values;
`owner.ts` is the **Walker** that restores and consumes continuation state.

The captured invocation owns checkpoint, clock, identity and pending-question
facts. Restoration retains the original optional-key shapes and clears each
consumed value at its existing point. `checkpointParts.test.ts` covers copying
and spent repair state; continuation and resume owners keep their existing
native behavior scenarios beside them.
