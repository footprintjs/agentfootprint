# unsupported-claim — what the answer says vs what the run settled

**Why.** The evidence gate grounds the answer's names and numbers: every value must appear in a tool
result. Its own documentation states the hole this fills — *"it cannot catch a FALSE CLAIM ASSEMBLED
FROM REAL VALUES"*. "fc1/3 is healthy" when the data says the port is down uses entirely grounded
tokens: `fc1/3` is in the evidence and "healthy" is a word. Token grounding passes it without a
murmur. So does a final answer reporting `budget_start: 2` when the run's own ledger recorded 30.

**What makes it decidable.** Two halves, and neither works alone. Typed facts make the contradiction
*representable*: a tool returning `semantic({ facts: [{ entity: 'screen2', nav: 2 }] })` settles a
reading, and `ledger.ts` flattens every recognized envelope into `(entity, field, value)` rows in
`scope.claimFacts` — the `coverageDeclared` shape, and for the same reason (the envelope is replaced
by its compact model projection on the wire, so without a tracked key the typed object exists nowhere
a check could read). A **declared contract** makes it *decidable*: `.claims({ nav_count: { entity:
'screen2', field: 'nav' } })` — the operator names which answer field is a claim about which fact.
The checker joins; it never infers, exactly as `argumentsFrom` does one folder over. Guessing that a
field named `nav_count` is about `nav(screen2)` is the inference this family exists to refuse.

**Where it runs.** In the Route decider, last of four judges — after the schema accepted the answer,
after the step judge, after the evidence gate. That order is the point: this check reads the TYPED
stratum, so it can only run on an answer a schema already validated, and it asks what none of the
others can. Unlike the other three it **never re-routes**: a disagreement between the answer and the
ledger is a fact about a finished run, and re-asking the model would invite it to change the claim
rather than the run to change the facts. It files one finding and returns the answer untouched.

**The fences.**

| Situation | Verdict |
|---|---|
| Claim contradicts the settled fact | `unsupported-claim` finding, `checked-fail` |
| Claim agrees | no finding, `checked-pass` |
| Fact never collected, or settled as an unknown `Claim` | no finding, **`unreachable`** — incomparable, never an accusation |
| Answer omits the field | no finding, `not-applicable` — the schema allowed the absence |
| Answer says `null` / `'unknown'` where the run verified a value | finding with **`advisory: true`**, counted apart — doubt is not contradiction |
| Earlier ledger rows for the same fact | ride as `quoted` witnesses; only the LAST row asserts (history is quotation) |
| `'30'` claimed against numeric `30` | no finding — one stated leniency, string-of-number toward number only |

**Runnable example.**

```ts
const agent = Agent.create({ provider, model })
  .tool(screenTool)                    // returns semantic({ facts: [{ entity: 'screen2', nav: 2 }] })
  .outputSchema(AnswerSchema)          // required — prose has no typed stratum, and is never checked
  .claims({ nav_count: { entity: 'screen2', field: 'nav' } })
  .build();

agent.on('agentfootprint.integrity.context_error', (e) => {
  if (e.payload.kind === 'unsupported-claim') console.log(e.payload.message);
});
// The answer's 'nav_count' claims 5 but the run's settled fact is nav(screen2) = 2
// (whats_here, call c1, iteration 1). The record supports the fact, not the claim.
```

Healthy runs file `checked-pass` rows on the disposition ledger next door — the difference between
"the checker ran and agreed" and "no checker was watching" is exactly what that ledger exists for.
