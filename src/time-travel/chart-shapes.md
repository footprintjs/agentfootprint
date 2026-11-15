## The two chart shapes

### `reactMode: 'dynamic'` — the turn is on the outer log

The flat chart commits `call-llm` in the run's own log, so the llm-turn stop is
on the outer cursor, next to the `sf-injection-engine` iteration stops and the
slot stops.

```ts
const agent = Agent.create({ provider, model: 'm', reactMode: 'dynamic' }).system('bot');
await agent.run('why?');

const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
cursor.stops.filter((s) => milestoneOf(s)?.kind === 'llm-turn').length;   // one per turn
cursor.jumpTo('call-llm#12');
cursor.stateAt().state;              // the state that turn left behind
```

### `reactMode: 'dynamic-grouped'` — the turn is one drill down

The grouped chart wraps each turn in an `sf-llm-call` subflow, which runs in its
own isolated runtime and commits to its own log. So the outer log holds the
MOUNTS — one `'iteration'` stop per turn — and the llm-turn / tool-call /
decision stops live inside. `drill()` is how you get there, and the same
strategy is what reads it.

```ts
const cursor = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
const turn2 = cursor.stops.filter((s) => milestoneOf(s)?.kind === 'iteration')[1]!;

const inner = cursor.drill(turn2.runtimeStageId)!;   // its own cursor, its own log
inner.stops.map((s) => milestoneOf(s)?.kind);
// measured: [undefined, 'iteration', 'slot', 'slot', 'slot', 'llm-turn', undefined]
// — the same grammar as the outer axis, over the turn's own 20-commit log.
inner.stateAt().state;                                // folded against the SUBFLOW's base
```

The mount is addressed by its `runtimeStageId`, not its path: a subflow inside a
loop runs many times and every iteration shares one path, so `sf-llm-call#4` and
`sf-llm-call#9` are two different turns and drill to two different logs.
