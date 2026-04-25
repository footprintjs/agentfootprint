---
name: Pause / Resume — human-in-the-loop
group: v2-features
guide: ../../README.md#features
defaultInput: refund order 123
---

# Pause / Resume — human-in-the-loop

A tool calls `pauseHere({question, …})` to request human input. The
Agent catches the PauseRequest and returns a `RunnerPauseOutcome`
carrying a JSON-serializable checkpoint. Store it anywhere (Redis,
Postgres, localStorage), then call `.resume(checkpoint, humanAnswer)`
to continue — same process OR different process.

## When to use

- **High-stakes tool calls** — refunds, deletes, sends, external writes.
- **Low-confidence actions** — the agent asks before acting when
  uncertain.
- **Workflow approvals** — multi-step flows where one step needs a
  manager's green-light.

## Key API

```ts
// Inside a tool:
execute: (args) => {
  pauseHere({ question: `Approve ${args.action}?`, risk: 'high' });
  return ''; // unreachable — pauseHere throws
}

// Consumer side:
const first = await agent.run({ message: '...' });
if (isPaused(first)) {
  // Store: await redis.set(`session:${id}`, JSON.stringify(first.checkpoint));
  // Later:
  const final = await agent.resume(first.checkpoint, humanAnswer);
}
```

## What it emits

- `pause.request` — at the pause point, carrying `reason` +
  `questionPayload` (the data passed to `pauseHere`)
- `pause.resume` — at resume start, carrying `resumeInput` +
  `pausedDurationMs`

## Works across process boundaries

Checkpoints are strictly JSON-serializable. Test round-trip:
`JSON.parse(JSON.stringify(checkpoint))` restores cleanly. This is
required for Redis/Postgres-based HITL workflows and is covered by the
`test/lib/pause/cross-executor-resume.test.ts` test in footprintjs 4.17.0.

## Related

- **[Agent](../core/02-agent-with-tools.md)** — pauseHere is usable
  from any Agent tool
- **[Permissions](./03-permissions.md)** — another tool-gating mechanism
  (policy-based, non-interactive)
