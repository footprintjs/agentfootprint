import { registeredToolForParty } from '../toolResolver.js';
import type { Tool } from '../../../../tools/tools.js';
import type { CallLLMStageDeps } from './types.js';
import type { AttemptContext } from 'footprintjs';
import { matchesPreparedData } from '../../../../lib/matchesPreparedData.js';
import type { LLMRequest, LLMResponse } from '../../../../provider-contract/types.js';
import type { AcceptedToolSelection } from '../../../slots/commitServedTools.js';

function sameUnforcedCatalog(expected: LLMRequest['tools'], request: LLMRequest): boolean {
  try {
    const tools = Object.getOwnPropertyDescriptor(request, 'tools');
    const forced = Object.getOwnPropertyDescriptor(request, 'toolChoice');
    return (
      (forced !== undefined || !('toolChoice' in request)) &&
      (tools !== undefined || !('tools' in request)) &&
      (!forced || ('value' in forced && forced.value === undefined)) &&
      (!tools || 'value' in tools) &&
      matchesPreparedData(expected, tools?.value)
    );
  } catch {
    return false;
  }
}

function confirmsNames(response: LLMResponse, names: readonly string[]): boolean {
  try {
    const manifest = Object.getOwnPropertyDescriptor(response, 'wireManifest')?.value;
    if (!manifest || typeof manifest !== 'object') return false;
    const wire = Object.getOwnPropertyDescriptor(manifest, 'toolNames')?.value;
    return (
      Array.isArray(wire) &&
      Object.getOwnPropertyDescriptor(wire, 'length')?.value === names.length &&
      names.every((name, i) => Object.getOwnPropertyDescriptor(wire, String(i))?.value === name)
    );
  } catch {
    return false;
  }
}

/** Private, per-call evidence. An adapter manifest attests names only. For a collision,
 * the native registration must also bind the exact winner at request and acceptance. */
export function selectionAtRequest(
  deps: Pick<CallLLMStageDeps, 'servedTools' | 'registrations'>,
  iteration: number,
  consumer: Pick<AttemptContext, 'series' | 'attempt' | 'signal'> | undefined,
  initial: LLMRequest,
  withheld: boolean,
) {
  const { servedTools: owner, registrations } = deps;
  const selection = owner?.selection;
  if (
    !owner ||
    !selection?.complete ||
    selection.iteration !== iteration ||
    !consumer?.series ||
    !Number.isSafeInteger(consumer.attempt) ||
    consumer.attempt < 1 ||
    consumer.signal.aborted ||
    withheld ||
    initial.toolChoice !== undefined
  )
    return undefined;
  const catalog = initial.tools;
  const names = (catalog ?? []).map((schema) => schema.name);
  const offered = new Set(names);
  if (
    names.length !== offered.size ||
    offered.size !== owner.current.size ||
    names.some((name) => !owner.current.has(name))
  )
    return undefined;
  const eligibleRows = (candidates: AcceptedToolSelection['rows']) => {
    const bindings = new Map<string, Tool | undefined>();
    return candidates.filter((row) => {
      if (row.kind === 'tree-routed')
        return !offered.has('read_skill') && !offered.has('list_skills');
      if (row.kind !== 'collision') return !offered.has(row.name);
      const { name, winner } = row;
      if (
        !registrations ||
        !offered.has(name) ||
        row.tool === winner.tool ||
        winner.party.channel === 'provider' ||
        owner.restored ||
        owner.pinned?.has(name) ||
        owner.current.get(name) !== winner.party
      )
        return false;
      if (!bindings.has(name))
        bindings.set(name, registeredToolForParty(registrations, name, winner.party)?.tool);
      return bindings.get(name) === winner.tool;
    });
  };
  const rows = eligibleRows(selection.rows);
  if (!rows.length) return undefined;
  // Retain identity only on this native call. A discarded or late response cannot
  // supply the proof for a different response that actually passes validation.
  const witnessed = new WeakMap<LLMResponse, boolean>();
  return {
    attempt() {
      let observed = false;
      let matches = true;
      return {
        observe(request: LLMRequest) {
          observed = true;
          matches &&= sameUnforcedCatalog(catalog, request);
        },
        finish(response: LLMResponse) {
          const unique = !witnessed.has(response);
          witnessed.set(response, unique && matches && observed && confirmsNames(response, names));
        },
      };
    },
    accept(response: LLMResponse): AcceptedToolSelection | undefined {
      if (
        consumer.signal.aborted ||
        owner.selection !== selection ||
        !witnessed.get(response) ||
        !confirmsNames(response, names)
      )
        return undefined;
      const retained = eligibleRows(rows);
      if (!retained.length) return undefined;
      const accepted = {
        consumer: { series: consumer.series, attempt: consumer.attempt },
        iteration,
        rows: retained,
      };
      selection.accepted = accepted;
      return accepted;
    },
  };
}
