# Source-links pilot

This paired catalog benchmark measures whether the model cites results it received, whether it uses the instructed source on the decoy, and what the citation request costs. [RULE.md](RULE.md) defines counts and gates. [PREDICTIONS.md](PREDICTIONS.md) records the predictions before rehearsal.

## Offline proof

From the repository’s `bench` directory on Node 24:

```sh
npm --prefix honest-report/cohorts/after ci --ignore-scripts --strict-peer-deps
node --test source-links/*.test.mjs
node --permission --allow-fs-read="$PWD/source-links" --allow-fs-read="$PWD/honest-report" \
  source-links/run.mjs --rehearse > source-links/rehearsal.json
node --permission --allow-fs-read="$PWD/source-links" --allow-fs-read="$PWD/honest-report" \
  source-links/run.mjs --verify-receipt
```

The scorer calls the published AgentFootprint 15.0.0 build’s own token helpers. The checked-in receipt pins the exact files, package trees, token module and scripted transcript digest. The scripted cases retain the actual request messages at the provider adapter boundary. In the out-of-window control, the harness removes the assigned result at that boundary before calling the scripted model. Only a uniquely matched slot with the locally issued call ID and exact text can verify a citation. The rule limits its claim to the received synthetic results and the requested field format.

The desk, budget, preflight estimator, exclusive ledger and cohort loader reuse the honesty harness. Its default USD 8 and USD 10 gates still apply to the prior benchmark. The batch-5 receipt is reproducible on its original #422 head `02977bef438a6`.

## Coordinator’s run

Supply a local ignored `paid-provider.mjs` beside `run.mjs`. It implements the [existing provider contract](../honest-report/README.md#coordinators-paid-batch), forwarding the same messages, system prompt, tools and limits with no extra model-visible data. Report actual usage, including unexpected cache usage, when the provider returns it. One call to `complete` is one physical attempt. Use no retries, caching, or server tools.

```sh
node --permission --allow-fs-read="$PWD/source-links" --allow-fs-read="$PWD/honest-report" \
  --allow-fs-write="$PWD/source-links/paid-attempts.jsonl" \
  source-links/run.mjs --coordinator-run > source-links/pilot.json
```

The runner verifies the offline receipt before importing the provider and creates the ledger exclusively. Preserve the ledger on any stop. The first repeat in each of the twelve cells must have final output and known usage before the USD 4 projection clears the remainder. USD 5 bounds additional dispatches. An incomplete schedule leaves the pass lines unevaluated. The output includes both arms’ wrong and missing counts, matched final-output token deltas and total known input and output usage per run.
