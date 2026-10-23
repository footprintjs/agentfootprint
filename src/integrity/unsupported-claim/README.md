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
detector, because the contract takes `(entity, field)` rows from ANY tool, with no scope or age
check, and any result carrying the semantics marker settles a fact — so any row may be forged or
stale. Its one law: **a reading can only withhold.** With no reading the claim is not checked
(`not-applicable`), and one more reading — first or last, forged, stale, doubtful or malformed —
never makes the verdict more permissive (pinned by a monotonicity property over a value matrix in
`test/answer-validation/agentChecks.test.ts`). So:
- **agreement is never support** — `agrees` is `not-applicable`, exactly as silent as no reading, so
  only the app's own checks pass a report; a contradiction still fails it and the answer is withheld;
- **every reading counts, never the latest alone** — readings that disagree are `disputed`; a
  reading that settled nothing (an `unknown(…)` Claim, a bare `null` or doubt word) beside the
  answer's value withholds;
- **a contradiction found is reported as one** — if the answer contradicts ANY value read, the
  verdict is `contradicts` (every value) or `contradicts-a-reading` (the values read differ),
  whatever else was read: a forged `null` beside a real reading cannot relabel it "unverified";
- **doubt is never agreement** — doubt on both sides is `unreachable` (doubt words are read after
  the comparison's own normalization, so `'Unknown'` is doubt); only an absence a tool declared with
  `known(null)` agrees with the answer's doubt;
- **only a well-formed `Claim` is read** (`evaluate.ts` · `claimShapeOf`): a `known(…)` without its
  `evidence`, an `unknown(…)` or `notApplicable(…)` carrying a `value`, or any other key, makes the
  verdict `incomparable`;
- **values compare after a declared normalization** (`evaluate.ts` · `compareClaimValues`, below) —
  `'Settled '` agrees with `'settled'` and `42.5` with `'42.50'`; values that cannot be compared
  safely are `unreachable`, never a contradiction.
Still no re-route: the seam above is unchanged, and the detector's findings and dispositions are
byte-identical (pinned against the ec32fad source by `test/integrity/claim-pair-evaluation.test.ts`).

**Comparison ownership.** `check.ts` selects the latest `(entity, field)` row, constructs the
asserted pair and preserves the answer-specific messages, witness order and dispositions.
`evaluate.ts` owns the pair's doubt and numeric-leniency decisions and delegates structural
comparison to the existing ContextFootprint algebra. It does not select evidence, infer scope,
judge coverage or write records. The detector compares by that exact equality, and its findings
are pinned to it. `evaluate.ts` · `compareClaimValues` is the one other value comparison, and only
the delivery verdict (`delivered.ts`) reads it, because a verdict that can withhold an answer must
not accuse it over a representational difference. Its normalization is declared and closed: text
is Unicode NFC, trimmed, its white space collapsed, under a full case fold WITHOUT the Turkic
mappings (each character upper- then lower-cased on its own, `ß`/`ẞ` → `ss`, the dotless `ı` kept);
case agrees ONLY for a word of letters, more than three of them, whose first letter or whole word
is cased differently (`Settled`/`settled`, `STRASSE`/`Straße`) — any other case difference is not
compared, because case can carry meaning: a short word or unit (`MW`/`mW`, `Co`/`CO`), a mixed-case
word, text with a digit, ß against ss in the same casing (`Masse`/`Maße`: two words), and a dotted
against a dotless i (`ılık`/`ilik`); a number and a plain decimal string
(`-?digits[.digits]`, no leading zero, sign or exponent) compare by value, both ways — two decimal
strings digit for digit, a JS number at the double precision it has; a number with a unit only with
the same unit, written exactly (`MW` is not `mW`); lists item by item in order, objects key by key.
A value written in a format — a currency symbol, digit separators, a dot-grouped number (`1.250`
is 1.25 or 1250, by locale), a date or a time — agrees only as written, and text that differs only
in how a number inside it is spelled (`USD 42.50`, `USD 42.5`) is not compared. Kinds that cannot be compared safely — a list or an object against a
scalar, a unit against a bare number, text against a number or `true`/`false` — are `incomparable`
(the row says "could not compare"), never a contradiction. A Claim wrapper is read
only where the contract puts one — at the TOP of a settled value or of a claimed field — and only a
well-formed `known(…)` (`kind`, `value`, a text `evidence`); a wrapper carrying any other key is
`incomparable`, and a wrapper-shaped object INSIDE a value is that value's data, compared as an
object, so an answer cannot have a nested object read as the value it wraps. Whether a run read one
fact two ways is decided by `claimValueKey`, an EXACT key per value (a JS number by the digits it
prints), never by agreement with the first reading: agreement at double precision is not transitive
(a double agrees with both `'9007199254740992'` and `'9007199254740993'`), and a pairwise scan over a
long series would cost its square. The pair-by-pair oracle is hand-written in
`test/answer-validation/agentChecks.test.ts`.

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
