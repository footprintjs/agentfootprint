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
 *   stream.tool_start                  → TOOL_CALL_START + TOOL_CALL_ARGS + TOOL_CALL_END
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
 * out by default that a person is not meant to read. Every value comes from a
 * served payload; `CUSTOM` carries only the event types on an allow-list, each
 * with the fields its projection picks ({@link AG_UI_CUSTOM_EVENTS} — the whole
 * record, such as `context.injected`'s assembled prompt or `error.retried`'s
 * raw error, stays off the wire unless the app lists it); the model's
 * reasoning goes out only when the app says so; and a failure is described by
 * the record, never by the thrown value. Identity on the meta (`principal`,
 * `tenant`, `sessionId`) is never written.
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
 * TEXT. The reply is what the record streamed (`stream.token`) — the channel
 * `toSSE({ format: 'text' })` and a hosted reply read. An agent turn whose
 * answer streamed no token (a provider without `stream()`) is written whole
 * from `turn_end.finalContent`, unless the record marks it refused. An
 * agent's `llm_end.content` is a DRAFT the library may be holding back
 * (answer validation, an output policy) and is never written.
 */

import type { AgentfootprintEvent } from '../events/registry.js';
import { CONSUMER_SCOPE_RUN_ID } from '../bridge/eventMeta.js';
import type { RunTranslation } from '../hosting/protocolAdapter.js';
import { LLM_ERROR_SENTENCES } from '../lib/humanizeLLMError.js';
import { toWireJson, withWireErrors } from '../lib/wireJson.js';
import { agUiIdMinter } from './ids.js';
import {
  AG_UI_PROTOCOL_VERSION,
  type AgUiAddress,
  type AgUiEvent,
  type AgUiInterrupt,
  type AgUiMetadata,
  type AgUiSuspendedScope,
  type AgUiSuspension,
} from './types.js';

/** What a CUSTOM projection is told beside the payload: where the event landed. */
export interface AgUiCustomContext {
  /** The AG-UI id of the tool call open where the event happened, when one is. */
  readonly toolCallId?: string;
}

/**
 * One allow-listed event's `CUSTOM` value: the fields of its SERVED payload
 * that go out (the payload is the one every listener receives — the
 * placeholder wherever a redaction policy selected a value). Return only what
 * a person using the frontend is meant to read.
 */
export type AgUiCustomProjection = (
  payload: Readonly<Record<string, unknown>>,
  at: AgUiCustomContext,
) => unknown;

/** The listed fields of `payload`, where present. */
const pick = (
  payload: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of fields) if (payload[field] !== undefined) out[field] = payload[field];
  return out;
};

/**
 * The agentfootprint events that go out as AG-UI `CUSTOM` by default, each with
 * the fields it carries: progress (which call, which iteration), spend, the
 * loop's route, the answer's standing and a provider's retries — counts and the
 * library's own words. Content (a tool's own progress `payload`,
 * `context.injected`'s assembled prompt, `error.retried`'s raw error, memory,
 * permission and credential facts) stays off the wire unless an app lists it:
 * `agUiSerializer({ ..., custom: { ...AG_UI_CUSTOM_EVENTS, [type]: projection } })`.
 */
export const AG_UI_CUSTOM_EVENTS: Readonly<Record<string, AgUiCustomProjection>> = Object.freeze({
  // Which call and which iteration — never the tool author's `payload`, which
  // is whatever the tool chose to report (list it to send it).
  'agentfootprint.stream.tool_progress': (payload, at) => ({
    ...(at.toolCallId !== undefined && { toolCallId: at.toolCallId }),
    ...pick(payload, ['iteration']),
  }),
  'agentfootprint.cost.tick': (payload) =>
    pick(payload, [
      'scope',
      'model',
      'provider',
      'tokensInput',
      'tokensOutput',
      'estimatedUsd',
      'cumulative',
    ]),
  'agentfootprint.agent.route_decided': (payload) => pick(payload, ['iterIndex', 'chosen']),
  'agentfootprint.answer.assessed': (payload) =>
    pick(payload, ['standing', 'assessment', 'reasons', 'checked', 'turn', 'iteration']),
  'agentfootprint.error.retried': (payload) =>
    pick(payload, ['attempt', 'maxAttempts', 'backoffMs', 'statedWaitMs']),
  'agentfootprint.error.recovered': (payload) => pick(payload, ['attempt', 'totalDurationMs']),
});

