import type { ToolStartPayload } from '../../../../events/payloads.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';
import { sha256Hex } from '../../../../lib/sha256.js';
import type { OtelObservabilityOptions, OtelSpanLike } from '../types.js';
import type { TurnState, TurnStore } from '../turns/state.js';
import { anchorRunId, sessionOf, conversationAttr } from '../turns/metadata.js';
import type { SpanWriter } from '../spans/writer.js';
import type { ToolContent, ToolEndLike } from '../content/tools.js';
import type { Explainability } from './explainability.js';
import type { LateEvents } from './late.js';
import { bound, boundList, spanNamePart } from '../attributes/bounds.js';
import type { Attrs } from '../attributes/projections.js';

/** The batch settlement's marker (9.113.0), as the canonical field defines it. */
type SettledMarker = NonNullable<ToolStartPayload['notDispatched']>;

/**
 * The same marker as an event reaching this adapter carries it — DERIVED from
 * the canonical field (one definition), every level optional because the
 * adapter also takes hand-fed streams.
 */
type SettledMarkerLike = { readonly [K in keyof SettledMarker]?: Partial<SettledMarker[K]> };

interface DispatchOptions {
  readonly opts: OtelObservabilityOptions;
  readonly sampleRate: number;
  readonly genAiNames: boolean;
  readonly explainability: boolean;
  readonly captureContent: boolean;
  readonly captureToolContent: boolean;
  readonly maxContentChars: number;
  readonly rawConversationId: boolean;
  readonly lifecycle: { stopped: boolean };
  readonly turns: Pick<
    TurnStore,
    | 'activeTurns'
    | 'closedTurns'
    | 'forgottenRuns'
    | 'ranTools'
    | 'codeRunners'
    | 'remember'
    | 'rememberClosed'
  >;
  readonly spans: Pick<
    SpanWriter,
    'pushSpan' | 'popSpan' | 'endSpan' | 'setAttrs' | 'recordSpanEvent' | 'topSpan'
  >;
  readonly content: ToolContent;
  readonly explanation: Explainability;
  readonly late: LateEvents;
}

