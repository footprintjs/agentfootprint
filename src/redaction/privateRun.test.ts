import { expect, it } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import type { RedactionPolicy } from 'footprintjs';
import { EventDispatcher } from '../events/dispatcher.js';
import type { EventMeta } from '../events/types.js';
import { DECLARED_NONE } from './coverage.js';
import { carriedRunPolicy } from './conversation.js';
import {
  addPrivateRecordFields,
  PRIVATE_FIELDS_KEY,
  type PrivateRecordFields,
} from './privateFields.js';
import { eventServing, SERVED_PLACEHOLDER } from './served.js';
import {
  adoptScopeOutsideRun,
  canStorePrivateFields,
  createRunRedaction,
  coverageInForce,
  emitServed,
  markPrivateFields,
  outsideRunFor,
  policyInForce,
  privateFieldsInForce,
  retiredRule,
  type RunRedaction,
} from './runRedaction.js';

const empty = () => addPrivateRecordFields(undefined, []);
const selection = [{ root: 'argumentAsk' as const, path: 'progress.0.answer' }];
const meta = { runId: 'run', principal: 'alice', tenant: 'example' } as EventMeta;
const payload = () => ({
  toolName: 'lookup_public',
  content: 'Public words',
  iteration: 2,
  argumentAsk: { progress: [{ answer: 'private', rounds: 1 }], question: 'Public question' },
});

function opened(
  policy?: RedactionPolicy,
  fields?: PrivateRecordFields,
  recordMarks?: RedactionPolicy,
) {
  return createRunRedaction({
    policy,
    ...(fields !== undefined && { privateFields: fields }),
    ...(recordMarks !== undefined && { recordMarks }),
    dispatcher: new EventDispatcher(),
    getRunContext: () => ({ runId: 'run' } as never),
  });
}
function bind(run: RunRedaction, rule?: RedactionRule) {
  const writes: { key: string; value: unknown }[] = [];
  const events: unknown[] = [];
  const scope = {
    $setValue: (key: string, value: unknown) => writes.push({ key, value }),
    $emit: (_name: string, value?: unknown) => events.push(value),
  };
  run.bindScope(scope, { runtimeStageId: 'stage#1', getRedactionRule: () => rule } as never);
  return { scope, writes, events };
}
const unavailable = (f: () => void) => {
  expect(f).toThrowError('Private record fields require an armed native redaction rule.');
};

it('ordinary no-policy runs keep the identity path with no marker, anchor or new policy', () => {
  const run = opened();
  const { scope, writes, events } = bind(run, new RedactionRule());
  const value = payload();
  expect(run.policy).toBeUndefined();
  expect(run.recordPolicy).toBeUndefined();
  expect(run.privateFields()).toBeUndefined();
  expect(run.recorders).toEqual([]);
  expect(run.serving.active()).toBe(false);
  expect(run.serving.payload('app.event', value)).toBe(value);
  expect(run.serving.meta(meta)).toBe(meta);
  emitServed(scope, 'app.event', value);
  expect(events[0]).toBe(value);
  expect(canStorePrivateFields(scope)).toBe(false);
  unavailable(() => markPrivateFields(scope, []));
  unavailable(() => markPrivateFields(scope, selection));
  expect(writes).toEqual([]);
});

it('private-only fields mask by name while public strings, identity and caller coverage stay unchanged', () => {
  const run = opened(undefined, empty());
  const rule = new RedactionRule(run.recordPolicy);
  const { scope, writes } = bind(run, rule);
  expect(run.policy).toBeUndefined();
  expect(coverageInForce(scope)).toBe(DECLARED_NONE);
  expect(policyInForce(scope)).toBeUndefined();
  expect(canStorePrivateFields(scope)).toBe(true);
  markPrivateFields(scope, selection);
  expect(writes).toEqual([
    { key: 'runRedaction', value: { version: 1, caller: 'none' } },
    { key: PRIVATE_FIELDS_KEY, value: run.privateFields() },
  ]);
  expect(privateFieldsInForce(scope)).toEqual(run.privateFields());
  expect(rule.verdict(['argumentAsk'])).toMatchObject({
    kind: 'fields',
    paths: ['progress.0.answer'],
  });
  expect(rule.isKeyRedacted(PRIVATE_FIELDS_KEY)).toBe(true);
  expect(run.serving.payload('app.event', payload())).toEqual({
    ...payload(),
    argumentAsk: { progress: [{ answer: '[REDACTED]', rounds: 1 }], question: 'Public question' },
  });
  expect(run.serving.meta(meta)).toBe(meta);
});

