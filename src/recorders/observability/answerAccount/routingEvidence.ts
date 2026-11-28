import { readOwnList } from '../../../lib/boundedJson.js';
import type { AccountEventEvidence } from './evidence.js';

const GRAPH = 'agentfootprint.skill.graph_declared';
const ROUTED = 'agentfootprint.skill.turn_routed';
const MAX_ROUTING_ENTRIES = 256;

export function isInitialRoutingEvent(type: string): boolean {
  return type === GRAPH || type === ROUTED;
}

/** Read only selected data descriptors. Foreign objects cannot supply an implicit routing fact. */
function fields(source: unknown, names: readonly string[]): Record<string, unknown> {
  if (source === null || typeof source !== 'object') throw new TypeError('Invalid routing record.');
  const prototype: unknown = Object.getPrototypeOf(source);
  if (prototype !== null && prototype !== Object.prototype)
    throw new TypeError('Invalid routing record prototype.');
  const selected: [string, unknown][] = [];
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    if (descriptor !== undefined) {
      if (!('value' in descriptor)) throw new TypeError('Unstable routing record.');
      const value: unknown = descriptor.value;
      if (value !== undefined) selected.push([name, value]);
    }
  }
  return Object.fromEntries(selected);
}

function leaves(source: unknown, names: readonly string[]): Record<string, unknown> {
  const selected = fields(source, names);
  if (
    Object.values(selected).some((value) => !['string', 'number', 'boolean'].includes(typeof value))
  )
    throw new TypeError('Invalid routing leaf.');
  return selected;
}

function entries(value: unknown): readonly unknown[] {
  const list = readOwnList(value, MAX_ROUTING_ENTRIES);
  if (list === undefined || list.unread > 0) throw new RangeError('Routing evidence list limit.');
  return list.entries;
}

/** Inputs to the ordinary routing and label readers, at the original array positions. */
export function projectInitialRouting(
  type: string,
  source: unknown,
): Record<string, unknown> | undefined {
  if (type === GRAPH) {
    const { nodes } = fields(source, ['nodes']);
    return { nodes: entries(nodes).map((node) => leaves(node, ['id', 'title'])) };
  }
  if (type !== ROUTED) return undefined;

  const verdict = leaves(source, ['by', 'from', 'to', 'decisive', 'scorer']);
  const { scores, offered, witness, decider } = fields(source, [
    'scores',
    'offered',
    'witness',
    'decider',
  ]);
  return {
    ...verdict,
    ...(scores !== undefined && {
      scores: entries(scores).map((score) => leaves(score, ['id', 'score'])),
    }),
    // The whole reader uses only the menu length. The offered ids have no evidence pointer.
    ...(offered !== undefined && { offered: entries(offered).map(() => null) }),
    ...(witness !== undefined && { witness: leaves(witness, ['text']) }),
    ...(decider !== undefined && { decider: leaves(decider, ['model']) }),
  };
}

/** Only a complete, fresh native pair is admitted for a graph. Rules-only graphs stay unavailable. */
export function hasInitialRoutingWitnesses(events: readonly AccountEventEvidence[]): boolean {
  const configured = events.find(
    ({ event }) => event.type === 'agentfootprint.agent.run_configured',
  );
  const model = events.find(({ event }) => event.type === 'agentfootprint.stream.llm_start');
  const routing = events.filter(({ event }) => isInitialRoutingEvent(event.type));
  if (configured?.event.payload.skillGraph === undefined) return routing.length === 0;
  const [graph, verdict] = routing;
  return (
    configured !== undefined &&
    model !== undefined &&
    routing.length === 2 &&
    graph?.event.type === GRAPH &&
    verdict?.event.type === ROUTED &&
    model.event.meta.runId === configured.event.meta.runId &&
    graph.event.meta.runId === configured.event.meta.runId &&
    verdict.event.meta.runId === configured.event.meta.runId &&
    configured.index < graph.index &&
    graph.index < verdict.index &&
    verdict.index < model.index &&
    typeof verdict.event.payload.by === 'string'
  );
}