export function createEventDispatcher({
  opts,
  sampleRate,
  genAiNames,
  explainability,
  captureContent,
  captureToolContent,
  maxContentChars,
  rawConversationId,
  lifecycle,
  turns,
  spans,
  content,
  explanation,
  late,
}: DispatchOptions) {
  const {
    activeTurns,
    closedTurns,
    forgottenRuns,
    ranTools,
    codeRunners,
    remember,
    rememberClosed,
  } = turns;
  const { pushSpan, popSpan, endSpan, setAttrs, recordSpanEvent, topSpan } = spans;
  const { snapshotArgs, toolContent } = content;
  const { handleExplainability, flushStandings } = explanation;
  const { handleDisposition, handleEvalScore } = late;
  /** `gen_ai.task.<input|output>`, or its size when over `maxContentChars`. */
  function taskContent(kind: 'input' | 'output', text: string): Attrs {
    return text.length > maxContentChars
      ? { [`agentfootprint.task.${kind}.omitted_chars`]: text.length }
      : { [`gen_ai.task.${kind}`]: text };
  }

  // ─── Event-to-span dispatch ────────────────────────────────────────

  function handleEvent(event: AgentfootprintEvent): void {
    if (lifecycle.stopped) return;
    const runId = anchorRunId(event);
    if (!runId) return; // Events without a turn anchor — skip.

    switch (event.type) {
      case 'agentfootprint.agent.turn_start': {
        const sampled = sampleRate >= 1 || Math.random() < sampleRate;
        // The CONVERSATION this run belongs to: `meta.sessionId` (9.4.0),
        // stamped by `run(input, { sessionId })` and by `standingAgent` from
        // the request's own session — the one a `SessionLifecycle` store
        // (9.26.0) persists. It is the spec's `gen_ai.conversation.id` exactly:
        // "the unique identifier for a conversation (session, thread)", and
        // the spec rules out a stand-in ("a new UUID, a trace identifier …
        // SHOULD NOT be used"), so a run that is not session-bound gets none —
        // never the runId, which names ONE turn and would merge nothing and
        // split everything in a backend's session view.
        //
        // WRITTEN AS A DIGEST by default (`conversationId`): at a door with no
        // verifier the session id is the handle to the conversation, and a
        // trace backend is read by many more people than the browser that
        // minted it. The digest groups exactly as the id would; the raw id is
        // an opt-in for doors that verify who may open a conversation.
        const sessionId = sessionOf(event);
        const sessionDigest = sessionId !== undefined ? sha256Hex(sessionId) : undefined;
        const turnState: TurnState = {
          stack: [],
          sampled,
          toolSpans: new Map(),
          toolNames: new Map(),
          standingEvents: 0,
          standingOmitted: 0,
          proposedArgs: new Map(),
          ...(sessionId !== undefined && {
            conversationId: rawConversationId ? sessionId : sessionDigest,
            sessionDigest,
          }),
        };
        activeTurns.set(runId, turnState);
        closedTurns.delete(runId);
        forgottenRuns.delete(runId);
        if (sampled) {
          const turnIndex = (event.payload as { turnIndex?: number }).turnIndex;
          // `invoke_agent` span per the GenAI agent-span conventions.
          // `gen_ai.provider.name` / `gen_ai.request.model` (conditionally
          // required) are back-filled on the first llm_start — unknown here.
          // `userPrompt` rides the span ONLY when the consumer asked for it
          // (`captureContent`) — see that option for what enabling it exports.
          // `agentfootprint.run.id` names the run (one turn) beside the
          // conversation id above — one session, many runs.
          // WHO the run is for (9.11.0). This adapter maps selected signals
          // onto spans rather than serializing the envelope — unlike the
          // file / CloudWatch / AgentCore sinks, which write
          // `JSON.stringify(event)` and inherit every meta field for free — so
          // the actor has to be placed deliberately or it would not appear at
          // all. Own namespace, not `enduser.id`: the semconv name for this has
          // moved once already, and quietly claiming a convention we do not
          // track is worse than a name that says whose field it is.
          const actor = (event as { meta?: { principal?: string; tenant?: string } }).meta;
          turnState.root = pushSpan(
            turnState,
            genAiNames ? `invoke_agent ${opts.serviceName}` : opts.serviceName,
            {
              'service.name': opts.serviceName,
              'gen_ai.operation.name': 'invoke_agent',
              'gen_ai.agent.name': opts.serviceName,
              ...conversationAttr(turnState),
              'agentfootprint.run.id': runId,
              ...(typeof turnIndex === 'number' && { 'agentfootprint.turn.index': turnIndex }),
              // Absent when nobody named one — an anonymous run gets no
              // attribute rather than an empty string.
              ...(actor?.principal !== undefined && {
                'agentfootprint.principal.id': actor.principal,
              }),
              ...(actor?.tenant !== undefined && { 'agentfootprint.tenant.id': actor.tenant }),
              ...(captureContent &&
                typeof (event.payload as { userPrompt?: unknown }).userPrompt === 'string' && {
                  ...taskContent('input', (event.payload as { userPrompt: string }).userPrompt),
                }),
            },
          );
        }
        break;
      }

      case 'agentfootprint.agent.turn_end': {
        const t = activeTurns.get(runId);
        if (!t) break;
        if (t.root) {
          // Turn-total usage on the invoke_agent span (semconv allows
          // usage attrs on agent spans) + the iteration count.
          const p = event.payload as {
            totalInputTokens?: number;
            totalOutputTokens?: number;
            iterationCount?: number;
            finalContent?: string;
          };
          setAttrs(t.root, {
            ...(captureContent &&
              typeof p.finalContent === 'string' &&
              taskContent('output', p.finalContent)),
            ...(typeof p.totalInputTokens === 'number' && {
              'gen_ai.usage.input_tokens': p.totalInputTokens,
            }),
            ...(typeof p.totalOutputTokens === 'number' && {
              'gen_ai.usage.output_tokens': p.totalOutputTokens,
            }),
            ...(typeof p.iterationCount === 'number' && {
              'agentfootprint.iteration.count': p.iterationCount,
            }),
          });
        }
        // A count per findings standing (only when the turn filed any) and the
        // overflow summary (only when the per-turn cap held rows back).
        flushStandings(t);
        // Defensive: end everything still on the stack.
        while (t.stack.length > 0) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        activeTurns.delete(runId);
        rememberClosed(runId, t);
        break;
      }

      case 'agentfootprint.agent.iteration_start': {
        const t = activeTurns.get(runId);
        if (t?.sampled) {
          const iteration =
            (event.payload as { iterIndex?: number; iteration?: number }).iterIndex ??
            (event.payload as { iteration?: number }).iteration;
          pushSpan(t, `iteration:${iteration ?? '?'}`, {
            ...(typeof iteration === 'number' && { 'iteration.number': iteration }),
          });
        }
        break;
      }

      case 'agentfootprint.agent.iteration_end': {
        const t = activeTurns.get(runId);
        if (t?.sampled) {
          const span = popSpan(t, (name) => name.startsWith('iteration:'));
          if (span) {
            const toolCallCount = (event.payload as { toolCallCount?: number }).toolCallCount;
            if (typeof toolCallCount === 'number')
              setAttrs(span, { 'agentfootprint.tool_call.count': toolCallCount });
            endSpan(span);
          }
        }
        break;
      }

      case 'agentfootprint.stream.llm_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as { model?: string; provider?: string; temperature?: number };
        // Inference span per GenAI semconv: operation `chat`.
        // `gen_ai.provider.name` passes the adapter's provider id through
        // unchanged — 'anthropic' / 'openai' / 'cohere' are already
        // well-known semconv values; others ride as custom values (the
        // spec permits them).
        pushSpan(t, genAiNames && p.model ? `chat ${spanNamePart(p.model)}` : 'llm', {
          'gen_ai.operation.name': 'chat',
          ...(p.model !== undefined && { 'gen_ai.request.model': p.model }),
          ...(p.provider !== undefined && { 'gen_ai.provider.name': p.provider }),
          ...(typeof p.temperature === 'number' && {
            'gen_ai.request.temperature': p.temperature,
          }),
          // Conditionally Required on inference spans "if available" (spec).
          ...conversationAttr(t),
        });
        // Back-fill the conditionally-required agent-span attrs now that
        // the first inference call reveals provider + model.
        if (t.root && t.rootEnriched !== true) {
          t.rootEnriched = true;
          setAttrs(t.root, {
            ...(p.provider !== undefined && { 'gen_ai.provider.name': p.provider }),
            ...(p.model !== undefined && { 'gen_ai.request.model': p.model }),
          });
        }
        break;
      }

      case 'agentfootprint.stream.llm_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const span = popSpan(t, (name) => name === 'llm' || name.startsWith('chat'));
        if (!span) break;
        const p = event.payload as {
          usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
          stopReason?: string;
          providerResponseRef?: string;
        };
        // Response-side semconv attrs. `content` is deliberately NOT
        // emitted (PII) — the snapshot/audit-log channel carries it
        // under the consumer's redaction policy.
        setAttrs(span, {
          ...(typeof p.usage?.input === 'number' && {
            'gen_ai.usage.input_tokens': p.usage.input,
          }),
          ...(typeof p.usage?.output === 'number' && {
            'gen_ai.usage.output_tokens': p.usage.output,
          }),
          ...(typeof p.usage?.cacheRead === 'number' && {
            'gen_ai.usage.cache_read.input_tokens': p.usage.cacheRead,
          }),
          ...(typeof p.usage?.cacheWrite === 'number' && {
            'gen_ai.usage.cache_creation.input_tokens': p.usage.cacheWrite,
          }),
          ...(typeof p.stopReason === 'string' && {
            'gen_ai.response.finish_reasons': [p.stopReason] as readonly string[],
          }),
          ...(typeof p.providerResponseRef === 'string' && {
            'gen_ai.response.id': p.providerResponseRef,
          }),
        });
        endSpan(span);
        break;
      }

      case 'agentfootprint.stream.tool_start': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as {
          toolName?: string;
          toolCallId?: string;
          args?: Record<string, unknown>;
          protocol?: string;
          notDispatched?: SettledMarkerLike;
        };
        const toolName = p.toolName ?? 'tool';
        // A call the batch settlement answered (9.113.0) never executed, so it
        // gets no `execute_tool` span — one would claim an execution that
        // never happened. The fact is a library decision, recorded like every
        // other one here: a span event on the active span (SYNTHESIZED name).
        // Only on a leg this adapter traces — see the header's KNOWN LIMIT.
        if (p.notDispatched !== undefined) {
          const top = topSpan(t);
          if (top) {
            const paused = p.notDispatched.pausedCall;
            recordSpanEvent(top, 'agentfootprint.tool.not_dispatched', {
              'gen_ai.tool.name': toolName,
              ...(p.toolCallId !== undefined && { 'gen_ai.tool.call.id': p.toolCallId }),
              ...(paused?.toolCallId !== undefined && {
                'agentfootprint.tool.paused_call.id': paused.toolCallId,
              }),
              ...(paused?.toolName !== undefined && {
                'agentfootprint.tool.paused_call.name': paused.toolName,
              }),
            });
          }
          break;
        }
        // Tool-execution span per GenAI semconv (`execute_tool`).
        // Args: top-level key NAMES by default. The values ride
        // `gen_ai.tool.call.arguments` — Opt-In in the spec, because they are
        // raw (PII / prompt-injection echo) — ONLY under `captureToolContent`,
        // SNAPSHOTTED here (serialized now — the tool receives this same
        // object and may write into it) and exported at `tool_end`, once the
        // rules have named the keys they changed (`changedArgKeys`).
        const argKeys =
          p.args !== undefined && typeof p.args === 'object' ? Object.keys(p.args) : [];
        const nameInSpan = spanNamePart(toolName);
        const span = pushSpan(t, genAiNames ? `execute_tool ${nameInSpan}` : `tool:${nameInSpan}`, {
          'tool.name': toolName,
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': toolName,
          ...(p.toolCallId !== undefined && { 'gen_ai.tool.call.id': p.toolCallId }),
          ...(p.protocol !== undefined && { 'agentfootprint.tool.protocol': p.protocol }),
          ...(argKeys.length > 0 && { 'agentfootprint.tool.args.keys': boundList(argKeys) }),
          // Conditionally Required on execute_tool spans "if available" (spec).
          ...conversationAttr(t),
        });
        if (p.toolCallId !== undefined) {
          t.toolSpans.set(p.toolCallId, span);
          t.toolNames.set(p.toolCallId, toolName);
          if (captureToolContent) t.proposedArgs.set(p.toolCallId, snapshotArgs(toolName, p.args));
        }
        break;
      }

      case 'agentfootprint.stream.tool_end': {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        const p = event.payload as ToolEndLike;
        // A settled call's tool_start opened no span (see tool_start), so its
        // tool_end closes nothing — and must never reach the name-less
        // fallback below, which would pop whatever tool span is on top.
        if (p.notDispatched !== undefined) break;
        const errored = p.error !== undefined && p.error !== false;
        const ranName = p.toolCallId !== undefined ? t.toolNames.get(p.toolCallId) : undefined;
        if (p.toolCallId !== undefined) t.toolNames.delete(p.toolCallId);
        // A call that returned without error and was not refused is a tool this
        // agent holds — what a `tryInsteadTool` name is recognized by. (A call
        // declined on resume passes too: `answer-account/README.md`, "Not covered yet".)
        if (ranName !== undefined && !errored && p.notExecuted !== true)
          remember(ranTools, ranName);
        // Correlate by toolCallId (the only identity ToolEndPayload
        // carries) — parallel tool calls end out of LIFO order, so name
        // matching alone would close the wrong span. Fallback chain
        // keeps legacy hand-fed events (toolName) working.
        let span: OtelSpanLike | undefined;
        if (p.toolCallId !== undefined && t.toolSpans.has(p.toolCallId)) {
          span = t.toolSpans.get(p.toolCallId);
          t.toolSpans.delete(p.toolCallId);
          // Remove from the stack by identity so the LIFO unwind stays clean.
          const idx = t.stack.findIndex((entry) => entry.span === span);
          if (idx >= 0) t.stack.splice(idx, 1);
        } else {
          span = popSpan(
            t,
            p.toolName !== undefined
              ? (name): boolean =>
                  name === `tool:${spanNamePart(p.toolName ?? '')}` ||
                  name === `execute_tool ${spanNamePart(p.toolName ?? '')}`
              : (name): boolean => name.startsWith('tool:') || name.startsWith('execute_tool '),
          );
        }
        if (!span) break;
        // Result: TYPE by default — never the value (PII discipline; mirrors
        // the #9 contract). Content only under `captureToolContent`
        // (`toolContent`): the proposal with rule-changed keys withheld, and
        // what the model read.
        setAttrs(span, {
          'agentfootprint.tool.result.type': p.result === null ? 'null' : typeof p.result,
          ...(errored && { 'error.type': '_OTHER' }), // boolean error flag — no class info
          ...(captureToolContent && toolContent(t, p, errored)),
        });
        endSpan(span, { error: errored });
        break;
      }

      // A fatal run error: the turn will never see turn_end, so close
      // the span tree here (ERROR on root) instead of leaking it until
      // stop(). Stage + scope only — error MESSAGES can echo PII.
      case 'agentfootprint.error.fatal': {
        const t = activeTurns.get(runId);
        if (!t) break;
        const p = event.payload as { stage?: string; scope?: string };
        if (t.root) {
          recordSpanEvent(t.root, 'agentfootprint.error.fatal', {
            ...(p.stage !== undefined && { 'agentfootprint.error.stage': bound(p.stage) }),
            ...(p.scope !== undefined && { 'agentfootprint.error.scope': bound(p.scope) }),
          });
        }
        flushStandings(t);
        while (t.stack.length > 1) {
          const span = popSpan(t);
          if (span) endSpan(span);
        }
        const root = popSpan(t);
        if (root) endSpan(root, { error: true });
        activeTurns.delete(runId);
        // The run door's `finally` still files its checker accounting.
        rememberClosed(runId, t);
        break;
      }

      // A code runner ran: its NAME marks its calls' arguments (the program)
      // as never exported. Names only; the event carries no code.
      case 'agentfootprint.tools.code_run': {
        const tool = (event.payload as { tool?: unknown }).tool;
        if (typeof tool === 'string') remember(codeRunners, tool);
        break;
      }

      // Late-capable events: they may name a turn that has already closed.
      case 'agentfootprint.eval.score': {
        handleEvalScore(event, runId);
        break;
      }
      case 'agentfootprint.integrity.disposition': {
        if (explainability) handleDisposition(event, runId);
        break;
      }

      // Other events — annotate / record on the topmost active span.
      default: {
        const t = activeTurns.get(runId);
        if (!t?.sampled) break;
        // Cost ticks are particularly valuable as attributes.
        if (event.type === 'agentfootprint.cost.tick') {
          const top = topSpan(t);
          if (!top) break;
          // Runtime shape: `cumulative.estimatedUsd` (CostTickPayload).
          // Legacy fallback `cumulativeCostUsd` keeps hand-fed events
          // working (the pre-6.17 fabricated test shape).
          const p = event.payload as {
            cumulative?: { estimatedUsd?: number };
            cumulativeCostUsd?: number;
          };
          const usd = p.cumulative?.estimatedUsd ?? p.cumulativeCostUsd;
          if (typeof usd === 'number') setAttrs(top, { 'cost.cumulative_usd': usd });
          break;
        }
        if (explainability) handleExplainability(event, t);
        break;
      }
    }
  }

  return handleEvent;
}
