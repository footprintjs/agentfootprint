import type { TypedScope } from 'footprintjs';
import { RedactionRule, valueBehind } from 'footprintjs/advanced';
import { BINDING_LIMITS } from '../../../integrity/claim-binding/scope.js';
import type { EvidenceSnapshot } from '../../../integrity/claim-binding/types.js';
import { readCallOccurrenceKey } from '../../../lib/callOccurrence.js';
import { toolBytesOf } from '../../../lib/toolBytes.js';
import type { SubmittedCitationOffer } from '../../../provider-contract/citationResponse.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { coverageInForce, policyInForce } from '../../../redaction/runRedaction.js';
import { ruleShowsPath } from '../../../redaction/sourceLinkPolicy.js';
import type { AgentState } from '../types.js';
import { MAX_CITATION_HISTORY_ROWS, matchesCitationBody } from './accepted.js';
import type { StoredCitationSource } from './capture.js';

function toolMessagePosition(history: readonly LLMMessage[], occurrence: string): number {
  if (history.length > MAX_CITATION_HISTORY_ROWS) return -1;
  let position = -1;
  for (const [index, row] of history.entries()) {
    if (row?.role !== 'tool' || readCallOccurrenceKey(row) !== occurrence) continue;
    if (position !== -1) return -1;
    position = index;
  }
  return position;
}

function permitsFields(rule: RedactionRule, path: readonly string[], fields: readonly string[]) {
  return fields.every(
    (field) => !rule.isKeyRedacted(field) && ruleShowsPath(rule, [...path, field]),
  );
}

function permitsSlots(rule: RedactionRule, path: readonly string[], size: number) {
  for (let position = 0; position < size; position++)
    if (!ruleShowsPath(rule, [...path, String(position)])) return false;
  return true;
}

/** A column's absence requires the visible body, governing receipt and complete schema. */
export function visibleColumnsForCitedResult(
  scope: TypedScope<AgentState>,
  sources: readonly StoredCitationSource[],
  offer: SubmittedCitationOffer | undefined,
  evidence: EvidenceSnapshot | undefined,
  resultId: string,
): readonly string[] | undefined {
  if (offer === undefined || evidence === undefined || coverageInForce(scope).state === 'unknown')
    return undefined;
  if (sources.length > BINDING_LIMITS.results || evidence.results.length > BINDING_LIMITS.results)
    return undefined;
  const sourceIndex = sources.findIndex((source) => source.resultId === resultId);
  const resultIndex = evidence.results.findIndex(({ id }) => id === resultId);
  const result = evidence.results[resultIndex];
  const offerIndex = offer.results.findIndex((entry) => entry.resultId === resultId);
  const selected = offer.results[offerIndex];
  const source = valueBehind(sources[sourceIndex]) as StoredCitationSource | undefined;
  const columns = source?.completeColumns;
  if (
    source === undefined ||
    columns === undefined ||
    selected === undefined ||
    result === undefined ||
    result.unavailable !== undefined
  )
    return undefined;
  const occurrence = readCallOccurrenceKey(source);
  if (
    typeof occurrence !== 'string' ||
    readCallOccurrenceKey({ callOccurrenceKey: selected.occurrence }) !== occurrence
  )
    return undefined;

  const history = scope.$getValue('history') as readonly LLMMessage[] | undefined;
  if (!Array.isArray(history)) return undefined;
  const position = toolMessagePosition(history, occurrence);
  const row = history[position];
  if (row === undefined || row.toolCallId !== result.toolCallId) return undefined;
  const toolBody = toolBytesOf(row);
  if (!matchesCitationBody(toolBody, source.bodyDigest)) return undefined;
  // The submitted result can include a framework note after the tool's own bytes.
  if (
    toolBody === row.content
      ? selected.bodyDigest !== source.bodyDigest
      : !matchesCitationBody(row.content, selected.bodyDigest)
  )
    return undefined;

  // The existing caller policy governs public facts derived from these private
  // working carriers. Their automatic whole-root masks protect the raw data.
  const policy = policyInForce(scope);
  if (policy === undefined) return columns;
  const rule = new RedactionRule(policy);
  const rowPath = ['history', String(position)];
  const resultPath = ['resultIdentities', 'evidence', 'results', String(resultIndex)];
  const sourcePath = ['citationSources', String(sourceIndex)];
  const offerPath = ['acceptedCitationOffer', '0', 'submitted', 'results', String(offerIndex)];
  return permitsFields(rule, rowPath, [
    'role',
    'content',
    'toolChars',
    'toolCallId',
    'callOccurrenceKey',
  ]) &&
    permitsSlots(rule, [...rowPath, 'callOccurrenceKey'], source.callOccurrenceKey.length) &&
    ruleShowsPath(rule, resultPath) &&
    permitsFields(rule, resultPath, ['id', 'identity', 'toolCallId']) &&
    permitsFields(rule, [...resultPath, 'identity'], ['namespace', 'runId', 'ordinal']) &&
    permitsFields(rule, sourcePath, [
      'resultId',
      'bodyDigest',
      'callOccurrenceKey',
      'completeColumns',
    ]) &&
    permitsSlots(rule, [...sourcePath, 'callOccurrenceKey'], source.callOccurrenceKey.length) &&
    permitsSlots(rule, [...sourcePath, 'completeColumns'], columns.length) &&
    permitsFields(rule, offerPath, ['resultId', 'bodyDigest', 'slot', 'occurrence']) &&
    permitsSlots(rule, [...offerPath, 'occurrence'], selected.occurrence.length)
    ? columns
    : undefined;
}
