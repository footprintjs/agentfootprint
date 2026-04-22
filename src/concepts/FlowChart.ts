/**
 * FlowChart — sequential composition of runners as a flowchart.
 *
 * The simplest multi-agent pattern: run agents in order, each feeding into the next.
 * More complex patterns (fan-out, hierarchy, swarm) are user-built with footprintjs
 * primitives (fork, addDeciderFunction, loopTo).
 *
 * Usage:
 *   const composed = FlowChart.create()
 *     .agent('researcher', 'Research', researchRunner)
 *     .agent('writer', 'Write', writerRunner)
 *     .build();
 *   const result = await composed.run('Write about AI');
 */

import { flowChart as buildFlowChart, FlowChartExecutor, MetricRecorder } from 'footprintjs';
import type { FlowChart as FlowChartDef, TypedScope } from 'footprintjs';
import { annotateSpecIcons } from './specIcons';

import type { AgentStageConfig, AgentResultEntry, TraversalResult } from '../types';
import { runnerAsStage } from '../stages/runnerAsStage';
import type { RunnerLike } from '../types';
import type { AgentRecorder } from '../core';
import { RecorderBridge } from '../recorders/RecorderBridge';
import { forwardEmitRecorders } from '../recorders/forwardEmitRecorders';
import type { MultiAgentState } from '../scope/types';
import type { AgentStreamEvent, AgentStreamEventHandler } from '../streaming';
import { createStreamEventRecorder, EventDispatcher } from '../streaming';

/**
 * Check if a runner exposes its internal flowChart for subflow composition.
 * Runners with `toFlowChart()` are mounted as subflows (enables UI drill-down).
 * Runners without it fall back to `addFunction + runnerAsStage`.
 */
function hasToFlowChart(
  runner: RunnerLike,
): runner is RunnerLike & { toFlowChart(): FlowChartDef } {
  return typeof (runner as any).toFlowChart === 'function';
}

export class FlowChart {
  private readonly agents: AgentStageConfig[] = [];
  private readonly recorders: AgentRecorder[] = [];

  private constructor() {}

  static create(): FlowChart {
    return new FlowChart();
  }

  /** Add a runner to the flowchart. Runners execute in the order added. */
  agent(
    id: string,
    name: string,
    runner: RunnerLike,
    options?: {
      inputMapper?: AgentStageConfig['inputMapper'];
      outputMapper?: AgentStageConfig['outputMapper'];
    },
  ): this {
    this.agents.push({
      id,
      name,
      runner,
      inputMapper: options?.inputMapper,
      outputMapper: options?.outputMapper,
    });
    return this;
  }

  /** Attach a recorder. AgentRecorder OR EmitRecorder (e.g. contextEngineering). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recorder(rec: AgentRecorder | { id: string; onEmit?: (event: any) => void }): this {
    this.recorders.push(rec as AgentRecorder);
    return this;
  }

  /** Build the composed flowchart and return a runner. */
  build(): FlowChartRunner {
    if (this.agents.length === 0) {
      throw new Error('FlowChart requires at least one agent');
    }
    return new FlowChartRunner([...this.agents], [...this.recorders]);
  }
}

export class FlowChartRunner {
  private readonly agents: readonly AgentStageConfig[];
  private readonly recorders: AgentRecorder[];
  private lastExecutor?: FlowChartExecutor;
  private lastSpec?: unknown;
  /** Persistent observer list — see AgentRunner.dispatcher. */
  private readonly dispatcher = new EventDispatcher();

  constructor(agents: readonly AgentStageConfig[], recorders: AgentRecorder[] = []) {
    this.agents = agents;
    this.recorders = recorders;
  }

