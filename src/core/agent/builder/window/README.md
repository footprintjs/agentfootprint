**Map** — validates the one declared window strategy and its summarizer coherence.

# Builder window declaration

`configure.ts` installs either the explicit strategy or compaction strategy on
the original builder. Dynamic guard and attribution calls keep their original
order. `guards.ts` owns the one-strategy conflict and distinct-summarizer rules.

The facade retains its private wrappers and door-note method. Neither owner
executes a strategy or makes a provider call.
