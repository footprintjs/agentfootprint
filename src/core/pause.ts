/**
 * pause — runner-level pause/resume primitives.
 *
 * Pattern: Control-flow exception (PauseRequest) + typed outcome (RunnerPauseOutcome).
 * Role:    core/ layer. Bridges footprintjs.s pause signal into the agentfootprint
 *          Runner contract: tools call `pauseHere(data)` to raise a pause
 *          intent; runners detect the paused executor result and return a
 *          `RunnerPauseOutcome` instead of `TOut`. Consumers call
 *          `runner.resume(checkpoint, input)` to continue.
 * Emits:   N/A (types + helpers only). Event emission happens in RunnerBase.
 *
 * Why a control-flow "throw": tool.execute(args, ctx) doesn't receive the
 * typed scope, so it cannot call `scope.$pause()` directly. A thrown
 * `PauseRequest` is caught inside the Agent's tool-call stage, which then
 * forwards the pause into the flowchart via `scope.$pause()`. This keeps
 * the tool API clean (tools are pure-ish) while still supporting pause.
 */

import { readAskComponent } from '../tools/askComponent.js';
import type { FlowchartCheckpoint } from 'footprintjs';
import type { AskComponent } from '../tools/askComponent.js';
import type { CheckInRequest } from './checkin.js';
import { InputRequestError, validateInputDeclaration } from '../tools/inputRequest.js';
import type { AwaitingInput, InputRequestDeclaration } from '../tools/inputRequest.js';

/**
 * Outcome returned by `runner.run()` / `runner.resume()` when execution
 * has paused mid-flow. The shape mirrors footprintjs's `PausedResult` but
 * surfaces `pauseData` as a first-class field for consumers who don't
 * want to reach into the checkpoint.
 */
export interface RunnerPauseOutcome {
  readonly paused: true;
  /** Serializable checkpoint — store anywhere (Redis, Postgres, localStorage). */
  readonly checkpoint: FlowchartCheckpoint;
  /** Data passed to `scope.$pause()` / `pauseHere()`. Consumer-typed. */
  readonly pauseData: unknown;
  /** Typed data collection; answers are values, never approval decisions. */
  readonly awaitingInput?: AwaitingInput;
  /**
   * Present ONLY when this pause is an evidence-carrying check-in (a tool
   * declared `checkIn`). Carries the typed ask + evidence pack. Absent for
   * plain `askHuman` / `pauseHere` pauses — that's the clean discriminant
   * between the two pause kinds. Resume with a `CheckInDecision` built from
   * it (`checkInApproved({ request: outcome.checkIn, by })` /
   * `checkInDeclined(...)`) — `checkIn.id` names the request it answers.
   */
  readonly checkIn?: CheckInRequest;
  /**
   * Present ONLY when a `toolMiddleware` answered `ask` — the question it put
   * to a person, plus the middleware that asked. Absent for every other pause,
   * which is the discriminant.
   *
   * Resume with a `CheckInDecision` built from it
   * (`checkInApproved({ request: outcome.ask, by })` / `checkInDeclined(...)`).
   * That is deliberate rather than a second decision type: a person approving
   * is a person approving, whether the gate was a tool's `checkIn` or a
   * middleware's `ask`, and one word for one thing beats a synonym.
   *
   * The answer is a DECISION, not a result. Approve and the chain resumes from
   * the next middleware and the REAL tool runs; decline and the model receives
   * a denial it can adapt to. Nobody — not the middleware, not the person —
   * gets to write the tool's answer.
   */
  readonly ask?: MiddlewareAsk;
}

/** The question a `toolMiddleware` put to a person, as it rides the checkpoint. */
export interface MiddlewareAsk {
  /**
   * Names this request: the id a decision quotes
   * (`checkInApproved({ request: outcome.ask, by })`). Minted when the run
   * paused, unique to this pause, and bound to the exact call that runs on
   * approval — see `core/consentRequest.ts`.
   */
  readonly id: string;
  /** The question, in the middleware author's own words. */
  readonly question: string;
  /** Anything else the answering UI should render. Never interpreted here. */
  readonly detail?: unknown;
  /**
   * Which REGISTERED screen component collects the answer (9.24.0) — the
   * typed half of the question, carried from `ask({ question, component })`.
   * Absent means what it always meant: render the prose. The answer comes
   * back through the same `CheckInDecision` either way.
   */
  readonly component?: AskComponent;
  /** `name` of the middleware that asked. */
  readonly middleware: string;
}

