import type { ToolParty } from '../../../../../slots/buildToolsSlot.js';
import type { Tool } from '../../../../../../tools/tools.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { TurnStamp } from '../../../../findings/ledger.js';
import type { SplitFindings } from '../../../../findings/reserved.js';
import type { Resolution } from '../callFacts.js';
import type { SpokenIds } from '../../../../../../lib/spokenIds.js';

/** Explicit callback contract for existing catalog operations. */
export interface ToolCatalogOperations {
  readonly lookupTool: (toolName: string, pinned?: ToolParty) => Tool | undefined;
  readonly unmountedRules: (
    tool: Tool | undefined,
    toolName: string,
  ) => Promise<string> | undefined;
  readonly warnUnmountedToolPeriod: (tool: Tool | undefined, toolName: string) => void;
  readonly turnStampOf: (scope: TypedScope<AgentState>) => TurnStamp | undefined;
  readonly peelsReserved: (tool: Tool | undefined) => boolean;
  readonly peelCall: (tc: {
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }) => SplitFindings;
  readonly noteOptionsFor: (tool: Tool | undefined) => { readonly sources: true } | undefined;
  readonly noteOffWire: (
    scope: TypedScope<AgentState>,
    resolved: Resolution,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
  ) => void;
  readonly frameworkSkipStepAnswered: (name: string, answered: Tool | undefined) => boolean;
  readonly parkedNow: (scope: TypedScope<AgentState>) => ReadonlySet<string> | undefined;
  readonly dispatchRoster: (scope: TypedScope<AgentState>) => SpokenIds;
}
