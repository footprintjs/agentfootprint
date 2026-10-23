**Walker** — admits native tool observations and replaces typed negative citations with checked, library-written statements at the agent's final-answer boundary.

`config.ts` validates the app's arm and serves the model's citation schema.
`capture.ts` owns the private attempt ledger: actual dispatch arguments, native
result identities, caller binding, pending calls and observation eligibility.
`checkpoint.ts` admits its bounded operational carrier across a continuation;
the host must authenticate checkpoint storage. Structural validation does not
authenticate arbitrary caller-supplied JSON.

`delivery.ts` joins those observations with the pure checker in
`integrity/negative-claim/`, requires every citation to name its population,
checks other reads of that subject, and composes the delivered field. A negative
check never produces `checked-pass`. App answer checks keep their independent
veto, and `state-searched` changes delivery without upgrading verification.

`recheck.ts` spends the shared one-correction budget. The correction is a
request-only system frame, never conversation evidence; tools remain disabled.
The schema-retry stage shares this budget under the same arm. Buffered delivery,
history and memory use the final canonical answer, not the model draft.

`prose.ts` observes every original free-form model string, including nested strings and citation
labels, before the library writes its statements. One whole-answer budget bounds
scanning (65,536 UTF-16 code units and 256 strings) and observations (32
claims or unjudged units). Over a budget, one note records skipped work instead of a partial pass.
The fixed English grammar files `negative-claim` / `negative-claim-note` findings;
they make the answer fold not-sure and never block or verify. The grammar can miss
phrases and over-flag others; all other answer text remains unchecked model prose.

Remote tool admission and model-generated evidence rules remain deferred. Unarmed
agents retain their execution; the global answer-account template version changes
from 11 to 12, including records from agents without this arm.
