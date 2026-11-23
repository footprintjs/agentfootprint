// Paths name production boundaries. Evidence for the remaining gaps is kept in hiding-inventory.md.
export type Boundary = readonly [file: string, symbol: string, calls?: number];

const agent = 'src/core/agent';
const toolCalls = `${agent}/stages/toolCalls`;

export const inventoriedCalls = [
  {
    writer: 'src/core/codeRunnerTool/output',
    exportName: 'clipOutput',
    sites: [['src/core/codeRunnerTool.ts', 'render']],
  },
  {
    writer: 'src/core/codeRunnerTool/output',
    exportName: 'codeRunStatus',
    sites: [['src/core/codeRunnerTool.ts', 'codeRunnerTool']],
  },
  {
    writer: `${toolCalls}/execution/readExecutedResult`,
    exportName: 'readExecutedResult',
    sites: [
      [`${toolCalls}/execution/initialInvocation.ts`, 'invokeInitialTool'],
      [`${toolCalls}/execution/resumedInvocation.ts`, 'executeResumed'],
    ],
  },
  {
    writer: `${agent}/assessment/results/outcomes/stage`,
    exportName: 'outcomeDetailReader',
    sites: [[`${agent}/assessment/reasonDetails.ts`, 'readReasonDetails']],
  },
  {
    writer: `${agent}/toolResultCap`,
    exportName: 'capToolResult',
    sites: [[`${toolCalls}/decorators/limitsOperations.ts`, 'capResults', 2]],
  },
  {
    writer: 'src/artifacts/placement',
    exportName: 'placedToolResult',
    sites: [[`${toolCalls}/execution/artifactsOperations.ts`, 'placeResults']],
  },
  {
    writer: `${agent}/resultCeiling`,
    exportName: 'applyResultCeiling',
    sites: [[`${toolCalls}/decorators/limitsOperations.ts`, 'refuseOverCeiling']],
  },
  {
    writer: `${agent}/honesty/libraryResultLimits`,
    exportName: 'recordServedLimits',
    sites: [
      [`${toolCalls}/execution/dispatchCall.ts`, 'dispatchCall'],
      [`${toolCalls}/resume/ask.ts`, 'resumeAsk'],
      [`${toolCalls}/resume/checkIn.ts`, 'resumeCheckIn'],
      [`${toolCalls}/resume/credential.ts`, 'resumeCredential'],
      [`${toolCalls}/resume/plain.ts`, 'resumePlain'],
    ],
  },
  {
    writer: `${agent}/honesty/libraryResultLimits`,
    exportName: 'recordLibraryResultLimit',
    sites: [[`${toolCalls}/execution/artifactsOperations.ts`, 'placeResults']],
  },
  {
    writer: `${agent}/honesty/libraryResultLimits`,
    exportName: 'captureDatasetLimit',
    sites: [[`${toolCalls}/execution/contextOperations.ts`, 'toolArtifacts']],
  },
  {
    writer: `${agent}/honesty/responseStop`,
    exportName: 'recordResponseStop',
    sites: [[`${agent}/stages/callLLM.ts`, 'buildCallLLMStage']],
  },
] as const;

export const auditedBoundaries = {
  'result cap': [
    [`${agent}/toolResultCap.ts`, 'capToolResult'],
    [`${toolCalls}/decorators/limitsOperations.ts`, 'capResults'],
  ],
  'per-tool ceiling produces a refusal': [[`${agent}/resultCeiling.ts`, 'applyResultCeiling']],
  'after-tool rewrite': [
    [`${toolCalls}/decorators/middlewareOperations.ts`, 'afterMoment'],
    [`${agent}/assessment/standingAdmission.ts`, 'nativeResult'],
  ],
  'window compaction': [
    [`${agent}/window/strategies/drop.ts`, 'dropOldestSpan'],
    [`${agent}/window/strategies/summarizeOldest.ts`, 'summarizeOldest'],
    [`${agent}/stages/window.ts`, 'buildWindowStage'],
  ],
  'object and rowset emptiness': [[`${agent}/assessment/assess.ts`, 'foldState']],
  'code runner settlement': [
    [`${agent}/honesty/settledToolCalls.ts`, 'toolSettlementOf'],
    [`${agent}/honesty/settledToolCalls.ts`, 'commitSettledToolHistory'],
  ],
  'retrieval threshold and budget': [
    ['src/memory/retrieval/topK.ts', 'topK'],
    ['src/memory/stages/pickByBudget.ts', 'pickByBudget'],
  ],
  'tool and skill selection': [
    [`${agent}/toolChoice/pick.ts`, 'narrowServed'],
    ['src/tool-providers/gatedTools.ts', 'gatedTools'],
    ['src/context-ledger/gates.ts', 'ledgerToolGate'],
    [`${agent}/toolsFromActiveSkill.ts`, 'scopeToolsToActiveSkill'],
    ['src/injection-engine/buildInjectionEngineSubflow.ts', 'hiddenSkillIdsOf'],
    ['src/maps/engagement/parkCard.ts', 'parkCard'],
    ['src/core/slots/buildToolsSlot.ts', 'mergeWire'],
    [`${toolCalls}/routing/readSkillRoute.ts`, 'applyReadSkillRoute'],
  ],
  'local answer scan limit': [[`${agent}/evidence/extract.ts`, 'readAnswer']],
  'findings collapse': [[`${agent}/findings/serve.ts`, 'collapseJudged']],
  'runbook and artifact paging': [
    ['src/core/runbook/runbookAsTool.ts', 'runbookAsTool'],
    ['src/tools/artifactDetailTool.ts', 'artifactDetailTool'],
  ],
  'clock conversion and period flags': [
    ['src/time/axis.ts', 'normaliseInstants'],
    [`${agent}/assessment/periodRows.ts`, 'readPeriodVerdicts'],
  ],
  'evidence revision withholding tools': [[`${agent}/composeRequest.ts`, 'toolsWithheld']],
  'replay omission and deferred injection': [
    ['src/recorders/core/replayHooks.ts', 'replayPreparedHook'],
    ['src/injection-engine/messagesSlotRefusal.ts', 'messagesDeferralNote'],
  ],
} as const satisfies Readonly<Record<string, readonly Boundary[]>>;
