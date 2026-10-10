# Step 1 bench — the standing fold over the recorded runs ($0)

Registered BEFORE the bench ran (honesty design, evolution step 1; the design adopted overnight
2026-09-27 on the owner's go; the owner may overturn). No model is called: the bench reads
recordings already in the repository. Cost: $0.

## What is measured

The fold is `core/agent/assessment/assess.ts` · `assessAnswer`. The oracle is the study's
registered RQ3 rule, as transcribed in `test/core/agent/assessment/rq3-parity.test.ts` · `rq3`
(events only, imports no library reader). The bench script `bench/standing-fold/run.mjs` writes
`bench/standing-fold/results.json`.

The recorded runs, every one the repository holds (a tracked JSON that carries committed state):

| Tier | Source | How the committed state is read |
|---|---|---|
| full | the 21 byte references, `test/core/tools/reference/*.json` | `foottrace` · `stateAt` over the whole `commitLog` |
| full | fixture A, `test/lib/answer-account/fixtures/turn2.recorded.json` (the one real field recording) | its `snapshot.sharedState`, with the app's declarations (`test/lib/answer-account/helpers.ts` · `NEO_DECLARATIONS`) |
| full | `test/recorders/observability/fixtures/demo-turn.json` | its `finalState` |
| excerpt | `test/core/agent/reference/coverage-record-only-bytes.json` (20 variants), `test/core/scenario/reference/batch-pause-last-call.json` (4), `test/core/agent/reference/paused-lookup-no-absence.json`, `test/core/agent/fixtures/absent-try-instead-sentence.reference.json` | only the committed keys the reference retained (`history`, `coverageDeclared` where kept); the missing keys are listed per record, never rebuilt |
| excluded | `test/core/agent/reference/hand-raised-malformed-request.json` (4) | each run ended in an error: no answer, so no standing (`assessAnswer`'s contract) — counted, not folded |
| unreadable | the OTel references, the narrative reference, `absent-try-instead-not-a-sentence.reference.json` (events and model-read text only), the account goldens | no committed state — counted |

The study repository's recorded runs (`honest-answers/data/runs/`) are EMPTY at this bench
(the study has not run its pilot): parity over the study's own records is blocked by data and is
re-run at the study's freeze.

## The rule — GOOD only if all three hold

1. **Parity.** (a) `test/core/agent/assessment/rq3-parity.test.ts` passes: every one of its 18
   recorded turns lands in RQ3's class or in a NAMED difference (`entity-scope`, `last-lookup`,
   `pause-kind`), and every named difference runs in one direction (the fold says more: not sure
   or ask). (b) On every in-repo recording where RQ3 is defined — the record keeps its event
   stream AND its question names an entity that the calls' arguments carry (fixture A:
   `SHPSTRPLPCL003`; demo-turn: `Heat`) — the fold's class equals RQ3's class, or the difference
   is one of the three named ones in the says-more direction. Zero unexplained disagreements.
2. **No "known" from silence, anywhere.** Over every folded record (full + excerpt) and over the
   synthetic silence probes in the script, every `known` rests on a committed supporting row (an
   `answerValidation` report with `status: 'passed'`, `mode: 'enforce'` and a `candidateDigest`),
   and the same record with that row removed never folds to `known`. Violations = 0.
3. **Full suite green.** `npx vitest run` on this branch: zero failures outside the base set
   measured on `origin/main` (7a9c517c) in this environment (the `openid-client` environment
   failures, `bench/standing-fold/base-failures.txt`); and the 21 byte references unchanged
   (`git diff origin/main -- test/core/tools/reference/` empty).

Reported, not gated: the standing mix per tier (`known · consistent · not-sure · ask ·
not-assessed`), the reasons, the share of results the record cannot read, the PLAIN share.