/** Options for {@link agUiSerializer}. */
export interface AgUiSerializerOptions {
  /** The conversation this run belongs to — `RunAgentInput.threadId`. */
  readonly threadId: string;
  /** This run's AG-UI id — `RunAgentInput.runId`. Every id the run mints is under it. */
  readonly runId: string;
  /**
   * The events with no AG-UI equivalent that go out as `CUSTOM`, keyed by event
   * type, each with the projection that picks its fields. Default
   * {@link AG_UI_CUSTOM_EVENTS}; `{}` sends none. An event not listed sends
   * nothing. Events the mapping consumes (tokens, tool calls, turns,
   * iterations, compositions, the pause and the fatal error) are never CUSTOM.
   */
  readonly custom?: Readonly<Record<string, AgUiCustomProjection>>;
  /**
   * Write the model's reasoning — `REASONING_*` events from the served
   * `stream.thinking_*` events. Default `false`: a model's chain of thought is
   * shown to a person only when the app decides it is.
   */
  readonly reasoning?: boolean;
  /**
   * What a FAILED tool call's result says. Default `'withheld'`: the fixed words
   * "The tool failed." — the record's result for a failed call is the thrown
   * text, which may hold a connection string, a path or a provider's response.
   * `'served'` sends the record's own result (still the served value: the
   * placeholder wherever a redaction policy selected one).
   */
  readonly toolErrors?: 'withheld' | 'served';
  /**
   * Which served events are this run's. Default: the events of the first run
   * an event names (plus events that name no run). Pass it when the listener
   * can hear more than one run — an instance several callers share — so the
   * translation never binds to whichever run spoke first.
   */
  readonly owns?: (event: AgentfootprintEvent) => boolean;
  /**
   * The paused run this one continues — what that run's translation returned
   * from `suspension()` after it settled `'paused'`. Its suspended sub-agents
   * and open steps re-open under the same ids, and the call it stopped in is
   * answered under its own id (or, for a frontend tool, not at all: the client
   * already holds the result it sent).
   */
  readonly resume?: AgUiSuspension;
}

/** One run's AG-UI translation — and, once it pauses, what its continuation needs. */
export interface AgUiTranslation extends RunTranslation<AgUiEvent> {
  /**
   * The record to `resume` from. Before settling, what a `'paused'` settlement
   * with the same `awaiting` will hand out (keep it first, then settle); after
   * `settle({ kind: 'paused' })`, what it handed out; after any other ending,
   * `undefined`.
   */
  suspension(awaiting?: 'person' | 'caller'): AgUiSuspension | undefined;
}

/** Said by `TOOL_CALL_RESULT` for a failed call, unless `toolErrors: 'served'`. */
export const AG_UI_TOOL_FAILED = 'The tool failed.';

/** Said by `RUN_ERROR` when the run's `error.fatal` is not one of the record's fixed sentences. */
export const AG_UI_RUN_FAILED = 'The run failed.';

/**
 * Said by `RUN_ERROR` (with `code: 'ERR_ANSWER_VALIDATION'`) when an enforcing
 * `.answerValidation()` withheld the answer: a refusal, not a crash.
 */
export const AG_UI_ANSWER_WITHHELD =
  "The answer was withheld: it did not pass the app's answer checks.";

/** Is `said` one of the record's fixed failure sentences — the only `error.fatal` words a `RUN_ERROR` repeats? */
const isFixedFailure = (said: string): boolean =>
  (Object.values(LLM_ERROR_SENTENCES) as readonly string[]).includes(said);

/** Said by `SUBAGENT_ERROR` for a sub-agent whose turn ended without an answer. */
export const AG_UI_SUBAGENT_UNFINISHED = "The sub-agent's turn ended without an answer.";

/** Said by `SUBAGENT_ERROR` for a sub-agent still running when its run was cancelled. */
export const AG_UI_SUBAGENT_CANCELLED = 'The run was cancelled before this sub-agent finished.';

interface OpenText {
  readonly id: string;
  readonly address: string;
  lastTokenIndex: number;
}

interface OpenReasoning {
  readonly id: string;
  readonly iteration: unknown;
}

