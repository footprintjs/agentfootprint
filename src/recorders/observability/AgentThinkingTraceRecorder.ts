/**
 * AgentThinkingTraceRecorder — produce an AgentThinkingUI `Trace` from a run.
 *
 * AgentThinkingUI (the "watch it think" player) consumes a framework-agnostic
 * `Trace` — a list of beats: `prompt → ask → return → answer`, where a tool
 * reply is `data` (reason) or an `instruction` (a skill that says how to act).
 * This recorder builds that `Trace` from agentfootprint's emit stream AS THE RUN
 * TRAVERSES (no post-processing) — so any agentfootprint agent gets the
 * domain-expert view for free, and AgentThinkingUI stays vendor-agnostic (it
 * just renders the `Trace` JSON, exactly as it renders the OTLP adapter's output).
 *
 * Mapping (from the events already on the stream):
 *   stream.llm_end (toolCalls>0)  → the brain reasoned; content + usage become
 *                                   the upcoming ask's `brain` + `cost`.
 *   stream.llm_end (toolCalls==0) → the final `answer`.
 *   stream.tool_start             → `ask`  (read_skill → reaching for a skill).
 *   stream.tool_end               → `return` (read_skill → replyType:'instruction'
 *                                   + skill; any other tool → replyType:'data').
 *
 * Commentary (each beat's `brain`): filled from agentfootprint's OWN commentary
 * engine — the SAME `selectCommentaryKey`/`extractCommentaryVars`/`renderCommentary`
 * the Lens uses — so AgentThinkingUI's Notepad / bottom caption read identically
 * to the Lens commentary panel (one engine, consumer-overridable via
 * `commentaryTemplates`). The LLM's own reasoning still wins on the first ask of
 * an iteration; the engine fills every other beat so no line is ever blank.
 *
 * Convention 1 (one purpose) + Convention 4 (run-scoped — resets per run).
 */

import type { EmitEvent, EmitRecorder } from 'footprintjs';
import type { AgentfootprintEvent } from '../../events/registry.js';
import {
  defaultCommentaryTemplates,
  selectCommentaryKey,
  extractCommentaryVars,
  renderCommentary,
  type CommentaryTemplates,
} from './commentary/commentaryTemplates.js';

// ── The AgentThinkingUI Trace contract (kept inline so agentfootprint does NOT
//    depend on the agentThinkingui package — it emits the documented JSON shape).
export interface AttCost {
  ms: number;
  tokens: number;
  tokensIn?: number;
  tokensOut?: number;
  tokensCached?: number;
}
export interface AttAnswer {
  headline: string;
  [key: string]: unknown;
}
export type AttStep =
  | { kind: 'prompt'; brain: string; cost: AttCost }
  | {
      kind: 'ask';
      tool: string;
      toolName?: string;
      input: Record<string, unknown>;
      brain: string;
      cost: AttCost;
    }
  | {
      kind: 'return';
      tool: string;
      toolName?: string;
      replyType: 'data' | 'instruction' | 'both';
      output: Record<string, unknown>;
      brain: string;
      cost: AttCost;
      brainMode?: 'reason' | 'act';
      skill?: string;
      error?: string;
    }
  | { kind: 'answer'; to: string; brain: string; answer: AttAnswer; cost: AttCost; error?: string };
export interface AttTrace {
  task: string;
  title?: string;
  agent: string;
  model: string;
  asker: string;
  steps: AttStep[];
}

export interface AgentThinkingTraceOptions {
  readonly id?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly asker?: string;
  /**
   * Override agentfootprint's bundled commentary templates — the SAME shape as
   * the Lens's `commentaryTemplates` prop (partial; spread over the defaults).
   * Drives each beat's `brain` narration, so AgentThinkingUI's Notepad / bottom
   * caption read like the Lens commentary panel — one engine, one voice,
   * consumer-overridable. Omit to use the bundled English defaults.
   */
  readonly commentaryTemplates?: Partial<CommentaryTemplates>;
}

export interface AgentThinkingTraceHandle extends EmitRecorder {
  /** The AgentThinkingUI `Trace` for the run so far. `task` (the headline of the
   *  replay pill) defaults to the captured user message; override any field. */
  getTrace(
    overrides?: Partial<Pick<AttTrace, 'task' | 'title' | 'agent' | 'model' | 'asker'>>,
  ): AttTrace;
  clear(): void;
}

const LLM_END = 'agentfootprint.stream.llm_end';
const TOOL_START = 'agentfootprint.stream.tool_start';
const TOOL_END = 'agentfootprint.stream.tool_end';

