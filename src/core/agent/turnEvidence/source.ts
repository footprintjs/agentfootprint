import type { AgentfootprintEvent, AgentfootprintEventMap } from '../../../events/registry.js';
import { CONSUMER_SCOPE_RUN_ID } from '../../../bridge/eventMeta.js';
import type { TurnEvidenceSource } from './types.js';

const TURN_END = 'agentfootprint.agent.turn_end';
type TurnEnd = AgentfootprintEventMap[typeof TURN_END];

export interface RecordedTurn {
  readonly snapshot: Readonly<Record<string, unknown>> | undefined;
  readonly events: readonly AgentfootprintEvent[];
  readonly terminal: TurnEnd;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameComponent(event: AgentfootprintEvent, terminal: TurnEnd): boolean {
  const path = event.meta?.compositionPath;
  const owner = terminal.meta.compositionPath;
  return (
    Array.isArray(path) &&
    path.length === owner.length &&
    path.every((name, index) => name === owner[index])
  );
}

export function recordedTurn(source: TurnEvidenceSource, runId: string): RecordedTurn | undefined {
  if (!runId || runId === CONSUMER_SCOPE_RUN_ID || !Array.isArray(source.events)) return undefined;
  const own = source.events.filter((event) => event?.meta?.runId === runId);
  const terminals = own.filter((event): event is TurnEnd => event.type === TURN_END);
  // A named run can appear in a composite recording. An unambiguous terminal
  // names the component and cuts later events away from its verdict.
  if (terminals.length !== 1) return undefined;
  const [terminal] = terminals;
  if (!Array.isArray(terminal.meta.compositionPath)) return undefined;
  const events = own
    .slice(0, own.indexOf(terminal) + 1)
    .filter((event) => sameComponent(event, terminal));
  // A recorder left on a pooled agent can still have the requested event
  // alongside a snapshot from its next turn. Check the native address first.
  const snapshot = source.snapshot;
  const engineId = terminal.meta.sourcePosition?.engineRunId ?? runId;
  return {
    events,
    terminal,
    snapshot: isRecord(snapshot) && snapshot.runId === engineId ? snapshot : undefined,
  };
}
