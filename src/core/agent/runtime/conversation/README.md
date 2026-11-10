**Fold** — conversation carrier values read from the run's committed state.

`checkpointParts.ts` owns the spent recovery carrier, folded spans and findings
ledger. Absent or empty observations stay absent. Returned spans and ledger
rows are detached copies; a persistence caller cannot mutate the live run.
Both ordinary and crash checkpoints read these same functions. They read no
selected run, clock, provider or recorder and import no facade or builder.
