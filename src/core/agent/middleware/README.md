**Mixed** — the governance chain: three verbs walked forwards over a call and
backwards over its result.
Walker: `runChain.ts` (the one place a chain is walked), `outcomes.ts`,
`types.ts`.
Trace: `ledger.ts` — one writer for one committed key, where a chain's decisions
become record.
Fold: `rewrites.ts` — which ruled argument a before-tool rewrite superseded, read
off that key (honesty layer 2).
Support: `errors.ts`, `index.ts`.

## What it reads / what it writes
- Reads the call (or its result) and the caller's own middleware list.
- Writes the decisions through `ledger.ts` only; `deny` raises
  `MessageDeniedError`.

## The one law here
Every decision is recorded, including the boring ones. A chain that allowed
silently and a chain that never ran must not look the same afterwards.

## The `'input'` verdict is the turn's user entry — on every turn
The user entry a run adds to the conversation is the message the `'input'`
chain let through, on a first turn and on a continued one
(`run({ continueFrom })`, `followUp()`, a stored session behind
`standingAgent`). One writer: `stages/seed.ts · historyForTurn`, called after
the chain. A continuation stashes the stored history and a flag
(`Agent.ts · applyContinuation`), never a pre-built entry — an entry built
before the chain runs holds the raw text, which is what 9.112.1 and earlier
served the model on every continued turn while the record said the rewrite
happened. `resumeOnError` appends nothing (its last user entry is already
the failing turn's message).

```ts
const agent = Agent.create({ provider, model })
  .messageMiddleware({
    name: 'scrub-account-numbers',
    onMessage: (m) => {
      if (m.phase !== 'input') return allow();
      const clean = m.content.replace(/\d{6,}/g, '[number]');
      return clean === m.content ? allow() : allow(clean, 'masked an account number');
    },
  })
  .build();

await agent.run({ message: 'hello' });
await agent.followUp('my account is 12345678');
// The model read 'my account is [number]', and the stored conversation holds
// the same string: the last user entry in checkpoint().history equals
// checkpoint().originalInput.message.
```

Pinned by `test/core/agent-middleware-continuation.test.ts`.

## A refused input is not a conversation
Seed records the chain's decisions and refusal flags, then breaks before
`seedFrom`. It writes no `history` or `userMessage`, restores no continuation
state, and files no conversation clock. `Agent.checkpoint()` returns
`undefined`; `followUp()` after that attempt raises `NoConversationError`.
Keep the earlier accepted checkpoint and pass it explicitly as `continueFrom`.

This is a write-time boundary, not a checkpoint scrub. Hosted async/sync
durability watches history commits directly, so writing even an empty history
would overwrite an accepted session. No history write means all durability
modes retain their last accepted checkpoint. A refused `resumeOnError` follows
the same rule: its supplied history already contains the failing turn, and
guessing a safe prefix from the last user message would be unsound. The caller's
checkpoint is unchanged; the run's finally clears the pending restoration.

The refusal remains visible through `middlewareDecisions` and
`agentfootprint.middleware.decision`. No LLM work is seeded, so the integrity
disposition reports `workExisted: false`. Allowed paths, output refusals and
tool pause/resume are unchanged. Previously persisted conversations are not
rescanned or repaired. Audit input, rewrite pairs and middleware-authored
reasons still require their own retention policy.

Pinned by `test/core/input-admission.test.ts` and
`test/hosting/input-denial-durability.test.ts`.

## An `'input'` scrub does not scrub the record
The ledger row is NOT the only copy of the pre-scrub text. The model, the
committed `history`, `checkpoint().history` and every `agentfootprint.*`
event payload get the chain's verdict; these keep the original, and an app
that must not keep it redacts them itself (an `Agent` exposes no footprintjs
redaction policy today):
- the ledger row `middlewareDecisions[i].before`, in every copy of run state
  — `getLastSnapshot()` (`sharedState`, `commitLog`, `executionTree`,
  `subflowResults`), `getLastNarrativeEntries()`, a `recordRun` recording, a
  `BoundaryRecorder` `subflow.entry` payload, and a paused run's checkpoint
  — `RunnerPauseOutcome.checkpoint` (`sharedState`, `executionTree`), which
  `standingAgent` itself stores for a paused session as a `flowchart-v1`
  envelope under every durability, the default `'exit'` included (strip the
  rows by wrapping the `persist` of the store passed as `sessions`);
- the run's input as passed — the `run.entry` payload every flow recorder
  receives;
- a crash checkpoint — `RunCheckpointError.checkpoint.originalInput.message`
  (open issue, CHANGELOG 9.112.2).

The user-facing version, with what to do about each, is the docs page
`docs-next/content/docs/build/middleware.mdx` ("Read this before you scrub
secrets").

## Files
- `runChain.ts` — the Chain-of-Responsibility driver.
- `outcomes.ts` — `allow` / `deny` / `ask`, as smart constructors.
- `ledger.ts` — `recordDecisions`.
- `rewrites.ts` — `argumentRewritesOf`: under the inputs layer a before-tool
  rewrite of a ruled tool's arguments is filed with `changedKeys` (and, when
  declared, `allow(args, why, { from })`'s origin per key); this is the ONE
  reading of those rows, taken by the answer's standing
  (`assessment/assess.ts` · `readArgumentVerdicts`) and the answer's "Assumed"
  block (`arguments/serve.ts` · `assumedBlockOf`), so the two cannot disagree
  about which value a call ran with. Both readers load through `import()`, so
  a plain agent never carries this module.

  ```ts
  argumentRewritesOf(state.middlewareDecisions).get('c1')?.get('window');
  // { index: 0, origin: 'person' } — the call ran with the rewrite's value
  ```
- `types.ts`, `errors.ts`, `index.ts` — shape, refusal, barrel.
