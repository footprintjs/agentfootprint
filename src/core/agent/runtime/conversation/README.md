**Mixed** — preserve the accepted conversation across native turns.
`checkpointParts.ts` is the **Fold** of detached checkpoint values;
`seedHistory.ts` owns the one accepted user-entry writer and its pending
history type.
`owner.ts` is the **Walker** that restores and consumes continuation state.
`src/core/checkpointHistory.ts` validates a typed answer's mark
(`LLMMessage.answersAsk`) in the stored history and folded originals.
`owner.ts` restores those messages with their marks intact.

The captured invocation owns checkpoint, clock, identity and pending-question
facts. Restoration retains the original optional-key shapes and clears each
consumed value at its existing point. `checkpointParts.test.ts` covers copying
and spent repair state; continuation and resume owners keep their existing
native behavior scenarios beside them.

A conversation checkpoint keeps shown inner-call arguments in history and the matching private policy inputs beside it. Both checkpoint writers select private inputs from the history they retain. Continuation admits the stored shape before arming native private recording and restoring the values. A legacy or missing private input cannot satisfy a permission sequence.
