---
type: internal
---
**The run manifest's reading vocabulary moves into `recorders/observability/recordedManifest.ts`.** `RUN_CONFIGURED_EVENT`, `manifestFromEvents`, `RunManifestLike`, `ManifestMemoryLike` and `CapturedEventLike` now live beside the recording envelope that archives the manifest, so the recorders no longer import context-bisect. The strategy-arm logic that checks an arm against a manifest stays in context-bisect and imports the vocabulary from there, and one upward edge leaves the layering allowance list. `agentfootprint/observe` exports the same names as before.