/** Type guard — discriminates `RunnerPauseOutcome` from a normal `TOut`. */
export function isPaused<T>(result: T | RunnerPauseOutcome): result is RunnerPauseOutcome {
  return (
    typeof result === 'object' && result !== null && (result as RunnerPauseOutcome).paused === true
  );
}

/** A missing-input pause, distinct from every consent gate. */
export function isInputPause(
  result: unknown,
): result is RunnerPauseOutcome & { readonly awaitingInput: AwaitingInput } {
  return isPaused(result) && result.awaitingInput !== undefined;
}

/**
 * Collect declared fields using a dedicated tool. The query itself runs afterwards.
 *
 * When a lookup does raise about its own miss (the dedicated collection tool
 * stays the documented shape), it still declares what it looked at
 * (9.114.0): pass the envelope `absent()` returns as `absence`. The dispatch
 * door files it at the raise — the rows a returned `absent(…)` files — and it
 * never rides `awaitingInput`. A value the absence recognizer cannot read
 * throws `InputRequestError` here (`absence: null` is the field omitted); an
 * envelope it reads whose lists cannot be copied (a hand-built
 * `checked: [null]`) errors the call at the door instead of pausing, as the
 * same value returned would.
 */
export function requestInput(declaration: InputRequestDeclaration): never {
  const inputRequest = validateInputDeclaration(declaration);
  if (
    !inputRequest.fields.some(
      (field) =>
        field.required !== false &&
        !Object.prototype.hasOwnProperty.call(inputRequest.supplied ?? {}, field.id),
    )
  ) {
    throw new InputRequestError(
      'no required fields are missing; continue without requesting input',
    );
  }
  return pauseHere({ question: inputRequest.question, inputRequest });
}

/**
 * Type guard — is this a check-in pause (evidence-carrying human consent),
 * as opposed to a plain `askHuman` pause? Narrows `checkIn` to present.
 *
 * @example
 *   const out = await agent.run({ message });
 *   if (isCheckInPause(out)) {
 *     showToHuman(out.checkIn.evidence);       // the receipts
 *     const decision = checkInApproved({ request: out.checkIn, by: 'alice' });
 *     await agent.resume(out.checkpoint, decision);
 *   }
 */
export function isCheckInPause(
  result: unknown,
): result is RunnerPauseOutcome & { readonly checkIn: CheckInRequest } {
  return isPaused(result) && (result as RunnerPauseOutcome).checkIn !== undefined;
}

/**
 * Type guard — is this a middleware-ask pause (a `toolMiddleware` answered
 * `ask`), as opposed to a check-in or a plain `askHuman` pause? Narrows `ask`
 * to present.
 *
 * @example
 *   const out = await agent.run({ message });
 *   if (isAskPause(out)) {
 *     const yes = await showToHuman(out.ask.question);      // asked by out.ask.middleware
 *     await agent.resume(out.checkpoint, yes
 *       ? checkInApproved({ request: out.ask, by: 'alice' })
 *       : checkInDeclined({ request: out.ask, by: 'alice', note: 'not this one' }));
 *   }
 */
export function isAskPause(
  result: unknown,
): result is RunnerPauseOutcome & { readonly ask: MiddlewareAsk } {
  return isPaused(result) && (result as RunnerPauseOutcome).ask !== undefined;
}

// ─── Which pauses demand a decision (8.13.0) ───────────────────────────

/**
 * The two pause kinds whose answer is a DECISION rather than a value.
 *
 * A **`'checkIn'`** pause is the tool's own consent demand, and its identity is
 * the evidence pack. A **`'ask'`** pause is a `toolMiddleware`'s own question.
 * Both are answered with `checkInApproved()` / `checkInDeclined()`, built from
 * the paused request so the decision names it (`ResumeDecisionError`).
 *
 * Everything else — `pauseHere()` / `askHuman()`, and the 3LO credential-consent
 * pause — is NOT a consent gate in this sense: there the human's answer either
 * IS the tool's result or is ignored entirely, and any value is accepted.
 */
