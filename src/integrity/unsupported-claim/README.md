**Mixed** — one decidable claim over recorded context, and the sentences that
claim is served as.
Fold: `check.ts` · `unsupportedClaimsOf` — what the answer says against what the
run actually settled. It derives from the record, states its own evidence, and
files a disposition even when it finds nothing.
Lens: the two `message` variants `check.ts` · `unsupportedClaimsOf` composes —
the contradiction sentence ("The answer's '…' says … while the run verified …")
and its advisory twin. They are English prose with a model audience, not only a
dashboard one: `src/core/agent/integrityFindings.ts` · `fileIntegrityFindings` emits every
ContextError on `agentfootprint.integrity.context_error`, and
`src/trace-toolpack/traceToolpack.ts` · `buildFindContextErrors` reads them
all and truncates `error.message` into the `find_context_errors` tool result a
debugging model reads.
No `test/modelFacingScan.test.ts` LEDGER row files this check: that scan keys
on a `this run` / `right now` time anchor, which this prose does not carry, and
absence from the LEDGER is not evidence a surface is not model-facing.

# unsupported-claim — what the answer says vs what the run settled

**Why.** The evidence gate grounds the answer's names and numbers: every value must appear in a tool
result. Its own documentation states the hole this fills — _"it cannot catch a FALSE CLAIM ASSEMBLED
FROM REAL VALUES"_. "fc1/3 is healthy" when the data says the port is down uses entirely grounded
tokens: `fc1/3` is in the evidence and "healthy" is a word. Token grounding passes it without a
murmur. So does a final answer reporting `budget_start: 2` when the run's own ledger recorded 30.

**What makes it decidable.** Two halves, and neither works alone. Typed facts make the contradiction
_representable_: a tool returning `describedResult({ facts: [{ entity: 'screen2', nav: 2 }], provenance })`
settles a reading, and `ledger.ts` flattens every recognized envelope into `(entity, field, value)` rows in
`scope.claimFacts` — the `coverageDeclared` shape, and for the same reason (the envelope is replaced
by its compact model projection on the wire, so without a tracked key the typed object exists nowhere
a check could read). A **declared contract** makes it _decidable_: `.claims({ nav_count: { entity:
'screen2', field: 'nav' } })` — the operator names which answer field is a claim about which fact.
The checker joins; it never infers, exactly as `argumentsFrom` does one folder over. Guessing that a
field named `nav_count` is about `nav(screen2)` is the inference this family exists to refuse.

**Where it runs.** In the Route decider, last of four judges — after the schema accepted the answer,
after the step judge, after the evidence gate. That order is the point: this check reads the TYPED
stratum, so it can only run on an answer a schema already validated, and it asks what none of the
others can. Unlike the other three it **never re-routes**: a disagreement between the answer and the
ledger is a fact about a finished run, and re-asking the model would invite it to change the claim
rather than the run to change the facts. It files one finding and returns the answer untouched.

**When it governs delivery.** An enforcing `.answerValidation({ agentChecks: ['claims'] })` asks the
same selection — `check.ts` · `compareClaim`, which `unsupportedClaimsOf` is built on — once more,
over the canonical answer that validation delivers, and `delivered.ts` · `judgeDeliveredClaim` turns
it into one verdict per declared claim, which `answer-validation/agentChecks.ts` files as a report
row. A verdict that can withhold an answer reads the unscoped contract more strictly than the
detector, because the contract takes the latest `(entity, field)` row from ANY tool, with no scope
or age check, and any result carrying the semantics marker settles a fact:
- **agreement is never support** — `agrees` is `not-applicable`, so only the app's own checks pass
  a report; a contradiction still fails it and the answer is withheld;
- **a fact read two ways is disputed** — when this run's rows for one fact disagree, the claim is
  not compared with the latest (`unreachable`); a row that settled nothing disputes nothing;
- **a bare doubt settles nothing** — a value against a tool's bare `null` / `'unknown'`, and doubt on
  both sides, are `unreachable`; an absence a tool declared with `known(null)` is a settled value;
- **values compare after a declared normalization** (`evaluate.ts` · `compareClaimValues`, below) —
  `'Settled '` agrees with `'settled'` and `42.5` with `'42.50'`; values that cannot be compared
  safely are `unreachable`, never a contradiction.
