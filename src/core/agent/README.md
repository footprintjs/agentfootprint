**Mixed** — the Agent's chart builders sitting beside the composers and folds
the walk calls from inside its stages.
Map: `buildAgentChart.ts`, `buildDynamicAgentChart.ts`,
`buildAgentMessageApiChart.ts`, `buildMessageApiChart.ts`, `buildCacheSubflow.ts`,
`buildToolRegistry.ts`, `AgentBuilder.ts`, `skillGraphDeclared.ts`,
`skillBrains.ts`, `types.ts`.
Walker: `toolDispatch.ts`, `toolEffects.ts`, `toolArgsValidation.ts`,
`validators.ts`, `act.ts`, `moments.ts`.
Trace: `runManifest.ts`, `integrityFindings.ts`, `watch.ts`.
Fold: `memoryRecallInjections.ts`, `toolsFromActiveSkill.ts`.
Lens: `selfCallNotice.ts`, `stagedRefs.ts` · `stagedRefsNudgeLine`,
`presentTool.ts`, `outputEnforcement.ts` · `buildCorrectiveTurn`,
`repeatedCall.ts` · `noteFor`, `resultCeiling.ts` · `applyResultCeiling`,
`toolResultCap.ts`.

## What it reads / what it writes
- The chart builders own the outputMappers that publish the loop's shared facts:
  `activeInjections`, `currentSkillId`, `stepPointer`, `dynamicToolSchemas`
  (`buildAgentChart.ts` · `SUBFLOW_IDS.INJECTION_ENGINE` and
  `buildAgentChart.ts` · `SUBFLOW_IDS.TOOLS`, on their `outputMapper`s).
- The Lens files read only what they are handed, plus `scope.hiddenSkillIds`
  (owner: `../slots/buildToolsSlot.ts` · `discoverStage`) where they name skill ids.

## The one law here
A builder declares; it must not decide. Anything that has to be true AT a
moment is composed in `stages/`, where the moment is.

## Files
See the role lists above; `types.ts` holds both the public agent types and the
internal ones the stages share.
