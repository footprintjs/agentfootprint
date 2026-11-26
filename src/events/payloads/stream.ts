import type {
  LLMMessage,
  LLMProviderName,
  ToolCallEventIdentity,
  ToolProtocol,
  ToolResultStatus,
} from './dependencyTypes.js';

// stream.* (5)
export interface LLMStartPayload {
  readonly iteration: number;
  readonly provider: LLMProviderName;
  readonly model: string;
  readonly systemPromptChars: number;
  /**
   * The ASSEMBLED system prompt, verbatim as sent to the provider (9.50.0) —
   * every injection piece joined exactly the way the wire saw it. **OPT-IN,
   * default OFF**: present only when the run was built with
   * `recordSystemPrompt: true` (`AgentOptions` / `LLMCallOptions`).
   *
   * PRIVACY: the assembled prompt routinely carries what its pieces carry —
   * skill bodies, RAG passages, memory recalls, per-user instructions. With
   * the dial on, all of it lands in every event sink and every recording
   * (`recordRun` → `persistRecording`), so treat those artifacts as being as
   * sensitive as the prompt itself. Absent, the event keeps its exact prior
   * bytes: only `systemPromptChars` (the length) is recorded, and the
   * assembled string is honestly NOT in the recording.
   */
  readonly systemPromptText?: string;
  readonly messagesCount: number;
  readonly toolsCount: number;
  /**
   * The tool CATALOG the model saw for this call — what was at its disposal when
   * it chose (the menu behind its tool-selection reasoning). One `{ name,
   * description }` per tool sent to the provider, in request order. Absent when
   * the call had no tools. The structured "what the model saw" payload: pair it
   * with the iteration's reasoning to debug WHY a tool was (or wasn't) picked.
   * Names + descriptions only — full input schemas live in the snapshot.
   */
  readonly tools?: readonly { readonly name: string; readonly description?: string }[];
  readonly estimatedPromptTokens?: number;
  readonly temperature?: number;
  readonly providerRequestRef?: string;
  /**
   * WHICH BRAIN answered, when a brain rung won (9.19.0 — "the cursor picks
   * the brain"). `via: 'skill'` = the active skill's declared brain served
   * this call (`skillId` names the tenure); `via: 'escalation'` = the turn
   * crossed its declared refusal threshold and the escalation brain is
   * serving the rest of it. ABSENT whenever the agent's own configured /
   * default model answered — an agent without brains keeps its exact prior
   * event bytes. `provider` + `model` above always report what was actually
   * called, whichever rung supplied them.
   */
  readonly brain?: {
    readonly via: 'skill' | 'escalation';
    readonly skillId?: string;
  };
  /**
   * On a model whose thinking is bound to its context, or whose binding the
   * provider cannot tell (`thinkingBinding` answers `bound` or `unknown`): what
   * this request changes under the newest signed reasoning on its wire, by
   * name, when that reasoning was written by a model of the same family.
   * `refused: true` means the call stops here with `ContextChangedError`
   * (bound models only). A row with `check: 'unchecked'` appears ONCE per
   * signed response this run did not record (a continued or restored
   * conversation): nothing could be compared for it.
   * ABSENT otherwise: when nothing changed, when no such reasoning is on the
   * wire, and on every unbound model — those runs keep their exact prior bytes.
   */
  readonly contextChange?: import('./contextChange.js').ContextChangeCheck;
  /**
   * Which way the agent's skills reach the model, and why — on the run's
   * first request only: the tool strategy (`listed` / `declared`) and the body
   * channel, each in the shared decision-record shape, and the binding fact
   * that decided them. ABSENT when the agent has no skill and when the rule
   * table's default chose `declared` (every model that does not bind its
   * reasoning), so those runs keep their exact prior bytes.
   */
  readonly skillContext?: import('./skillContext.js').SkillContextRecord;
}

export interface LLMEndPayload {
  readonly iteration: number;
  /** Draft text, or an empty string when contentWithheld is true. */
  readonly content: string;
  /** An output policy withheld draft text. This does not mean the model returned no text. */
  readonly contentWithheld?: true;
  readonly toolCallCount: number;
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    /**
     * 9.29.0 — reasoning tokens the model spent on this call, when the
     * provider reports them (`LLMResponse.usage.thinking`).
     *
     * This field is the fix for a gap a field trial found by walking into it:
     * a 256-token Gemini stream produced ONE visible chunk, and the run only
     * made sense once the numbers were read — `input 21, output 9,
     * thinking 243`. The provider had been reporting that third number all
     * along and this payload's type dropped it, so the event that a consumer
     * actually subscribes to could not explain its own run.
     *
     * **Not inside `output`.** On Gemini `candidatesTokenCount` counts visible
     * tokens only; thinking is a separate, billed line item. A cost estimate
     * built from `input + output` under-counts a thinking model by whatever it
     * thought. `cost.tick` deliberately does NOT fold it in — `PricingTable`
     * prices four kinds and thinking is not one of them, and inventing a rate
     * would be this library guessing at somebody's invoice.
     *
     * Undefined when the provider does not report thinking tokens, which is
     * most calls.
     */
    readonly thinking?: number;
  };
  readonly stopReason: string;
  readonly durationMs: number;
  readonly providerResponseRef?: string;
}