interface OpenCall {
  readonly id: string;
  /** Its number in this run — `-1` for a call a paused run opened. */
  readonly n: number;
  readonly address: string;
  readonly servedId: unknown;
  /** Opened by the paused run this one continues: answered by the first result in its scope. */
  readonly resumed?: boolean;
  /** Answered by the CLIENT (a frontend tool): its result is never written back. */
  readonly client?: boolean;
}

/** One agent's turn (or the root of the run), and what is open in it. */
interface Scope {
  readonly mount: readonly string[];
  /** The AG-UI invocation handle — `undefined` for the root, the parent agent. */
  readonly subagentRunId: string | undefined;
  /** `SUBAGENT_STARTED`'s name and parent — kept so a continuation re-opens it the same. */
  readonly name?: string;
  readonly parentSubagentRunId?: string;
  /** The stage execution of the scope's current LLM call — its message's address. */
  llmAddress: string | undefined;
  /** An agent's turn opened it (the root: only when the run's runner is an agent). */
  isAgent: boolean;
  text: OpenText | undefined;
  /** The text message of the scope's current LLM call — the parent of its tool calls. */
  callMessageId: string | undefined;
  /** A token streamed since the scope's last `llm_start`. */
  streamed: boolean;
  reasoning: OpenReasoning | undefined;
  /** Open step names, in the order they opened. */
  readonly steps: string[];
  /** Open tool calls, most recent last. */
  readonly calls: OpenCall[];
}

const newScope = (
  mount: readonly string[],
  subagentRunId: string | undefined,
  name?: string,
  parentSubagentRunId?: string,
): Scope => ({
  mount,
  subagentRunId,
  ...(name !== undefined && { name }),
  ...(parentSubagentRunId !== undefined && { parentSubagentRunId }),
  llmAddress: undefined,
  isAgent: false,
  text: undefined,
  callMessageId: undefined,
  streamed: false,
  reasoning: undefined,
  steps: [],
  calls: [],
});

/** Does `prefix` lead `path`, segment by segment? */
function leads(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

const sameMount = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && leads(a, b);

const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};

