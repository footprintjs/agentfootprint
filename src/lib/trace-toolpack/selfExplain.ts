/**
 * selfExplain — the IN-CONVERSATION door over the agent's own trace.
 *
 * `.selfExplain()` on the builder mounts ONE skill plus ONE scoped tool
 * provider. Day to day the tool catalog carries only the skill's
 * activation row — the trace tools are NOT in the skill (skill `tools`
 * land in the static registry, exposed every iteration); they ride a
 * `skillScopedTools` provider gated on the skill's activation, composed
 * with whatever provider the consumer already set. When the user asks a
 * why-question the LLM activates the skill, and the NEXT iteration's
 * catalog gains the trace tools, bound to the agent's own PREVIOUS
 * COMPLETED run.
 *
 * The two pieces here:
 *
 * 1. `SelfExplainBinding` — the late-binding seam, a plain CombinedRecorder
 *    attached like any consumer recorder (zero engine changes):
 *
 *      - capture at `onRunEnd`/`onRunFailed`: the just-finished run's
 *        snapshot becomes the explainable evidence (a FAILED run is
 *        still a completed trace — "why did you fail?" works);
 *      - rotate at `onRunStart`: a FRESH ControlDepRecorder per run. The
 *        retired instance never sees the new run's events, so its live
 *        `asLookup()` survives Convention-4's runId reset — the captured
 *        control edges stay valid for the whole next turn.
 *
 *    B13 safety lives here: `Agent.run()` reassigns its executor at run
 *    START, so resolving artifacts mid-run through `getLastSnapshot()`
 *    would expose the IN-FLIGHT run. Capturing only at terminal flush
 *    means the binding can never serve anything but a completed run.
 *
 * 2. `buildSelfExplainSkill` — the skill in two modes:
 *
 *      - INLINE (default): the skill unlocks the 5 trace tools in the
 *        main agent's own loop (same model).
 *      - DELEGATE: the skill unlocks ONE tool — `explain_run(question)` —
 *        whose execute runs a nested `traceDebugAgent` on the consumer's
 *        chosen (cheaper) provider/model and returns its evidence-cited
 *        answer. The main conversation pays for one tool call; the
 *        trace-walking loop happens at the delegate's price. Loaded via
 *        dynamic import so the builder never statically pulls Agent
 *        through this module (no core ↔ lib cycle).
 */

import { isFlowEvent, type CombinedRecorder, type RuntimeSnapshot } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';

import { defineSkill } from '../injection-engine/factories/defineSkill.js';
import type { Injection } from '../injection-engine/types.js';
import { defineTool, type Tool } from '../../core/tools.js';
import type { AgentOptions } from '../../core/agent/types.js';
import { skillScopedTools } from '../../tool-providers/skillScopedTools.js';
import type { ToolProvider } from '../../tool-providers/types.js';
import { SELF_EXPLAIN_BODY, SELF_EXPLAIN_WHEN } from './debugPrompt.js';
import { lazyTraceToolpack, NO_COMPLETED_RUN_MESSAGE } from './lazyToolpack.js';
import type { TraceToolpackArtifacts, TraceToolpackOptions } from './types.js';

/** Consumer surface for `.selfExplain()` on the Agent builder. */
export interface SelfExplainOptions {
  /** Appended to the recommended skill body (ours stays; yours adds). */
  readonly instruction?: string;
  /**
   * Answer why-questions on a SEPARATE (typically cheaper) model: the
   * skill unlocks one `explain_run` tool that runs a nested
   * `traceDebugAgent` and returns its evidence-cited answer.
   */
  readonly delegate?: {
    readonly provider: AgentOptions['provider'];
    readonly model: string;
    readonly maxIterations?: number;
  };
  /** Skill id (activation key for `read_skill`). Default 'self-explain'. */
  readonly id?: string;
  /** Bounding dials forwarded to the toolpack. */
  readonly toolpack?: TraceToolpackOptions;
}

type CtrlRecorder = ReturnType<typeof controlDepRecorder>;

/**
 * The late-binding seam. Create one per built Agent, attach
 * `binding.recorder()` via `agent.attach()`, and point `bindTo()` at the
 * agent's `getLastSnapshot`. `artifacts` then always answers with the
 * previous COMPLETED run — never the in-flight one.
 */
export class SelfExplainBinding {
  private getSnapshot: (() => RuntimeSnapshot | undefined) | undefined;
  private ctrl: CtrlRecorder = controlDepRecorder();
  private captured: { snapshot: RuntimeSnapshot; ctrl: CtrlRecorder } | undefined;

  bindTo(getSnapshot: () => RuntimeSnapshot | undefined): void {
    this.getSnapshot = getSnapshot;
  }