A claim with no settled fact is `unreachable` too, so it is withheld. Still no re-route: the seam
above is unchanged, and the detector's findings and dispositions are byte-identical (pinned against
the ec32fad source by `test/integrity/claim-pair-evaluation.test.ts`).

**Comparison ownership.** `check.ts` selects the latest `(entity, field)` row, constructs the
asserted pair and preserves the answer-specific messages, witness order and dispositions.
`evaluate.ts` owns the pair's doubt and numeric-leniency decisions and delegates structural
comparison to the existing ContextFootprint algebra. It does not select evidence, infer scope,
judge coverage or write records. The detector compares by that exact equality, and its findings
are pinned to it. `evaluate.ts` · `compareClaimValues` is the one other value comparison, and only
the delivery verdict (`delivered.ts`) reads it, because a verdict that can withhold an answer must
not accuse it over a representational difference. Its normalization is declared and closed: text
is trimmed and case-folded; a number and a plain decimal string (`-?digits[.digits]`, no leading
zero, sign or exponent) compare by value, both ways — two decimal strings digit for digit, a JS
number at the double precision it has; a number with a unit only with the same unit; lists item by
item in order, objects key by key. Kinds that cannot be compared safely — a list or an object
against a scalar, a unit against a bare number, text against a number or `true`/`false` — are
`incomparable` (the row says "could not compare"), never a contradiction. The pair-by-pair oracle
is hand-written in `test/answer-validation/agentChecks.test.ts`.

The internal evaluator reports a reason, not a support badge: evidence unavailable, claim
nonparticipating, doubt against a value, both doubt, numeric leniency, conflict or no conflict.
`no-conflict` alone proves no positive agreement. The existing answer adapter still maps both
doubt and a nonparticipating claimed value to `checked-pass`; that diagnostic contract is
preserved, not relabeled as verification. A future scoped check must establish its own eligibility
before interpreting the pair result. The delivery verdict (`delivered.ts`) is the one reader that
can withhold an answer, and it never turns a pair result into support.

**The fences.**

| Situation                                                       | Verdict                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Claim contradicts the settled fact                              | `unsupported-claim` finding, `checked-fail`                                   |
| Claim agrees                                                    | no finding, `checked-pass`                                                    |
| Fact never collected, or settled as an unknown `Claim`          | no finding, **`unreachable`** — incomparable, never an accusation             |
| Answer omits the field                                          | no finding, `not-applicable` — the schema allowed the absence                 |
| Answer says `null` / `'unknown'` where the run verified a value | finding with **`advisory: true`**, counted apart — doubt is not contradiction |
| Answer says `null` where the run SETTLED `null`                 | no finding, `checked-pass` — agreement on a non-reading is agreement          |
| Earlier ledger rows for the same fact                           | ride as `quoted` witnesses; only the LAST row asserts (history is quotation)  |
| `'30'` claimed against numeric `30`                             | no finding — one stated leniency, string-of-number toward number only         |

**Identity is per (entity, field).** A finding carries `predicate: claim.field`, so two claims about
two fields of one entity are two defects — mirroring the substrate's own `assertionKey`. Before that,
their identities collided and the second was deduplicated away while the disposition ledger still
counted it, leaving the event channel and the accounting disagreeing about one run. An adversarial
review caught it; `test/integrity/unsupportedClaim.test.ts` pins it.

**Cost is gated on the contract.** The ledger accumulates only when `.claims()` is declared — an
agent whose tools return semantic envelopes but who declared no contract has nothing that would ever
read those rows, so writing them would be committed state and checkpoint weight bought for nobody.

**Runnable example.**

```ts
const agent = Agent.create({ provider, model })
  .tool(screenTool) // returns describedResult({ facts: [{ entity: 'screen2', nav: 2 }], provenance })
  .outputSchema(AnswerSchema) // required — prose has no typed stratum, and is never checked
  .claims({ nav_count: { entity: 'screen2', field: 'nav' } })
  .build();

agent.on('agentfootprint.integrity.context_error', (e) => {
  if (e.payload.kind === 'unsupported-claim') console.log(e.payload.message);
});
// The answer's 'nav_count' claims 5 but the run's settled fact is nav(screen2) = 2
// (whats_here, call c1, iteration 1). The record supports the fact, not the claim.
```

The disposition ledger next door distinguishes a configured check from an unwatched seam.
Its legacy `checked-pass` includes the doubt and nonparticipation cases above, so it is not
by itself a certificate that an answer field agrees with evidence in the intended scope.