export interface LLMTokenPayload {
  readonly iteration: number;
  readonly tokenIndex: number;
  readonly content: string;
}

export interface ToolStartPayload
  extends Pick<ToolCallEventIdentity, 'toolCallId' | 'callOccurrenceKey'> {
  readonly toolName: string;
  /**
   * The arguments as the model proposed them — the REAL values, also for a
   * tool whose argument view hides some ({@link shownArgs}). Only the run's
   * redaction policy masks them here.
   */
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * The approval-safe display of the proposal for AG-UI `TOOL_CALL_ARGS`.
   * An unsupported view, or a proposal that can be rewritten before
   * admission, displays placeholders for every available argument name.
   * A valid view that withholds nothing omits this field.
   */
  readonly shownArgs?: Readonly<Record<string, unknown>>;
  /** Names withheld from the proposal's display, in argument order. A check-in
   * records the names withheld from the bound call it actually shows. */
  readonly hiddenArgs?: readonly string[];
  readonly parallelCount?: number;
  readonly protocol?: ToolProtocol;
  /**
   * 9.113.0 — present only on the bracket of a call that was NEVER
   * DISPATCHED: a batch paused on an earlier call, and the resume answered
   * this one with a fixed sentence instead of running it
   * (`core/agent/stages/toolCalls/batch/settlementOperations.ts` · `bracketSettled`, the one stamping
   * site). `pausedCall` names the call in the same batch the run paused on.
   * No gate judged this call and no tool ran; `args` are the ones it would
   * have run with.
   *
   * The same fact, the same shape, as the history message's marker — typed off
   * `LLMMessage.notDispatched`, so there is one definition. Read it rather than
   * inferring anything from the bracket's `durationMs: 0` or its sentence.
   *
   * Absent on every other bracket.
   */
  readonly notDispatched?: LLMMessage['notDispatched'];
}

/**
 * One progress report from inside a still-running tool call (9.52.0) — filed
 * by `ctx.progress(payload)` from within `tool.execute`, in call order, always
 * BETWEEN this call's `stream.tool_start` and its `stream.tool_end`.
 *
 * The split is deliberate: the identity fields are stamped by the
 * FRAMEWORK from the dispatch it is already holding (a tool cannot claim to be
 * another call, another tool, or another iteration), and `payload` is the tool
 * author's data forwarded verbatim. Nothing here is ever shown to the model —
 * this is the telemetry channel, not the result channel.
 *
 * Absent entirely for every tool that never reports: a run whose tools call
 * nothing files no `tool_progress` events at all.
 */
export interface ToolProgressPayload extends Pick<ToolCallEventIdentity, 'callOccurrenceKey'> {
  /** The invocation this report belongs to — matches `stream.tool_start.toolCallId`. */
  readonly toolCallId: string;
  /** The tool that reported. */
  readonly toolName: string;
  /** The ReAct iteration this call was dispatched on (`0` where there is no loop). */
  readonly iteration: number;
  /**
   * The tool author's payload, verbatim — whatever shape they chose
   * (`{ done: 3, total: 12 }`, a status string, a partial row). The library
   * neither reads it nor normalizes it; it must survive `structuredClone`,
   * because it lands in every event sink and every recording.
   */
  readonly payload: unknown;
}

