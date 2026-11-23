import type { FlowChart } from 'footprintjs';
import type { AgentChartDeps } from '../buildAgentChart.js';
import { startFinalBranch } from '../honesty/mounts.js';
import { prepareFinalFor } from '../stages/prepareFinal.js';
import { breakFinalStage, breakFinalWithValidationStage } from '../stages/breakFinal.js';
import { mountMemoryWrite } from '../../../memory/wire/mountMemoryPipeline.js';
import { unwrapMemoryFlowChart } from '../../../memory/define.js';

export function groupedFinalBranch(deps: AgentChartDeps): FlowChart {
  // ── Final-branch subflow ─────────────────────────────────────
  // Identical to buildAgentChart: PrepareFinal captures the turn
  // payload, memory-write subflows persist it, BreakFinal terminates
  // the ReAct loop. Lives in the OUTER chart (the final answer is a
  // peer of the LLM turn, not part of it).
  // Same stage id, same position for PrepareFinal — only the body differs, and
  // only for an agent that asked for its limits (or its standing) to travel.
  // See `stages/prepareFinal.ts` · `prepareFinalFor` and `honesty/mounts.ts` ·
  // `startFinalBranch`, the one choice and the one helper both builders use.
  let finalBranchBuilder = startFinalBranch(
    deps.answerLayer,
    prepareFinalFor(deps),
    deps.structureRecorders,
  );
  for (const m of deps.memories) {
    if (m.write) {
      finalBranchBuilder = mountMemoryWrite(finalBranchBuilder, {
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
  const finalBranchChart = finalBranchBuilder
    .addFunction(
      'BreakFinal',
      deps.hasAnswerValidation === true ? breakFinalWithValidationStage : breakFinalStage,
      'break-final',
      'Terminate the ReAct loop',
    )
    .build();

  return finalBranchChart;
}
