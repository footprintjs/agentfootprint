# Published 15.0.1 answer-layer control

`published.json` records the npm archive and the honest-report harness lock
that authenticated it. The capture ran the public CommonJS package and its mock
provider with the three dependency versions from that lock. The control agent
made one lookup that returned an empty array and gave a prose answer ending in
a newline and two spaces.

`capture.ts` hashes the serialized chart, commit bundles and wildcard events in
their original order. The chart is unchanged by the capture and the answer
is hashed directly as UTF-8. The commit and event hashes replace only generated
run identities, clocks, durations and the receipt digests salted with the run
ID. Each masked path is named in the code.

`current-main.json` pins the commit log and event bytes from main
`05fdfdeee419ca4717b2c138d1bd12f13df1b906` for the same scenario. Against
the published run, #441 adds `rootTurn: true` to the terminal event and
#443 adds the same call occurrence address at the ten listed paths.
#446 and #445 introduce no additional differences in this scenario.
The chart and answer still match the published capture exactly.

Both public off switches must match the complete main capture after
the existing per-run masks and normalization of the occurrence batch
address. That normalization keeps the slot and co-reference. Removing
only the listed additions must also reproduce all four published hashes.

`checkpoint.json` is the untouched serialized output of a separate 15.0.1 run
that paused on the tool's question. The writer's clock was fixed to make the
saved bytes reproducible. The suite verifies its SHA-256 and resumes it on a
fresh agent with the default. The record describes zero completed checks, so
the answer is `not-assessed` without a warning.

To reproduce the capture in the Lane C review workspace, run
`node ../proof/capture-published-answer-control.mjs` from the repository root.
The script accepts a local npm tarball path or reads npm's cached archive by
the lock's verified digest. The test suite uses the checked fixtures offline.
