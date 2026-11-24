import type { FlowChartBuilder } from 'footprintjs';
import { unwrapMemoryFlowChart } from '../../memory/define.js';
import {
  memoryInjectionKey,
  memoryRecallOutcomesKey,
  retrievalEvidenceKey,
  type MemoryDefinition,
} from '../../memory/define.types.js';
import { mountMemoryRead } from '../../memory/wire/mountMemoryPipeline.js';

/** Both chart shapes read memory once after Initialize, before the ReAct loop. */
export function mountAgentMemoryReads(
  builder: FlowChartBuilder,
  memories: readonly MemoryDefinition[],
): FlowChartBuilder {
  for (const memory of memories) {
    builder = mountMemoryRead(builder, {
      pipeline: {
        read: unwrapMemoryFlowChart(memory.read) as never,
        ...(memory.write !== undefined && { write: unwrapMemoryFlowChart(memory.write) as never }),
      },
      identityKey: 'runIdentity',
      turnNumberKey: 'turnNumber',
      contextTokensKey: 'contextTokensRemaining',
      injectionKey: memoryInjectionKey(memory.id),
      evidenceKey: retrievalEvidenceKey(memory.id),
      recallOutcomesKey: memoryRecallOutcomesKey(memory.id),
      readSubflowId: `sf-memory-read-${memory.id}`,
      ...(memory.corpus !== undefined && { identityOverride: memory.corpus }),
    });
  }
  return builder;
}
