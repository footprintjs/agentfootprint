import type { buildToolResolver } from '../../toolResolver.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { ToolParty } from '../../../../slots/buildToolsSlot.js';
import { warnToolPeriodUnjudged } from '../helpers/periodWarnings.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { TurnStamp } from '../../../findings/ledger.js';
import {
  ownsReservedArgument,
  type SplitFindings,
  splitFindings,
} from '../../../findings/reserved.js';
import { carriesRules } from '../../../../../tools/declare.js';
import type { Resolution } from '../contracts/callFacts.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import { SKIP_STEP_TOOL_NAME } from '../../../../../injection-engine/skillSteps.js';
import { parkedMemberIds, type MapEngagement } from '../../../../../maps/engagement/types.js';
import { type SpokenIds, spoken } from '../../../../../lib/spokenIds.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import { SOURCES_NOTE } from '../helpers/sourceNote.js';

interface ToolCatalogOperationsLinks {
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
  readonly peelArms: { argumentSources: boolean } | undefined;
  readonly frameworkSkipStep: Tool | undefined;
  readonly registryByName: ToolCallsHandlerDeps['registryByName'];
  readonly externalToolProvider: ToolCallsHandlerDeps['externalToolProvider'];
  readonly providerToolCache: ToolCallsHandlerDeps['providerToolCache'];
}

