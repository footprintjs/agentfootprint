---
type: changed
---
**What changes for existing OpenTelemetry and audit users.**

- Session-bound traces now carry `gen_ai.conversation.id` (the digest) on their agent, chat and tool spans. They are not byte-identical to the previous release; that attribute is the only delta, and it is pinned as such.
- `agentCoreEvaluationSpans` turns `captureToolContent` on — AgentCore's tool-parameter and tool-selection scorers read the call's arguments. Its users now also export each call's arguments (changed keys withheld) and the result the model read, omitted over the ceiling. `captureToolContent: false` opts out.
- `auditExport()` bounds the new content fields in its default `payloadMode: 'bounded'`: an evaluation's `explanation` becomes `'[N chars]'`, and `tool_end`'s `modelResult` is reduced like `result`.
- `stream.tool_end` payloads grow only when a rule acted, so envelope-serializing sinks (`file`, CloudWatch, AgentCore) see `modelResult` — the post-rule value, beside the `result` they already carried — and argument key NAMES, never argument values.
