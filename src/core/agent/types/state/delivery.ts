import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import type { ActiveInjection } from '../../../../injection-engine/types.js';
import type { MessagesDelivery } from '../../delivery/types.js';
import type { Receipt } from '../../receipt/receipt.js';

export interface DeliveryState {
  // Injection Engine state ─────────────────────────────────────
  /** Active set output by InjectionEngine subflow each iteration —
   *  POJO projections (no functions) suitable for scope round-trip. */
  activeInjections: readonly ActiveInjection[];
  /** IDs of LLM-activated Skills the LLM has activated this turn
   *  (via the `read_skill` tool). InjectionEngine matches by id. */
  activatedInjectionIds: readonly string[];
  /** Most recent tool result — the LAST entry of `toolResults`. Kept for
   *  every existing reader (context-bisect's proximate-tool key among them);
   *  batch-aware routing reads `toolResults`. */
  lastToolResult?: {
    toolName: string;
    result: string;
    /** The tool's own declared outcome (9.19.0) — envelope tools only. */
    status?: import('../../../../semantics/toolEffects.js').ToolResultStatus;
  };
  // NOTE (9.26.0): the repeated-call nudge deliberately keeps NO key here. Its
  // counters are a within-turn tally, not conversation state, and tracked state
  // is the commit log, the snapshot, the narrative and every recording — a key
  // written on each tool landing would change all of them for every agent that
  // merely upgraded. They live run-keyed beside the dispatch loop instead
  // (`../repeatedCall.ts`), and the repeat itself lands on the record as
  // `agentfootprint.tools.repeated_call`.
  /** EVERY tool result of the current iteration's batch, in call order
   *  (9.16.0) — reset when tool dispatch starts, appended as each result
   *  lands (a pause mid-batch commits the partial batch; resume appends the
   *  answered call). Drives `on-tool-return` triggers and skill-graph routes
   *  so a parallel batch routes on all its calls, not only the last. */
  toolResults?: ReadonlyArray<{
    toolName: string;
    result: string;
    toolCallId: string;
    /** The tool's OWN declared outcome (9.19.0) — present only when the tool
     *  returned a result envelope carrying `status`. `onToolStatus` route
     *  edges key on it. */
    status?: import('../../../../semantics/toolEffects.js').ToolResultStatus;
  }>;
  /**
   * The iteration that DISPATCHED the batch `toolResults` holds — written
   * beside it by ToolCalls when dispatch starts (or, for a batch paused
   * before anything stamped it, when it completes on resume), and ONLY while
   * the results layer is mounted (honesty layer 3): an agent without it
   * commits exactly the keys it always did.
   *
   * It is how the layer at the loop head knows a batch from a re-entry
   * (`honesty/mounts.ts` · `batchToJudge`): ToolCalls advances `iteration`
   * by one and loops straight to the layer, so the batch is new exactly when
   * the loop head's `iteration` is this plus one — each batch judged once per
   * run, never by call id, which a provider may reuse. Per run: a
   * conversation checkpoint (`AgentRunCheckpoint`) never carries it, so a
   * resumed leg starts without one.
   */
  toolResultsIteration?: number;
  /** The `Deliver` stage's record for THIS iteration: which messages-slot
   *  injections entered the window, and which were held back with the
   *  sentence saying why. Overwritten per iteration (the commit log keeps
   *  the sequence). This is the committed answer to "why is my declaration
   *  not on the wire?" — read it from `snapshot.sharedState`. Absent for an
   *  agent that has no messages-slot delivery mounted. */
  messagesDelivery?: MessagesDelivery;
  /** The run's delivery ledger — every `deliveryKey` already let in, so an
   *  always-on injection is delivered ONCE rather than re-appended every
   *  iteration. Unioned with the markers found in the window itself, which
   *  is what keeps a replayed run (`resumeOnError` restores history into a
   *  fresh scope) from delivering the same message twice. */
  deliveredMessageKeys: readonly string[];
  /** Tool schemas resolved by the tools slot subflow each iteration
   *  (registry + injection-supplied). Used by callLLM. */
  dynamicToolSchemas: readonly LLMToolSchema[];
  /**
   * THE RECEIPT (9.88.0) — what the model was handed on this call, as hashes
   * and references, written by `callLLM` immediately before the provider is
   * called and therefore committed in the call-llm bundle. Read it with
   * `receiptAt(snapshot, epoch)`; rebuild the request it fingerprints with
   * `servedAt(snapshot, epoch)`.
   *
   * It changes every call (the epoch is on it), so it commits every iteration
   * rather than being dropped by the net-change filter — which is what makes
   * bubbling it out of `sf-llm-call` in the grouped chart worth doing.
   *
   * Every value on it is a digest, a count or a name the run already
   * published. It carries no message text, no prompt text, no schema bodies
   * and — by its first law — no authority omissions.
   */
  receipt?: Receipt;
  /**
   * The name of the synthetic tool a `'tool-forced'` output strategy puts on
   * every request (9.88.0) — seeded once, from the build-time strategy, on an
   * agent that has one. Absent for every other agent, which is what keeps
   * `seed`'s committed key set unchanged for them.
   *
   * It exists so a rebuild can NAME the forced tool without reading the
   * receipt: the receipt is the thing a rebuild is checked against, and a
   * check that reads its own answer sheet proves nothing. The tool's SCHEMA is
   * still not on the record — see `servedView.ts` · `SERVED_GAPS`.
   */
  forcedOutputToolName?: string;
  /**
   * How the findings ledger is SERVED on this run (9.101.0) — the
   * `AgentOptions.findings.serve` dial, seeded once by `stages/seed.ts` on
   * EVERY run of an agent with `.findings()` (`AgentBuilder.findings`
   * normalises the dial to `'ledger-and-facts'`, so an armed agent whose
   * caller named no mode records the default) and absent for every other
   * agent, which is what keeps `seed`'s committed key set unchanged for them
   * (the `forcedOutputToolName` shape one key up). An armed agent's key set
   * is therefore the unarmed twin's plus this key, plus `findingsLedger`
   * once the model declares something.
   *
   * It exists for the same reason: a rebuild (`servedView.ts` · `viewOf`)
   * collapses judged tool results the way the wire did, and the mode it
   * needs is a build-time constant the receipt it is checking must not be
   * asked for. `'ledger-and-facts'` serves fact, open and undeclared results
   * verbatim; `'ledger-only'` collapses fact results too (bench-gated, never
   * a default).
   */
  findingsServe?: 'ledger-and-facts' | 'ledger-only';
  /** Recorded layout and resolved bound; absent on older records. */
  findingsLayout?: 'late-v1';
  findingsContextBytes?: number;
  /**
   * The answer-turn ask on this run (9.103.0) — present ONLY when
   * `AgentOptions.findings.answerAsk` is `'quote-facts'`, seeded by
   * `stages/seed.ts` beside `findingsServe` under the same arm, and absent
   * for every other agent — including an armed one on the default `'none'`,
   * so the dial's default writes no key and an armed record is the bytes
   * it was before the dial existed (the `forcedOutputToolName` shape:
   * absent means the default). It exists for the same reason as
   * `findingsServe`: the rebuild (`servedView.ts` · `viewOf`) appends
   * `FINDINGS_ANSWER_ASK` to the piece the way the wire did, and the dial
   * is a build-time constant it must read from the RECORD, not from the
   * receipt it is checking.
   */
  findingsAnswerAsk?: 'quote-facts';
  /**
   * The `Tool.wants` declarations by tool name (9.88.0) — seeded once, on an
   * agent whose evidence gate arms the staged-refs nudge. Absent for every
   * other agent.
   *
   * It is the one input to that nudge that was build-time-only. The nudge is a
   * `role: 'user'` line composed for a single request and written to no
   * history; with this key on the record, `servedView.ts` · `servedAt` composes
   * the identical line from committed state — conversation, tools served, and
   * these declarations — instead of declaring the model's own words a gap.
   *
   * A plain record rather than the `Map` the join takes, because an object
   * write to scope is JSON-round-tripped and a `Map` round-trips to `{}`.
   */
  toolWantsByName?: Readonly<Record<string, readonly string[]>>;
  /** Which skill ids the caller's role may NOT see this iteration (9.86.0),
   *  resolved ONCE by the tools slot and published here so every model-facing
   *  composer applies the same filter. Read by the `read_skill` gate before it
   *  names any id — in a refusal or in the `skill.rejected` payload. Absent
   *  for every agent whose `PermissionChecker` does not govern `'skill_read'`
   *  (and for all of them the gate's sets are unfiltered, exactly as before). */
  hiddenSkillIds?: readonly string[];
}
