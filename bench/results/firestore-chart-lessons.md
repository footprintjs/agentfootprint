# Firestore chart-folder pilot cost

The checked-in harness `bench/firestore-chart-pilot.test.ts` measures the same
fixed 290-byte envelope against the existing in-process Firestore double.
It warms 50 saves and 50 loads, then runs five fresh-store rounds of 1,000
serial saves and 1,000 serial loads each. Correctness checks are outside the
timed loops. Module loading, chart construction and store construction are
excluded. No Firestore service or network latency was measured.

| Median | Before | Chart | Added per call |
| --- | ---: | ---: | ---: |
| Save | 3.249 µs | 68.040 µs | 64.791 µs |
| Load | 2.406 µs | 32.921 µs | 30.516 µs |

Raw rounds, environment, source digests and measured call counts are in
`firestore-chart-before.json` and `firestore-chart-after.json`. The source digest
pins the after source even when its recorded revision says dirty; the final
request names the immutable submitted head. The only harness adaptations from
the before run are the explicit folder import and a clarification that module
loading/chart construction are excluded. The workload and timing loops match.

The fake backend makes the added chart work conspicuous: about
20.9× save and 13.7× load total time. The added absolute costs are
0.065 ms and 0.031 ms per call. These are measured local overhead,
not a measured fraction of a real network round trip. Profile a deployed
workload before widening this pattern; this pilot does not establish that the
cost is negligible for a hot local store.

## Lessons

- Whole-unit helpers and unchanged port conformance made the extraction tractable.
- The original synchronous snapshot and request-start prefix has to remain one
  first stage. Splitting it across awaited stages would accept later caller
  mutations or alter shutdown ordering. The regression probe catches that.
- Firestore owns transaction retry. Each callback gets its own ownership chart;
  the adapter does not add a second retry loop.
- Native scope args are frozen copies for plain data. A frozen capability
  wrapper borrows the private call instead. The private test observer captures
  bounded facts, never the envelope, SDK handles, raw SDK errors or caller
  identity. Its args are explicitly untracked, so this is not a full causal
  slice. The public factory supplies no observer and retains no debug record.
- The refused-save artifact is a private demonstration, not a production debug
  log. Its snapshot contains the byte count, ceiling and `envelope-too-large`
  reason code, but no size-rule label; the decision rationale only says
  `returned branchId: refuse`. The test builds the artifact's `sentence` from
  the thrown error and its assertion that no transaction started, not from the
  snapshot. Pilot requirement 4 therefore remains unmet for the public store.
  The chart pattern and record design stay on hold for the owner's decision;
  attaching a recorder or adding a public diagnostics API is outside this fix.
- A folder move does not make an explicit `.js` source import resolve to an
  `index.js` in Node ESM. Private imports and path-based inventories need a real
  rebase, with no forwarding shim; the package hosting door remains the same.
- Validation primitives and pure address/retention helpers stay plain functions;
  operational branch rules are data. Keep charting focused on meaningful I/O,
  absence, size and ownership boundaries before applying it more widely.
