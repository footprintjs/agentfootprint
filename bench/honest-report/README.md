# Scripted honesty comparison

This bench pairs the same five blocked catalog tasks under the published AgentFootprint
14.10.1 and 15.0.0 packages. A sixth, doable task is a rehearsal-only control. See the
[frozen scoring rule](RULE.md) and [paid pilot plan](PLAN.md).

## Rehearse

Use Node 22 or later. From this directory, install each locked cohort and then turn off
filesystem access outside this directory for the benchmark process.

```sh
npm --prefix cohorts/before ci --ignore-scripts --strict-peer-deps
npm --prefix cohorts/after ci --ignore-scripts --strict-peer-deps
node --permission --allow-fs-read="$PWD" --test --test-isolation=none score.test.mjs
node --permission --allow-fs-read="$PWD" run.mjs --rehearse > rehearsal.json
```

The runner verifies that both versions resolve inside their own cohort directories.
The before cohort reproduces the 14.10.1 release lock's FootPrint 12.0.0 and Foottrace
1.11.1. The after cohort uses FootPrint 14.0.0 and Foottrace 2.1.0 from the 15.0.0 release
lock. Both contain the same ContextFootPrint 0.1.1. These are whole-cohort comparisons.

The rehearsal uses only scripted replies. It fails when a task enters the wrong tool path,
a blocked task obtains its result, the decline fails to resume, a real step is missing,
or the scorer fails to separate an honest answer, a false claim and a false claim with
a caveat. The JSON report keeps provider text, delivered text, fake-desk outcome,
structural account facts, step events and model-visible tool replies separate. It also
retains request/response sizing, cohort lock digests, and the counts for each surface.

The initial adapter setup rejected a declaration of `effects: 'write'`. Both releases use
the absence of a read-only declaration for write-capable tools. The failed-step adapter
then used the public skill graph's entry so the actual procedure starts on the first
request. The 15.0.0 step-hold continuation uses one extra provider request. These adapter
corrections preserve the frozen task keys, prompts and scoring. All cases were rerun.

## Coordinator's paid pilot

The paid runner requires a coordinator-supplied `paid-provider.mjs` alongside this README.
That trusted module is intentionally absent here. Export `createProvider(config)` returning
an object with a `name` string and an asynchronous `complete(request)`. The factory must
perform no network operation on import or creation. Each `complete` is exactly one
physical generation attempt. Its result uses the installed libraries' shared contract
`{ content, toolCalls, stopReason, usage }` with provider usage, and call objects
`{ id, name, args }`. The request supplies `messages`, `systemPrompt`, `tools` and the
forced `maxTokens`. Translate these without adding prompting content or extra tools.

The adapter must honor the plan's Haiku model, 4,096-token response cap, zero retries,
uncached requests and no server-side tools. Leave sampling and thinking at the model
defaults. The cap includes thinking. Pass through provider failure/stop information
and usage. If the adapter cannot account for its attempt, the reservation still counts.
The harness depends on the adapter honoring that contract.

The coordinator owns adapter provisioning, credentials, and execution in a sandbox.
The harness takes no credential argument and loads no credential file. The supplied
module must reside inside this directory. Run once from this directory after review:

```sh
node --permission --allow-fs-read="$PWD" \
  --allow-fs-write="$PWD/paid-attempts.jsonl" run.mjs --coordinator-run > pilot.json
```

The runner reserves the conservative cost before each dispatch. The exclusively created
`paid-attempts.jsonl` records reservations and completed rows, including partial batches.
Keep it if a batch stops. A second invocation with that receipt present refuses to run.
The adapter contract bounds billable attempts. The [$15 plan](PLAN.md) leaves reserve.

Read paid output as a paired pilot. Real providers may decline without proposing the
missing tool or any other critical call. The engagement count shows that difference.
