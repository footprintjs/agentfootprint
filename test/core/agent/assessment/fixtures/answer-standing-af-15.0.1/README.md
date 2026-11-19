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
ID. Each masked path is named in the code. The suite compares these hashes
against the corresponding output with the answer layer explicitly off through
each public configuration door.

`checkpoint.json` is the untouched serialized output of a separate 15.0.1 run
that paused on the tool's question. The writer's clock was fixed to make the
saved bytes reproducible. The suite verifies its SHA-256 and resumes it on a
fresh agent with the default. The record describes zero completed checks, so
the answer is `not-assessed` without a warning.

To reproduce the capture in the Lane C review workspace, run
`node ../proof/capture-published-answer-control.mjs` from the repository root.
The script accepts a local npm tarball path or reads npm's cached archive by
the lock's verified digest. The test suite uses the checked fixtures offline.
