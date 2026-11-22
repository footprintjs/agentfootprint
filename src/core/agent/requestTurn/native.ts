import type { TypedScope } from 'footprintjs';
import { runKeepsOut } from '../../../redaction/runRedaction.js';
import type { AgentState } from '../types.js';
import type { RequestReplayValue } from './state.js';

// If the host selects an original state key, its private replay copy inherits that choice.
const PROJECTION_SOURCES = [
  'history',
  'findingsLedger',
  'placedTickets',
  'timeLine',
  'evidenceRecovery',
  'llmLatestContent',
  'thinkingBlocks',
];

export function writeRequestReplay(
  scope: TypedScope<AgentState>,
  value: RequestReplayValue | undefined,
): void {
  const keepOut =
    value !== undefined && PROJECTION_SOURCES.some((source) => runKeepsOut(scope, source));
  scope.$setValue('requestReplay', value, keepOut);
}
