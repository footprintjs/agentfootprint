import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolResolver } from '../../toolResolver.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import { boundArgsOf } from './bindings.js';
import { frozenView } from '../../../../../lib/frozenCopy.js';
import { hiddenArgNames } from '../../../../toolShownArgs.js';
import { ResumeDecisionError } from '../../../../pause.js';
import {
  HIDDEN_ARGS_NOT_RECORDED,
  hiddenViewChange,
  recordedHiddenArgs,
} from '../../../../checkInHiddenArgs.js';

/**
 * Hold a check-in resume to the VIEW the person decided on: the resumed
 * tool's argument view must hide the same names the request told them were
 * hidden (`CheckInRequest.hiddenArgs`, kept with the pause and bound into its
 * id). An approval covers exactly what was shown, so a changed view voids it:
 * `ResumeDecisionError('view-changed')`, naming the difference by argument
 * name, thrown before the decision is spent and before anything runs.
 *
 * Asked after the resume has prepared its tool catalog, because the view
 * lives in the tool (a provider's tool is found only then). Not asked when the
 * request carries no list (a pause stored before the list existed — its record
 * reads `'not-recorded'`), nor when the tool no longer resolves (it cannot run;
 * the resume answers that as it always did).
 *
 * Example: asked with `['to']`; a redeploy's view also hides `memo` → refused,
 * "hidden now, shown when asked: `memo`".
 */
export function buildHeldView(resolveTool: () => ToolResolver) {
  return (scope: TypedScope<AgentState>): void => {
    const asked = recordedHiddenArgs(scope.$getValue('pausedRequest'));
    if (asked === HIDDEN_ARGS_NOT_RECORDED) return;
    const toolName = scope.$getValue('pausedToolName');
    if (typeof toolName !== 'string') return;
    const party = scope.$getValue('pausedToolParty') as ToolParty | undefined;
    const tool = resolveTool()(toolName, party).tool;
    if (tool === undefined) return;
    // The view runs on a frozen copy: it never touches what an approval runs.
    const args = boundArgsOf(scope, 'pausedCheckInArgs');
    const change = hiddenViewChange(asked, hiddenArgNames(tool, frozenView(args) ?? args));
    if (change !== undefined) throw new ResumeDecisionError('view-changed', 'checkIn', change);
  };
}
