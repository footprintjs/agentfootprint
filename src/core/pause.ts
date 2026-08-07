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

import type { FlowchartCheckpoint } from 'footprintjs';
import type { CheckInRequest } from './checkin.js';

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
  /**
   * Present ONLY when this pause is an evidence-carrying check-in (a tool
   * declared `checkIn`). Carries the typed ask + evidence pack. Absent for
   * plain `askHuman` / `pauseHere` pauses — that's the clean discriminant
   * between the two pause kinds. Resume with a `CheckInDecision`
   * (`checkInApproved` / `checkInDeclined`).
   */
  readonly checkIn?: CheckInRequest;
  /**
   * Present ONLY when a `toolMiddleware` answered `ask` — the question it put
   * to a person, plus the middleware that asked. Absent for every other pause,
   * which is the discriminant.
   *
   * Resume with a `CheckInDecision` (`checkInApproved` / `checkInDeclined`).
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
  /** The question, in the middleware author's own words. */
  readonly question: string;
  /** Anything else the answering UI should render. Never interpreted here. */
  readonly detail?: unknown;
  /** `name` of the middleware that asked. */
  readonly middleware: string;
}

/** Type guard — discriminates `RunnerPauseOutcome` from a normal `TOut`. */
export function isPaused<T>(result: T | RunnerPauseOutcome): result is RunnerPauseOutcome {
  return (
    typeof result === 'object' && result !== null && (result as RunnerPauseOutcome).paused === true
  );
}

/**
 * Type guard — is this a check-in pause (evidence-carrying human consent),
 * as opposed to a plain `askHuman` pause? Narrows `checkIn` to present.
 *
 * @example
 *   const out = await agent.run({ message });
 *   if (isCheckInPause(out)) {
 *     showToHuman(out.checkIn.evidence);       // the receipts
 *     const decision = checkInApproved({ by: 'alice' });
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
 *       ? checkInApproved({ by: 'alice' })
 *       : checkInDeclined({ by: 'alice', note: 'not this one' }));
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
 * Both are answered with `checkInApproved()` / `checkInDeclined()`.
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
        `Resume with checkInApproved({ by }) or checkInDeclined({ by, note }) from ` +
        `'agentfootprint'; \`by\` is who decided, and it is what the record says. Nothing was ` +
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
