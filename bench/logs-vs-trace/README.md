**Support** — local benchmark preparation; no model chooses an answer in this harness.

# Logs versus trace: no-cost harness verification

This is the preparation phase of a future debugging benchmark. It checks paired
evidence delivery, a seeded run plan and deterministic fix grading. It does not
measure how well a model debugs, how many model turns it needs, or token savings.
No model/provider adapter, key lookup or paid-run switch is implemented.

The native fixture follows the existing trace-debug-session example: a monthly
debt ratio uses an annual denominator. A second fixture keeps the correct monthly
denominator. A third deliberately withholds the completed trace capture. Both
arms refer to the same completed execution for each case, rather than rerunning
different inputs under different arms.

The synthetic policy compares the unrounded ratio with `0.4`. Native fixture and
private replay tests independently pin `0.3996` and `0.4` as within the ceiling,
and `0.4004` as above it. No display rounding changes a decision.

## Owners and boundaries

| File           | One responsibility                                                           |
| -------------- | ---------------------------------------------------------------------------- |
| `cases.mjs`    | Frozen synthetic case descriptors and visible input values                   |
| `capture.mjs`  | Native test chart, ordinary application logs and completed artifacts         |
| `evidence.mjs` | Logs or public trace-tool responses; exact response bytes and framed digests |
| `grade.mjs`    | Private held-out replay oracle; strict structured candidate grammar          |
| `harness.mjs`  | Seeded paired plan and explicitly scripted validation attempts               |
| `run.mjs`      | Local CLI; only seed and new output-file options                             |
| `*.test.ts`    | Adjacent behavior, negative, replay and no-model checks                      |
| `PLAN.md`      | Boundaries and decisions required before a future empirical run              |

The grader and case labels are not part of either arm's served task or evidence
frame. The output keeps grading separately for audit. Never feed the whole
validation report to a future debugging model: it contains scripted candidates
and grader results. Such a model would receive only the declared evidence frame.

## Running

The CLI uses the package's existing `/observe` door from a build matching this
checkout, as the other internal benches do. Heavy builds go to hosted CI first.

```sh
node bench/logs-vs-trace/run.mjs --seed 1729 --out /tmp/new-logs-trace-validation.json
```

The output path must be new; an existing file is never overwritten. Supplying a
provider, model or spending flag is refused. The focused suite loads the actual
source door and needs no local library build:

```sh
node node_modules/vitest/vitest.mjs run bench/logs-vs-trace
```

Vitest explicitly discovers adjacent `bench/**/*.test.ts` tests. This adds tests
to the normal hosted gate; existing source/test discovery and coverage stay in
place. There is no new public export, package feature, alias or production change.

## Reading the output

- `mode` is always `deterministic-harness-validation`; the candidate scripts are
  predetermined checks of the harness, not independent debugger answers.
- `modelCalls` and `providerCalls` are zero. `modelSpendUsd` is zero because no
  adapter is enabled. Coding, CI and other computing costs are not measured.
- Model input/output tokens are `null`, with provenance `not collected`. Byte
  counts are never converted into tokens or a money estimate.
- `utf8BytesServed` counts response-body bytes only. It excludes prompts, tool
  schemas, request envelopes and protocol overhead. Digests cover framed response
  JSON, so response boundaries cannot collide by concatenation.
- Native trace responses keep their coverage warnings. Initial `$getArgs()`
  input is untracked; available artifacts do not prove complete causal coverage.
- A deliberately missing trace capture remains visible as missing. Available
  ordinary logs stay visible. The paired case is not graded; absence is not a
  successful diagnosis or a failed model answer.
- Native timestamps and record identifiers can vary. The synthetic inputs,
  seeded arm order, candidate scripts and replay outcomes are deterministic.

`PLAN.md` defines the remaining empirical work. These validation results cannot
support a performance, cost, model-quality or correct-fix-rate claim.
