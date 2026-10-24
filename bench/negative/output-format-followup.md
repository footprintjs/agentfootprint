# Structured-output follow-up to PR 206

**Ratings are stopped. No accuracy or usefulness result is claimed.** The original generation bank, registration, replies and recordings remain frozen. This follow-up fixes format handling in the library, replays the saved replies offline, and records six separately authorized live smoke calls. It does not replace the failed benchmark or enable a release.

## Library change

`outputSchema` defaults to `auto`: use the effective provider/model's declared native format when a usable JSON Schema is supplied or parser-derived; otherwise retain instruction-based generation and local validation. Explicit strategies remain available. Native format enforcement is not factual verification. One whole-answer JSON or unlabelled triple-backtick wrapper is accepted before the unchanged strict JSON/application parser. No values are repaired and surrounding prose or multiple wrappers still fail.

The format guarantee follows actual requests and provider fallbacks. Local callback answers cannot inherit native provenance. A native refusal cannot enter a reliability schema retry. Object intersections that closing would change are conservatively refused for native output and use checked parsing under auto.

## Original run and the 43 stopped trials

The frozen generation run used explicit instruction-only output. Its 741 terminal replies were fenced JSON and failed the old JSON decoder. The other 43 trials ended before a terminal answer. None reached a checked library statement.

Saved recordings explain all 43 stops:

| Model behavior after the scripted read | Trials | Read executions | Fixture result |
| --- | ---: | ---: | --- |
| Repeated the exact scripted read | 20 | 20 | Unscheduled-read error |
| Changed its account filter | 20 | 20 | Unscheduled-read error |
| Changed time bounds twice | 3 | 6 | Three argument mismatches, then three exhausted-response errors |

All 46 reads were advertised, entered execution and recorded an error. Their errors reached the next assembled request. The benchmark then blocked that ordinary model call before transport: main cells allowed only one paid response, and long cells only one additional response after tool use. These were not citation corrections or a library max-iteration failure. The traces do not establish an infinite loop. Ten observe trials streamed a preamble; those bytes remain in the original records.

In the three long trials, the first changed window started seven days later and ended one second earlier; the second used dates and ended one day before the authored exclusive endpoint. These were different windows, not equivalent date formatting. The fixture consumed its response slot before checking the first mismatch, causing the second exhaustion. No fixture behavior was patched into the frozen run.

## Free offline replay

The [replay tool](REPARSE.md) uses the fixed library decoder, the original application contract, and each answer's unchanged native evidence. It checks native identity, execution binding, chronology and the exact saved wire response. All **784 trials** remain in the denominator. All **785 input manifest/raw files** were byte-identical before and after. The [aggregate results](offline-reparse-results.json) include per-model/arm counts and full built-code/script provenance.

| Outcome | Count |
| --- | ---: |
| Saved terminal replies that decode as JSON | 741 |
| Pass the unchanged application schema | 621 |
| Still fail that schema | 120 |
| No terminal answer | 43 |
| Binding errors | 0 |
| Schema-admitted answers with zero claims | 84 |
| Schema-admitted answers with claims | 537 |

The 120 schema failures include malformed handles (76 answers), invalid kinds (28), missing/non-array references (14), extra citation fields (13), and empty references (10). These counts overlap. None was repaired or admitted.

The 537 nonempty answers contain **540 claims**. Of their pointers, **483** resolve to a current-turn result, **27** point to an earlier turn and **30** do not resolve. A current pointer alone does not establish the claim.

| Typed checker result | Claims |
| --- | ---: |
| Established within recorded scope | 20 |
| Kind mismatch | 331 |
| About/subject mismatch | 67 |
| Incomplete search | 53 |
| Unresolved citation | 30 |
| Earlier-turn citation | 27 |
| Superseded by a write | 12 |

Thus **20 claims establish and 520 remain unestablished**. All 331 kind mismatches use `not-found` against ordinary declared-absence evidence without the names facet; this contract uses `none` for that evidence. The 20 established claims comprise 10 `none` claims on ordinary absence and 10 `not-found` claims on actual names-index absence. This is a model/contract integration limit, not a reason to weaken the checker.

Fifty-seven answers would need a citation correction. This is counterfactual: no correction, agent delivery or new model response happened during replay. Observe and near-match cells are also evaluated counterfactually under the typed `withhold` configuration; their original delivery behavior is unchanged. Zero claims is not establishment. “Established” does not upgrade a full answer to known/verified and does not measure accuracy.

The prose observer scanned the **621 admitted original candidates**, before any library-written statement: **318 answers had observations**, **303 had none**, and **163 trials were unscanned**. There were 308 entity-unresolved claim rows and 20 no-read notes, with ten-answer overlap. These are bounded heuristic flags. They do not measure semantic repetition reliably; silence is not clearance. Ratings remain stopped.

## Six-call live format smoke

Three calls each used `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`: a format-only answer, an answer after a native captured read, and a tools-off citation correction. Read selection and the deliberately invalid initial citation were scripted; final/correction responses were live. No paid tool-selection benchmark was run.

- **6/6** used native output on the actual wire, returned valid JSON and passed the local answer schema. All stopped normally, without fences or truncation.
- Both format-only answers completed with zero claims; neither counts as an established negative answer.
- Both Haiku claim cases delivered library-written statements.
- Both Sonnet claim cases chose an incompatible kind and were withheld. Their drafts produced no final streamed tokens or memory entries and were absent from conversation history.
- Both correction calls had tools disabled. Each fixture read executed once; no operation was repeated to satisfy the checker.

The initial invocation stopped on the fifth case's failed delivery assertion. After inspecting that recorded kind mismatch, only the sixth already-planned case ran separately, with the same prompt, schema, source and spending ledger. Neither failure was retried or excluded. Native format selection is confirmed for this small probe; reliable semantic claim selection is not. The [smoke aggregate](output-format-smoke.json) retains outcome counts and private-record/source digests.

## Cost and next work

The smoke cost **$0.014708** for six settled calls, with no uncertain charges. Prior settled/reserved spend was **$3.485721**, including the retained unresolved rating reservation of **$0.002908**; combined used/reserved is **$3.500429**, leaving **$0.799571** under the approved $4.30 plan. No ratings or full rerun followed.

Before a new full benchmark, resolve the model-facing `none`/`not-found` contract and make ordinary read continuation compatible with the fixture/call allowance. Freeze any new design and obtain explicit approval for its cost. This patch neither tunes the frozen benchmark nor authorizes that run. **Merge remains with the owner; release stays on hold.**
