**Walker** — admits native tool observations and either observes prose or replaces typed negative citations with checked, library-written statements at the agent's final-answer boundary.

`config.ts` validates the app's discriminated arm. `{ prose: true, phrases? }`
requires no schema, citations, tool-name list or answer validator. The typed
`{ field, tools, unestablished, phrases? }` arm serves the model's citation schema.
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

`prose.ts` observes every free-form model string, including nested strings and citation
labels. The typed arm calls it before writing library statements. `observe.ts`
mounts the prose-only arm after terminal routing and output middleware, before
assessment and conversation capture; refused drafts and pending consent are skipped.
It never invokes the app parser again, adds a correction or rewrites the answer.
Independent schema/validation behavior stays in force. Prose-only configuration
refuses `outputFallback`, whose replacement would occur after observation.

One whole-answer budget bounds
scanning (65,536 UTF-16 code units and 256 strings) and observations (32
claims plus unjudged units). JSON copying is capped at 1 MiB and field paths at
4,096 code units. One shared 8,000,000-unit work budget bounds pattern preparation
and evidence/name matching across fields. Over a budget, one note records skipped
work and replaces all partial findings.
The English heuristic requires a same-clause anchor in a dispatched read's public
declaration, sent value or resolved name; host-only and kept-out values cannot
anchor it. Anchoring does not establish an entity or a fact. Code and recognized
unsupported-language units receive notes; language detection itself can miss text.
App extensions add at most 32 literal phrases of 128 code units, under the same
rules and a version derived from their effective pack hash.

The writer files `negative-claim` / `negative-claim-note` findings and emits one
`agentfootprint.findings.negative_claim` warning per row: bounded locations, codes,
pack identity and native references, never answer text or tool values. Current-turn
rows make the answer fold not-sure with `negative-prose-unverified`; no finding
does not verify the answer. The heuristic can miss phrases and over-flag others;
its revised behavior is unmeasured. Prose never blocks, verifies or buffers delivery,
and `strictProse` / `enforceProse` remain refused.

Remote tool admission and model-generated evidence rules remain deferred. Unarmed
agents retain their execution. PR 4 (#203) already changed the global answer-account
template version from 11 to 12, including unarmed records; PR 5 retains version 12.