export type ConsentGateKind = 'checkIn' | 'ask';

/** What {@link pauseDemandsDecision} reports about a pause that is a consent gate. */
export interface ConsentGate {
  readonly kind: ConsentGateKind;
  /** The tool the gate is about, when the pause payload named one. */
  readonly toolName?: string;
  /** `'ask'` only — the `name` of the middleware that asked. */
  readonly middleware?: string;
}

/**
 * Read a pause payload and say whether answering it requires a
 * `CheckInDecision` — and if so, which gate is outstanding.
 *
 * THE ONE reader of that shape. `RunnerBase.detectPause` builds
 * `outcome.checkIn` / `outcome.ask` from this, and `Agent.resume` refuses a
 * mis-shaped answer from this, so the surface a consumer is told about and the
 * surface the library enforces cannot drift apart.
 *
 * Keyed on the PAUSE, never on the input: a plain `askHuman` answer is a string
 * and must stay one, so "is this the right answer?" can only be decided by
 * knowing what was asked.
 *
 * @returns the gate, or `undefined` when this pause takes any value.
 */
/**
 * Refuse an answer chosen against different bytes than the question was asked
 * against. See {@link StaleDecisionError}.
 *
 * Silent in every case but one, deliberately: the ask has to have pinned a ref
 * AND the answer has to name one. Either side absent means nobody claimed the
 * two were about the same artifact, and inventing that claim here would refuse
 * answers that are perfectly good.
 */
export function assertDecisionIsNotStale(pauseData: unknown, input: unknown): void {
  const asked = readAskComponent(pauseData)?.propsRef;
  if (asked === undefined) return;
  const answered = (input as { value?: { from?: string } } | null | undefined)?.value?.from;
  if (answered === undefined || answered === asked) return;
  throw new StaleDecisionError(asked, answered);
}

export function pauseDemandsDecision(pauseData: unknown): ConsentGate | undefined {
  if (typeof pauseData !== 'object' || pauseData === null) return undefined;
  const bag = pauseData as {
    checkIn?: unknown;
    ask?: unknown;
    toolName?: unknown;
  };
  const toolName = typeof bag.toolName === 'string' ? bag.toolName : undefined;
  if (typeof bag.checkIn === 'object' && bag.checkIn !== null) {
    return { kind: 'checkIn', ...(toolName !== undefined && { toolName }) };
  }
  if (typeof bag.ask === 'object' && bag.ask !== null) {
    const middleware = (bag.ask as { middleware?: unknown }).middleware;
    return {
      kind: 'ask',
      ...(toolName !== undefined && { toolName }),
      ...(typeof middleware === 'string' && { middleware }),
    };
  }
  return undefined;
}

/**
 * Raised by `agent.resume()` when a run paused on a CONSENT GATE and the resume
 * input is not a `CheckInDecision`.
 *
 * Before 8.13.0 that resume silently DECLINED, attributed to `by: 'unknown'` —
 * a `checkin.decision` record naming a person who was never asked. A governance
 * layer that invents a decision is worse than one that drops it: the run reads
 * as consented-and-refused when nobody consented to anything.
 *
 * **Nothing was executed and the checkpoint is unchanged** — this refuses at the
 * API boundary, before the engine is handed the checkpoint. Answer the gate and
 * resume the same checkpoint again.
 *
 * A plain `askHuman()` / `pauseHere()` pause never raises this: there the
 * human's answer IS the tool's result, so any value is accepted. The 3LO
 * credential-consent pause never raises it either — it re-asks the provider and
 * ignores the input by design.
 */
/**
 * The person answered about something the ask was not about.
 *
 * A typed ask can pin the data the answer is to be chosen FROM — the
 * `propsRef` on its {@link AskComponent}, a 200-row picker's options living in
 * the artifact store rather than in every stored session envelope. A
 * {@link DecisionValue} can say which artifact the choice was made AGAINST.
 * When both are present and they disagree, the answer is about different bytes
 * than the question.
 *
 * That happens for an ordinary reason: time passes between asking and
 * answering. A refresh lands, a filter moves, rows re-sort, the ask is re-raised
 * with new options — and "the third row" now names something else. Accepting it
 * would resume the run with a value the person never chose, and there is no
 * later signal that anything went wrong: the id is well-formed, the type checks,
 * the loop continues.
 *
 * So it refuses, and the refusal is the feature. A person asked again is mildly
 * annoyed; a person whose gesture was silently reinterpreted has been
 * misrepresented, and in a consent record that is the one failure nothing
 * downstream can recover from.
 *
 * Only ever raised when the ask pinned a ref AND the answer named one. An
 * approve/decline, a plain `askHuman` value, or an answer that names no
 * artifact are all byte-identical to every earlier release.
 */
