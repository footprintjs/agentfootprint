# Free counterfactual reparse

`reparse.mjs` applies the current built library decoder and negative-claim checks to a
registered full-path run's **saved model responses and original native records**. It does
not run an Agent, call a model, execute a tool, request a correction, or update a rating.
It is a diagnostic after a parser change, not a replacement generation benchmark.

From the repository root:

```sh
npm run build
node node_modules/vitest/vitest.mjs run test/bench/negative/reparse.test.ts --maxWorkers=2
node bench/negative/reparse.mjs /absolute/private/registered-run /absolute/private/new-analysis
```

The output parent must exist. The output directory must be new, outside the original run,
and outside any Git checkout. It is created with permissions `0700`; reports use `0600`.
Nothing is overwritten. The command prints aggregate JSON only. It has no credential or
network configuration and imports no provider.

Inputs are `manifest.json` and exactly the `raw/<scheduled-id>.json.gz` files named by its
schedule. Every registered row remains in the denominator. Row/model/cell/arm/rep, actual
turn counts, selected wire response, runtime result tuples, executed arguments and caller
identity are checked. Every dispatched read must map to a saved tool proposal preceding the
selected answer; later proposals cause a binding error rather than record reconstruction.
Returned failure/denied/invalid/pending envelopes remain failed native reads even when the
execute function did not throw. A trial with only tool-use responses remains **no-answer**. The
script does not extract a candidate from history, a scripted first answer, or a tool result.

The JSON decoder is `applyOutputSchema`. `reparse-contract.mjs` preserves the original
benchmark application parser's summary, negatives, kind, about, handle and extra-key rules.
A valid JSON envelope can still fail that application contract. Schema issue counts are
closed diagnostic codes; they neither change nor admit the rejected candidate. Counts are
per answer and can overlap when one answer has multiple schema defects.

Only schema-admitted candidates reach `renderNegativeCandidate` and `observeNegativeProse`.
The typed configuration uses the saved record's app tool names and `withhold`; trust is
exactly `call.trustedContext === true && record.ledgerComplete`. The saved native record
is frozen, hashed, and passed unchanged to both checks. Model prose is never appended to
evidence. Prose observation sees the original candidate, before library-written statements.
The summary explicitly separates unscanned trials, observed warnings, and scanned answers
without an observation. None of those categories establishes semantic repetition or truth.

Outputs:

- `analysis.private.json`: selected-response/native-record hashes, original file hashes,
  binding audits, original candidates, schema diagnostics and counterfactual checker rows.
- `aggregate.json` and `aggregate.md`: model/cell/arm counts without private case IDs,
  questions, tool names or entity names. Original-file hashes are rechecked after replay.
- Runtime provenance records the Node version, a digest over every built local JavaScript
  file (including transitive helpers), dependency-lock digest and replay-script digests.
  Reproduce with that exact code/build and the same original input bytes, using a new output
  directory. A different digest identifies a different implementation.

“Established” means only that the typed claim passes the recorded-scope check. It is not
answer accuracy or usefulness. Empty claim arrays are counted separately and never counted
as established negative answers. “Correction needed” is counterfactual; no correction was
performed. These checks cannot show what the model would have answered after a retry, with
native output generation, or with a different tool-call allowance. That requires a separately
authorized run.
