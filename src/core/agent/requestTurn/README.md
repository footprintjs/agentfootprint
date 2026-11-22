# Native tool-turn requests

`replayPrefix.ts` stores only the library's contributions to an accepted request. The provider response anchors their placement. On replay, existing supplement messages return before their original assistant and tool projections keep the form already served. Fresh context follows them. The projection maps wire positions back to committed history for cache breakpoints and evidence reads.

`state.ts` advances the working state after an accepted response. A real terminal response can close a tool turn even when a revision keeps the rejected draft out of ordinary conversation. The model-call stage records the request context in its receipt. Saved views declare a gap for these private contributions when they rebuild from public conversation. The adapter still owns all signature and prefix checks.

`checkpoint.ts` admits the bounded, anchored projection for a crash retry. An imported checkpoint can replay its recorded library contributions on the same request. The contents are private checkpoint data. A terminal draft excluded from the recorded history is available to the live run while it prepares the correction. A crash retry that still needs this draft to prove completion can refuse at the adapter, since its ordinary checkpoint carries only the witnessed open prefix.