export class StaleDecisionError extends Error {
  readonly code = 'ERR_STALE_DECISION' as const;
  /** The artifact the QUESTION was asked against. */
  readonly asked: string;
  /** The artifact the ANSWER was chosen against. */
  readonly answered: string;

  constructor(asked: string, answered: string) {
    super(
      `[resume] this answer was chosen against artifact '${answered}', and the question was ` +
        `asked against '${asked}'. The data moved between asking and answering, so the choice ` +
        `does not name what the person saw. Nothing was resumed — raise the ask again with the ` +
        `current data.`,
    );
    this.name = 'StaleDecisionError';
    this.asked = asked;
    this.answered = answered;
  }
}

export class DecisionRequiredError extends Error {
  readonly code = 'ERR_DECISION_REQUIRED' as const;
  /** Which gate is outstanding. */
  readonly gate: ConsentGateKind;
  /** The tool the gate is about, when the pause named one. */
  readonly toolName?: string;
  /** `'ask'` only — the middleware that asked. */
  readonly middleware?: string;
  /**
   * What arrived instead, as a TYPE NAME only (`'a string'`, `'nothing'`, …).
   *
   * Never the value. A resume payload is caller data that may carry anything a
   * person typed, and an error message is copied into logs, tickets and crash
   * reporters by default.
   */
  readonly received: string;

  constructor(gate: ConsentGate, input: unknown) {
    const who =
      gate.kind === 'checkIn'
        ? "a tool's checkIn"
        : `a toolMiddleware's ask${gate.middleware ? ` (asked by '${gate.middleware}')` : ''}`;
    const received = describeResumeInput(input);
    super(
      `[resume] this run paused on a consent gate — ${who}${
        gate.toolName ? ` on tool '${gate.toolName}'` : ''
      } — and a consent gate is answered with a DECISION, not a value. Got ${received}. ` +
        `Resume with checkInApproved({ request, by }) or checkInDeclined({ request, by, note }) ` +
        `from 'agentfootprint'; \`request\` is the paused request (outcome.checkIn or ` +
        `outcome.ask) and \`by\` is who decided, and both are what the record says. Nothing was ` +
        `executed and the checkpoint is unchanged — answer it and resume again. (An askHuman() ` +
        `/ pauseHere() pause is different: there the human's answer IS the tool's result, and ` +
        `any value is accepted.)`,
    );
    this.name = 'DecisionRequiredError';
    this.gate = gate.kind;
    if (gate.toolName !== undefined) this.toolName = gate.toolName;
    if (gate.middleware !== undefined) this.middleware = gate.middleware;
    this.received = received;
  }
}

/**
 * Why a decision could not answer the request a run is paused on — the
 * {@link ResumeDecisionError} `reason`:
 *
 *   - `'no-request'` — the decision names no request (`requestId` missing):
 *     one built by an older release, or by hand.
 *   - `'request-not-recorded'` — the PAUSE recorded no request to answer: a
 *     checkpoint written before requests were named, or one whose record was
 *     removed.
 *   - `'other-request'` — the decision names a different request: another
 *     conversation's, an earlier pause of this run, a parallel sibling's.
 *   - `'call-changed'` — the decision names this request, but the paused call
 *     is no longer the one the person was asked about (the checkpoint's tool,
 *     arguments, call id, served party, or — for an ask — the middleware
 *     position or the rules recorded after it changed).
 *   - `'chain-changed'` — an ask only: the decision names this request and
 *     the checkpoint is intact, but the agent resuming it would continue the
 *     middleware chain under other rules than the ones the person was asked
 *     under — the link that asked, or a link after it, was removed, added,
 *     renamed or moved (a redeploy). An approval holds for the rules it was
 *     given under, so a rule it was given under is never skipped.
 *   - `'already-answered'` — a resume already used a decision for this
 *     request, approved or declined.
 */
