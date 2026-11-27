import type { CallOccurrenceKey } from '../../../../../lib/callOccurrence.js';
import {
  type ToolArgValidationMode,
  validateToolArgs,
  formatToolArgIssues,
} from '../../../../../tools/toolArgsValidation.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import { isLibrarySkillReader } from '../../../../../injection-engine/skillTools.js';
import { skillReadArgumentIssue } from '../../../skillContext/readSkillArguments.js';
import type { SkillRoleView } from '../../../skillContext/toolVisibility.js';
import type { LLMToolSchema } from '../../../../../provider-contract/types.js';

/** Build the existing per-handler argument-schema admission rule. */
export function buildArgumentRefusal(
  toolArgValidation: ToolArgValidationMode,
  governsSkillRole: boolean,
) {
  /**
   * One admission rule for initial and resumed dispatch. Judge against the
   * wire schema after middleware, before artifact resolution or credentials.
   * Approval of an ask does not establish schema validity, and a remaining
   * middleware link may have changed the paused arguments. Credential-consent
   * checkpoints holding resolved wants data are not converted back to refs.
   */
  const argumentRefusal = (
    scope: TypedScope<AgentState>,
    tool: Tool,
    args: unknown,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly callOccurrenceKey?: CallOccurrenceKey;
      readonly role?: SkillRoleView;
    },
  ): string | undefined => {
    const { role, ...event } = call;
    const roleIssue =
      governsSkillRole && isLibrarySkillReader(tool)
        ? skillReadArgumentIssue(
            tool,
            args,
            role ?? { hiddenSkillIds: scope.hiddenSkillIds },
            role === undefined
              ? (scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined)
              : undefined,
          )
        : undefined;
    if (roleIssue === undefined && toolArgValidation === 'off') return undefined;
    const verdict =
      roleIssue === undefined
        ? validateToolArgs(args, tool.schema.inputSchema)
        : { ok: false, issues: [roleIssue] };
    if (verdict.ok) return undefined;
    const enforced = roleIssue !== undefined || toolArgValidation === 'enforce';
    typedEmit(scope, 'agentfootprint.validation.args_invalid', {
      ...event,
      issues: verdict.issues,
      enforced,
    });
    return enforced ? formatToolArgIssues(call.toolName, verdict.issues) : undefined;
  };
  return argumentRefusal;
}