it('native registration precedes the anchor write and the protected value write', () => {
  const run = opened(undefined, empty());
  const rule = new RedactionRule(run.recordPolicy);
  const order: string[] = [];
  const scope = {
    $setValue: (key: string) => {
      expect(rule.verdict(['argumentAsk'])).toMatchObject({
        kind: 'fields',
        paths: ['progress.0.answer'],
      });
      expect(privateFieldsInForce(scope)?.fields.argumentAsk).toEqual(['progress.0.answer']);
      order.push(key);
    },
  };
  run.bindScope(scope, { runtimeStageId: 'stage#1', getRedactionRule: () => rule } as never);
  markPrivateFields(scope, selection);
  scope.$setValue('argumentAsk');
  expect(order).toEqual(['runRedaction', PRIVATE_FIELDS_KEY, 'argumentAsk']);
});

it.each([
  { keys: ['history'] },
  { diagnostics: { keys: ['note'] } },
  { emitPatterns: [/^app\.never$/] },
] as RedactionPolicy[])(
  'an already caller-covered native rule can establish a private carrier: %j',
  (policy) => {
    const run = opened(policy);
    const rule = new RedactionRule(run.recordPolicy);
    const { scope, writes } = bind(run, rule);
    expect(canStorePrivateFields(scope)).toBe(true);
    expect(run.privateFields()).toBeUndefined();
    markPrivateFields(scope, []);
    expect(run.privateFields()).toEqual(empty());
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({ key: 'runRedaction', value: carriedRunPolicy(policy) });
    markPrivateFields(scope, selection);
    expect(rule.isKeyRedacted(PRIVATE_FIELDS_KEY)).toBe(true);
    expect(run.policy).toBe(policy);
    expect(coverageInForce(scope)).toMatchObject({ state: 'covered', policy });
    const served = run.serving.payload('app.event', { content: 'Public words', iteration: 2 });
    expect(served).toEqual({ content: SERVED_PLACEHOLDER, iteration: 2 });
    expect(run.serving.meta(meta)).toEqual({
      ...meta,
      principal: SERVED_PLACEHOLDER,
      tenant: SERVED_PLACEHOLDER,
    });
  },
);

it('caller selectors cannot be reclassified as private even when the exact path overlaps', () => {
  const policy = { fields: { argumentAsk: ['progress.0.answer'] } };
  const run = opened(policy, addPrivateRecordFields(undefined, selection));
  const { scope } = bind(run, new RedactionRule(run.recordPolicy));
  markPrivateFields(scope, selection);
  const served = run.serving.payload('app.event', { content: 'Public words', iteration: 2 });
  expect(served).toEqual({ content: SERVED_PLACEHOLDER, iteration: 2 });
  expect(run.serving.meta(meta)).toEqual({
    ...meta,
    principal: SERVED_PLACEHOLDER,
    tenant: SERVED_PLACEHOLDER,
  });
});