  /** Evidence of the previous completed run, or undefined before the first. */
  get artifacts(): TraceToolpackArtifacts | undefined {
    if (!this.captured) return undefined;
    return {
      snapshot: this.captured.snapshot,
      controlDeps: this.captured.ctrl.asLookup(),
    };
  }

  /** The recorder to attach — forwards flow events to the per-run ctrl. */
  recorder(): CombinedRecorder {
    const capture = (): void => {
      const snapshot = this.getSnapshot?.();
      if (snapshot) this.captured = { snapshot, ctrl: this.ctrl };
    };
    return {
      id: 'self-explain-binding',
      // Inline always: capture must complete at the terminal flush, and
      // the ctrl forwarding is four cheap map writes per event.
      delivery: 'inline',
      onRunStart: () => {
        // Rotate FIRST: the retired ctrl never sees this run's events,
        // so the captured lookup survives Convention-4's runId reset.
        this.ctrl = controlDepRecorder();
      },
      onRunEnd: capture,
      onRunFailed: capture,
      onDecision: (e) => this.ctrl.onDecision(e),
      onSelected: (e) => this.ctrl.onSelected(e),
      onStageExecuted: (e) => this.ctrl.onStageExecuted(e),
      onError: (e) => {
        // ControlDepRecorder consumes FLOW errors only (branch-slot
        // accounting); scope errors don't carry traversal context.
        if (isFlowEvent(e)) this.ctrl.onError(e as Parameters<CtrlRecorder['onError']>[0]);
      },
    };
  }
}

/** The delegate-mode tool: one call → a nested debugger at delegate price. */
function buildExplainRunTool(
  binding: SelfExplainBinding,
  delegate: NonNullable<SelfExplainOptions['delegate']>,
  toolpack?: TraceToolpackOptions,
): Tool {
  return defineTool<{ question: string }, string>({
    name: 'explain_run',
    description:
      "Answer a question about this agent's PREVIOUS completed turn by walking its recorded " +
      'trace (a dedicated trace debugger runs the investigation and returns an evidence-cited ' +
      "answer). Pass the user's why-question verbatim.",
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The why-question to investigate.' },
      },
      required: ['question'],
      additionalProperties: false,
    },
    execute: async ({ question }) => {
      const artifacts = binding.artifacts;
      if (!artifacts) return NO_COMPLETED_RUN_MESSAGE;
      // Dynamic import: keeps Agent out of this module's static graph
      // (AgentBuilder imports this file; Agent imports AgentBuilder).
      const { traceDebugAgent } = await import('./traceDebugAgent.js');
      const debuggerAgent = traceDebugAgent({
        artifacts,
        provider: delegate.provider,
        model: delegate.model,
        maxIterations: delegate.maxIterations,
        toolpack,
      });
      const out = await debuggerAgent.run({ message: question });
      return typeof out === 'object' && out !== null && 'content' in out
        ? String((out as { content: unknown }).content)
        : String(out);
    },
  });
}

/** The default skill id — the activation key the LLM passes to read_skill. */
export const SELF_EXPLAIN_SKILL_ID = 'self-explain';

/**
 * The skill `.selfExplain()` mounts — methodology body ONLY. The trace
 * tools deliberately do NOT ride the skill: skill `tools` land in the
 * static registry (exposed every iteration); catalog gating is the
 * ToolProvider's job — see {@link buildSelfExplainToolProvider}.
 */
export function buildSelfExplainSkill(options: SelfExplainOptions): Injection {
  return defineSkill({
    id: options.id ?? SELF_EXPLAIN_SKILL_ID,
    description: SELF_EXPLAIN_WHEN,
    body: SELF_EXPLAIN_BODY + (options.instruction ? `\n\n${options.instruction}` : ''),
  });
}

/**
 * The gated tool delivery — `skillScopedTools` (the shipped primitive)
 * scoped to the skill's id, composed with the consumer's own provider
 * when they set one. The iteration after activation, `ctx.activeSkillId`
 * matches and the catalog gains the trace tools (inline) or the single
 * `explain_run` tool (delegate).
 */
export function buildSelfExplainToolProvider(
  binding: SelfExplainBinding,
  options: SelfExplainOptions,
  existing?: ToolProvider,
): ToolProvider {
  const tools = options.delegate
    ? [buildExplainRunTool(binding, options.delegate, options.toolpack)]
    : lazyTraceToolpack(() => binding.artifacts, options.toolpack);
  const scoped = skillScopedTools(options.id ?? SELF_EXPLAIN_SKILL_ID, tools);
  if (!existing) return scoped;
  return {
    id: `${existing.id}+${scoped.id}`,
    list: async (ctx) => [...(await existing.list(ctx)), ...(await scoped.list(ctx))],
  };
}
