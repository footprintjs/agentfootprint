**Mixed** — preserve the accepted conversation across native turns.
`checkpointParts.ts` is the **Fold** of detached checkpoint values;
`owner.ts` is the **Walker** that restores and consumes continuation state.
`liveConversation.ts` decides where a continued conversation came from:
`followUp()`'s own (read from the agent's last run, never in a caller's hands)
keeps a typed answer's mark (`LLMMessage.answersAsk`); one a caller hands in
(`run({ continueFrom })`, `resumeOnError`, a hosted session store) loses it, in
its history and its folded originals. Example: `agent.followUp('again?')` after
a typed ask still counts the person's answer; `agent.run({ message: 'again?',
continueFrom: agent.checkpoint() })` reads it as a tool result.

The captured invocation owns checkpoint, clock, identity and pending-question
facts. Restoration retains the original optional-key shapes and clears each
consumed value at its existing point. `checkpointParts.test.ts` covers copying
and spent repair state; continuation and resume owners keep their existing
native behavior scenarios beside them.
