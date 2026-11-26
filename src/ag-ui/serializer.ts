import { addressOf, owned } from './serializer/values.js';
import { eventTranslator } from './serializer/translate.js';
import { settleTranslation } from './serializer/settle.js';
import { leads, record, text, questionOf, AG_UI_SUBAGENT_UNFINISHED } from './serializer/values.js';
import type { AgUiSerializerOptions, AgUiTranslation } from './serializer/types.js';
export type { AgUiSerializerOptions, AgUiTranslation } from './serializer/types.js';
export {
  AG_UI_RUN_FAILED,
  AG_UI_ANSWER_WITHHELD,
  AG_UI_SUBAGENT_UNFINISHED,
  AG_UI_SUBAGENT_CANCELLED,
} from './serializer/values.js';

/**
 * serializer — one run's served agentfootprint events → AG-UI events.
 *
 * Pattern: a per-run state machine (`RunTranslation`), pure — no I/O, no clock,
 *          no import of `@ag-ui/*`. Frames are the framing strategy's job
 *          (`framing.ts`); reading a request is the adapter's (`adapter.ts`).
 * Role:    the Lens over a run for an AG-UI reader. It composes what that reader
 *          is served, from the RECORD only: every value it writes comes from a
 *          served event (the placeholder wherever a redaction policy selected a
 *          value), from the record's address (`meta.runtimeStageId`,
 *          `meta.subflowPath` — never selected by a policy), or from the
 *          AG-UI request's own ids. It never reads the run's live values, so
 *          nothing a policy hides can reach an AG-UI event. The record's own
 *          run id is never written: it counts every run the process made.
 *
 * THE MAPPING
 *   agent.turn_start (nested)          → SUBAGENT_STARTED      (a sub-agent's turn)
 *   agent.turn_end                     → SUBAGENT_FINISHED / the root answer
 *   agent.iteration_start/_end         → STEP_STARTED/_FINISHED  `iteration <n>`
 *   composition.enter/exit             → STEP_STARTED/_FINISHED  `<Kind>[:<mount>]`
 *   stream.token                       → TEXT_MESSAGE_START/CONTENT/END
 *   stream.llm_end (no agent around)   → one whole TEXT message (an LLM call that streams nothing)
 *   stream.thinking_delta/_end         → REASONING_START … REASONING_END   (only with `reasoning: true`)
 *   stream.tool_start                  → TOOL_CALL_START + TOOL_CALL_ARGS (the view) + TOOL_CALL_END
 *   stream.tool_end                    → TOOL_CALL_RESULT
 *   pause.request + settle('paused')   → RUN_FINISHED { outcome: interrupt }
 *   settle('paused', awaiting caller)  → RUN_FINISHED { outcome: success, pendingToolCallIds }
 *                                        (a tool the client runs: its call is left to answer)
 *   error.fatal + settle('failed')     → RUN_ERROR — the served error.fatal's words when they
 *                                        are a fixed sentence, else "The run failed."
 *   an allow-listed event              → CUSTOM { name: <event type>, value: <its listed fields> }
 *   anything else                      → nothing
 *
 * WHAT LEAVES THE PROCESS. An AG-UI stream goes to a browser, so nothing goes
 * out by default that a person is not meant to read. In record-only mode every value comes from a
 * served payload; `CUSTOM` carries only the event types on an allow-list, each
 * with the fields its projection picks ({@link AG_UI_CUSTOM_EVENTS} — the whole
 * record, such as `context.injected`'s assembled prompt or `error.retried`'s
 * raw error, stays off the wire unless the app lists it); the model's
 * reasoning goes out only when the app says so; and a failure is described by
 * the record, never by the thrown value. Identity on the meta (`principal`,
 * `tenant`, `sessionId`) is never written.
 *
 * HOST DELIVERY is explicit: candidate answer text at every depth stays off
 * the wire until the host completes. Its final output and allow-listed custom
 * reply data are app-authorized delivery, not observations from the record.
 * Tools, steps and progress still use served native events.
 *
 * WHO OWNS AN EVENT. Each agent's turn opens a SCOPE at its mount — the
 * subflow path its `turn_start` fired at (`[]` for the root agent, `step-p/x`
 * for an agent in a parallel branch). An event belongs to the deepest open scope
 * whose mount prefixes its own subflow path, segment by segment, and carries
 * that scope's `subagentRunId`. Parallel branches have different mounts, so
 * their interleaved events can never be attributed to each other.
 *
 * A RUN THAT CONTINUES A PAUSE. A paused run hands back `suspension()` — the
 * ids it gave the client (the interrupt, the open call) and every scope and
 * step open at the pause. The run that continues it passes that as `resume`:
 * the same sub-agents re-open (AG-UI: "a later run may continue the same
 * invocation"), their steps re-open, and the first result in the paused call's
 * scope answers that call under its own id — or, for a tool the client ran, is
 * not written at all, because the client holds the result it sent.
 *
 * TEXT in record-only mode comes from `stream.token`, then from the rest of
 * `turn_end.finalContent` as its own message. A marked root `turn_end` can
 * deliver the answer even when this reader joined after the turn started.
 * `unstreamedText` uses the same prefix rule as `toSSE({ format: 'text' })`.
 * Refused final content and an agent's draft `llm_end.content` stay off the wire.
 */

