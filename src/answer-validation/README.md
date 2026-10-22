**Mixed** — a contract for checking the exact answer before delivery.
Map: `types.ts` declares the authored checks, bounds and report vocabulary;
`outputSchema.ts` declares the answer's shape (`.outputSchema()`: the parser
port, its default instruction, and the parse every caller applies).
Walker: `evidence.ts` resolves bounded parcels under the run's existing scope;
`toolLedger.ts` hands the check this run's tool calls as one frozen parcel.
Fold: `validate.ts` derives a verdict from explicit checks and evidence availability;
`agentChecks.ts` turns the agent's own checks' verdicts into rows of that report.

The host supplies the comparisons. This folder supplies no domain rules,
query engine, model judge, artifact store, or repair loop. It reuses the
existing artifact port and schema parser. `core/agent/stages/answerValidation.ts`
owns when validation runs; the final stage owns delivery and memory capture.

The validator receives a detached, frozen JSON value. Its canonical serialized
form is the value considered for delivery, including when a schema transforms
the input. A callback cannot return replacement content. Reports identify that
candidate by digest and record dispositions separately from artifact reads.

Each evidence resolver is scoped to one invocation, checks metadata before a
verifying store read, and closes on completion or cancellation. Missing and
foreign refs remain indistinguishable. Application stores and callbacks are
trusted ports; time and size limits are not a CPU or process-memory sandbox.

Without configuration the agent mounts none of this boundary. With it, both
modes suppress draft tokens and withhold `stream.llm_end.content` with the
`contentWithheld` marker. Enforce refuses failed or unverified reports; observe
permits delivery with the report available for inspection. The Story recorder
uses the delivered canonical content at `agent.turn_end` in either mode. Other
diagnostics can still contain the original model candidate; this does not
replace redaction.

## Which tools ran — `context.toolCalls`

The check also reads this run's tool calls: `name`, `callId` and `outcome`
(`ok` / `error` / `not-run`), never arguments or results. The ledger is tracked
state of the run that owns the check (`AgentState.toolCallLedger`), written beside
every `stream.tool_end` bracket (`src/core/agent/stages/toolCalls.ts` · `emitToolEnd`) and only
on an agent with `answerValidation`, so it cannot hold another run's calls and
no other agent's record changes. It is read at the moment of the check
(`toolLedger.ts` · `ledgerAtCheck`). `complete: false` says the list may
disagree with what the run did: past `limits.maxToolCalls`, an oversized name or
id, a call still open (its `tool_start` with no `tool_end`), a tool that
declared `pending`, a reply whose calls never went out (a cut-off or wrapped-up
turn), a `resumeOnError`
leg, or a resumed checkpoint written before ledgers existed. It fails closed: a
check that reads the list while it is incomplete gets `unverified`
(`tool-calls-incomplete`) whatever it returns, so read it only when the rule
needs it (destructuring it in the parameter list counts as a read). It lists the model's own calls; a
call a tool makes from inside itself is that tool's work.

The rule "the answer presents code, but no code-execution tool ran":

