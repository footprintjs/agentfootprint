/** Closed v2 admission for saved causal values; legacy rows are never upgraded. */
import { EVIDENCE_CAUSES, EVIDENCE_LIMITS, type EvidenceCause } from './observation.js';
import type { SnapshotEntry } from './types.js';

type Data = Record<string, unknown>;
function record(value: unknown): value is Data {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function own(value: Data, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function fields(value: unknown, allowed: readonly string[]): value is Data {
  return (
    record(value) &&
    Object.getOwnPropertyNames(value).every(
      (key) => allowed.includes(key) && 'value' in Object.getOwnPropertyDescriptor(value, key)!,
    )
  );
}
const text = (value: unknown): value is string => typeof value === 'string';
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const finite = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;

function dataArray(
  value: unknown,
  limit: number,
  admit: (item: unknown) => boolean,
): value is unknown[] {
  if (!Array.isArray(value) || value.length > limit) return false;
  for (let i = 0; i < value.length; i += 1) {
    const field = Object.getOwnPropertyDescriptor(value, String(i));
    if (!field || !('value' in field) || !admit(field.value)) return false;
  }
  return true;
}

function entry(value: unknown): boolean {
  if (!fields(value, ['kind', 'mode', 'nativeEntry'])) return false;
  if (value.kind === 'run') return fields(value, ['kind']);
  if (value.kind === 'resume')
    return fields(value, ['kind', 'mode']) && ['same', 'fresh'].includes(String(value.mode));
  return (
    fields(value, ['kind', 'nativeEntry']) &&
    value.kind === 'mounted' &&
    value.nativeEntry === 'unavailable'
  );
}

function coverage(value: unknown): boolean {
  if (!fields(value, ['scope', 'runId', 'entry', 'priorLegs', 'source'])) return false;
  const source = value.source;
  return (
    value.scope === 'component-execution-leg' &&
    text(value.runId) &&
    value.runId.length > 0 &&
    entry(value.entry) &&
    value.priorLegs === 'not-carried' &&
    fields(source, [
      'kind',
      'runId',
      'startedAtMs',
      'runtimeStageId',
      'subflowPath',
      'parentRuntimeStageId',
    ]) &&
    source.kind === 'stage' &&
    source.runId === value.runId &&
    finite(source.startedAtMs) &&
    text(source.runtimeStageId) &&
    source.runtimeStageId.length > 0 &&
    (source.subflowPath === undefined || text(source.subflowPath)) &&
    (source.parentRuntimeStageId === undefined || text(source.parentRuntimeStageId))
  );
}

function observations(value: Data): boolean {
  if (
    !coverage(value.coverage) ||
    !count(value.observedIterationStarts) ||
    (value.lastObservedIteration !== undefined && !count(value.lastObservedIteration))
  )
    return false;
  if (
    !dataArray(
      value.decisions,
      EVIDENCE_LIMITS.decisions,
      (d) =>
        fields(d, ['stageId', 'chosen', 'rule', 'evidence']) &&
        text(d.stageId) &&
        text(d.chosen) &&
        (d.rule === undefined || text(d.rule)) &&
        (d.evidence === undefined || record(d.evidence)),
    )
  )
    return false;
  if (
    !dataArray(
      value.toolCalls,
      EVIDENCE_LIMITS.toolCalls,
      (t) =>
        fields(t, ['name', 'args', 'resultPreview', 'errored']) &&
        text(t.name) &&
        record(t.args) &&
        text(t.resultPreview) &&
        typeof t.errored === 'boolean',
    )
  )
    return false;
  const tool = value.toolAccounting,
    usage = value.usageAccounting,
    omitted = value.omittedObservations;
  if (
    !fields(tool, ['unmatchedStarts', 'unmatchedEnds', 'duplicateStarts']) ||
    !count(tool.unmatchedStarts) ||
    tool.unmatchedStarts > EVIDENCE_LIMITS.pendingStarts ||
    !count(tool.unmatchedEnds) ||
    !count(tool.duplicateStarts) ||
    !fields(usage, ['observedCalls', 'missingUsage']) ||
    !count(usage.observedCalls) ||
    !count(usage.missingUsage) ||
    !fields(omitted, ['decisions', 'toolCalls', 'pendingStarts']) ||
    !count(omitted.decisions) ||
    !count(omitted.toolCalls) ||
    !count(omitted.pendingStarts)
  )
    return false;
  if (
    !fields(value.tokenUsage, ['input', 'output']) ||
    !finite(value.tokenUsage.input) ||
    !finite(value.tokenUsage.output) ||
    (usage.observedCalls === 0 && (value.tokenUsage.input !== 0 || value.tokenUsage.output !== 0))
  )
    return false;
  const duration = value.duration;
  if (
    !(fields(duration, ['kind']) && duration.kind === 'unavailable') &&
    !(
      fields(duration, ['kind', 'observationWindowMs']) &&
      duration.kind === 'measured' &&
      finite(duration.observationWindowMs)
    )
  )
    return false;
  const required: EvidenceCause[] = [];
  if (omitted.decisions + omitted.toolCalls + omitted.pendingStarts > 0)
    required.push('bounded-observation');
  if (tool.unmatchedStarts > 0 || tool.unmatchedEnds > 0) required.push('incomplete-tool-pairs');
  if (tool.duplicateStarts > 0) required.push('duplicate-tool-start');
  if (usage.missingUsage > 0) required.push('missing-usage');
  if (value.availability === 'observed') return value.causes === undefined && required.length === 0;
  if (
    value.availability !== 'partial' ||
    !dataArray(value.causes, EVIDENCE_CAUSES.length, (c) =>
      EVIDENCE_CAUSES.includes(c as EvidenceCause),
    ) ||
    value.causes.length === 0
  )
    return false;
  const causes = value.causes;
  return (
    causes.length <= EVIDENCE_CAUSES.length &&
    EVIDENCE_CAUSES.filter((c) => causes.includes(c)).join('|') === causes.join('|') &&
    required.every((c) => causes.includes(c))
  );
}

export type SnapshotAdmission =
  | { readonly kind: 'accepted'; readonly value: SnapshotEntry }
  | { readonly kind: 'unsupported' | 'invalid' };

export function readSnapshot(value: unknown): SnapshotAdmission {
  try {
    if (!record(value) || own(value, 'schemaVersion') !== 2) return { kind: 'unsupported' };
    const common = ['schemaVersion', 'query', 'finalContent', 'narrative', 'evalScore'];
    if (
      !text(own(value, 'query')) ||
      !text(own(value, 'finalContent')) ||
      (own(value, 'narrative') !== undefined && !text(own(value, 'narrative'))) ||
      (own(value, 'evalScore') !== undefined &&
        (typeof own(value, 'evalScore') !== 'number' || !Number.isFinite(own(value, 'evalScore'))))
    )
      return { kind: 'invalid' };
    const available = own(value, 'availability');
    if (available === 'unavailable') {
      if (
        !fields(value, [...common, 'availability', 'reason']) ||
        !['not-configured', 'observer-failed', 'collector-failed'].includes(
          String(own(value, 'reason')),
        )
      )
        return { kind: 'invalid' };
    } else if (
      !fields(value, [
        ...common,
        'availability',
        'coverage',
        'decisions',
        'toolCalls',
        'observedIterationStarts',
        'lastObservedIteration',
        'toolAccounting',
        'usageAccounting',
        'omittedObservations',
        'duration',
        'tokenUsage',
        'causes',
      ]) ||
      !observations(value)
    )
      return { kind: 'invalid' };
    return { kind: 'accepted', value: value as unknown as SnapshotEntry };
  } catch {
    return { kind: 'invalid' };
  }
}
