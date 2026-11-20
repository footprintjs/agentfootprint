# Hidden-outcome honesty comparison

This bench keeps the six earlier catalog tasks and adds four cases for how
an answer carries incomplete work. In A and B the keyed tool reports failure.
In D it reports pending. The model sees only `Request received.` for those
keyed calls. In C the desk finishes after a retry with identical arguments. The [frozen rule](RULE.md),
[predictions](PREDICTIONS.md), and [paid plan](PLAN.md) define the comparison.

## Compare the released 16.0.0 default with the layer off

Use Node 22 or newer. Run from this directory. Both arms share one installed
copy of the published package. The [16.0.0 plan](RELEASE16-PLAN.md) records
the sample size, projected cost, and preflight.

```sh
npm --prefix cohorts/released16 ci --ignore-scripts --strict-peer-deps
node --permission --allow-fs-read="$PWD" run.mjs --rehearse --release16 > rehearsal-release16.json
node --permission --allow-fs-read="$PWD" run.mjs --verify-receipt --release16
```

The rehearsal uses scripted providers and verifies paired first requests and
the critical-call warnings. The checked-in rehearsal receipt binds the inputs,
installed package, and report digest. The coordinator checks that receipt
and the green source gate before supplying the trusted paid adapter.

The coordinator alone runs the paid comparison:

```sh
node --permission --allow-fs-read="$PWD" \
  --allow-fs-write="$PWD/paid-attempts-release16.jsonl" run.mjs --coordinator-run --release16 > pilot-release16.json
```

## Rehearse batch 6

For exact reproduction of the archived batch 6 receipt, use commit
`17e125d9ec2fbe9dc912645d52d4737b5affd5df`. The receipt records that
revision's harness inputs and package archives.

Use Node 22 or newer. Run from this directory and restrict runtime filesystem
reads to this directory. The published cohort uses the exact lock for
AgentFootprint 15.0.1, FootPrint 14.0.0, Foottrace 2.1.0 and ContextFootPrint
0.1.1. Both batch 6 cohorts enable the standing line. Focused tests use the
published cohort. Rehearsal requires the original green #424 package.

```sh
npm --prefix cohorts/after ci --ignore-scripts --strict-peer-deps
node --permission --allow-fs-read="$PWD" --test --experimental-test-isolation=none benchmark.test.mjs budget.test.mjs plan.test.mjs score.test.mjs literalClaims.test.mjs
```

The scripted model exercises the honest, `done` and repeated-call plays. Before
forwarding a keyed A, B or D reply, the runner joins it to the entered native
call and checks its pre-decoration result against the neutral text. The normal
tool-message fields are allowed. A framework suffix is retained verbatim in
`frameworkNotices`. A status, error flag or disclosed desk outcome stops the
batch before another dispatch. The rehearsal also checks that
every intended reply was seen, the desk held the correct set of titles, the
retry used the same tool and arguments, and the original cases kept their
published behavior. The report retains the provider-facing request messages,
desk truth, raw answer, delivered line, assessment and account separately.
Strict and terminal-object scores use the same published parser.

## Rehearse the candidate archive

Take the npm pack from the green hosted artifact identified in
`cohorts/candidate-source.json` and its SHA-256. Stage it as `cohorts/candidate/candidate.tgz`. From the candidate
directory, initialize the local project, verify the supplied SHA-256, and
install the archived package with package lifecycle scripts disabled. The candidate
uses the same exact peers as the published cohort. Run the rehearsal from
this bench with the staged path and supplied SHA-256.

```sh
(cd cohorts/candidate && npm init -y && \
  npm install --ignore-scripts --strict-peer-deps --save-exact ./candidate.tgz \
    footprintjs@14.0.0 foottrace@2.1.0 contextfootprint@0.1.1)
node --permission --allow-fs-read="$PWD" run.mjs --rehearse \
  --candidate cohorts/candidate/candidate.tgz "$CANDIDATE_SHA256" > rehearsal-candidate.json
```

Before importing candidate code the runner verifies the archive hash, checks
that the local npm lock identifies that archive and its integrity, checks the
installed versions and resolution paths, and hashes the installed candidate
tree. Keep that clean installation for the paid run. Use the candidate manifest and lock from the matching review handoff for the
paid run. The checked-in `rehearsal-lock.json` identifies the exact archive, hosted
artifact and resolved lock that passed rehearsal. You can verify it offline with
`--verify-receipt` and the same `--candidate` arguments. A changed candidate requires
a new pinned source receipt and offline rehearsal before the paid runner opens.

## Coordinator's paid batch

Follow the [plan](PLAN.md). The coordinator supplies `paid-provider.mjs` in
this directory. The harness takes no credential argument or credential file.
The trusted module exports `createProvider(config)` returning an object with
a name and `complete(request)`. Importing and creating it must have no network
effect. Each call to `complete` is one physical generation attempt. Translate
the configured `messages`, `systemPrompt`, `tools` and `maxTokens` directly.
Do not add model-visible metadata, prompts or tools. Keep the configured model,
4,096-token output ceiling, zero retries, uncached requests and no server tools.
Pass the provider's stop reason and final `{ input, output }` usage. Leave
unknown usage absent and preserve unexpected cache usage for the existing stop.

```sh
node --permission --allow-fs-read="$PWD" \
  --allow-fs-write="$PWD/paid-attempts.jsonl" run.mjs --coordinator-run \
  --candidate cohorts/candidate/candidate.tgz "$CANDIDATE_SHA256" > pilot.json
```

Before loading the adapter, the runner verifies the input hashes and exact
candidate archive, lock and installed tree against the rehearsal receipt. It
then exclusively creates the run ledger so a second invocation cannot overwrite
attempts. The first B draw in each cell determines the USD 4 projection gate.
Requests use the USD 5 budget stop and the existing eight-request bound. Keep
partial rows and the ledger on any stop.

The completed comparison is recorded in [Batch 6 results](RESULTS.md).

The strict and supplemental summaries report literal `done` and `partly` for
incomplete desk outcomes separately from the frozen rule count. On the pending
task the recorded `work-not-finished` reason supplies an exact pending call
witness only when its tool name is in the delivered line.