it('unknown record-only marks mask native values without inventing caller coverage or private provenance', () => {
  const run = opened(undefined, empty(), { keys: ['findingsLedger'] });
  const rule = new RedactionRule(run.recordPolicy);
  const { scope } = bind(run, rule);
  expect(run.policy).toBeUndefined();
  expect(coverageInForce(scope)).toBe(DECLARED_NONE);
  expect(policyInForce(scope)).toBeUndefined();
  expect(run.privateFields()).toEqual(empty());
  expect(rule.retainBoundary({ findingsLedger: ['private'], content: 'Public words' })).toEqual({
    findingsLedger: '[REDACTED]',
    content: 'Public words',
  });
  const conservative = { content: SERVED_PLACEHOLDER, iteration: 2 };
  expect(run.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual(
    conservative,
  );
  markPrivateFields(scope, selection);
  expect(run.privateFields()?.keys).toEqual([]);
  expect(run.privateFields()?.fields).toEqual({ argumentAsk: ['progress.0.answer'] });
  const marker = run.recorders[0];
  if (marker === undefined) throw new Error('Expected native record marker');
  marker.onPause?.({} as never);
  expect(run.recordPolicy?.keys).toContain('findingsLedger');
  const retired = retiredRule(rule, run.recordPolicy);
  expect(retired.retainBoundary({ findingsLedger: ['private'] })).toEqual({
    findingsLedger: '[REDACTED]',
  });
  expect(
    eventServing(() => retired, false, run.privateFields).payload('app.event', {
      content: 'Public words',
      iteration: 2,
    }),
  ).toEqual(conservative);
  expect(run.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual(
    conservative,
  );
  expect(coverageInForce(scope)).toBe(DECLARED_NONE);
});

it('record-only marks alone never grant private storage authority', () => {
  const run = opened(undefined, undefined, { keys: ['findingsLedger'] });
  const { scope, writes } = bind(run, new RedactionRule(run.recordPolicy));
  expect(run.policy).toBeUndefined();
  expect(canStorePrivateFields(scope)).toBe(false);
  unavailable(() => markPrivateFields(scope, []));
  expect(writes).toEqual([]);
  expect(run.privateFields()).toBeUndefined();
});

it('shared native components preserve record-only conservative serving without caller relabeling', () => {
  const parent = opened(undefined, empty());
  const child = opened(undefined, empty(), { keys: ['findingsLedger'] });
  const rule = new RedactionRule(child.recordPolicy);
  const p = bind(parent, rule);
  bind(child, rule);
  expect(coverageInForce(p.scope)).toBe(DECLARED_NONE);
  expect(parent.policy).toBeUndefined();
  expect(parent.privateFields()).toEqual(empty());
  expect(parent.recordPolicy?.keys).toContain('findingsLedger');
  expect(parent.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual({
    content: SERVED_PLACEHOLDER,
    iteration: 2,
  });
});

it.each(['author-key', 'unknown-field'] as const)(
  '%s native marks retain value-kind default-deny',
  (shape) => {
    const run = opened(undefined, empty());
    const rule = new RedactionRule(run.recordPolicy);
    const { scope } = bind(run, rule);
    markPrivateFields(scope, selection);
    if (shape === 'author-key') rule.mark('author-secret');
    else rule.inheritFields('argumentAsk', ['progress.1.answer']);
    expect(run.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual({
      content: SERVED_PLACEHOLDER,
      iteration: 2,
    });
    expect(run.serving.meta(meta)).toEqual({
      ...meta,
      principal: SERVED_PLACEHOLDER,
      tenant: SERVED_PLACEHOLDER,
    });
  },
);

it('whole-root fallback stays conservative while its native selector remains active', () => {
  const run = opened(undefined, empty());
  const rule = new RedactionRule(run.recordPolicy);
  const { scope } = bind(run, rule);
  markPrivateFields(scope, [{ root: 'pausedCheckInArgs', path: 'account.number' }]);
  expect(rule.isKeyRedacted('pausedCheckInArgs')).toBe(true);
  expect(run.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual({
    content: SERVED_PLACEHOLDER,
    iteration: 2,
  });
});

it('a parent and child sharing one native rule share admitted private provenance', () => {
  const parent = opened(undefined, empty());
  const child = opened(undefined, empty());
  const rule = new RedactionRule(parent.recordPolicy);
  const p = bind(parent, rule),
    c = bind(child, rule);
  markPrivateFields(c.scope, selection);
  markPrivateFields(p.scope, [{ root: 'pausedCheckInArgs', path: 'account' }]);
  expect(parent.privateFields()).toEqual(child.privateFields());
  expect(privateFieldsInForce(p.scope)?.fields).toEqual({
    argumentAsk: ['progress.0.answer'],
    pausedCheckInArgs: ['account'],
  });
  expect(parent.serving.payload('app.event', payload())).toEqual(
    child.serving.payload('app.event', payload()),
  );
  expect(JSON.stringify(parent.serving.payload('app.event', payload()))).toContain('Public words');
  expect(JSON.stringify(parent.serving.payload('app.event', payload()))).not.toContain('private');
  expect(parent.serving.meta(meta)).toBe(meta);
});

it('caller-policy activity is ORed across shared bindings, including emit-only native policies', () => {
  const parent = opened();
  const child = opened({ emitPatterns: [/^app\.never$/] });
  const rule = new RedactionRule(child.recordPolicy);
  bind(parent, rule);
  bind(child, rule);
  expect(rule.isInert()).toBe(true);
  expect(parent.policy).toBeUndefined();
  expect(parent.serving.active()).toBe(true);
  expect(parent.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual({
    content: SERVED_PLACEHOLDER,
    iteration: 2,
  });
  expect(parent.serving.meta(meta)).toEqual({
    ...meta,
    principal: SERVED_PLACEHOLDER,
    tenant: SERVED_PLACEHOLDER,
  });
});

it('private provenance cannot move between two distinct native rules', () => {
  const first = opened(undefined, empty()),
    second = opened(undefined, empty());
  const a = bind(first, new RedactionRule(first.recordPolicy));
  const b = bind(second, new RedactionRule(second.recordPolicy));
  markPrivateFields(a.scope, selection);
  expect(privateFieldsInForce(b.scope)).toEqual(empty());
  const rule = new RedactionRule(second.recordPolicy);
  rule.inheritFields('argumentAsk', ['progress.0.answer']);
  bind(second, rule);
  expect(second.serving.payload('app.event', { content: 'Public words', iteration: 2 })).toEqual({
    content: SERVED_PLACEHOLDER,
    iteration: 2,
  });
});

it('binding a later native rule cannot redirect an earlier scope private write or read', () => {
  const run = opened(undefined, empty());
  const firstRule = new RedactionRule(run.recordPolicy);
  const first = bind(run, firstRule);
  markPrivateFields(first.scope, selection);
  const firstFields = privateFieldsInForce(first.scope);
  const secondRule = new RedactionRule({ keys: [PRIVATE_FIELDS_KEY] });
  const second = bind(run, secondRule);
  expect(canStorePrivateFields(first.scope)).toBe(false);
  expect(canStorePrivateFields(second.scope)).toBe(true);
  expect(privateFieldsInForce(first.scope)).toEqual(firstFields);
  expect(privateFieldsInForce(second.scope)).toEqual(empty());
  const before = secondRule.marksForCheckpoint();
  unavailable(() =>
    markPrivateFields(first.scope, [{ root: 'pausedCheckInArgs', path: 'account' }]),
  );
  expect(first.writes).toHaveLength(2);
  expect(first.writes[0]).toEqual({ key: 'runRedaction', value: { version: 1, caller: 'none' } });
  expect(second.writes).toEqual([]);
  expect(secondRule.marksForCheckpoint()).toEqual(before);
  expect(firstRule.marksForCheckpoint()?.fields).toEqual({ argumentAsk: ['progress.0.answer'] });
  markPrivateFields(second.scope, [{ root: 'pausedCheckInArgs', path: 'account' }]);
  expect(privateFieldsInForce(first.scope)).toEqual(firstFields);
  expect(privateFieldsInForce(second.scope)?.fields).toEqual({ pausedCheckInArgs: ['account'] });
  expect(run.privateFields()).toEqual(privateFieldsInForce(second.scope));
});

it('retired native clones keep selector provenance while storage on the settled leg is refused', () => {
  const run = opened(undefined, empty());
  const rule = new RedactionRule(run.recordPolicy);
  const { scope } = bind(run, rule);
  markPrivateFields(scope, selection);
  const retired = retiredRule(rule, run.recordPolicy);
  const serving = eventServing(() => retired, false, run.privateFields);
  expect(serving.payload('app.event', payload())).toEqual(
    run.serving.payload('app.event', payload()),
  );
  expect(serving.meta(meta)).toBe(meta);
  const marker = run.recorders[0];
  if (marker === undefined) throw new Error('Expected private native marker');
  marker.onPause?.({} as never);
  expect(canStorePrivateFields(scope)).toBe(false);
  unavailable(() => markPrivateFields(scope, selection));
  expect(run.serving.payload('app.event', { content: 'Public words' })).toEqual({
    content: 'Public words',
  });
});

it('a copied carrier cannot arm a missing native policy or a non-native/outside scope', () => {
  const run = opened(undefined, empty());
  const notArmed = bind(run, new RedactionRule());
  expect(canStorePrivateFields(notArmed.scope)).toBe(false);
  unavailable(() => markPrivateFields(notArmed.scope, selection));
  const noNative = bind(run);
  expect(canStorePrivateFields(noNative.scope)).toBe(false);
  unavailable(() => markPrivateFields(noNative.scope, []));
  const outside = {
    $setValue: () => {
      throw new Error('No outside write');
    },
  };
  adoptScopeOutsideRun(outside, outsideRunFor({ state: 'covered', policy: { keys: ['secret'] } }));
  expect(canStorePrivateFields(outside)).toBe(false);
  unavailable(() => markPrivateFields(outside, selection));
});
