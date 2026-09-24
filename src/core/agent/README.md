**Mixed** — the Agent's chart builders sitting beside the composers and folds
the walk calls from inside its stages.
Map: `buildAgentChart.ts`, `buildDynamicAgentChart.ts`,
`buildAgentMessageApiChart.ts`, `buildMessageApiChart.ts`, `buildCacheSubflow.ts`,
`buildToolRegistry.ts`, `AgentBuilder.ts`, `skillGraphDeclared.ts`,
`skillBrains.ts`, `types.ts`.
Walker: `toolDispatch.ts`, `toolEffects.ts`, `toolArgsValidation.ts`,
`validators.ts`, `act.ts`, `moments.ts`.
Trace: `runManifest.ts`, `integrityFindings.ts`, `watch.ts`.
Fold: `memoryRecallInjections.ts`, `toolsFromActiveSkill.ts`.
Lens: `selfCallNotice.ts`, `stagedRefs.ts` · `stagedRefsNudgeLine`,
`presentTool.ts`, `outputEnforcement.ts` · `buildCorrectiveTurn`,
`repeatedCall.ts` · `noteFor`, `resultCeiling.ts` · `applyResultCeiling`,
`toolResultCap.ts`.

## What it reads / what it writes
- The chart builders own the outputMappers that publish the loop's shared facts:
  `activeInjections`, `currentSkillId`, `stepPointer`, `dynamicToolSchemas`
  (`buildAgentChart.ts` · `SUBFLOW_IDS.INJECTION_ENGINE` and
  `buildAgentChart.ts` · `SUBFLOW_IDS.TOOLS`, on their `outputMapper`s).
- The Lens files read only what they are handed, plus `scope.hiddenSkillIds`
  (owner: `../slots/buildToolsSlot.ts` · `discoverStage`) where they name skill ids.

The Route decider also writes `answerGuarantee` on the turn it picks `final`
(9.100.0): `'tool-forced'` when the provider was forced by name through the
output schema's synthetic tool, `'checked'` when the schema parsed a
generated answer, `'none'` when there is no schema — how the answer's shape
was secured, beside `answerValidation`, which is about its content.

## The one law here
A builder declares; it must not decide. Anything that has to be true AT a
moment is composed in `stages/`, where the moment is.

## Every library-composed correction is past-anchored and names no destination (9.113.0)

**A sentence the library composes to correct the model's course — a refusal,
a denial, a settlement, a nudge — states past facts about one finished event,
names that event, and never names where to go next.**

**Why.** A correction lands on a `role: 'tool'` result or an injected turn, so
it is not read once: it is composed on one call and re-read on every call after
it for the rest of the turn, the tool-less wrap-up included. A present-tense or
forward-looking clause is "a prediction that outlives its own evidence" — the
canon's second Lens law (`docs/design/map-walker-trace-fold-lens.md` · "The two
Lens laws, as they apply here"). A named destination — "call X first", "propose
it again", "read skill Y" — is an order: a later call's wire, budget or posture
can refuse it, and the model obeys it anyway. `selfCallNotice.ts` ·
`selfCallNotice` is the worked example: every clause is past tense about "that
call", and it names no skill to go to. The present tense has its own owners,
recomposed for every request — the tool list and the `read_skill` description
— so the two cannot disagree.

**How.** Three checks, each one a reader can make:
1. every clause is past tense about one finished event;
2. that event is NAMED — "that call", bound by the opening clause, or "call
   'c2' to 'collect_input'" — never pointed at ("this call", "the call you just
   made", "now");
3. no clause names a destination: no tool to call, no skill to read, no call to
   propose again. Reporting what a finished call held is a past fact, not a
   destination — `stages/toolCalls.ts` · `unknownToolResult` lists the names
   that resolved on that call and directs nothing.

A new correction is registered as a row in `test/modelFacingSurfaces.test.ts`
(`stages/README.md` · "Every model-facing sentence this stage composes is
REGISTERED"): the row composes its REAL output and the checker
(`test/helpers/modelFacingClaims.ts`) reads it at the persistent lifetime. The
checker is a partial net, not a proof: its `BANNED_CLAUSES` catch some
present-tense and pointing shapes (checks 1 and 2) — "is not executed" passes
it — and check 3 is a reader's. So the row's `reaches` markers pin the anchor,
and a sentence's exact wording is pinned in its own scenario suite
(`test/core/scenario/batch-pause-settlement.test.ts` pins the example below
word for word). Older sentences are not all registered; the ones the scan
catches that break the law are named in `test/modelFacingScan.test.ts` ·
`LEDGER` as `unrepaired` — a work list, not a pardon. Two more are known and
sit in neither list: the `askPolicy: 'refuse'` denial in
`middleware/runChain.ts` · `runToolChain` ("there is no pause here to carry
that ask" — present tense), and the author's note closing the 9.86.1
resumed-call refusal in `stages/toolCalls.ts` ("Keep one gate for this tool:
…" — a destination). Neither is reworded yet: that changes the bytes of every
run that meets them.

```typescript
// stages/toolCalls.ts · notDispatchedResult — the batch settlement (9.113.0)
notDispatchedResult('fetch_invoices', { toolName: 'collect_input', toolCallId: 'c2' });
// "Tool 'fetch_invoices' was not executed on that call: the run paused on call
//  'c2' to 'collect_input', earlier in the same batch, and resumed without
//  executing the calls that followed it in that batch."
//
// "The run paused ON call 'c2'", not "call 'c2' paused the run": on the
// middleware-ask and credential-consent doors a gate paused the run at that
// call, not the call itself.
//
// Not the design draft's tail — "…the batch paused before it; propose it again
// if still needed". "Propose it again" is an order about a later call, and
// whether the call is still needed is the model's to judge from the facts.
```

## Files
See the role lists above; `types.ts` holds both the public agent types and the
internal ones the stages share.
