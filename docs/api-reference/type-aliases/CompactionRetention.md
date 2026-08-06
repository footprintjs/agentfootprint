[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / CompactionRetention

# Type Alias: CompactionRetention

> **CompactionRetention** = `"conversation"` \| `"discard"`

Defined in: [src/core/agent/window/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/2e3535f98fd1947b0c72b1e5df04d70658249b33/src/core/agent/window/types.ts#L211)

What becomes of the messages a fold removes from the window.

The commit log keeps them for as long as the PROCESS keeps them, and that
is the whole of what 8.1 offered. A standing agent outlives its process, so
"the folded turns are still in the commit log" stops being true the moment
the run ends — and the summary sitting in the restored conversation went on
claiming otherwise. Retention is the fix: the originals ride with the
CONVERSATION, which is the thing that actually survives.

The trade is stated rather than hidden: **compaction shrinks the wire, not
the record.** A stored session grows as it folds. That is the right way
round — the model's context window is scarce and a session row is not.
