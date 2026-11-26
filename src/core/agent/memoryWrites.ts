import type { FlowChartBuilder } from 'footprintjs';
import { unwrapMemoryFlowChart } from '../../memory/define.js';
import { mountMemoryWrite } from '../../memory/wire/mountMemoryPipeline.js';
import type { AgentChartDeps } from './chartContract.js';

/** Persist the accepted messages through the configured native write subflows. */
export function mountAgentMemoryWrites(
  builder: FlowChartBuilder,
  deps: Pick<AgentChartDeps, 'memories' | 'causalEvidenceSource'>,
): FlowChartBuilder {
  for (const m of deps.memories) {
    if (m.write) {
      builder = mountMemoryWrite(builder, {
        pipeline: {
          read: unwrapMemoryFlowChart(m.read) as never,
          write: unwrapMemoryFlowChart(m.write) as never,
        },
        identityKey: 'runIdentity',
        turnNumberKey: 'turnNumber',
        contextTokensKey: 'contextTokensRemaining',
        newMessagesKey: 'newMessages',
        writeSubflowId: `sf-memory-write-${m.id}`,
        ...(m.corpus !== undefined && { identityOverride: m.corpus }),
        // Evidence bridge (#5): only CAUSAL pipelines consume run evidence.
        ...(m.type === 'causal' &&
          deps.causalEvidenceSource && { evidenceSource: deps.causalEvidenceSource }),
      });
    }
  }
  return builder;
}
