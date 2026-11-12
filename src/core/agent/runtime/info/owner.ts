import { type CombinedNarrativeEntry, type RuntimeSnapshot } from 'footprintjs';
import type { CachePolicy } from '../../../../cache/types.js';
import { SUBFLOW_IDS } from '../../../../lib/conventions.js';
import type { ArtifactStore } from '../../../../artifacts/types.js';
import { eventBelongsToRun } from '../../../../bridge/eventMeta.js';
import type { AgentfootprintEvent } from '../../../../events/registry.js';

import type { AgentContext } from '../contracts.js';
import type { RunnerExecution } from '../../../runnerExecution.js';
import type { AgentRunValues } from '../../runValues.js';

export function getSystemPromptCachePolicy(this: Pick<AgentContext, 'configuration'>): CachePolicy {
  return this.configuration.systemPromptCachePolicy;
}

export function getArtifactStore(
  this: Pick<AgentContext, 'configuration'>,
): ArtifactStore | undefined {
  return this.configuration.artifactStore;
}

export function ownsEvent(this: Pick<AgentContext, 'native'>, event: AgentfootprintEvent): boolean {
  const selected = this.native.runExecution().selected();
  return selected !== undefined && eventBelongsToRun(event.meta, selected.context);
}

export function getLastSnapshot(this: Pick<AgentContext, 'native'>): RuntimeSnapshot | undefined {
  return this.native.getLastSnapshot();
}

export function getLastNarrativeEntries(
  this: Pick<AgentContext, 'native'>,
): readonly CombinedNarrativeEntry[] {
  return narrativeEntries(this.native.runExecution());
}

/** The narrative reader is also borrowable by other native RunnerBase implementations. */
export function narrativeEntries(
  execution: RunnerExecution<AgentRunValues>,
): readonly CombinedNarrativeEntry[] {
  const selected = execution.selected();
  const coverage = selected?.value.redaction?.coverage;
  if (selected === undefined || coverage === undefined || coverage.state === 'unknown') return [];
  return selected.view.getNarrativeEntries();
}

export function getGroupTranslator(
  this: Pick<AgentContext, 'configuration'>,
): import('../../../translator.js').GroupTranslator | undefined {
  return this.configuration.agentGroupTranslator;
}

export function buildUIGroupMetadata(
  this: Pick<AgentContext, 'configuration' | 'runner'>,
): import('../../../translator.js').GroupMetadata {
  const toolNames = this.configuration.registry.map((r) => r.name);
  return {
    kind: 'Agent',
    id: this.runner.id,
    name: this.runner.name,
    members: [],
    extra: {
      slots: [SUBFLOW_IDS.SYSTEM_PROMPT, SUBFLOW_IDS.MESSAGES, SUBFLOW_IDS.TOOLS] as const,
      toolNames,
      maxIterations: this.configuration.maxIterations,
    },
  };
}

export function canExplain(this: Pick<AgentContext, 'selfExplainBinding'>): boolean {
  return this.selfExplainBinding?.artifacts !== undefined;
}

export function bindSelfExplain(
  this: Pick<AgentContext, 'selfExplainBinding'>,
  binding: Parameters<AgentContext['bindSelfExplain']>[0],
): void {
  this.selfExplainBinding = binding;
}
