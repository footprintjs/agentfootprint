---
name: Tool sessions — summarize prose, compute data
group: features
guide: ../../README.md#features
defaultInput: How many orders shipped late last quarter?
---

# Tool sessions — summarize prose, compute data

A tool that hands the model 40,000 rows has not given it data. It has spent
the context window. The motivating failure is real and measured: a production
request of **879,073 tokens**, almost all of it one tool result pasted into the
prompt.

With a code runner the model writes the aggregation, the *runner* holds the
rows, and what comes back is the number.

## When to use

- **A tool whose honest answer is large** — a query result, a log file, a CSV.
  Compute over it; return the finding.
- **A service that is Start → Invoke ×N → Stop** — a managed code interpreter,
  a headless browser, a leased connection.
- **A standing agent serving many people from one process** — where a session
  held in a module-level map hands person B person A's files.

## Key API

```ts
import { Agent, codeRunnerTool, toolSessionKey } from 'agentfootprint';
import { localCodeRunner, agentCoreCodeRunner } from 'agentfootprint/providers';

// One interpreter per TURN (the default).
const agent = Agent.create({ provider })
  .tool(codeRunnerTool({ runner: localCodeRunner(), language: 'javascript' }))
  .build();

// One per CONVERSATION — variables and files persist between turns.
// Your composition root says when the conversation is over:
const hosted = Agent.create({ provider })
  .tool(codeRunnerTool({ runner: agentCoreCodeRunner({ region, identifier }), scope: 'session' }))
  .build();
conversation.onClose(() => void hosted.closeToolSessions({ sessionId }));
```

Writing your own session-holding tool is the same two lines:

```ts
execute: async (args, ctx) => {
  const key = toolSessionKey(ctx, 'run');          // t=<tenant>/p=<principal>/r=<runId>
  if (!key) throw new Error('this door has no run — use scope "call"');
  const session = await open(key);
  ctx.onTeardown?.(() => session.close(), { scope: 'run', key });
  return session.query(args);
};
```

## What it emits

- `tools.session_started` — a session was opened, with `keyHash` + `runnerId`.
  Fires inside `tool.execute`, so it carries the real `tool-calls#N` stage.
- `tools.session_reused` — a later call joined it; `calls` is how many have now
  shared one start-up. This is the payoff, measured.
- `tools.session_closed` — with `reason`: `call-end` · `run-end` · `session-end`
  · `shutdown` · `idle` · `evicted`. Fires after the last stage committed, so it
  carries the stated pseudo-stage `tool-teardown#0` — and the run's real
  `runId`, so it joins the run that opened the session.
- `tools.session_close_failed` — the cleanup threw or ran out of budget.
  Teardown never throws into your run, but it is never silent either: a `Stop`
  that failed leaves a sandbox somebody is still paying for.

`keyHash` is a digest, never the key. The key composes tenant, principal and the
hosting `sessionId`; publishing it would put a user identifier into every
exporter's payload.

## The isolation rule

**A `sessionId` alone never keys a live session.** It is caller data — anyone
who can reach the host can put any string there, including someone else's. The
key composes what you actually know:

```
session →  t=<tenant|_>/p=<principal|_>/s=<sessionId>
run     →  t=<tenant|_>/p=<principal|_>/r=<runId>
call     →  c=<toolCallId>
```

Ask for a scope the door cannot honour and the tool **refuses by name**. It
never quietly narrows or widens: widening hands one sandbox to two people, and
narrowing multiplies start-up cost by ~30× with nothing to show for it.

## When teardown fires — and when it must not

| scope | fires |
|---|---|
| `call` | when `tool.execute` settles — resolve **or** throw. Works at every door, including `mcpServe`. |
| `run` | when the turn reaches a terminal that is **not a pause**. |
| `session` | when you call `agent.closeToolSessions({ sessionId })`. |
| `shutdown` | `agent.shutdown()` — **including `{ stop: false }`**, because a sandbox this runtime opened is not borrowed. |

**A pause is not a terminal.** A check-in on a code interpreter is a person
deciding; tearing the sandbox down there destroys the exact state the resume
needs, and it fails *quietly* — as a resumed run that "just re-ran everything".

Never calling `closeToolSessions` is survivable, not silent: sessions idle out
on a lazy sweep, a bounded live count evicts the coldest, and `shutdown()` takes
whatever is left.

## Isolation, not a sandbox

`localCodeRunner()` runs a **child process on your machine**. It gives you a
separate process and heap, kill-on-timeout, no inherited stdin, and an
environment allowlist (`process.env` is not inherited — only `PATH`, so the
interpreter can be found). It does **not** give you a filesystem jail, a network
jail, or CPU/memory limits.

That is fine for a dev loop and wrong for arbitrary model-written code from
untrusted users. For that, put a real sandbox behind the same port —
`agentCoreCodeRunner({ region, identifier })` — and keep the tool identical.

In-process `eval` / `node:vm` is refused outright: Node documents `vm` as not a
security mechanism, so shipping it as one would be theater.