export type ResumeDecisionRefusal =
  | 'no-request'
  | 'request-not-recorded'
  | 'other-request'
  | 'call-changed'
  | 'chain-changed'
  | 'already-answered';

/**
 * Raised by a resume when the decision cannot answer the request the run is
 * paused on. **The tool never runs**: the refusal comes before it, and a
 * decision is never re-read as a decline or as anyone else's answer.
 *
 * A consent gate (a tool's `checkIn`, a middleware's `ask`) mints a request id
 * when it pauses (`CheckInRequest.id`, `MiddlewareAsk.id`). The id is unique to
 * that pause and bound to the exact call that runs on approval — the tool, its
 * arguments, the call id, the served party and, for an ask, where the chain
 * resumes and the names of the rules from there on. A decision names it
 * (`checkInApproved({ request, by })`), and a resume holds the decision to it:
 * the same request, the same call, once.
 *
 * Every refusal but `'already-answered'` is decided before anything moves on
 * an agent's own `resume()`; the checkpoint is unchanged and can be answered
 * with the right decision. `'already-answered'` — and every refusal of a
 * composition's nested agent — is decided where the decision is used, inside
 * the resumed run and still before the tool. See {@link ResumeDecisionRefusal}.
 *
 * **It names no request id** — not in its message, not on a field — and a
 * host sends its message as the refusal's body. A refusal that named the
 * request the run is paused on would hand out the very id it exists to
 * require: a client that retried with it would approve a request nobody was
 * shown. The paused request is the server's to show; it is in the stored
 * pause (`PendingAsk.checkIn` / `.ask`), never in an error.
 */
export class ResumeDecisionError extends Error {
  readonly code = 'ERR_RESUME_DECISION' as const;
  /** Which rule refused the decision. */
  readonly reason: ResumeDecisionRefusal;
  /** Which kind of consent gate the run is paused on. */
  readonly gate: ConsentGateKind;

  constructor(reason: ResumeDecisionRefusal, gate: ConsentGateKind) {
    super(resumeDecisionMessage(reason));
    this.name = 'ResumeDecisionError';
    this.reason = reason;
    this.gate = gate;
  }
}

function resumeDecisionMessage(reason: ResumeDecisionRefusal): string {
  switch (reason) {
    case 'no-request':
      return (
        `[resume] this decision names no request. A person's decision answers ONE paused ` +
        `request: build it with checkInApproved({ request, by }) or checkInDeclined({ request, ` +
        `by }), passing the request the person was shown — outcome.checkIn or outcome.ask ` +
        `(PendingAsk.checkIn / .ask on a hosted door). A decision without \`requestId\` cannot ` +
        `say which request it answers, so it answers none. Nothing was executed.`
      );
    case 'request-not-recorded':
      return (
        `[resume] this run paused on a consent gate without a record of the request it asked — ` +
        `a checkpoint written before requests were named, or one whose record was removed. No ` +
        `decision can answer it. Nothing was executed; abandon this pause and ask again in a ` +
        `new run.`
      );
    case 'other-request':
      return (
        `[resume] this decision answers a different request than the one this run is paused ` +
        `on. A decision answers only the request it names — not a later pause of the same run, ` +
        `not a parallel sibling's, not another conversation's. Nothing was executed; show the ` +
        `person the paused request and build the decision from what they were shown.`
      );
    case 'call-changed':
      return (
        `[resume] this decision names the paused request, but the paused call is no longer the ` +
        `call the person was asked about: the checkpoint's tool, arguments, call id, served ` +
        `party or middleware position changed after the ask. An approval binds to the exact ` +
        `call it was shown. Nothing was executed; treat the checkpoint as altered.`
      );
    case 'chain-changed':
      return (
        `[resume] this decision names the paused request, but this agent's toolMiddleware ` +
        `chain is not the one the request was asked under: the link that asked, or a link ` +
        `after it, was removed, added, renamed or moved since (a redeploy). The rest of the ` +
        `chain would not be the rules the approval was given under, so the approval is not ` +
        `used. Nothing was executed; resume on an agent built with the same chain, or abandon ` +
        `the pause and ask again in a new run.`
      );
    case 'already-answered':
      return (
        `[resume] the request this decision names was already answered by an earlier resume. ` +
        `One decision runs one call: a request is spent the moment a resume uses its ` +
        `decision, approved or declined. Nothing was executed this time.`
      );
  }
}