function asObject(x: unknown): Record<string, unknown> {
  if (x != null && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>;
  return { value: x };
}
function headlineOf(s: string): string {
  const line = (s ?? '').split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.length > 140 ? line.slice(0, 140) + '…' : line || 'Done';
}
/** `EmitEvent.subflowPath` may arrive as a `/`-joined string or already split;
 *  normalize to the array shape the commentary engine's `extractAgentName` reads. */
function splitPath(p: unknown): string[] {
  if (Array.isArray(p)) return p as string[];
  if (typeof p === 'string' && p.length > 0) return p.split('/');
  return [];
}

export function agentThinkingTrace(
  options: AgentThinkingTraceOptions = {},
): AgentThinkingTraceHandle {
  let lastPipelineId: string | undefined;
  let task = '';
  let steps: AttStep[] = [];
  // The most recent reasoning + its cost, awaiting the iteration's ask step(s).
  let pendingBrain = '';
  let pendingCost: AttCost = { ms: 0, tokens: 0 };
  let pendingCostUsed = false;
  const byId = new Map<string, { toolName: string; isSkill: boolean; skillId?: string }>();

  // Commentary engine — the SAME one the Lens uses. Merged once: consumer
  // overrides spread over the bundled defaults.
  const templates: CommentaryTemplates = options.commentaryTemplates
    ? ({ ...defaultCommentaryTemplates, ...options.commentaryTemplates } as CommentaryTemplates)
    : defaultCommentaryTemplates;
  const appName = options.agent ?? 'Agent';

  /** Narrate one emit event into a prose `brain` line via agentfootprint's
   *  commentary engine. The raw `EmitEvent` is adapted to the typed
   *  `AgentfootprintEvent` shape the engine reads (`type`/`payload`/`meta`).
   *  Returns '' for events the engine deliberately skips. */
  function narrate(e: EmitEvent): string {
    const ev = {
      type: e.name,
      payload: e.payload,
      meta: { subflowPath: splitPath(e.subflowPath) },
    } as unknown as AgentfootprintEvent;
    const key = selectCommentaryKey(ev);
    if (!key) return '';
    const vars = extractCommentaryVars(ev, { appName }, templates);
    return renderCommentary(templates[key] ?? '', vars);
  }

  function reset(): void {
    task = '';
    steps = [];
    pendingBrain = '';
    pendingCost = { ms: 0, tokens: 0 };
    pendingCostUsed = false;
    byId.clear();
  }

  return {
    id: options.id ?? 'agent-thinking-trace',

    onEmit(e: EmitEvent): void {
      if (lastPipelineId !== undefined && e.pipelineId !== lastPipelineId) reset();
      lastPipelineId = e.pipelineId;

      if (e.name === LLM_END) {
        const p = e.payload as {
          content?: string;
          toolCallCount?: number;
          usage?: { input?: number; output?: number; cacheRead?: number };
          durationMs?: number;
        };
        const cost: AttCost = {
          ms: p.durationMs ?? 0,
          tokens: (p.usage?.input ?? 0) + (p.usage?.output ?? 0),
          tokensIn: p.usage?.input,
          tokensOut: p.usage?.output,
          tokensCached: p.usage?.cacheRead,
        };
        if ((p.toolCallCount ?? 0) === 0) {
          // No tool calls → this is the final answer.
          const content = p.content ?? '';
          steps.push({
            kind: 'answer',
            to: options.asker ?? 'you',
            brain: content,
            answer: { headline: headlineOf(content), text: content },
            cost,
          });
        } else {
          // Reasoning that will drive the upcoming ask step(s) this iteration.
          pendingBrain = p.content ?? '';
          pendingCost = cost;
          pendingCostUsed = false;
        }
        return;
      }

      if (e.name === TOOL_START) {
        const p = e.payload as { toolName?: string; toolCallId?: string; args?: unknown };
        if (!p?.toolCallId) return;
        const isSkill = p.toolName === 'read_skill';
        const skillId = isSkill
          ? (p.args as { id?: string } | undefined)?.id ?? undefined
          : undefined;
        byId.set(p.toolCallId, { toolName: p.toolName ?? '(tool)', isSkill, skillId });
        steps.push({
          kind: 'ask',
          tool: isSkill ? skillId ?? 'skill' : p.toolName ?? '(tool)',
          toolName: p.toolName,
          input: asObject(p.args),
          // First ask of the iteration carries the LLM's own reasoning; later
          // asks (and the reasoning-less ones) fall back to engine commentary so
          // the Notepad never shows a blank line.
          brain: pendingCostUsed ? narrate(e) : pendingBrain || narrate(e),
          cost: pendingCostUsed ? { ms: 0, tokens: 0 } : pendingCost, // attribute the LLM cost to the first ask of the iteration
        });
        pendingCostUsed = true;
        return;
      }

      if (e.name === TOOL_END) {
        const p = e.payload as {
          toolCallId?: string;
          result?: unknown;
          durationMs?: number;
          error?: boolean;
        };
        const started = p?.toolCallId ? byId.get(p.toolCallId) : undefined;
        if (!started) return;
        byId.delete(p!.toolCallId!);
        steps.push({
          kind: 'return',
          tool: started.isSkill ? started.skillId ?? 'skill' : started.toolName,
          toolName: started.toolName,
          replyType: started.isSkill ? 'instruction' : 'data',
          output: asObject(p!.result),
          // The tool-result beat has no LLM reasoning of its own — narrate the
          // mechanics via the commentary engine (matches the Lens).
          brain: narrate(e),
          brainMode: started.isSkill ? 'act' : 'reason',
          ...(started.isSkill && started.skillId ? { skill: started.skillId } : {}),
          cost: { ms: p!.durationMs ?? 0, tokens: 0 },
          ...(p!.error ? { error: 'tool failed' } : {}),
        });
      }
    },

    getTrace(overrides = {}): AttTrace {
      const prompt: AttStep = {
        kind: 'prompt',
        brain: overrides.task ?? task,
        cost: { ms: 0, tokens: 0 },
      };
      return {
        task: overrides.task ?? task,
        ...(overrides.title ? { title: overrides.title } : {}),
        agent: overrides.agent ?? options.agent ?? 'Agent',
        model: overrides.model ?? options.model ?? 'model',
        asker: overrides.asker ?? options.asker ?? 'you',
        steps: [prompt, ...steps],
      };
    },

    clear(): void {
      reset();
      lastPipelineId = undefined;
    },
  };
}
