# Source-links pilot rule

A verified citation means the named result held the value as a whole canonical token sequence and its occurrence was present in the request that produced the answer. A correct field assignment and the instructed source are separate measurements. The measurement says nothing about the source’s truth or what influenced the model.

## Tasks and arms

Use the six inventory cells in `tasks.mjs`. Each family keeps the same facts in both sides, reversing the order of two lookups and swapping their handles. The one-source pair reverses its result fields and changes its handle from r1 to r2. The ordinary and citation arms differ only in the citation instruction and the attached result handle. Each family, side, and arm gets 20 runs on claude-haiku-5-5, with zero retries and caching off.

Both arms ask for one named field and verbatim value per line. This keeps each required field identifiable during offline scoring. The check reads labeled fragments and counts a marker over the checkable values back to the previous marker or sentence start. A newline also starts a new fragment. One marker can cover multiple identifiable values in that scope. Required fields with no identifiable value are missing. A conflicting or repeated field counts wrong and cannot contribute a valid pair. Value correctness compares the whole canonical sequence with the inventory answer. The decoy value counts wrong for the task even when its citation passes membership.

## Receipt and citation scoring

A run mints only its own handles in the read-only tool callback. Bind each issued handle to that native call ID and full result text. For each actual provider request, retain the entire message list and join a unique matching tool message slot to its local occurrence. The final receipt is the request of the terminal answer. Omit ambiguous slots and preserve the concrete issue where the harness cannot establish a unique join. The trusted synthetic result body is the observed text after removing the one exact harness header, when present. Bracket text in results never creates a binding. Only names in this run’s binding set can resolve.

Score missing marker, bad handle, wrong value and out-of-window result separately. Whole-token membership uses the installed 15.0.0 build’s own `canonicalTokens` and `occursIn`. Marker/value pairs from duplicate field claims stay in the denominator and cannot improve validity. Orphan markers are reported apart because there is no value to test in that pair. The scorer checks source choice on the one decoy field independently of membership and answer correctness. A known local handle with no unique occurrence in the final request does not count.

## Pass line and usage

On the complete citation arm, coverage is marked eligible values divided by all eligible answer values, with duplicate fields counted once as uncovered. Validity is valid pairs divided by all marker/value pairs. The decoy line is runs that cite the instructed visible source divided by all 40 scheduled citation decoy runs. Wrong and missing values are combined over all required fields for each arm. An incomplete schedule cannot decide the pass line. A complete schedule with no eligible coverage or validity denominator fails that line.

Pass when coverage is at least 90%, validity at least 95%, correct decoy source at least 90%, and the citation arm’s wrong-or-missing rate is at most five percentage points above ordinary. All four pass means the model-facing design can proceed as written. Failure on coverage or validity drops prose markers and retains structured doors. Decoy failure bars citations as support for the choice between sources. Error-rate failure keeps sources opt-in per tool and off for answers.

Report the paired final-answer output-token delta by family, side and repeat, plus whole-run input and output separately. Report missing usage apart and omit unmeasured pairs from the token delta. The preflight samples the first repeat in every family, side and arm before proceeding. Its full-run projection may not exceed USD 4. The budget stops additional dispatches at USD 5 and holds one request’s conservative full exposure.