/**
 * Raised when an `askHuman()` / `pauseHere()` pause is resumed with NO answer.
 *
 * That pause exists to collect a value, and the value it collects becomes the
 * paused tool's result — the model reads it as what the tool said. Resuming
 * with nothing has two live readings, "the person gave no answer" and "just
 * carry on", and they produce different conversations. So the caller says
 * which; the library does not choose.
 *
 * Until 8.18.0 it chose, and chose invisibly: the missing answer became a
 * `role: 'tool'` message with `content: undefined`, and the run died on the
 * next turn inside the messages slot with a `TypeError` that named neither the
 * tool nor the resume.
 *
 * Nothing ran before this raised and the checkpoint is unchanged — answer it
 * and resume the same checkpoint again.
 */
export class PauseAnswerRequiredError extends Error {
  readonly code = 'ERR_PAUSE_ANSWER_REQUIRED' as const;
  /** The tool whose `execute()` paused. */
  readonly toolName: string;
  /** The tool call id the pause is filed under. */
  readonly toolCallId: string;

  constructor(ctx: { toolName: string; toolCallId: string }) {
    super(
      `[resume] this run paused inside tool '${ctx.toolName}' (askHuman/pauseHere), and that ` +
        `pause is answered with a VALUE — the answer becomes the tool's result. Got nothing. ` +
        `Say which you meant: resume(checkpoint, 'the answer') to hand the tool an answer, or ` +
        `resume(checkpoint, '(no answer)') to tell the model nobody answered. Nothing was ` +
        `executed and the checkpoint is unchanged.`,
    );
    this.name = 'PauseAnswerRequiredError';
    this.toolName = ctx.toolName;
    this.toolCallId = ctx.toolCallId;
  }
}

/** Name the SHAPE of a resume input for the refusal — never its contents. */
function describeResumeInput(input: unknown): string {
  if (input === undefined) return 'nothing';
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'an array';
  const t = typeof input;
  return t === 'object' ? 'an object that is not a CheckInDecision' : `a ${t}`;
}

/**
 * Control-flow error raised by `pauseHere()` inside a tool's `execute()`.
 * Caught by the Agent's tool-call stage, which forwards to `scope.$pause()`.
 * Never propagates to the consumer.
 */
export class PauseRequest extends Error {
  readonly data: unknown;
  constructor(data: unknown) {
    super('PauseRequest');
    this.name = 'PauseRequest';
    this.data = data;
    // Not a real error — stack has no diagnostic value for consumers.
    this.stack = '';
  }
}

/**
 * Called from inside a tool's `execute()` to request a pause. Throws a
 * `PauseRequest` that the Agent catches and forwards to the flowchart.
 *
 * @example
 *   const approveTool: Tool<{ action: string }, string> = {
 *     schema: { name: 'approve', description: 'Ask human', inputSchema: {...} },
 *     execute: async (args) => {
 *       pauseHere({ question: `Approve ${args.action}?`, risk: 'high' });
 *       return ''; // unreachable — pauseHere always throws
 *     },
 *   };
 */
export function pauseHere(data: unknown): never {
  throw new PauseRequest(data);
}

/** Type guard for a thrown `PauseRequest`. */
export function isPauseRequest(err: unknown): err is PauseRequest {
  return (
    err instanceof PauseRequest ||
    (err instanceof Error &&
      err.name === 'PauseRequest' &&
      Object.prototype.hasOwnProperty.call(err, 'data'))
  );
}

/**
 * Ergonomic alias for `pauseHere(data)` — the human-in-the-loop name.
 *
 * `pauseHere` describes the mechanism (control-flow throw); `askHuman`
 * describes the intent (ask a person to decide). Both work identically.
 *
 * @example
 *   const approveRefund: Tool<{ amount: number }, string> = {
 *     schema: { name: 'approve_refund', description: '...', inputSchema: {...} },
 *     execute: async ({ amount }) => {
 *       if (amount > 1000) askHuman({ question: `Approve $${amount}?` });
 *       return 'auto-approved';
 *     },
 *   };
 */
export const askHuman = pauseHere;
