**Walker** — the one private funnel every top-level turn of an Agent passes
through, and `.aroundTurn()`, the one public place to wrap it.
Map: `types.ts`. Walker: `funnel.ts`. Support: `errors.ts`, `guards.ts`,
`readOnlyCopy.ts`.

## What it does
Some work must wrap a whole turn: awaited preparation before it, an
`AsyncLocalStorage` held around it, cleanup after it. Message middleware cannot
hold a context or set `time`, and wrapping a host's handler runs before identity,
admission and session ownership. Replacing `agent.run` was never a contract, and
since 14.0.0 a hosted turn does not call a replaced method.

```ts
const prepared = new AsyncLocalStorage<Prepared>();

Agent.create({ provider, model })
  .time({ zone: 'UTC' })
  .aroundTurn({
    name: 'prepare',
    around: async (turn, proceed) => {
      if (turn.kind === 'resume') return proceed();
      const work = await prepare(turn.input);
      await prepared.run(work, () => proceed({ time: { now: work.at } }));
    },
  })
  .build();
```

## What it reads / what it writes
Reads a read-only copy of the turn, `{ kind: 'run', input, options }` or
`{ kind: 'resume', checkpoint, answer, options }`: plain data is copied and
frozen, while a signal or a sealed request handle keeps its identity. Writes
nothing but `agentfootprint.agent.around_turn_failed`, which carries the
wrapper's name and the error's class, never its message.

## The one law here
The wrapper cannot change how the turn ended. `proceed` resolves to nothing; the
library keeps the output, the pause, the checkpoint and the record binding. The
only change it accepts is `proceed({ time })` on a `run`, which reaches the run the
way `run({ time })` does: a field the wrapper names wins, and a field it leaves
out stays the caller's. A resume accepts no change.

| The wrapper | What happens |
|---|---|
| throws before `proceed` | The turn rejects with that error. No run starts; a pending question stays pending. |
| returns without `proceed` | Refused: `AroundTurnError`, `not-proceeded`. |
| calls `proceed` twice, or after it settled | That call is refused (`second-proceed`, `late-proceed`) and the first run stands. |
| swallows a failed `proceed` | The run's original error still surfaces. |
| throws after a good `proceed` | The outcome stands, and a pause is not lost. The failure goes on the diagnostic event. |
| does not await `proceed` | The turn still waits for the run, inside its lease. |
| never settles | The turn waits. Pass `turn.options` signals to your own work. |

## Where it sits
Inside the run's lease and inside `preservePendingQuestion`; after a host's
identity, admission and session checks; around `runLeg` / `resumeLeg`. The doors:
`run`, `runTyped` (typed parsing and `.outputFallback()` included), `followUp`,
`resumeOnError`, `resume`, the hosted ports, and so the stream handler. With no
wrapper the funnel hands back the leg's own promise and adds no await. Inside the
lease means a wrapper cannot run the same instance again (`RunInFlightError`), and
a run's `timeoutMs` starts when `proceed` does.

An agent mounted in another run has no turn, so a wrapper could not run there: it
is refused by name as its first stage opens (`componentSetup` in `Agent.ts`), never
skipped. Not at `getSpec()`, which readers that mount nothing use too. `standingAgent` refuses an agent whose `run` or
`resume` is not the class's own (`ReplacedRunnerMethodError`).

## Files
`types.ts`, `funnel.ts`, `errors.ts`, `guards.ts`, `readOnlyCopy.ts`, and the tests
beside them: `failure-table.test.ts`, `doors.test.ts`, `context-and-time.test.ts`.
The hosted half is pinned by `../../../hosting/around-turn.test.ts`.