```ts
const presentedCodeWasExecuted: AnswerValidationOptions<{ text: string }> = {
  id: 'presented-code-was-executed',
  version: '1',
  mode: 'enforce',
  validate(answer, context) {
    // The parser already required `text`; this is the check that always runs.
    const checks: AnswerCheck[] = [{ id: 'answer-is-text', disposition: 'checked-pass' }];
    if (!answer.text.includes('```')) {
      // No code shown: nothing to hold, and the tool list is never read — a
      // check that reads an incomplete list is refused as unverified.
      checks.push({ id: 'code-was-executed', disposition: 'not-applicable' });
      return { checks };
    }
    const executed = context.toolCalls.calls.some(
      (call) => call.name === 'run_code' && call.outcome === 'ok',
    );
    checks.push({
      id: 'code-was-executed',
      disposition: executed ? 'checked-pass' : 'checked-fail',
      ...(!executed && { reason: 'code was presented but never executed' }),
    });
    return { checks };
  },
};
```

Runnable: `examples/features/99-guard-presented-code.ts`. Over `streamHandler` +
`agUi()` a refusal sends no `TEXT_MESSAGE_CONTENT` and ends in `RUN_ERROR`
(`test/ag-ui/answer-validation-guard.test.ts`).

## The agent's own checks — `agentChecks`

**Why.** `.claims()` and `.namesAndNumbersFromEvidence()` only record: a
contradicted typed field or an invented value files a finding, and the answer
is delivered. `agentChecks: ['claims', 'names-and-numbers']` makes each of
their verdicts a ROW of this report, so `enforce` withholds the answer and the
existing delivery boundary (draft suppression, the final guard,
`AnswerValidationError`) does the rest. No new blocking verb: refusing stays
with this door and with `rails` (`docs/design/honesty/README.md` § 8).

`agentChecks.ts` owns the mapping, and only the mapping:

- `claimChecksOf` judges the CANONICAL candidate this validation delivers, so a
  transforming schema is judged as delivered. It asks the claim seam's own
  `integrity/unsupported-claim/check.ts` · `compareClaim`, the selection and
  evaluation the detector uses, so the two cannot compare differently (a
  matrix property in `test/answer-validation/agentChecks.test.ts` pins it).
  Conflict → `checked-fail`; agreement → `checked-pass`; no settled fact, or one
  settled unknown → `unreachable` (an unsupported claim is withheld, fail
  closed); omitted or declined (`null`, `'unknown'`, an unknown `Claim`) where
  the run settled a value → `not-applicable` (both `null` is agreement). The
  detector's legacy ledger maps doubt to `checked-pass`; the row does not.
- `evidenceCheckOf` reads the gate's verdict on the SAME delivered candidate:
  the gate is handed over as an `EvidenceJudge` bound to the evidence the run
  read (`core/agent/stages/answerEvidence.ts`, a per-scope `WeakMap`, never
  state, read only when that Route stage answers `'final'`), and asked of the
  canonical JSON. Never the verdict on the model's draft: an output schema can
  transform the draft (1200 read, 9750 delivered).
  No verdict (the gate never judged it) → `unreachable`. A clean pass →
  `not-applicable`: a membership pass never supports (the standing fold's
  law), so the gate can withhold an answer and never make a report pass.

Rows never carry a value from the answer or a tool result — counts and the
field names the app declared only, never the contract's `entity` (which an app
may build per user) — because `answerValidation` is not a name the redaction
vocabulary keeps out. `validate.ts` runs the row builder on the same
frozen candidate as the callback, before it; a throw, or a listed check with
no builder, is `agent-check-error` (unverified). Host check ids starting
`agent:` are refused while rows are on (refuse-by-domain: the two id sets
cannot collide). `core/agent/AgentBuilder.ts` · `build` refuses a listed check
whose builder call is missing.

## Claim prerequisites — `checkClaimRequirements`

This pure helper checks a host-authored, nonempty list of requirement references
for one exact claim, finding and window. It uses Foottrace's public structural
reader and returns an `AnswerCheck` plus matched `RequirementResult.id` selectors.
Those selectors are not artifact references: they never populate `evidenceRefs`
because this helper performs no artifact read.

Every expected obligation must have an exact satisfied binding. Any unresolved
report in that same finding/window affecting the claim blocks it, including an
extra obligation or another report for an already satisfied requirement. Other
claims and historical windows cannot satisfy this binding. Missing obligations
return `unreachable/not-collected`; an otherwise matching obligation available
only in a foreign finding/window returns `unreachable/incompatible`. Malformed
receipt sets return `unreachable/invalid-data`. Matching selectors are sorted;
if several reports are unresolved, the first by result ID supplies the reason.
Malformed host policies throw a fixed error with code
`ERR_CLAIM_REQUIREMENT_POLICY`. Policies are closed own-data JSON objects bounded
to 16 KiB, 16 distinct requirement references, 512 characters per opaque
reference, and 128 for `claimRef` so the check fits answer validation's ID limit.

`checked-pass` means only that the supplied producer reports meet these
prerequisites. The caller must authenticate their producer, query/run/scope,
authorized receipt access, time validity and domain meaning, including whether a
producer's nested checks justify its stated result. Neither structural admission
nor this helper authenticates a producer or checks a measured value. Executable
actions and permission to disclose remain host decisions.

In `.answerValidation()`, return this check only when the candidate asserts the
corresponding fact. A host may check an explicit unknown attribution as
`not-applicable` while independently checking its measured latency. An asserted
attribution with missing mapping is unreachable and enforce mode withholds that
candidate; it does not project or rewrite it. A safe candidate with a verified
latency and explicit unknown attribution can still pass. Use the existing output
middleware before validation if the host needs to render its own bounded values.
This helper mounts no agent stage, changes no existing mode, performs no IO and
does not compare values or inspect prose.
