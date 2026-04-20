---
name: exportTrace() — portable JSON snapshot
group: observability
guide: ../../docs/guides/recorders.md
defaultInput: What is my balance?
---

# exportTrace() — portable JSON snapshot

After a run, capture the entire execution as portable JSON. Pipe it to a file, send it over HTTP, paste it into the agent-playground viewer, attach it to a support ticket, log it for replay. One call: `exportTrace(agent)`.

## When to use

- Bug reports — users send you a trace, you paste into the viewer.
- Audit log — durable storage of agent decisions for compliance.
- Replay — feed a trace into a different visualization without re-running the agent.
- Cross-team debugging — engineering looks at exactly what the support agent saw.

## What you'll see

```
{
  schemaVersion:    '1',
  exportedAt:       '2026-04-20T...',
  redacted:         true,
  narrativeLines:   <n>,
  narrativeEntries: <n>,
  snapshotKeys:     ['sharedState', 'executionTree', 'commitLog', 'sharedRedactedState', ...],
  sizeKb:           <n>,
}
```

## Key API

- `exportTrace(agent, { redact?: boolean })`.
- Default `redact: true` uses footprintjs's redacted-mirror snapshot — keys configured as redacted arrive scrubbed.
- Output is JSON-serializable: `JSON.stringify(trace)` always works.

## Related

- [recorders guide](../../docs/guides/recorders.md).
- [security/01-gated-tools](../security/01-gated-tools.md) — pair with redaction policy for compliance-grade exports.
