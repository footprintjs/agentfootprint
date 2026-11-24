import type { FlowChartBuilder } from 'footprintjs';
import { ArrayMergeMode } from 'footprintjs/advanced';
import { milestoneTagsFor, STAGE_IDS, SUBFLOW_IDS } from '../../lib/conventions.js';
import { buildCacheSubflow, cacheMountInput } from './buildCacheSubflow.js';
import type { AgentChartDeps } from './chartContract.js';

type RequestMounts = Pick<
  AgentChartDeps,
  'maxIterations' | 'systemPromptCachePolicy' | 'lateRecordNotes' | 'callLLM'
>;

/** Shared request region for the flat and grouped agent charts. */
export function mountRequestStages<B extends FlowChartBuilder>(builder: B, deps: RequestMounts): B {
  // sf-cache: decideCacheMarkers → CacheGate → apply/skip, collapsed into
  // ONE box. Pure provider-agnostic DECISION layer — reads the turn's state,
  // outputs only the gated cacheMarkers (Replace, not concat, across the
  // loop). The attached provider's CacheStrategy turns markers into wire
  // format later. See buildCacheSubflow.ts.
  // Findings uses stable tool definitions and late request-only DATA, so
  // its changing ledger does not disable prefix cache markers.
  let mounted = builder.addSubFlowChartNext(SUBFLOW_IDS.CACHE, buildCacheSubflow(), 'Cache', {
    inputMapper: (parent) => cacheMountInput(parent, deps),
    outputMapper: (scope) => ({ cacheMarkers: scope.cacheMarkers }),
    arrayMerge: ArrayMergeMode.Replace,
  });
  if (deps.lateRecordNotes !== undefined) {
    mounted = mounted
      .addFunction(
        'ReadLateRecordFacts',
        deps.lateRecordNotes.read,
        'read-late-record-facts',
        'Read the scope’s served record facts for this request',
      )
      .addSubFlowChartNext('sf-late-record-note', deps.lateRecordNotes.chart, 'Late record note', {
        inputMapper: () => ({}),
      });
  }
  return (
    mounted
      // CallLLM emits the per-iteration `iteration_start` marker itself (no
      // dedicated IterationStart stage — emitting is passive observability).
      .addFunction('CallLLM', deps.callLLM as never, STAGE_IDS.CALL_LLM, 'LLM invocation')
      // Declared milestone (9.90.0): the LLM turn — `milestone:llm-turn` on the
      // stage's commit bundle, from the same table `milestoneFor` reads.
      .tag(...milestoneTagsFor(STAGE_IDS.CALL_LLM)) as B
  );
}
