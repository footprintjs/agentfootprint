import type { SelfExplainExtension } from '../../selfExplainPort.js';
import { type ResolvedNegativeClaims } from '../../negativeClaims/config.js';
import type { EngagementPlan } from '../../../../maps/engagement/types.js';
import type { Injection } from '../../../../injection-engine/types.js';
import { type FoldedSkillBrains } from '../../skillBrains.js';
import type { ToolProvider } from '../../../../tools/toolProvider.js';
import type { Watcher } from '../../watch.js';
import type { AgentOptions } from '../../types.js';
/** Only the existing local values at the original new Agent(...) point. */
export interface BuildParts {
  readonly opts: AgentOptions;
  readonly voice: {
    readonly appName: string;
    readonly commentaryTemplates: Record<string, string>;
    readonly thinkingTemplates: Record<string, string>;
  };
  readonly injections: Injection[];
  readonly toolProvider: ToolProvider | undefined;
  readonly negativeSchema: Readonly<Record<string, unknown>> | undefined;
  readonly skillBrains: FoldedSkillBrains | undefined;
  readonly mapsPlan: EngagementPlan | undefined;
  readonly claimContract:
    | { readonly answerField: string; readonly entity: string; readonly field: string }[]
    | undefined;
  readonly negativeClaims: ResolvedNegativeClaims | undefined;
}

/** No new upward trace-toolpack import: derive capabilities from the current port. */
type ExplainBinding = ReturnType<SelfExplainExtension['binding']>;
type ExplainSource = Extract<Parameters<ExplainBinding['bindTo']>[0], { getSnapshot(): unknown }>;
type ExplainOn = NonNullable<ExplainSource['on']>;
type ExplainedEvent = Parameters<Parameters<ExplainOn>[1]>[0];

export interface ConstructedAgent {
  attach(observer: Watcher): unknown;
  getLastSnapshot: ExplainSource['getSnapshot'];
  getLastNarrativeEntries: NonNullable<ExplainSource['getNarrative']>;
  on: ExplainOn;
  ownsEvent(event: ExplainedEvent): boolean;
  bindSelfExplain(binding: ExplainBinding): void;
}
