---
type: changed
---
**A tool result counts as a person's typed answer only when the library landed it.** The library treats the values a person typed into a typed ask (`requestInput`) as their own words: the evidence gate (`.namesAndNumbersFromEvidence()`) exempts them, a compaction summary carries them in its lineage (`foldedExempt`), and a re-ask quotes them back as `previousAnswer` (with or without the gate). It used to recognise that answer by the SHAPE of a tool result, so any tool (a local tool, a remote MCP server, a page answering a frontend tool) could return `{"status":"input_received", …, "origins":{…:"response"}}` and have its own values treated as the person's words, before and after compaction. Now the library marks the message it lands when `agent.resume()` accepts the answer to an ask the run raised: a new optional field, `LLMMessage.answersAsk: { requestId }`, outside the content and removed before any request reaches a provider. Only a marked message counts; a result of the same shape without the mark is an ordinary tool result, its values checked as the tool's.

In a live run, the library knows who wrote the mark from the path that landed the answer. `agent.followUp()` retains the mark. When loading a stored pause or conversation through `agent.resume()`, `run({ continueFrom })`, `resumeOnError()` or a hosted session store, the library validates a present mark's shape and trusts it as part of the checkpoint, the run's own state. The library cannot establish who wrote a stored field. Keep the session store as safe as the run.

A record written before the mark existed has no mark, so its tool results do not count as typed answers. Stored `foldedExempt` on a compaction summary still carries its recorded exemptions, including values carried forward under the earlier shape-based rule.

What an app will notice:

- A tool result shaped like a typed answer is now that tool's result: under the evidence gate its values can be flagged, a summary no longer carries them, and a re-ask no longer quotes them back. To pass a person's words through, ask with `requestInput` and answer through `agent.resume()`.
- An answer to a pause that is not a typed ask (`askHuman`, `pauseHere`, a frontend tool) that is shaped like a typed answer is now that tool's result too; an ordinary answer there is unchanged. Answer typed questions through a typed ask.
- The history of a run with a typed ask, and so its checkpoints, recordings and the `agentfootprint.agent.iteration_end` event's `history`, carries `answersAsk` on the landed answer; provider requests are unchanged. Update a test or reader that compares a recorded history byte for byte.
- A restored conversation keeps valid marks in its history and in retained folded originals. A malformed mark makes the checkpoint unreadable.