const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** A tool result as AG-UI text: a string as it is, anything else through the wire rule. */
const resultText = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined ? '' : toWireJson(value);

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
 * } catch {
 *   send(ag.settle({ kind: 'failed' })); // described by the record, never by the thrown value
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

  /** The record's address of `event`, as AG-UI metadata. */
  const addressOf = (event: AgentfootprintEvent, extra?: Partial<AgUiAddress>): AgUiMetadata => ({
    agentfootprint: {
      runtimeStageId: event.meta.runtimeStageId,
      subflowPath: [...event.meta.subflowPath],
      ...extra,
    },
  });

  /** The fields every event of `scope` carries. */
  const owned = (scope: Scope, event?: AgentfootprintEvent) => ({
    ...(event !== undefined && { timestamp: event.meta.wallClockMs }),
    ...(scope.subagentRunId !== undefined && { subagentRunId: scope.subagentRunId }),
  });

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

  const translate = (event: AgentfootprintEvent, out: AgUiEvent[]): void => {
    const path = event.meta.subflowPath;
    const address = event.meta.runtimeStageId;
    const payload = record(event.payload);
    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        if (path.length === 0) {
          root.isAgent = true;
          return;
        }
        const previous = scopes.find((s) => s !== root && sameMount(s.mount, path));
        if (previous !== undefined) endScope(previous, out, unfinished);
        const parent = scopeOf(path);
        const scope = newScope(
          path,
          ids.next('agent', address).id,
          path.join('/'),
          parent.subagentRunId,
        );
        scope.isAgent = true;
        scopes.push(scope);
        out.push({
          type: 'SUBAGENT_STARTED',
          subagentRunId: scope.subagentRunId as string,
          name: scope.name as string,
          ...(parent.subagentRunId !== undefined && { parentSubagentRunId: parent.subagentRunId }),
          timestamp: event.meta.wallClockMs,
          metadata: addressOf(event),
        });
        return;
      }
      case 'agentfootprint.agent.turn_end': {
        const scope = scopeOf(path);
        if (!scope.isAgent) {
          // A turn this translation never saw open (it subscribed late): its
          // answer has no scope to end, and the root's must not be guessed.
          pushCustom(event, scope, out);
          return;
        }
        closeText(scope, out);
        closeReasoning(scope, out);
        const refused = payload.refused !== undefined;
        const answer = refused ? undefined : text(payload.finalContent);
        if (!scope.streamed && answer !== undefined && answer.length > 0)
          wholeText(scope, answer, event, out);
        if (scope === root) {
          rootResult = answer;
          closeSteps(scope, out);
          return;
        }
        endScope(scope, out, (subagentRunId) => ({
          type: 'SUBAGENT_FINISHED',
          subagentRunId,
          ...(answer !== undefined && { result: answer }),
          timestamp: event.meta.wallClockMs,
        }));
        return;
      }
      case 'agentfootprint.agent.iteration_start':
        openStep(scopeOf(path), `iteration ${String(payload.iterIndex)}`, event, out);
        return;
      case 'agentfootprint.agent.iteration_end':
        finishStep(scopeOf(path), `iteration ${String(payload.iterIndex)}`, event, out);
        return;
      case 'agentfootprint.composition.enter':
        openStep(scopeOf(path), compositionStep(payload.kind, path), event, out);
        return;
      case 'agentfootprint.composition.exit': {
        // A turn under this composition that is still open never answered — a
        // branch a tolerant merge let fail. Said, never left dangling.
        for (const inner of scopesUnder(path)) closeScope(inner, out, unfinished);
        finishStep(scopeOf(path), compositionStep(payload.kind, path), event, out);
        return;
      }
      case 'agentfootprint.stream.llm_start': {
        const scope = scopeOf(path);
        closeText(scope, out);
        closeReasoning(scope, out);
        scope.streamed = false;
        scope.callMessageId = undefined;
        scope.llmAddress = address;
        return;
      }
      case 'agentfootprint.stream.token': {
        const content = text(payload.content);
        if (content === undefined) return;
        const scope = scopeOf(path);
        const index = typeof payload.tokenIndex === 'number' ? payload.tokenIndex : Number.NaN;
        const open = scope.text;
        if (open === undefined || open.address !== address || !(index > open.lastTokenIndex)) {
          // A new message: the first token of a call, another stage's tokens (an
          // answer released after validation), or a stream that restarted.
          closeText(scope, out);
          const { id } = ids.next('text', address);
          scope.text = { id, address, lastTokenIndex: Number.isNaN(index) ? -1 : index };
          scope.callMessageId = id;
          out.push({
            type: 'TEXT_MESSAGE_START',
            messageId: id,
            role: 'assistant',
            ...owned(scope, event),
            metadata: addressOf(event),
          });
        } else {
          open.lastTokenIndex = index;
        }
        scope.streamed = true;
        out.push({
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: (scope.text as OpenText).id,
          delta: content,
          ...owned(scope, event),
        });
        return;
      }
      case 'agentfootprint.stream.llm_end': {
        const scope = scopeOf(path);
        closeText(scope, out);
        // Inside an agent's turn the content is a draft; the turn's answer comes
        // at turn_end. With no agent around (an LLMCall, a merge by LLM) it IS
        // the answer — written whole when it streamed nothing.
        const content = text(payload.content);
        if (!scope.isAgent && !scope.streamed && payload.contentWithheld !== true && content)
          wholeText(scope, content, event, out);
        return;
      }
      case 'agentfootprint.stream.thinking_delta': {
        const content = text(payload.content);
        if (!reasoning || content === undefined) return;
        const scope = scopeOf(path);
        if (scope.reasoning === undefined || scope.reasoning.iteration !== payload.iteration) {
          closeReasoning(scope, out);
          const { id } = ids.next('reasoning', address);
          scope.reasoning = { id, iteration: payload.iteration };
          out.push({
            type: 'REASONING_START',
            messageId: id,
            ...owned(scope, event),
            metadata: addressOf(event),
          });
          out.push({
            type: 'REASONING_MESSAGE_START',
            messageId: id,
            role: 'reasoning',
            ...owned(scope, event),
          });
        }
        out.push({
          type: 'REASONING_MESSAGE_CONTENT',
          messageId: scope.reasoning.id,
          delta: content,
          ...owned(scope, event),
        });
        return;
      }
      case 'agentfootprint.stream.thinking_end': {
        if (!reasoning) return;
        const scope = scopeOf(path);
        if (scope.reasoning !== undefined && scope.reasoning.iteration === payload.iteration) {
          closeReasoning(scope, out);
          return;
        }
        // Nothing streamed for this call: the blocks are the reasoning, one
        // message each, in one span. A redacted block carries no text to show.
        const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
        const thoughts = blocks
          .map((block) => record(block))
          .filter((block) => block.type === 'thinking')
          .map((block) => text(block.content))
          .filter((content): content is string => content !== undefined && content.length > 0);
        if (thoughts.length === 0) return;
        closeReasoning(scope, out);
        const messageIds = thoughts.map(() => ids.next('reasoning', address).id);
        const span = messageIds[0] as string;
        out.push({
          type: 'REASONING_START',
          messageId: span,
          ...owned(scope, event),
          metadata: addressOf(event),
        });
        thoughts.forEach((content, i) => {
          const messageId = messageIds[i] as string;
          out.push({
            type: 'REASONING_MESSAGE_START',
            messageId,
            role: 'reasoning',
            ...owned(scope, event),
          });
          out.push({
            type: 'REASONING_MESSAGE_CONTENT',
            messageId,
            delta: content,
            ...owned(scope, event),
          });
          out.push({ type: 'REASONING_MESSAGE_END', messageId, ...owned(scope, event) });
        });
        out.push({ type: 'REASONING_END', messageId: span, ...owned(scope, event) });
        return;
      }
      case 'agentfootprint.stream.tool_start': {
        const scope = scopeOf(path);
        // The call's arguments are complete before it runs: a model's text
        // message for this call is over, and so is its reasoning.
        closeText(scope, out);
        closeReasoning(scope, out);
        // Every call of one LLM response belongs to ONE assistant message: the
        // call's text message when it wrote any, else a message minted at the
        // LLM call's own address for the first call and held for the rest.
        if (scope.callMessageId === undefined)
          scope.callMessageId = ids.next('text', scope.llmAddress ?? address).id;
        const { id, n } = ids.next('tool', address);
        scope.calls.push({ id, n, address, servedId: payload.toolCallId });
        const toolCallName = text(payload.toolName) ?? '';
        out.push({
          type: 'TOOL_CALL_START',
          toolCallId: id,
          toolCallName,
          parentMessageId: scope.callMessageId,
          ...owned(scope, event),
          metadata: addressOf(event, { toolCallId: text(payload.toolCallId) }),
        });
        out.push({
          type: 'TOOL_CALL_ARGS',
          toolCallId: id,
          delta: toWireJson(payload.args ?? {}),
          ...owned(scope, event),
        });
        out.push({ type: 'TOOL_CALL_END', toolCallId: id, ...owned(scope, event) });
        return;
      }
      case 'agentfootprint.stream.tool_end': {
        const scope = scopeOf(path);
        const call = takeCall(scope, address, payload.toolCallId);
        if (call === undefined) {
          // A result the record cannot tie to a call this run opened — never
          // attached to a call it may not belong to (CUSTOM only if listed).
          pushCustom(event, scope, out);
          return;
        }
        // A frontend tool's result is the one the client sent: it holds it already.
        if (call.client === true) return;
        // A FAILED call's result is the thrown text — a connection string, a
        // stack line, a provider's body. A person reads the fixed words unless
        // the app chose to serve the record's own.
        // Any `error` but an explicit `false` counts — under a policy that
        // selects the key, the flag itself is served as the placeholder.
        const failed =
          payload.error !== undefined && payload.error !== false && toolErrors !== 'served';
        out.push({
          type: 'TOOL_CALL_RESULT',
          messageId:
            call.n < 0 ? ids.next('result', address).id : ids.at('result', call.n, call.address),
          toolCallId: call.id,
          content: failed ? AG_UI_TOOL_FAILED : resultText(payload.result),
          role: 'tool',
          ...owned(scope, event),
        });
        return;
      }
      case 'agentfootprint.pause.request':
        pause = { event, scope: scopeOf(path) };
        return;
      case 'agentfootprint.error.fatal': {
        // Only a FIXED sentence goes to a browser. The record's own fallback
        // quotes the raw thrown message ("The AI call failed: …"), which may
        // hold anything a provider or a tool put in it.
        const said = text(payload.error);
        if (said !== undefined && isFixedFailure(said)) fatal = said;
        return;
      }
      default:
        pushCustom(event, scopeOf(path), out);
    }
  };

  /**
   * The open call a `tool_end` closes. One agent runs its calls one at a time,
   * so the open call at the result's stage execution is the one it answers;
   * where the record still names the call (no redaction policy), the id
   * decides among several.
   */
  function takeCall(scope: Scope, address: string, servedId: unknown): OpenCall | undefined {
    let at = -1;
    for (let i = scope.calls.length - 1; i >= 0; i--) {
      const call = scope.calls[i] as OpenCall;
      if (call.address !== address) continue;
      if (at < 0) at = i;
      if (typeof servedId === 'string' && call.servedId === servedId) {
        at = i;
        break;
      }
    }
    // The call a paused run left open is answered by the first result in its
    // scope: the continuation's stage executions are new, so no address matches.
    if (at < 0) at = scope.calls.findIndex((call) => call.resumed === true);
    return at < 0 ? undefined : scope.calls.splice(at, 1)[0];
  }

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
      metadata: addressOf(event),
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
    settle(settlement) {
      if (settled) return [];
      settled = true;
      const out: AgUiEvent[] = [];
      start(out);
      switch (settlement.kind) {
        case 'failed':
          // A refusal by its code, in fixed words; otherwise the record's own
          // words for the failure — never the thrown value.
          out.push(
            settlement.refusal === 'ERR_ANSWER_VALIDATION'
              ? { type: 'RUN_ERROR', message: AG_UI_ANSWER_WITHHELD, code: settlement.refusal }
              : { type: 'RUN_ERROR', message: fatal ?? AG_UI_RUN_FAILED },
          );
          return out;
        case 'paused': {
          const { record, clientCall } = pausedRecord(settlement.awaiting);
          suspended = record;
          if (clientCall !== undefined) {
            // A tool the client runs: the run COMPLETED this segment and left
            // the call for the application to answer in its next input.
            endAllNested(out, () => (subagentRunId) => ({
              type: 'SUBAGENT_FINISHED',
              subagentRunId,
              outcome: { type: 'suspended' },
            }));
            closeContents(root, out);
            out.push({
              type: 'RUN_FINISHED',
              threadId,
              runId,
              outcome: { type: 'success', pendingToolCallIds: [clientCall] },
            });
            return out;
          }
          const interrupt = interruptOf();
          endAllNested(out, (scope) => (subagentRunId) => ({
            type: 'SUBAGENT_FINISHED',
            subagentRunId,
            outcome: {
              type: 'suspended',
              ...(pause?.scope === scope && { interruptIds: [interrupt.id] }),
            },
          }));
          closeContents(root, out);
          out.push({
            type: 'RUN_FINISHED',
            threadId,
            runId,
            outcome: { type: 'interrupt', interrupts: [interrupt] },
          });
          return out;
        }
        case 'cancelled':
          endAllNested(out, () => (subagentRunId) => ({
            type: 'SUBAGENT_ERROR',
            subagentRunId,
            message: AG_UI_SUBAGENT_CANCELLED,
            code: 'cancelled',
          }));
          closeContents(root, out);
          out.push({
            type: 'RUN_FINISHED',
            threadId,
            runId,
            outcome: { type: 'cancelled' },
          });
          return out;
        case 'finished':
          endAllNested(out, () => unfinished);
          closeContents(root, out);
          out.push({
            type: 'RUN_FINISHED',
            threadId,
            runId,
            ...(rootResult !== undefined && { result: rootResult }),
          });
          return out;
      }
    },
    suspension: (awaiting) => {
      if (settled) return suspended;
      return pausedRecord(awaiting).record;
    },
  };
}

/**
 * The question a pause put to a person, from whichever home its kind keeps it
 * in: a plain ask (`askHuman` / `pauseHere` / an input request) at the top, a
 * middleware's ask on `ask.question`, a check-in as the plain-words claim of
 * what the tool will do (`checkIn.evidence.willDo`).
 */
function questionOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  return (
    text(payload.question) ??
    text(record(payload.ask).question) ??
    text(record(record(payload.checkIn).evidence).willDo)
  );
}

/** A composition's step name: its kind, and where it is mounted when it is not the run itself. */
function compositionStep(kind: unknown, path: readonly string[]): string {
  const name = typeof kind === 'string' && kind.length > 0 ? kind : 'Composition';
  return path.length === 0 ? name : `${name}:${path.join('/')}`;
}
