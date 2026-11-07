# Lens — typed input-response helpers

`../inputRequest.ts` is the existing public facade. It keeps declaration and
field validation, stamping/stored-pause checks, InputRequestError and the final
reply application. This sealed folder owns complete existing helper families:

| Unit          | One job                                                            | Runtime dependencies          |
| ------------- | ------------------------------------------------------------------ | ----------------------------- |
| `data.ts`     | Existing own-key/plain-object/string/JSON predicates               | none                          |
| `response.ts` | Existing time-answer refusal/re-ask and accepted-refusal retention | data, time validators/catalog |

`response.ts` imports the facade only for erased types. No helper calls back into
the facade and no native/executor identity changes. All original public types
and functions remain exported by inputRequest.ts, including TimeAnswerContext.

The one separate behavior delta is the facade's empty-values guard: after the
unchanged validateValues call, an empty value object may reach the existing
reply handling only when `time/replyForm.ts · hasDeclaredTimeReply(waiting)` reads
the declared optional range/correction pair. The time owner supplies that bounded
association reader. Ordinary and legacy requests still reject empty replies;
unknown fields, wrong types and malformed values fail before the exception.
The strict time-range validator, cancellation path and InputField key set are
unchanged. This is not a generic empty-answer or correction parsing allowance.

Existing behavior owners are `test/tools/input-request.test.ts` and the
`test/time/ask.test.ts` / `ask-run.test.ts` suites; Root's replyForm tests pin the
new association predicate and declared empty-pair behavior. Root must run the
actual tests, types, graph and source-census gates; this README claims no result.