export interface ToolEndPayload
  extends Pick<ToolCallEventIdentity, 'toolCallId' | 'callOccurrenceKey'> {
  readonly result: unknown;
  readonly error?: boolean;
  readonly durationMs: number;
  /**
   * Whether the tool's own function (`execute`) was entered — written from
   * the dispatch's own fact by the door every bracket of the Agent's tool-call
   * stages passes (`core/agent/stages/toolCalls/observation/
   * observationsOperations.ts` · `emitToolEnd`), read by
   * `semantics/toolRan.ts` · `toolRanOf`. The demo chart
   * `buildAgentMessageApiChart` emits its own brackets without it: it runs
   * no tool function, so its brackets prove nothing about a tool.
   *
   * WHY: `error: true` alone is the same bytes for a tool that ran and threw
   * and for a call that never reached its tool (an unknown tool name,
   * arguments the schema rejected, a `wants` or credential block), so a
   * reader could not tell "it ran and failed" from "it never ran".
   *
   * What it proves, on a record written by this version:
   * - `false`: the function was never entered. On every bracket of such a
   *   call, with or without `error` — except one that already says so with
   *   `notExecuted` (a rule refused it) or `notDispatched` (a paused batch
   *   settled it), which keeps the bytes it had.
   * - `true`: the function was entered, whether it returned or threw.
   *
   * A bracket with no `entered`, `notExecuted` or `notDispatched` does not
   * say whether the tool ran. Recordings made before this field existed
   * have no entry stamp. A saved `entered` value that is not a boolean (a
   * hand-edited record, a placeholder) also leaves entry unrecorded.
   *
   * @example { toolCallId: 'c1', result: "Unknown tool 'reboot_host'…", durationMs: 0, error: true, entered: false }
   */
  readonly entered?: boolean;
  /**
   * The tool's OWN declared outcome (9.19.0) — present only when the tool
   * returned a result envelope carrying `status`. Normalized vocabulary
   * (`'denied'` must never read like `'success'`); route edges key on it
   * via `onToolStatus`. Absent for every tool that never opted in.
   */
  readonly status?: ToolResultStatus;
  /**
   * 9.113.0 — present only when this call was NEVER DISPATCHED: the batch
   * settlement closed its bracket (`core/agent/stages/toolCalls/batch/settlementOperations.ts` ·
   * `bracketSettled`). `result` is then the library's fixed sentence (the one
   * the model read), `durationMs` is `0`, and `error` is ABSENT.
   *
   * `error` says a call FAILED — the tool threw or reported a failure, or the
   * call could not run as written (an args-validation rejection, a `wants`
   * block, a consent the tool needed and did not get, an unknown tool). A
   * settled call did not fail: the library decided not to dispatch it, the
   * way it decides for a call a permission policy denies or halts, whose
   * brackets carry no `error` either. This field is the owner of WHY there is
   * no result, and a reader that counts outcomes reads it: a bracket that
   * carries it is neither a success nor a failure of the tool.
   *
   * Same shape as `ToolStartPayload.notDispatched` and as the history
   * message's marker (typed off `LLMMessage.notDispatched`). Absent on every
   * other bracket.
   */
  readonly notDispatched?: LLMMessage['notDispatched'];
  /**
   * What the MODEL read for this call, when it differs from `result`: an
   * `onToolResult` link rewrote or denied it, the `maxToolResultChars` cap
   * cut the model's channel alone, or the library removed the record-only
   * coverage fields (`short`, `kind` — see `CoverageItem`) from a coverage
   * envelope before serving it. `result` stays the tool's own answer — this
   * is the other half of that split, which until now lived only in history.
   * Absent when the model read `result` itself (the common case; the two
   * channels are then one reference). Stamped on all five dispatch paths.
   *
   * Cost, stated: a call whose tool declares `short` or `kind` carries its
   * envelope twice here (`result` + `modelResult`), so the extra bytes are
   * the size of that envelope — about 4 KB for a typical absence, and as
   * large as the payload a ledger wraps. Under result PLACEMENT a difference
   * that is only this strip counts as one value: both channels carry the one
   * ticket and nothing is stamped. A tool that declares neither gets no stamp
   * and no new byte.
   */
  readonly modelResult?: unknown;
  /**
   * The NAMES of the argument keys whose value the tool ran with differs from
   * the proposal `stream.tool_start` carried: set, rewritten or removed by an
   * `onToolCall` link, or hidden by the tool's own redaction policy
   * (`flowchartAsTool({ redact })`, `runbookAsTool({ redact })` —
   * `core/toolShownArgs.ts` · `shownArgsOf`). Names only, never values: a
   * link may ADD a value (a server-side key) the model never saw, and an event
   * goes to every sink attached, each serializing what it gets. Taken BEFORE
   * the tool runs, and judged once more after it returns only when the time
   * layer redrew a look-back at dispatch — on the record's copy, a fresh
   * object the tool is never handed — so nothing the tool writes into its
   * arguments reaches it.
   * A reader exporting the call's arguments shows these keys' values as
   * withheld. Absent when the tool ran with the proposal as it was.
   *
   * Stamped on the batch-dispatch bracket only — the one whose `tool_start`
   * precedes it in the same run.
   */
  readonly changedArgKeys?: readonly string[];
  /**
   * A configured RULE refused the call, so the tool never ran: a permission
   * policy denied or halted it, or an `onToolCall` link denied it. `result` is
   * then the refusal the model read, and `error` is absent — this field is
   * what tells such a bracket from a tool that ran and answered.
   *
   * NOT a general "never ran" marker, and its absence proves nothing: a call
   * that could not run with no rule involved (an unknown tool name, an args
   * rejection, a `wants` or credential block) carries `error: true` and
   * `entered: false` instead, a settled bracket carries `notDispatched`, and
   * a resumed leg's bracket of a call that did not run (a person declined,
   * a credential was blocked) carries `entered: false`. The general answer is
   * `entered`, read through `semantics/toolRan.ts` · `toolRanOf`.
   * Batch-dispatch bracket only.
   */
  readonly notExecuted?: true;
}
