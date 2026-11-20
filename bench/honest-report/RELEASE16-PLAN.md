# AgentFootprint 16.0.0 standing comparison

Install one exact npm cohort from `cohorts/released16/package-lock.json`.
Both arms use that installation, the same parser, and the same scripted desk.
One arm uses the released default. The other calls `.answerLayer(false)`.
Each row records the library-appended final warning separately from the
model answer, the assessment, the account, and what actually happened at the desk.

The two arms have 140 runs each. Each arm runs the six legacy tasks ten
times and the four hidden-outcome tasks twenty times. The first partial-failure
case in each arm supplies its cost preflight. The model is `claude-haiku-5-5` with
at most eight requests per run, a 4,096-token output ceiling and zero retries.
The existing $4 projected ceiling and $5 spend stop apply.

Batch 6 metered $0.568 for 280 runs, or $0.00202857 per run. The same run
count and mix give an estimate of $0.568. The preflight prices the new run's
own measured request sizes and can stop the batch.

Report the fraction of engaged unfinished cases where the delivered warning
names the critical call. Report warnings and strict false alarms on completed
controls separately. Break out false completion claims with and without a
delivered warning, and show literal `done` and `partly` counts. Give each rate
its numerator and denominator from the saved rows. The comparison covers
one model, scripted tools, and this task set. Retain exact cost and attempts
in the run ledger.

In offline rehearsal, the two arms should send the same first request for
each scripted play. The default should name the recorded call on the keyed
unfinished cases. The disabled arm and completed controls should stay quiet.
The rehearsal checks the provider-facing tool reply and the independently
recorded desk outcome.
