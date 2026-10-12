/** Closed restored-data schemas; shared JSON/coverage/period owners do validation. */
import { copyJson, ownData } from '../../lib/boundedJson.js';
import { normalizeCoverageList, type CoverageSection } from '../../core/agent/coverage/items.js';
import { periodProblem } from '../../core/agent/coverage/period.js';
import type { CoverageInput } from '../../core/agent/coverage/types.js';
import { BINDING_LIMITS, boundedText, boundedResultId, scopeDeclarationOf } from './scope.js';
import { resultIdentityOf } from './capture.js';
import { BINDING_REASONS } from './types.js';
import type { ClaimBindingRule, EvidenceSnapshot, ResultEvidence } from './types.js';

export function bindingRuleOf(raw: unknown): ClaimBindingRule {
  const rule = ownData(raw, ['id', 'version', 'toolName', 'scopeDeclaration', 'fact', 'coverage']);
  const fact = ownData(rule.fact, ['entity', 'field']);
  if (
    !boundedText(rule.id) ||
    !boundedText(rule.version) ||
    !boundedText(rule.toolName) ||
    !boundedText(fact.field) ||
    (Object.hasOwn(rule, 'coverage') && typeof rule.coverage !== 'function')
  )
    throw new Error('Invalid claim binding rule.');
  const scopeDeclaration = scopeDeclarationOf(rule.scopeDeclaration);
  let entity: ClaimBindingRule['fact']['entity'];
  if (typeof fact.entity === 'string') {
    if (!boundedText(fact.entity)) throw new Error('Invalid fact entity.');
    entity = fact.entity;
  } else {
    const selector = ownData(fact.entity, ['scopeDimension']);
    if (
      !boundedText(selector.scopeDimension) ||
      !scopeDeclaration.dimensions.some((dimension) => dimension.name === selector.scopeDimension)
    )
      throw new Error('Invalid entity scope selector.');
    entity = Object.freeze({ scopeDimension: selector.scopeDimension });
  }
  return Object.freeze({
    id: rule.id,
    version: rule.version,
    toolName: rule.toolName,
    scopeDeclaration,
    fact: Object.freeze({ entity, field: fact.field }),
    ...(typeof rule.coverage === 'function' && {
      coverage: rule.coverage as NonNullable<ClaimBindingRule['coverage']>,
    }),
  });
}

function validateCoverage(raw: unknown): void {
  const coverage = ownData(raw, ['checked', 'notChecked', 'cannotCover']);
  for (const section of ['checked', 'notChecked', 'cannotCover'] as const) {
    const list = coverage[section];
    if (!Array.isArray(list) || list.length > BINDING_LIMITS.results)
      throw new Error('Invalid coverage list.');
    for (const rawItem of list) {
      const item = ownData(rawItem, ['what', 'why', 'short', 'kind']);
      if (!boundedText(item.what) || (Object.hasOwn(item, 'why') && !boundedText(item.why)))
        throw new Error('Invalid coverage item.');
    }
    // Ask the one existing rule owner, but never repair the saved shape.
    normalizeCoverageList(
      section as CoverageSection,
      list as readonly CoverageInput[],
      section === 'cannotCover',
    );
  }
}

function resultOf(raw: unknown): ResultEvidence {
  raw = copyJson(raw, BINDING_LIMITS.resultBytes, true);
  const result = ownData(raw, [
    'identity',
    'id',
    'toolName',
    'toolCallId',
    'iteration',
    'scopeDeclaration',
    'scope',
    'periodDimension',
    'unavailable',
    'facts',
    'coverage',
    'period',
  ]);
  const identity = ownData(result.identity, ['namespace', 'runId', 'ordinal']);
  const declaration = ownData(result.scopeDeclaration, ['id', 'version']);
  if (
    !boundedText(identity.namespace) ||
    !boundedText(identity.runId) ||
    typeof identity.ordinal !== 'number' ||
    !Number.isSafeInteger(identity.ordinal) ||
    identity.ordinal < 1 ||
    !boundedResultId(result.id) ||
    result.id !==
      resultIdentityOf({
        namespace: identity.namespace,
        runId: identity.runId,
        ordinal: identity.ordinal,
      }) ||
    !boundedText(result.toolName) ||
    !boundedText(result.toolCallId) ||
    typeof result.iteration !== 'number' ||
    !Number.isSafeInteger(result.iteration) ||
    result.iteration < 0 ||
    !boundedText(declaration.id) ||
    !boundedText(declaration.version)
  )
    throw new Error('Invalid result receipt identity.');
  if (Object.hasOwn(result, 'unavailable')) {
    if (
      typeof result.unavailable !== 'string' ||
      !(BINDING_REASONS as readonly string[]).includes(result.unavailable) ||
      ['scope', 'periodDimension', 'facts', 'coverage', 'period'].some((key) =>
        Object.hasOwn(result, key),
      )
    )
      throw new Error('Invalid unavailable receipt.');
  } else {
    const scope = ownData(copyJson(result.scope, BINDING_LIMITS.scopeBytes, true));
    if (
      Object.keys(scope).length === 0 ||
      Object.keys(scope).length > BINDING_LIMITS.dimensions ||
      !Object.keys(scope).every(boundedText) ||
      !Array.isArray(result.facts) ||
      result.facts.length > BINDING_LIMITS.results
    )
      throw new Error('Invalid receipt scope or facts.');
    if (Object.hasOwn(result, 'periodDimension') && !boundedText(result.periodDimension))
      throw new Error('Invalid period dimension.');
    for (const rawFact of result.facts) {
      const fact = ownData(rawFact, [
        'entity',
        'field',
        'value',
        'toolName',
        'toolCallId',
        'iteration',
        'measuredAt',
      ]);
      if (
        !boundedText(fact.entity) ||
        !boundedText(fact.field) ||
        !Object.hasOwn(fact, 'value') ||
        fact.toolName !== result.toolName ||
        fact.toolCallId !== result.toolCallId ||
        fact.iteration !== result.iteration ||
        (Object.hasOwn(fact, 'measuredAt') &&
          !boundedText(fact.measuredAt) &&
          typeof fact.measuredAt !== 'number')
      )
        throw new Error('Invalid fact receipt.');
    }
    if (Object.hasOwn(result, 'coverage')) validateCoverage(result.coverage);
    if (Object.hasOwn(result, 'period') && periodProblem(result.period, 'camel') !== undefined)
      throw new Error('Invalid period receipt.');
  }
  return raw as ResultEvidence;
}

/** Validate a detached saved snapshot without evaluating or reconstructing evidence. */
export function readEvidenceSnapshot(raw: unknown): EvidenceSnapshot {
  const source = ownData(copyJson(raw, BINDING_LIMITS.snapshotBytes, true), [
    'version',
    'namespace',
    'runIds',
    'results',
  ]);
  if (
    source.version !== 1 ||
    !boundedText(source.namespace) ||
    !Array.isArray(source.runIds) ||
    source.runIds.length > BINDING_LIMITS.results ||
    !source.runIds.every(boundedText) ||
    new Set(source.runIds).size !== source.runIds.length ||
    !Array.isArray(source.results) ||
    source.results.length > BINDING_LIMITS.results
  )
    throw new Error('Invalid evidence snapshot.');
  for (const result of source.results) resultOf(result);
  return source as unknown as EvidenceSnapshot;
}
