import { expect, it } from 'vitest';
import {
  captureDispatch,
  captureReturnedEvidence,
  evidenceSnapshot,
  finalizeEvidence,
} from '../../../../../../integrity/claim-binding/capture.js';
import type { ClaimBindingRule } from '../../../../../../integrity/claim-binding/types.js';
import { describedResult } from '../../../../../../semantics/described.js';
import { semanticsForModel } from '../../../../../../semantics/envelope.js';
import { compareCitationSources } from './compareSources.js';

const day = { from: '2026-11-23T00:00:00Z', to: '2026-11-24T00:00:00Z' };
const scope = { station: 'North', unit: 'mm', grain: 'day', period: day };
function rule(toolName: string, id = toolName, field = 'amount'): ClaimBindingRule {
  return {
    id,
    version: '1',
    toolName,
    scopeDeclaration: {
      id: 'measurement-scope',
      version: '1',
      dimensions: Object.keys(scope).map((name) => ({ name, argumentPath: [name] })),
      periodDimension: 'period',
    },
    fact: { entity: { scopeDimension: 'station' }, field },
    coverage: () => 'complete',
  };
}

function receipt(
  declaration: ClaimBindingRule,
  value: number | string,
  ordinal: number,
  readScope = scope,
) {
  const original = describedResult({
    facts: [{ entity: readScope.station, [declaration.fact.field]: value }],
    provenance: { measuredAt: readScope.period.to, source: 'synthetic fixture' },
    coverage: { checked: ['amount'] },
    period: { queried: readScope.period, held: readScope.period },
  });
  const dispatch = captureDispatch(
    { namespace: 'compare', runId: 'run', ordinal },
    { toolName: declaration.toolName, toolCallId: 'same-id', iteration: 0 },
    readScope,
    declaration.scopeDeclaration,
  );
  return finalizeEvidence(
    dispatch,
    captureReturnedEvidence(dispatch, original),
    semanticsForModel(original),
    { resultVisible: true, scopeVisible: true, completed: true },
  );
}

function compare(
  options: {
    readonly right?: ClaimBindingRule;
    readonly readScope?: typeof scope;
    readonly value?: number | string;
    readonly excludeRight?: boolean;
    readonly separateConcept?: boolean;
  } = {},
) {
  const left = rule('first');
  const right = options.right ?? rule('second');
  const first = receipt(left, 12, 1);
  const second = receipt(right, options.value ?? 11, 2, options.readScope);
  const slots = new Map([[1, first.id]]);
  if (!options.excludeRight) slots.set(2, second.id);
  return compareCitationSources({
    slots,
    evidence: evidenceSnapshot('compare', ['run'], [first, second]),
    rules: [left, right],
    groups: options.separateConcept
      ? [
          { concept: 'rainfall', rules: [left.id] },
          { concept: 'flooding', rules: [right.id] },
        ]
      : [{ concept: 'rainfall', rules: [left.id, right.id] }],
  });
}

it('reports two accepted witnesses for a disagreement without an answer marker', () => {
  expect(compare()).toEqual({ complete: true, conflicts: [[1, 2]] });
});

it('compares equivalent absolute periods written in different offsets', () => {
  expect(
    compare({
      readScope: {
        ...scope,
        period: { from: '2026-11-22T19:00:00-05:00', to: '2026-11-23T19:00:00-05:00' },
      },
    }),
  ).toEqual({ complete: true, conflicts: [[1, 2]] });
});

it.each([
  { readScope: { ...scope, unit: 'cm' } },
  { readScope: { ...scope, grain: 'week' } },
  { readScope: { ...scope, grain: ' Unknown ' } },
  { readScope: { ...scope, station: 'South' } },
  { readScope: { ...scope, period: { from: '2026-11-22T00:00:00Z', to: day.from } } },
  { right: rule('first', 'same-tool') },
  { right: rule('second', 'second', 'forecast') },
  { right: { ...rule('second'), coverage: () => 'partial' as const } },
  { value: '11' },
  { value: 12 },
  { excludeRight: true },
  { separateConcept: true },
])('does not report a disagreement on ineligible or equal evidence (%j)', (options) => {
  expect(compare(options)).toEqual({ complete: true, conflicts: [] });
});

it('declines an offer exceeding the bounded source count', () => {
  const slots = new Map(Array.from({ length: 257 }, (_, index) => [index + 1, String(index)]));
  expect(
    compareCitationSources({
      slots,
      evidence: evidenceSnapshot('compare', ['run'], []),
      rules: [],
      groups: [],
    }),
  ).toEqual({ complete: false, conflicts: [] });
});