import type { AgentfootprintEvent } from '../events/registry.js';
import { CONSUMER_SCOPE_RUN_ID } from '../bridge/eventMeta.js';
import { withWireErrors } from '../lib/wireJson.js';
import { newScope, type Scope } from './translationScope.js';
import { agUiIdMinter } from './ids.js';
import { checkInHiddenNamesOf } from './shownArgs.js';
import {
  AG_UI_PROTOCOL_VERSION,
  type AgUiEvent,
  type AgUiInterrupt,
  type AgUiSuspendedScope,
  type AgUiSuspension,
} from './types.js';

import { AG_UI_CUSTOM_EVENTS } from './customEvents.js';
export { AG_UI_CUSTOM_EVENTS } from './customEvents.js';
export type { AgUiCustomContext, AgUiCustomProjection } from './customEvents.js';

/**
 * The AG-UI serializer for ONE run: feed it every served agentfootprint event
 * of the run, in order, then settle it once. `RUN_STARTED` comes before the
 * first event it returns; `RUN_FINISHED` or `RUN_ERROR` is the last thing
 * `settle` returns, with everything still open closed before it.
 *
 * @example
 * ```ts
 * const ag = agUiSerializer({ threadId, runId });
 * const off = agent.on('*', (event) => send(ag.event(event)));
 * try {
 *   const out = await agent.run({ message });
 *   send(ag.settle({ kind: isPaused(out) ? 'paused' : 'finished' }));
 * } catch (error) {
 *   // A withheld answer is a refusal, named by its code (`RUN_ERROR.code`);
 *   // anything else is described by the record, never by the thrown value.
 *   send(
 *     ag.settle(
 *       error instanceof AnswerValidationError
 *         ? { kind: 'failed', refusal: 'ERR_ANSWER_VALIDATION' }
 *         : { kind: 'failed' },
 *     ),
 *   );
 * } finally {
 *   off();
 * }
 * ```
 */
