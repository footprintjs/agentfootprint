import type { AttemptContext } from 'footprintjs';
import { matchesPreparedData } from '../../../../lib/matchesPreparedData.js';
import type { LLMRequest, LLMResponse } from '../../../../provider-contract/types.js';
import type { AcceptedToolSelection, ServedToolParties } from '../../../slots/commitServedTools.js';

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

/** Private, per-call evidence. An adapter manifest attests names only. A collision whose
 * winner was offered needs additional implementation proof before it can travel with a request. */
export function selectionAtRequest(
  owner: ServedToolParties | undefined,
  iteration: number,
  consumer: Pick<AttemptContext, 'series' | 'attempt' | 'signal'> | undefined,
  initial: LLMRequest,
  withheld: boolean,
) {
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
  const rows = selection.rows.filter((row) => row.kind !== 'collision' && !offered.has(row.name));
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
      const accepted = {
        consumer: { series: consumer.series, attempt: consumer.attempt },
        iteration,
        rows,
      };
      selection.accepted = accepted;
      return accepted;
    },
  };
}
