import type { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { CallSettlement } from '../../../scripts/label.js';
import { type CodeRunFacts, type CodeRunSlot, codeRunsOf } from '../../../../codeRunnerTool.js';
import { scriptOf } from '../../../../../tools/script.js';
import { scriptRowFor, recordScriptRow, programIn } from '../../../scripts/rows.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ResumedCallFacts } from '../contracts/callFacts.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';

interface ToolScriptsOperationsLinks {
  readonly peelCall: ToolCatalogOperations['peelCall'];
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
}

/** Compose the existing scripts callbacks once for this handler. */
export function buildToolScriptsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'scriptRecord'>,
  links: ToolScriptsOperationsLinks,
): ToolScriptsOperations {
  /**
   * THE ONE DOOR for a call's `script` row (`deps.scriptRecord`) — asked
   * where each call of a declared code-running tool settles or pauses. A tool
   * that declares no `script` (or one the dispatch door refuses,
   * `tools/script.ts` · `scriptOf`) files nothing; an unarmed agent never
   * reaches the declaration at all.
   */
  const fileScript = (
    scope: TypedScope<AgentState>,
    call: {
      readonly tool: Tool | undefined;
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      /** The declared argument's value as the call arrived (`programOfCall`). */
      readonly proposed: unknown;
      /** Its value handed to `execute` — or as it stood at a pause or a refusal. */
      readonly submitted?: unknown;
      readonly settlement: CallSettlement;
      readonly facts?: CodeRunFacts;
      readonly withheld?: boolean;
      readonly paused?: boolean;
      /** The dispatch a settling paused call already has (`pausedScriptDispatch`). */
      readonly dispatch?: number;
    },
  ): number | undefined => {
    if (deps.scriptRecord !== true) return undefined;
    const script = scriptOf(call.tool);
    if (script === undefined) return undefined;
    const row = scriptRowFor({
      script,
      tool: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      turn: scope.turnNumber as number,
      proposed: call.proposed,
      ...(call.submitted !== undefined && { submitted: call.submitted }),
      settlement: call.settlement,
      ...(call.facts !== undefined && { facts: call.facts }),
      ...(call.withheld === true && { withheld: true }),
      ...(call.paused === true && { paused: true }),
    });
    if (row === undefined) return undefined;
    const dispatch = recordScriptRow(scope, row, {
      paused: call.paused === true,
      ...(call.dispatch !== undefined && { dispatch: call.dispatch }),
    });
    // A paused call keeps its dispatch across the checkpoint: the row that
    // settles it on resume joins the same dispatch, never a new one.
    if (call.paused === true && dispatch !== undefined) {
      scope.pausedScriptDispatch = { dispatch, toolCallId: call.toolCallId, turn: row.turn };
    }
    return dispatch;
  };

  /**
   * The declared argument's VALUE in `args`, read now — `undefined` when the
   * agent is unarmed or the tool declares no `script`. Asked at the boundary
   * each value belongs to (as the call arrives; just before `execute`) and
   * kept: a string cannot be edited afterwards, the arguments object can.
   */
  const programOfCall = (
    tool: Tool | undefined,
    args: Readonly<Record<string, unknown>> | undefined,
  ): unknown => {
    if (deps.scriptRecord !== true) return undefined;
    const script = scriptOf(tool);
    return script === undefined ? undefined : programIn(script, args);
  };

  /**
   * The arguments the model PROPOSED for a call, read back from the assistant
   * turn that carried it (`_findings` peeled) — what a resumed call's script
   * row compares the program it ran with. `undefined` when the turn is gone.
   */
  const proposedArgsOf = (
    scope: TypedScope<AgentState>,
    toolCallId: string,
  ): Readonly<Record<string, unknown>> | undefined => {
    const history = scope.history as readonly LLMMessage[];
    for (let i = history.length - 1; i >= 0; i--) {
      const call = history[i]?.toolCalls?.find((c) => c.id === toolCallId);
      if (call !== undefined) return links.peelCall(call).args;
    }
    return undefined;
  };

  /**
   * A RESUMED call's script row — the four resume doors settle the paused call
   * here. `carried` is the pause carrier (the arguments the person approved,
   * or the call was paused with); `seen` is what `resolveCredentialAndExecute`
   * saw when the call ran. The tool is resolved as the resume resolved it.
   */
  const fileResumedScript = (
    scope: TypedScope<AgentState>,
    call: {
      readonly toolName: string;
      readonly toolCallId: string;
      readonly iteration: number;
      readonly carried: Readonly<Record<string, unknown>>;
      readonly entered: boolean;
      readonly seen: ResumedCallFacts;
    },
  ): void => {
    if (deps.scriptRecord !== true) return;
    const tool = links.resolveTool(
      call.toolName,
      scope.pausedToolParty as ToolParty | undefined,
    ).tool;
    // The dispatch the pause filed this call under — when it is THIS call's.
    const held = scope.pausedScriptDispatch as
      | { readonly dispatch: number; readonly toolCallId: string; readonly turn: number }
      | undefined;
    const dispatch =
      held !== undefined &&
      held.toolCallId === call.toolCallId &&
      held.turn === (scope.turnNumber as number)
        ? held.dispatch
        : undefined;
    if (held !== undefined) scope.pausedScriptDispatch = undefined;
    // A call that paused from inside `execute` carried the values read before
    // it ran (`pausedScriptPrograms`) — this call's, when the dispatch is.
    const carried = scope.pausedScriptPrograms as
      | { readonly proposed?: string; readonly submitted?: string }
      | undefined;
    if (carried !== undefined) scope.pausedScriptPrograms = undefined;
    const own = dispatch !== undefined ? carried : undefined;
    // Read before `execute` ran (`seen`), or carried from before it ran; a
    // call that never got there reads its carrier now — no tool code ran on it.
    const proposed =
      call.seen.entered === true
        ? call.seen.proposed
        : own?.proposed ??
          programOfCall(tool, proposedArgsOf(scope, call.toolCallId) ?? call.carried);
    const submitted =
      call.seen.entered === true
        ? call.seen.submitted
        : own?.submitted ?? programOfCall(tool, call.carried);
    fileScript(scope, {
      tool,
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      proposed,
      ...(submitted !== undefined && { submitted }),
      settlement: !call.entered ? 'not-entered' : call.seen.threw === true ? 'threw' : 'returned',
      ...(call.seen.codeRun !== undefined && { facts: call.seen.codeRun }),
      withheld: call.seen.overCeiling === true,
      ...(dispatch !== undefined && { dispatch }),
    });
  };

  /**
   * THIS dispatch's code-run facts, taken from its own slot (`CODE_RUN_SLOT`)
   * — what the script row attests, whichever runner filed them (a wrapper that
   * hands its context to a code runner included). Asked at BOTH execute
   * boundaries — the batch loop and `resolveCredentialAndExecute` — right
   * after `tool.execute` returns. Only the slot is ever attested from.
   *
   * The published surfaces are kept exactly as they were. The map
   * (`codeRunsOf`): at the batch boundary (`takeListed`) the dispatched tool's
   * entry for this call id is taken off it; the resume boundary leaves it.
   * The event fires when the dispatched tool is itself a code runner, as it
   * always did, carrying the dispatch's own facts. When the slot is empty
   * there — a decorator kept the runner's map but handed the runner a context
   * of its own, so the runner filed by the call id alone — it fires as it
   * always did, from the map's entry: the one case the slot cannot reach, and
   * the facts it carries are the map's, never attested. The code itself is
   * never on this channel: generated code quotes the data it was handed.
   */
  const takeCodeRun = (
    scope: TypedScope<AgentState>,
    tool: Tool,
    slot: CodeRunSlot,
    call: { readonly toolName: string; readonly toolCallId: string; readonly takeListed: boolean },
  ): CodeRunFacts | undefined => {
    const facts = slot.facts;
    slot.facts = undefined;
    const listed = codeRunsOf(tool);
    const filed = call.takeListed ? listed?.get(call.toolCallId) : undefined;
    if (filed !== undefined) listed?.delete(call.toolCallId);
    const told = facts ?? filed;
    if (told !== undefined && listed !== undefined) {
      // `tool` is the name the model CALLED, not the one the runner's closure
      // was built with: a runner re-exposed under another schema name must be
      // recognizable by the name its calls carry (a content exporter withholds
      // that tool's arguments — the program). Same bytes whenever they agree.
      typedEmit(scope, 'agentfootprint.tools.code_run', { ...told, tool: call.toolName });
    }
    return facts;
  };

  return { fileScript, programOfCall, proposedArgsOf, fileResumedScript, takeCodeRun };
}
