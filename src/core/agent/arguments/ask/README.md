# Walker — batch argument questions

The `../ask.ts` facade retains its existing public exports and batch round/read/
bind/settled orchestration. This sealed folder holds complete existing plain
helper families moved out of that oversized file. No helper imports the facade
at runtime; existing external type readers continue through the facade.

| Unit               | One job                                                        | Internal runtime dependencies |
| ------------------ | -------------------------------------------------------------- | ----------------------------- |
| `types.ts`         | Existing shared field, progress, window and answer shapes      | none                          |
| `constants.ts`     | Existing bounds, identifiers and fixed expectations/questions  | none                          |
| `context.ts`       | JSON context checks and fitted native declarations             | constants, replyFields        |
| `validation.ts`    | Existing property and combined-period answer validation        | constants                     |
| `fields.ts`        | Existing ordinary/shared/window field planning and readability | constants, validation         |
| `windowBinding.ts` | Existing zone/window answer binding and per-call fills         | constants, fields, validation |

All units are pure functions over their supplied batch, tool resolver, clock and
state. They read no scope, wall clock or model and create no executor or pause.
The generic request/resume boundary remains outside this library. The reply addition retains the existing native identity and checkpoint topology.
The old range field keeps its id, enum and labels, becoming optional beside one
optional correction field; old saved fields without that association keep the
legacy path. The #266 partial-window admission and conversion remain separate.

`windowBinding.ts` owns existing range/zone binding and the projected re-ask.
`windowReply.ts` adapts one saved request-bound pair to `time/reply.ts` once, then
returns the existing binding result plus bounded decision/rule evidence.
`replyFields.ts` composes the two wire fields without renumbering tool arguments
and counts both against the native field limit. No text grammar lives here. The facade is below 600 lines. Its retained batch binding/state units are
not claimed to be a new chart or a completed behavioral refactor.

Existing behavior tests import the same facade in
`test/core/agent/arguments/ask.test.ts` and `partial-window.test.ts`; native time
coverage remains at `test/time/english-run.test.ts`, `partial-window-run.test.ts`
and related existing owners. Current native correction coverage is `test/time/time-reply-run.test.ts`.
Exact-head hosted checks and independent review remain required. No test
result or approval is inferred from the whole-unit move.