  async run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number; onEvent?: AgentStreamEventHandler },
  ): Promise<TraversalResult> {
    const startTime = Date.now();
    const bridge = this.recorders.length > 0 ? new RecorderBridge(this.recorders) : null;

    const dispatcher = this.dispatcher;
    const perRun = options?.onEvent;
    const onStreamEvent: AgentStreamEventHandler | undefined =
      dispatcher.size > 0 || perRun
        ? (e: AgentStreamEvent) => {
            dispatcher.dispatch(e);
            if (perRun) {
              try {
                perRun(e);
              } catch {
                /* swallow */
              }
            }
          }
        : undefined;

    onStreamEvent?.({ type: 'turn_start', userMessage: message });
    bridge?.dispatchTurnStart(message);

    // Seed stage: set input and initialize agent results.
    // Signal/timeout are passed via executor.run({ signal, timeoutMs }) and
    // available to stages via scope.$getEnv() — no need to duplicate in scope state.
    const seedStage = (scope: TypedScope<MultiAgentState>) => {
      scope.pipelineInput = message;
      scope.agentResults = [];
    };

    // Build flowchart: Seed → Runner1 → Runner2 → ... → RunnerN
    // Runners with toFlowChart() are mounted as subflows (UI drill-down).
    // Runners without it fall back to addFunction + runnerAsStage.
    let builder = buildFlowChart<MultiAgentState>('Seed', seedStage, 'seed');

    for (const agentConfig of this.agents) {
      if (hasToFlowChart(agentConfig.runner)) {
        // Mount as subflow — enables snapshot drill-down via getSubtreeSnapshot.
        // No outputMapper — results are extracted from subflowResults after execution.
        builder = builder.addSubFlowChartNext(
          agentConfig.id,
          agentConfig.runner.toFlowChart(),
          agentConfig.name,
          {
            inputMapper: (parentState: Record<string, unknown>) => {
              const input = agentConfig.inputMapper
                ? agentConfig.inputMapper(parentState)
                : (parentState.result as string) ?? (parentState.pipelineInput as string) ?? '';
              return { message: input };
            },
          },
        );
      } else {
        // Fallback: wrap as a stage function
        const stage = runnerAsStage(agentConfig);
        builder = builder.addFunction(agentConfig.name, stage, agentConfig.id);
      }
    }

    this.lastSpec = annotateSpecIcons(builder.toSpec());
    const chart = builder.build();

    const executor = new FlowChartExecutor(chart, { enrichSnapshots: true });
    executor.enableNarrative();
    executor.attachRecorder(new MetricRecorder('metrics'));
    forwardEmitRecorders(executor, this.recorders);
    if (onStreamEvent) {
      executor.attachEmitRecorder(createStreamEventRecorder(onStreamEvent));
    }

    try {
      await executor.run({
        input: { message },
        signal: options?.signal,
        timeoutMs: options?.timeoutMs,
      });
    } catch (err) {
      bridge?.dispatchError('llm', err);
      throw err;
    }

    this.lastExecutor = executor;

    // Extract results from snapshot.
    // For subflow-mounted agents, read from subflowResults (child shared state).
    // For flat-stage agents, read from parent's agentResults.
    const snapshot = executor.getSnapshot();
    const state = snapshot?.sharedState ?? {};
    const subflowResults = snapshot?.subflowResults ?? {};

    const flatAgentResults = (state.agentResults as AgentResultEntry[]) ?? [];
    const subflowAgentResults: AgentResultEntry[] = [];

    for (const agentConfig of this.agents) {
      const sfResult = subflowResults[agentConfig.id] as Record<string, unknown> | undefined;
      if (sfResult) {
        const childState = (sfResult.treeContext as Record<string, unknown> | undefined)
          ?.globalContext as Record<string, unknown> | undefined;
        const childContent = childState ? (childState.result as string) ?? '' : '';
        subflowAgentResults.push({
          id: agentConfig.id,
          name: agentConfig.name,
          content: childContent,
          latencyMs: 0, // Individual subflow timing not available from SubflowResult
        });
      }
    }

    const allAgentResults = [...flatAgentResults, ...subflowAgentResults];

    const lastSubflowContent =
      subflowAgentResults.length > 0
        ? subflowAgentResults[subflowAgentResults.length - 1].content
        : undefined;

    const content =
      (state.result as string) ??
      lastSubflowContent ??
      (flatAgentResults.length > 0 ? flatAgentResults[flatAgentResults.length - 1].content : '');

    bridge?.dispatchTurnComplete(content, 0);
    onStreamEvent?.({ type: 'turn_end', content, iterations: 1 });

    return {
      content,
      agents: allAgentResults,
      totalLatencyMs: Date.now() - startTime,
    };
  }

  /** Subscribe to the runner's live stream of events. See AgentRunner.observe(). */
  observe(handler: AgentStreamEventHandler): () => void {
    return this.dispatcher.observe(handler);
  }

  /** Get the flowchart spec (stage graph metadata). */
  getSpec(): unknown {
    if (!this.lastSpec) {
      // Build chart structure to capture spec without executing
      const seedStage = (scope: TypedScope<MultiAgentState>) => {
        scope.pipelineInput = '';
        scope.agentResults = [];
      };
      let builder = buildFlowChart<MultiAgentState>('Seed', seedStage, 'seed');
      for (const agentConfig of this.agents) {
        if (hasToFlowChart(agentConfig.runner)) {
          builder = builder.addSubFlowChartNext(
            agentConfig.id,
            agentConfig.runner.toFlowChart(),
            agentConfig.name,
            {
              inputMapper: (parentState: Record<string, unknown>) => {
                const input = agentConfig.inputMapper
                  ? agentConfig.inputMapper(parentState)
                  : (parentState.result as string) ?? (parentState.pipelineInput as string) ?? '';
                return { message: input };
              },
            },
          );
        } else {
          const stage = runnerAsStage(agentConfig);
          builder = builder.addFunction(agentConfig.name, stage, agentConfig.id);
        }
      }
      this.lastSpec = annotateSpecIcons(builder.toSpec());
    }
    return this.lastSpec;
  }

  /** Get structured narrative entries from the last run. */
  getNarrativeEntries() {
    return this.lastExecutor?.getNarrativeEntries() ?? [];
  }

  /** Get the full execution snapshot from the last run. */
  getSnapshot() {
    return this.lastExecutor?.getSnapshot();
  }
}
