**Mixed** — a contract for checking the exact answer before delivery.
Map: `types.ts` declares the authored checks, bounds and report vocabulary;
`outputSchema.ts` declares the answer's shape (`.outputSchema()`: the parser
port, its default instruction, and the parse every caller applies).
Walker: `evidence.ts` resolves bounded parcels under the run's existing scope;
`toolLedger.ts` hands the check this run's tool calls as one frozen parcel.
Fold: `validate.ts` derives a verdict from explicit checks and evidence availability.

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
modes suppress draft tokens. Enforce refuses failed or unverified reports;
observe permits delivery with the report available for inspection. Diagnostics
can still contain the original model candidate; this does not replace redaction.

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
