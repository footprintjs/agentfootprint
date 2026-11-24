import type { TypedScope } from 'footprintjs';
import { readOwnList } from '../../../lib/boundedJson.js';
import { type CallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { readDisplayName } from '../../../lib/displayName.js';
import { matchesPreparedData } from '../../../lib/matchesPreparedData.js';
import { ownCall } from '../stages/batchParties.js';
import { currentRequestIndexOf } from '../window/currentRequest.js';
import { declaredSourceGroups } from '../../../ontology/declaredSourceGroups.js';
import type { OntologySpec } from '../../../ontology/types.js';
import type { LLMRequest, WireToolManifest } from '../../../provider-contract/types.js';
import type { Tool } from '../../../tools/tools.js';
import type { AcceptedToolSelection } from '../../slots/commitServedTools.js';
import type { ServedToolParties } from '../../slots/buildToolsSlot.js';
import type { ToolClaim } from '../buildToolRegistry.js';
import type { ToolResolver } from '../stages/toolResolver.js';
import type { AgentState } from '../types.js';
import { MAX_ENTERED_TOOL_CALLS } from './enteredToolCalls.js';

type Scope = TypedScope<AgentState>;
type Binding = { readonly wireName: string; readonly tool: Tool };
type RecordedGroup = {
  readonly group: string;
  readonly callables: readonly number[];
  readonly origins?: readonly CallOccurrenceKey[];
};

type SelectionWitness = {
  readonly iteration: number;
  readonly consumer: AcceptedToolSelection['consumer'];
  readonly reason: 'top-N' | 'ledger' | 'skill-scope';
};

type SourceRoute = {
  readonly group: string;
  readonly callable: number;
  readonly iteration: number;
  readonly name?: string;
  readonly selection?: SelectionWitness;
};

export interface SourceConsultationRecord {
  readonly complete: boolean;
  readonly offers: readonly SourceRoute[];
  /** Only admitted, role-visible selection decisions on accepted requests. */
  readonly omissions?: readonly SourceRoute[];
  readonly attempted: readonly number[];
  readonly groups: readonly RecordedGroup[];
}

interface Group {
  readonly tools: readonly string[];
  readonly equivalents?: readonly string[];
  readonly origins?: readonly CallOccurrenceKey[];
}

interface ConsultationDeps {
  readonly ontology?: OntologySpec;
  readonly servedTools: ServedToolParties;
  readonly resolve: ToolResolver;
  readonly toolClaimants: ReadonlyMap<string, readonly ToolClaim[]>;
}

const LIMIT = MAX_ENTERED_TOOL_CALLS;

/** The adapter reports names from its final body. Admit each name at most once. */
function manifestNames(manifest: WireToolManifest | undefined): ReadonlySet<string> {
  const names = new Set<string>();
  const duplicates = new Set<string>();
  try {
    const list =
      manifest === undefined
        ? undefined
        : readOwnList(Object.getOwnPropertyDescriptor(manifest, 'toolNames')?.value, LIMIT);
    if (list === undefined || list.unread !== 0) return names;
    for (const name of list.entries) {
      if (typeof name !== 'string' || name.length === 0) return new Set();
      if (names.has(name)) duplicates.add(name);
      names.add(name);
    }
    for (const name of duplicates) names.delete(name);
    return names;
  } catch {
    return new Set();
  }
}

/** One data schema per effective wire name. Repeated names cannot bind a contract. */
function requestSchemas(request: LLMRequest): ReadonlyMap<string, object | null> {
  const names = new Map<string, object | null>();
  try {
    const list = readOwnList(Object.getOwnPropertyDescriptor(request, 'tools')?.value, LIMIT);
    if (list === undefined || list.unread !== 0) return names;
    for (const schema of list.entries) {
      if (schema === null || typeof schema !== 'object') continue;
      const name = Object.getOwnPropertyDescriptor(schema, 'name')?.value;
      if (typeof name === 'string' && name.length > 0)
        names.set(name, names.has(name) ? null : schema);
    }
  } catch {
    return new Map();
  }
  return names;
}

/** Source coverage for this invocation, with actual callable identity kept inside its native bank. */
export function buildSourceConsultation(deps: ConsultationDeps) {
  const indexed = new Map<Tool, number>();
  const bindings = new Map<string, Tool>();
  const ambiguous = new Set<string>();
  const offers = new Map<string, number>();
  const omissions = new Map<string, SelectionWitness>();
  let declaredRoutes: ReadonlySet<string> | undefined;
  const attempted = new Set<number>();
  const suggestions = new Map<string, CallOccurrenceKey[]>();
  let grounds: readonly Group[] | undefined;
  let complete = true;
  let suggestionCount = 0;
  let previous = '';

  function hiddenSkills(scope: Scope): ReadonlySet<string> {
    return new Set(('hiddenSkillIds' in scope ? scope.hiddenSkillIds : undefined) ?? []);
  }

  function visible(tool: Tool, name: string, hidden: ReadonlySet<string>): boolean {
    if (hidden.size === 0) return true;
    const claims = deps.toolClaimants.get(name)?.filter((claim) => claim.tool === tool);
    return (
      claims === undefined ||
      claims.length === 0 ||
      claims.some(
        (claim) => claim.channel !== 'skill' || (claim.id !== undefined && !hidden.has(claim.id)),
      )
    );
  }

  function index(tool: Tool): number | undefined {
    const prior = indexed.get(tool);
    if (prior !== undefined) return prior;
    if (indexed.size === LIMIT) {
      complete = false;
      return undefined;
    }
    const next = indexed.size;
    indexed.set(tool, next);
    return next;
  }

  function admit(binding: Binding): number | undefined {
    const prior = bindings.get(binding.wireName);
    if (prior !== undefined && prior !== binding.tool) ambiguous.add(binding.wireName);
    if (bindings.size === LIMIT && prior === undefined) {
      complete = false;
      return undefined;
    }
    bindings.set(binding.wireName, binding.tool);
    return index(binding.tool);
  }

  function markAmbiguous(name: string): void {
    if (ambiguous.size < LIMIT || ambiguous.has(name)) ambiguous.add(name);
    else complete = false;
  }

  function ensureTurn(scope: Scope): void {
    if (grounds !== undefined) return;
    // A rebuilt bank cannot rejoin the exact callable objects of a prior leg.
    // Native pauses retaining this bank still have the original proof.
    complete =
      scope.iteration === 1 &&
      !('sourceConsultation' in scope) &&
      !('sourceConsultationInterrupted' in scope) &&
      scope.settledToolCallsComplete !== false;
    const composed = 'userMessageFrom' in scope && scope.userMessageFrom === 'composed';
    const said = scope.userMessage;
    const question =
      composed || deps.ontology === undefined || typeof said !== 'string'
        ? undefined
        : scope.history[currentRequestIndexOf(scope.history, said)]?.content;
    grounds =
      question === undefined || question !== said || deps.ontology === undefined
        ? []
        : declaredSourceGroups(deps.ontology, question);
  }

  function collectGroups(hidden: ReadonlySet<string>): readonly Group[] {
    const all = grounds ?? [];
    const named = new Set(all.flatMap((group) => group.tools));
    return [
      ...all,
      ...[...suggestions].flatMap(([name, origins]) => {
        const tool = bindings.get(name);
        return named.has(name) || !tool || !visible(tool, name, hidden)
          ? []
          : [{ tools: [name], origins }];
      }),
    ];
  }

  function commit(scope: Scope): void {
    const groups: RecordedGroup[] = [];
    const visibleOffers: SourceRoute[] = [];
    const visibleOmissions: SourceRoute[] = [];
    const hidden = hiddenSkills(scope);
    let holders = 0;
    let origins = 0;
    for (const entry of collectGroups(hidden)) {
      const alternatives = entry.equivalents ?? entry.tools;
      if (
        alternatives.some((name) => {
          const tool = bindings.get(name);
          return ambiguous.has(name) && tool !== undefined && visible(tool, name, hidden);
        })
      )
        continue;
      const eligible = new Set(entry.tools);
      const candidates = alternatives.flatMap((wireName) => {
        const tool = bindings.get(wireName);
        const callable = tool === undefined ? undefined : indexed.get(tool);
        return tool !== undefined && callable !== undefined && visible(tool, wireName, hidden)
          ? [{ wireName, tool, callable }]
          : [];
      });
      const offered = candidates.flatMap((candidate) => {
        const iteration = eligible.has(candidate.wireName)
          ? offers.get(candidate.wireName)
          : undefined;
        return iteration === undefined ? [] : [{ ...candidate, iteration, selection: undefined }];
      });
      // Prefer the witnessed offer when a declared holder reached any accepted request.
      // A tree catalog ID or a shadowed name alone cannot identify an unavailable callable.
      const omitted =
        offered.length || entry.origins !== undefined
          ? []
          : candidates.flatMap((candidate) => {
              const selection = eligible.has(candidate.wireName)
                ? omissions.get(candidate.wireName)
                : undefined;
              return selection === undefined
                ? []
                : [{ ...candidate, iteration: selection.iteration, selection }];
            });
      const witnessed = offered.length ? offered : omitted;
      if (!witnessed.length) continue;
      const callables = [...new Set(candidates.map((candidate) => candidate.callable))];
      holders += callables.length;
      origins += entry.origins?.length ?? 0;
      if (
        holders > LIMIT ||
        origins > LIMIT ||
        visibleOffers.length + visibleOmissions.length + witnessed.length > LIMIT
      ) {
        complete = false;
        break;
      }
      const group = String(groups.length);
      groups.push({
        group,
        callables,
        ...(entry.origins !== undefined && { origins: entry.origins }),
      });
      const target = offered.length ? visibleOffers : visibleOmissions;
      for (const candidate of witnessed) {
        const label =
          candidate.selection === undefined
            ? candidate.tool.displayName
            : Object.getOwnPropertyDescriptor(candidate.tool, 'displayName')?.value;
        const name = readDisplayName(label);
        target.push({
          group,
          callable: candidate.callable,
          iteration: candidate.iteration,
          ...(candidate.selection !== undefined && { selection: candidate.selection }),
          ...(name !== undefined && { name }),
        });
      }
    }
    const record: SourceConsultationRecord = complete
      ? {
          complete,
          offers: visibleOffers,
          ...(visibleOmissions.length > 0 && { omissions: visibleOmissions }),
          attempted: [...attempted],
          groups,
        }
      : { complete, offers: [], attempted: [], groups: [] };
    const serialized = JSON.stringify(record);
    if (serialized === previous) return;
    previous = serialized;
    scope.sourceConsultation = record;
  }

  return {
    capture(
      scope: Scope,
      request: LLMRequest,
      authorized: LLMRequest,
      earlier?: readonly Binding[],
    ): readonly Binding[] {
      const current = deps.servedTools.currentImplementations;
      if (current === undefined || deps.servedTools.restored === true) return [];
      const hidden = hiddenSkills(scope);
      const authorizedSchemas = requestSchemas(authorized);
      // The observer can see more than one transport inside a custom wrapper.
      // Retain only bindings common to every observation until a new phase begins.
      const prior =
        earlier === undefined
          ? undefined
          : new Map(earlier.map((binding) => [binding.wireName, binding.tool]));
      const bindings: Binding[] = [];
      for (const [wireName, schema] of requestSchemas(request)) {
        const tool = current.get(wireName);
        if (tool === undefined || (prior !== undefined && prior.get(wireName) !== tool)) continue;
        const contract = authorizedSchemas.get(wireName);
        if (schema === null || contract == null || !matchesPreparedData(contract, schema)) continue;
        const resolved = deps.resolve(wireName);
        if (resolved.tool === tool && resolved.offWire !== true && visible(tool, wireName, hidden))
          bindings.push({ wireName, tool });
      }
      return bindings;
    },

    accepted(
      scope: Scope,
      request: readonly Binding[] | undefined,
      manifest: WireToolManifest | undefined,
      calls: readonly unknown[],
    ): void {
      ensureTurn(scope);
      if (calls.length > LIMIT) {
        complete = false;
        commit(scope);
        return;
      }
      const onWire = manifestNames(manifest);
      for (const binding of request ?? []) {
        if (
          admit(binding) !== undefined &&
          onWire.has(binding.wireName) &&
          !offers.has(binding.wireName)
        )
          offers.set(binding.wireName, scope.iteration);
      }
      const hidden = hiddenSkills(scope);
      for (const value of calls) {
        const call = ownCall(value);
        if (call === undefined) continue;
        const resolved = deps.resolve(call.name);
        if (resolved.tool === undefined) {
          const prior = bindings.get(call.name);
          if (prior !== undefined && visible(prior, call.name, hidden)) markAmbiguous(call.name);
          continue;
        }
        if (!visible(resolved.tool, call.name, hidden)) continue;
        const callable = admit({ wireName: call.name, tool: resolved.tool });
        if (callable !== undefined) attempted.add(callable);
      }
      commit(scope);
    },

    omitted(scope: Scope, proof: AcceptedToolSelection): void {
      if (!complete || !grounds?.length) return;
      declaredRoutes ??= new Set(grounds.flatMap((group) => group.tools));
      const hidden = hiddenSkills(scope);
      let recorded = false;
      for (const row of proof.rows) {
        if (row.kind === 'tree-routed' || row.kind === 'collision' || !declaredRoutes.has(row.name))
          continue;
        if (!visible(row.tool, row.name, hidden)) continue;
        if (admit({ wireName: row.name, tool: row.tool }) !== undefined && !omissions.has(row.name))
          omissions.set(row.name, {
            iteration: proof.iteration,
            consumer: proof.consumer,
            reason: row.kind,
          });
        recorded = true;
      }
      if (recorded) commit(scope);
    },

    innerAttempt(scope: Scope, wireName: string, tool: Tool): void {
      if (grounds === undefined || !visible(tool, wireName, hiddenSkills(scope))) return;
      const callable = admit({ wireName, tool });
      if (callable !== undefined) attempted.add(callable);
      commit(scope);
    },

    suggestion(scope: Scope, wireName: string, producer: string, origin: CallOccurrenceKey): void {
      if (grounds === undefined) return;
      const hidden = hiddenSkills(scope);
      const originTool = deps.resolve(producer).tool;
      const tool = deps.resolve(wireName).tool;
      if (
        originTool === undefined ||
        !visible(originTool, producer, hidden) ||
        (tool !== undefined && !visible(tool, wireName, hidden))
      )
        return;
      if (tool !== undefined && admit({ wireName, tool }) === undefined) return;
      const known = suggestions.get(wireName) ?? [];
      if (suggestionCount === LIMIT) complete = false;
      else {
        suggestionCount += 1;
        suggestions.set(wireName, [...known, [...origin]]);
      }
      commit(scope);
    },
  };
}

export type SourceConsultation = ReturnType<typeof buildSourceConsultation>;
