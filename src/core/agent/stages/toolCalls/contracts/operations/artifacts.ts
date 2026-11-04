import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../../types.js';
import type { Tool } from '../../../../../../tools/tools.js';
import type { ToolArgs } from '../../../../../../tools/runChain.js';
import type { ArtifactMeta } from '../../../../../../artifacts/types.js';
import type { AskComponent } from '../../../../../../tools/askComponent.js';

/** Explicit callback contract for existing artifacts operations. */
export interface ToolArtifactsOperations {
  readonly resolveWantsAtDispatch: (
    scope: TypedScope<AgentState>,
    toolName: string,
    wants: NonNullable<Tool['wants']>,
    args: ToolArgs,
    inputSchema: Readonly<Record<string, unknown>> | undefined,
  ) => Promise<
    | {
        readonly ok: true;
        readonly args: ToolArgs;
        readonly wanted?: Readonly<Record<string, ArtifactMeta>>;
      }
    | { readonly ok: false; readonly refusal: string }
  >;
  readonly assertComponentDeliverable: (
    scope: TypedScope<AgentState>,
    toolName: string,
    component: unknown,
    door: string,
  ) => Promise<AskComponent>;
  readonly applyPresent: (
    scope: TypedScope<AgentState>,
    call: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ) => Promise<{ readonly ok: boolean; readonly text: string }>;
  readonly placeResults: (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    values: { readonly result: unknown; readonly modelResult: unknown },
    eligible: boolean,
  ) => Promise<{ readonly result: unknown; readonly modelResult: unknown }>;
}
