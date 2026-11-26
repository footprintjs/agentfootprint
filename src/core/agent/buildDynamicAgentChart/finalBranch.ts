import type { FlowChart } from 'footprintjs';
import type { AgentChartDeps } from '../buildAgentChart.js';
import { startFinalBranch } from '../honesty/mounts.js';
import { prepareFinalFor } from '../stages/prepareFinal.js';
import { breakFinalStage, breakFinalWithValidationStage } from '../stages/breakFinal.js';
import { mountAgentMemoryWrites } from '../memoryWrites.js';

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
  finalBranchBuilder = mountAgentMemoryWrites(finalBranchBuilder, deps);
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
