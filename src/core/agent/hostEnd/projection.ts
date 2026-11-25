import { flowChart, FlowChartExecutor } from 'footprintjs';
import { mountAgentMemoryWrites } from '../memoryWrites.js';
import type { AgentChartDeps } from '../chartContract.js';
import type { AgentState } from '../types.js';

// Application store errors may contain conversation text. Per-writer outcomes
// are the diagnostics for this private projection.
const silent = () => undefined;
const projectionLogger = { debug: silent, info: silent, log: silent, warn: silent, error: silent };

export type HostMemoryInput = Pick<
  AgentState,
  'runIdentity' | 'turnNumber' | 'contextTokensRemaining' | 'newMessages'
>;

/** Compile each declared writer with its normal mapper, corpus and bound store options.
 * Each projection has an independent failure boundary. Its caller owns the turn lease. */
export function hostWriters(memories: AgentChartDeps['memories']) {
  return memories
    .filter((memory) => memory.write && memory.type === 'episodic' && memory.strategy === 'window')
    .map((memory) => {
      const seed = flowChart<HostMemoryInput>(
        'Project delivered turn',
        (scope) => {
          const input = scope.$getArgs<{ delivered: HostMemoryInput }>().delivered;
          scope.runIdentity = input.runIdentity;
          scope.turnNumber = input.turnNumber;
          scope.contextTokensRemaining = input.contextTokensRemaining;
          scope.newMessages = input.newMessages;
        },
        'delivered-turn',
      );
      const chart = mountAgentMemoryWrites(seed, { memories: [memory] })
        .addFunction('Acknowledge projection', () => 'acknowledged', 'acknowledge')
        .setLogger(projectionLogger)
        .build();
      return {
        id: memory.id,
        async write(input: HostMemoryInput): Promise<'acknowledged' | 'unknown'> {
          try {
            const result = await new FlowChartExecutor(chart).run({
              input: { delivered: structuredClone(input) },
            });
            return result === 'acknowledged' ? 'acknowledged' : 'unknown';
          } catch {
            // A store can persist part or all of a batch and then reject.
            return 'unknown';
          }
        },
      };
    });
}