/** Compose the existing catalog callbacks once for this handler. */
export function buildToolCatalogOperations(
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'inputsLayer'
    | 'resultsLayer'
    | 'answerLayer'
    | 'findings'
    | 'argumentSources'
    | 'engagementPlan'
    | 'toolDeclaringSkills'
  >,
  links: ToolCatalogOperationsLinks,
): ToolCatalogOperations {
  const lookupTool = (toolName: string, pinned?: ToolParty): Tool | undefined =>
    links.resolveTool(toolName, pinned).tool;

  /**
   * FAIL CLOSED (honesty layer 2, adopted Q14): with the inputs layer NOT
   * mounted, a call whose tool declares argument rules is refused rather than
   * run unruled — configured-and-inert looks exactly like
   * configured-and-working. Only a ToolProvider-served tool can reach here
   * (a registered ruled tool arms the layer at build). `undefined` —
   * synchronously, no microtask — for every tool that declares nothing, and
   * for every call on an armed agent; only a ruled tool on an agent without
   * the layer loads the layer's dispatch half, for the sentence and the
   * warning (`arguments/dispatch.ts` · `unmountedRefusal`).
   */
  const unmountedRules = (
    tool: Tool | undefined,
    toolName: string,
  ): Promise<string> | undefined => {
    if (deps.inputsLayer === true || tool === undefined) return undefined;
    if (tool.askOrAssume === undefined && tool.period === undefined) return undefined;
    return import('../../../arguments/dispatch.js').then((m) => m.unmountedRefusal(toolName));
  };

  /**
   * The results layer's twin (honesty layer 3): with the layer NOT mounted, a
   * call whose tool declares a `ToolPeriod` still runs — its VERDICT needs the
   * layer, the call does not — so dev mode says, once per tool, that none will
   * be filed (`warnToolPeriodUnjudged`). Nothing for a tool that declares none,
   * or on an armed agent.
   */
  const warnUnmountedToolPeriod = (tool: Tool | undefined, toolName: string): void => {
    if (deps.resultsLayer !== true && tool?.period !== undefined) {
      warnToolPeriodUnjudged(toolName);
    }
  };

  /**
   * The honesty layers' TURN STAMP (adopted Q6): while an honesty layer is
   * armed (the inputs layer, the results layer, the answer layer), every row
   * this handler files through the one writer carries the conversation turn —
   * the ledger crosses turns on a continued conversation and `iteration`
   * restarts at 1 every run. `turnNumber` is read only then.
   */
  // While ANY honesty layer is armed, the one writer stamps the turn (adopted
  // Q6) — the inputs layer, or the results layer (step 7b).
  const turnStampOf = (scope: TypedScope<AgentState>): TurnStamp | undefined =>
    deps.inputsLayer === true || deps.resultsLayer === true || deps.answerLayer === true
      ? { turn: scope.turnNumber as number }
      : undefined;

  /**
   * THE PER-CALL PEEL (9.101.0, `.findings()`). Under the arm the reserved
   * `_findings` argument is taken off a call's args — UNLESS the tool that
   * answers the name OWNS the property (`findings/reserved.ts ·
   * ownsReservedArgument`). Such a schema was served undecorated
   * (`withFindingsArgument` returns it by reference; a REGISTRY schema doing
   * the same was refused at build, so this is a provider- or MCP-ingested
   * tool), and the model's value on that call is the author's argument: it
   * runs with the call and files no row, exactly as the committed schema
   * says. DECLARED SOURCES WITHOUT THE LEDGER (`.inputsLayer({
   * argumentSources: true })`, no `.findings()`) plant the argument on RULED
   * tools only (`withSourcesArgument`), so only those calls are peeled — by
   * the same rule the tools slot decorated with (`tools/declare.ts` ·
   * `carriesRules`). Unarmed: `tc.args` itself, by reference — not one byte
   * moves.
   */
  const peelsReserved = (tool: Tool | undefined): boolean =>
    !ownsReservedArgument(tool?.schema) &&
    (deps.findings === true || (deps.argumentSources === true && carriesRules(tool)));

  const peelCall = (tc: {
    readonly name: string;
    readonly args: Readonly<Record<string, unknown>>;
  }): SplitFindings =>
    peelsReserved(links.resolveTool(tc.name).tool)
      ? splitFindings(tc.args, links.peelArms)
      : { args: tc.args };

  /**
   * The inputs layer's note options: under declared sources an answered
   * clause says a later call may cite the answer in `_findings.from` — only
   * for a tool whose served schema CARRIES it. A tool whose author owns
   * `_findings` was served undecorated and its calls are not peeled
   * (`peelsReserved`'s rule, `ownsReservedArgument`; a registered one is
   * refused at build), so its note is the step-4 note. Absent → the step-3/4
   * note.
   */
  const noteOptionsFor = (tool: Tool | undefined): { readonly sources: true } | undefined =>
    deps.argumentSources === true && !ownsReservedArgument(tool?.schema) ? SOURCES_NOTE : undefined;

  /** The record of an off-wire dispatch — once per such call, before it runs. */
  const noteOffWire = (
    scope: TypedScope<AgentState>,
    resolved: Resolution,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
  ): void => {
    if (resolved.offWire !== true || resolved.party === undefined) return;
    typedEmit(scope, 'agentfootprint.tools.answered_off_wire', {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      iteration: call.iteration,
      answeredBy: resolved.party.channel,
      ...(resolved.party.id !== undefined && { answeredById: resolved.party.id }),
    });
  };

  const frameworkSkipStepAnswered = (name: string, answered: Tool | undefined): boolean =>
    links.frameworkSkipStep !== undefined &&
    name === SKIP_STEP_TOOL_NAME &&
    answered === links.frameworkSkipStep;

  /**
   * Every member id of every map the kernel currently holds PARKED (9.86.0
   * fix pass) — asked of `parkedMemberIds`, the kernel's own owner of the fact.
   *
   * ONE reader for TWO gates. The `skill_read` permission gate and the graph's
   * dispatch gate both have to tell a stay from a re-engagement, and they sit
   * 480 lines apart; the second computed this and the first did not, which is
   * exactly how a role-hidden parked member became re-activatable. Answers with
   * `undefined` when no engagement plan is mounted, which is every agent that
   * never called `.maps()`.
   */
  const parkedNow = (scope: TypedScope<AgentState>): ReadonlySet<string> | undefined =>
    deps.engagementPlan === undefined
      ? undefined
      : parkedMemberIds(deps.engagementPlan, scope.mapEngagement as MapEngagement | undefined);

  // FOLD · the one owner of "which tool names this caller may be told exist" for one iteration
  // consumers read this and never re-derive it: `toolCalls/helpers/dispatchRefusals.ts` · unknownToolResult, called at both dispatch doors
  // detached: yes — a fresh SpokenIds; the named half leaves through spoken().
  /**
   * Every name `lookupTool` would resolve, in resolution order, through the
   * role filter (9.86.0) — the roster `unknownToolResult` names.
   *
   * Derived from the SAME two sources the lookup reads, so a name it reports is
   * a name that resolved. Then filtered by the SAME fact every other sentence in
   * this stage filters by: `scope.hiddenSkillIds`, the per-iteration answer to
   * "which skills may this caller be told about". The first draft applied
   * neither, and named a hidden skill's tool to a role that may not see the
   * skill — the leak the `read_skill` refusals had just closed, reappearing one
   * sentence over because the roster read the dispatch map raw.
   *
   * A tool is unnameable only when EVERY skill declaring it is hidden
   * (`deps.toolDeclaringSkills`, the build-time owner of that fact). A tool two
   * skills share is still named when either is visible — the same
   * sole-owner rule the step hold-out uses, for the same reason: a shared name
   * is somebody's escape hatch. Names nobody declares from a skill — static
   * `.tool()` registrations, `read_skill`, `skip_step`, provider-delivered
   * tools — have no owning skill and are never filtered.
   *
   * DISPATCH IS UNTOUCHED. `lookupTool` still resolves every name in the map:
   * a narrowing may take a name out of a sentence, never out of the dispatch
   * map. This filter governs only what the model is TOLD.
   */
  const dispatchRoster = (scope: TypedScope<AgentState>): SpokenIds => {
    const names = [...links.registryByName.keys()];
    const seen = new Set(names);
    for (const t of links.externalToolProvider ? links.providerToolCache?.current ?? [] : []) {
      if (seen.has(t.schema.name)) continue;
      seen.add(t.schema.name);
      names.push(t.schema.name);
    }
    const hidden = new Set((scope.hiddenSkillIds as readonly string[] | undefined) ?? []);
    if (hidden.size === 0) return { named: names, held: names.length > 0 };
    const declaredBy = deps.toolDeclaringSkills;
    return spoken(names, (name) => {
      const owners = declaredBy?.get(name);
      return owners === undefined || owners.some((id) => !hidden.has(id));
    });
  };

  return {
    lookupTool,
    unmountedRules,
    warnUnmountedToolPeriod,
    turnStampOf,
    peelsReserved,
    peelCall,
    noteOptionsFor,
    noteOffWire,
    frameworkSkipStepAnswered,
    parkedNow,
    dispatchRoster,
  };
}
