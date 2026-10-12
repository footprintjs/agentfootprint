---
type: fixed
---
**Preserve standard Anthropic response metadata during thinking replay.**
Tool turns could stop with `UnsafeThinkingReplayError` even when the application
had not changed the response: empty citation metadata, direct tool callers or a
null toolset name were incorrectly treated as lost content. The shared adapter
now preserves these fields exactly through normalization and JSON checkpoints,
including the difference between absent, null and empty values. Changed content
and unsupported metadata still refuse unsafe active-turn replay before sending.
