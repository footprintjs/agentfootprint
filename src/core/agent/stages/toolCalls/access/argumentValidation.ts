import {
  type ToolArgValidationMode,
  validateToolArgs,
  formatToolArgIssues,
} from '../../../../../tools/toolArgsValidation.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';

/** Build the existing per-handler argument-schema admission rule. */
export function buildArgumentRefusal(toolArgValidation: ToolArgValidationMode) {
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
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
  ): string | undefined => {
    if (toolArgValidation === 'off') return undefined;
    const verdict = validateToolArgs(args, tool.schema.inputSchema);
    if (verdict.ok) return undefined;
    typedEmit(scope, 'agentfootprint.validation.args_invalid', {
      ...call,
      issues: verdict.issues,
      enforced: toolArgValidation === 'enforce',
    });
    return toolArgValidation === 'enforce'
      ? formatToolArgIssues(call.toolName, verdict.issues)
      : undefined;
  };
  return argumentRefusal;
}