export function agUiSerializer(options: AgUiSerializerOptions): AgUiTranslation {
  const { threadId, runId } = options;
  if (typeof threadId !== 'string' || threadId.length === 0) {
    throw new TypeError('AG-UI: `threadId` must be a non-empty string.');
  }
  const ids = agUiIdMinter(runId);
  const custom = options.custom ?? AG_UI_CUSTOM_EVENTS;
  const reasoning = options.reasoning === true;
  const owns = options.owns;
  const toolErrors = options.toolErrors ?? 'withheld';

  const hostDelivery = options.delivery === 'host';
  const root = newScope([], undefined);
  /** Open scopes — the root always, then each nested agent turn in open order. */
  const scopes: Scope[] = [root];
  let started = false;
  let settled = false;
  /**
   * The run the events name, once one did — how a translation without `owns`
   * keeps to one run. Never written: the library's run ids count every run the
   * PROCESS made, and a browser must not learn how many other callers ran.
   */
  let recordRunId: string | undefined;
  /** The record's own words for a failure — the last served `error.fatal`. */
  let fatal: string | undefined;
  let pause: { readonly event: AgentfootprintEvent; readonly scope: Scope } | undefined;
  /** Text already shown from the root's last complete-only call before its turn was known. */
  let rootCallText: string | undefined;
  /** The root agent's answer as the record serves it — `RUN_FINISHED.result`. */
  let rootResult: string | undefined;
  /** What a continuation needs — set when the run settles paused. */
  let suspended: AgUiSuspension | undefined;

  const scopeOf = (path: readonly string[]): Scope => {
    let best = root;
    for (const scope of scopes) {
      if (scope.mount.length > best.mount.length && leads(scope.mount, path)) best = scope;
    }
    return best;
  };

  // ── closers — each leaves its entity closed and writes the events that say so ──

  const closeText = (scope: Scope, out: AgUiEvent[]): void => {
    if (scope.text === undefined) return;
    out.push({ type: 'TEXT_MESSAGE_END', messageId: scope.text.id, ...owned(scope) });
    scope.text = undefined;
  };

  const closeReasoning = (scope: Scope, out: AgUiEvent[]): void => {
    if (scope.reasoning === undefined) return;
    const { id } = scope.reasoning;
    out.push({ type: 'REASONING_MESSAGE_END', messageId: id, ...owned(scope) });
    out.push({ type: 'REASONING_END', messageId: id, ...owned(scope) });
    scope.reasoning = undefined;
  };

  const closeSteps = (scope: Scope, out: AgUiEvent[]): void => {
    while (scope.steps.length > 0) {
      const stepName = scope.steps.pop() as string;
      out.push({ type: 'STEP_FINISHED', stepName, ...owned(scope) });
    }
  };

  /** Close what is open INSIDE a scope — the scope itself stays. */
  const closeContents = (scope: Scope, out: AgUiEvent[]): void => {
    closeText(scope, out);
    closeReasoning(scope, out);
    closeSteps(scope, out);
  };

  /** Close one nested scope: what is open inside it, then its own terminal event. */
  const closeScope = (
    scope: Scope,
    out: AgUiEvent[],
    terminal: (subagentRunId: string) => AgUiEvent,
  ): void => {
    closeContents(scope, out);
    const at = scopes.indexOf(scope);
    if (at > 0) scopes.splice(at, 1);
    if (scope.subagentRunId !== undefined) out.push(terminal(scope.subagentRunId));
  };

  /** The open nested scopes mounted strictly under `mount`, deepest first. */
  const scopesUnder = (mount: readonly string[]): Scope[] =>
    scopes
      .filter((s) => s !== root && s.mount.length > mount.length && leads(mount, s.mount))
      .reverse()
      .sort((a, b) => b.mount.length - a.mount.length);

  /** End a nested scope: every turn still open under it first (they never answered), then it. */
  const endScope = (
    scope: Scope,
    out: AgUiEvent[],
    terminal: (subagentRunId: string) => AgUiEvent,
  ): void => {
    for (const inner of scopesUnder(scope.mount)) closeScope(inner, out, unfinished);
    closeScope(scope, out, terminal);
  };

  const unfinished = (subagentRunId: string): AgUiEvent => ({
    type: 'SUBAGENT_ERROR',
    subagentRunId,
    message: AG_UI_SUBAGENT_UNFINISHED,
  });

  // ── openers ──

  const openStep = (
    scope: Scope,
    stepName: string,
    event: AgentfootprintEvent,
    out: AgUiEvent[],
  ): void => {
    const at = scope.steps.indexOf(stepName);
    if (at >= 0) {
      // The same name still open in this scope: the record never closed it.
      scope.steps.splice(at, 1);
      out.push({ type: 'STEP_FINISHED', stepName, ...owned(scope) });
    }
    scope.steps.push(stepName);
    out.push({
      type: 'STEP_STARTED',
      stepName,
      ...owned(scope, event),
      metadata: addressOf(event),
    });
  };

  const finishStep = (
    scope: Scope,
    stepName: string,
    event: AgentfootprintEvent,
    out: AgUiEvent[],
  ): void => {
    const at = scope.steps.indexOf(stepName);
    if (at < 0) return;
    scope.steps.splice(at, 1);
    out.push({ type: 'STEP_FINISHED', stepName, ...owned(scope, event) });
  };

  /** A whole text message in one go — an answer the record did not stream. */
  const wholeText = (
    scope: Scope,
    content: string,
    event: AgentfootprintEvent,
    out: AgUiEvent[],
  ): void => {
    const { id } = ids.next('text', event.meta.runtimeStageId);
    out.push({
      type: 'TEXT_MESSAGE_START',
      messageId: id,
      role: 'assistant',
      ...owned(scope, event),
      metadata: addressOf(event),
    });
    out.push({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: id,
      delta: content,
      ...owned(scope, event),
    });
    out.push({ type: 'TEXT_MESSAGE_END', messageId: id, ...owned(scope, event) });
    scope.callMessageId = id;
  };

  // ── the mapping ──

  const translate = eventTranslator({
    options,
    root,
    scopes,
    ids,
    hostDelivery,
    reasoning,
    toolErrors,
    scopeOf,
    addressOf,
    owned,
    closeText,
    closeReasoning,
    closeSteps,
    closeScope,
    scopesUnder,
    endScope,
    unfinished,
    openStep,
    finishStep,
    wholeText,
    pushCustom,
    get rootCallText() {
      return rootCallText;
    },
    set rootCallText(value) {
      rootCallText = value;
    },
    get rootResult() {
      return rootResult;
    },
    set rootResult(value) {
      rootResult = value;
    },
    get pause() {
      return pause;
    },
    set pause(value) {
      pause = value;
    },
    get fatal() {
      return fatal;
    },
    set fatal(value) {
      fatal = value;
    },
  });

  /**
   * Re-open what the paused run left open — the scopes (same `subagentRunId`),
   * their steps and the call it stopped in — and return the events that say so,
   * for `start` to write after `RUN_STARTED`.
   */
  function restore(from: AgUiSuspension): AgUiEvent[] {
    const events: AgUiEvent[] = [];
    root.isAgent = from.rootAgent;
    for (const kept of from.scopes) {
      let scope = root;
      if (kept.subagentRunId !== undefined) {
        scope = newScope(kept.mount, kept.subagentRunId, kept.name, kept.parentSubagentRunId);
        scope.isAgent = true;
        scopes.push(scope);
        events.push({
          type: 'SUBAGENT_STARTED',
          subagentRunId: kept.subagentRunId,
          name: kept.name ?? kept.mount.join('/'),
          ...(kept.parentSubagentRunId !== undefined && {
            parentSubagentRunId: kept.parentSubagentRunId,
          }),
        });
      }
      for (const stepName of kept.steps) {
        scope.steps.push(stepName);
        events.push({ type: 'STEP_STARTED', stepName, ...owned(scope) });
      }
      for (const call of kept.calls) {
        scope.calls.push({
          id: call.toolCallId,
          n: -1,
          address: '',
          servedId: undefined,
          resumed: true,
          client: call.client,
        });
      }
      if (kept.messageId !== undefined) scope.callMessageId = kept.messageId;
    }
    return events;
  }

  /** The record a continuation resumes from: every scope open now, with its steps. */
  function suspensionOf(
    interruptId: string | undefined,
    call: AgUiSuspension['call'],
  ): AgUiSuspension {
    const kept: AgUiSuspendedScope[] = scopes.map((scope) => ({
      mount: [...scope.mount],
      ...(scope.subagentRunId !== undefined && { subagentRunId: scope.subagentRunId }),
      ...(scope.name !== undefined && { name: scope.name }),
      ...(scope.parentSubagentRunId !== undefined && {
        parentSubagentRunId: scope.parentSubagentRunId,
      }),
      steps: [...scope.steps],
      calls: scope.calls.map((open) => ({
        toolCallId: open.id,
        client: open.id === call?.toolCallId ? call.client : open.client === true,
      })),
      ...(scope.callMessageId !== undefined && { messageId: scope.callMessageId }),
    }));
    return {
      version: 1,
      runId,
      ...(interruptId !== undefined && { interruptId }),
      ...(call !== undefined && { call }),
      rootAgent: root.isAgent,
      scopes: kept,
    };
  }

  /**
   * `event` as CUSTOM — only when its type is on the allow-list, carrying only
   * the fields its projection picks from the served payload, through the wire
   * rule. An unlisted event writes nothing.
   */
  function pushCustom(event: AgentfootprintEvent, scope: Scope, out: AgUiEvent[]): void {
    const project = Object.prototype.hasOwnProperty.call(custom, event.type)
      ? custom[event.type]
      : undefined;
    if (typeof project !== 'function') return;
    const call = scope.calls[scope.calls.length - 1];
    const value = project(record(event.payload), call === undefined ? {} : { toolCallId: call.id });
    out.push({
      type: 'CUSTOM',
      name: event.type,
      value: withWireErrors(value ?? null),
      ...owned(scope, event),
      metadata: addressOf(event),
    });
  }

  /**
   * What a pause leaves for its continuation, as of now: on whom it waits
   * decides whether the open call is the client's (a frontend tool) or the
   * interrupt's. Pure apart from minting the interrupt once.
   */
  const pausedRecord = (
    awaiting: 'person' | 'caller' | undefined,
  ): { readonly record: AgUiSuspension; readonly clientCall?: string } => {
    const at = pause?.scope ?? root;
    const open = at.calls[at.calls.length - 1];
    if (awaiting === 'caller' && open !== undefined) {
      return {
        record: suspensionOf(undefined, {
          toolCallId: open.id,
          mount: [...at.mount],
          client: true,
        }),
        clientCall: open.id,
      };
    }
    return {
      record: suspensionOf(
        interruptOf().id,
        open === undefined
          ? undefined
          : { toolCallId: open.id, mount: [...at.mount], client: false },
      ),
    };
  };

  /** What `RUN_STARTED` is followed by in a continuation: the scopes and steps it re-opens. */
  const reopened: readonly AgUiEvent[] =
    options.resume === undefined ? [] : restore(options.resume);

  const start = (out: AgUiEvent[]): void => {
    if (started) return;
    started = true;
    out.push({
      type: 'RUN_STARTED',
      threadId,
      runId,
      protocolVersion: AG_UI_PROTOCOL_VERSION,
    });
    out.push(...reopened);
  };

  /** The interrupt a person-awaited pause hands out — minted once, so a record kept before settling names it. */
  let interrupt: AgUiInterrupt | undefined;
  const interruptOf = (): AgUiInterrupt => (interrupt ??= mintInterrupt());
  const mintInterrupt = (): AgUiInterrupt => {
    if (pause === undefined) return { id: ids.next('interrupt', 'run').id, reason: 'paused' };
    const { event, scope } = pause;
    const payload = record(event.payload);
    // The question a person is asked, as the record serves it — and nothing
    // else of the pause's payload (a check-in's evidence pack, a typed ask's
    // context), which a browser has no reason to receive.
    const message = questionOf(record(payload.questionPayload));
    const call = scope.calls[scope.calls.length - 1];
    return {
      id: ids.next('interrupt', event.meta.runtimeStageId).id,
      reason: text(payload.reason) ?? 'paused',
      ...(message !== undefined && { message }),
      ...(call !== undefined && { toolCallId: call.id }),
      ...(scope.subagentRunId !== undefined && { subagentRunId: scope.subagentRunId }),
      metadata: addressOf(event, checkInHiddenNamesOf(payload)),
    };
  };

  /** Close every open nested scope, deepest first, each with the terminal `end` names for it. */
  const endAllNested = (
    out: AgUiEvent[],
    end: (scope: Scope) => (subagentRunId: string) => AgUiEvent,
  ): void => {
    for (const scope of scopesUnder(root.mount)) closeScope(scope, out, end(scope));
  };

  return {
    event(event) {
      if (settled) return [];
      if (owns !== undefined && !owns(event)) return [];
      const named = event.meta?.runId;
      const namesRun = typeof named === 'string' && named !== CONSUMER_SCOPE_RUN_ID;
      if (namesRun) {
        // Without `owns`, the first run an event names is this run's, and
        // another run's event is never this run's to translate.
        if (recordRunId === undefined) recordRunId = named;
        else if (owns === undefined && named !== recordRunId) return [];
      }
      const body: AgUiEvent[] = [];
      translate(event, body);
      // `RUN_STARTED` waits for the run to name itself (or to say something):
      // a continuation opens with the resume's own bookkeeping, which names no
      // run, and the run's id belongs on its first event.
      if (!started && !namesRun && body.length === 0) return [];
      const out: AgUiEvent[] = [];
      start(out);
      out.push(...body);
      return out;
    },
    publish(name, payload) {
      if (settled || !hostDelivery) return [];
      const project = custom[name];
      if (typeof project !== 'function') return [];
      const out: AgUiEvent[] = [];
      start(out);
      out.push({ type: 'CUSTOM', name, value: withWireErrors(project(payload, {}) ?? null) });
      return out;
    },
    settle(settlement) {
      if (settled) return [];
      settled = true;
      const out: AgUiEvent[] = [];
      start(out);
      return settleTranslation(settlement, out, {
        root,
        threadId,
        runId,
        ids,
        hostDelivery,
        pausedRecord,
        endAllNested,
        closeContents,
        interruptOf,
        unfinished,
        get rootResult() {
          return rootResult;
        },
        set rootResult(value) {
          rootResult = value;
        },
        get suspended() {
          return suspended;
        },
        set suspended(value) {
          suspended = value;
        },
        get fatal() {
          return fatal;
        },
        get pause() {
          return pause;
        },
      });
    },
    suspension: (awaiting) => {
      if (settled) return suspended;
      return pausedRecord(awaiting).record;
    },
  };
}
