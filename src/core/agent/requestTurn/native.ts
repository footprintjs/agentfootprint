import type { TypedScope } from 'footprintjs';
import { namesAnything } from '../../../redaction/policy.js';
import {
  coverageInForce,
  privateFieldsInForce,
  runKeepsOut,
} from '../../../redaction/runRedaction.js';
import type { AgentState } from '../types.js';
import type { RequestReplayValue } from './state.js';

// Library marks on a source also cover the provider-only projection.
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
  const coverage = coverageInForce(scope);
  const selectors = privateFieldsInForce(scope);
  // Renderer output can combine partial fields, so a caller with any selected
  // data keeps this mixed copy out of records. Native checkpoints keep the value.
  const keepOut =
    value !== undefined &&
    (coverage.state === 'unknown' ||
      (coverage.state === 'covered' && namesAnything(coverage.policy)) ||
      (selectors !== undefined &&
        (selectors.keys.length > 0 || Object.keys(selectors.fields).length > 0)) ||
      PROJECTION_SOURCES.some((source) => runKeepsOut(scope, source)));
  scope.$setValue('requestReplay', value, keepOut);
}
