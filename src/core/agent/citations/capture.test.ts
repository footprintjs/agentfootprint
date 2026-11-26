import { expect, it } from 'vitest';
import type { TypedScope } from 'footprintjs';
import { RedactionRule } from 'footprintjs/advanced';
import { EventDispatcher } from '../../../events/dispatcher.js';
import { defineTool, type ToolExecutionContext } from '../../../tools/tools.js';
import { sha256Hex } from '../../../lib/sha256.js';
import {
  addPrivateRecordFields,
  CITATION_PRIVATE_FIELDS,
} from '../../../redaction/privateFields.js';
import { createRunRedaction } from '../../../redaction/runRedaction.js';
import { describedResult } from '../../../semantics/described.js';
import { semanticsForModel } from '../../../semantics/envelope.js';
import { createVerificationState, reserveResultIdentity } from '../findings/verificationState.js';
import { nativeResultFinalizer } from '../resultRowsets/finalization.js';
import type { AgentState } from '../types.js';
import { safeStringify } from '../validators.js';
import { captureCitationResult } from './capture.js';
import { resolveProseCitations } from './config.js';

const runId = 'run';
const tool = defineTool({
  name: 'measure',
  description: 'Read a measured amount.',
  inputSchema: { type: 'object' },
  execute: () => '',
});
const call = {
  toolName: 'measure',
  toolCallId: 'c1',
  iteration: 0,
  callOccurrenceKey: [1, 2, 3, 4, 0] as const,
};
const config = resolveProseCitations({
  verification: {
    rules: [
      {
        id: 'measured-amount',
        version: '1',
        toolName: 'measure',
        scopeDeclaration: {
          id: 'measurement',
          version: '1',
          dimensions: [{ name: 'unit', argumentPath: ['unit'] }],
        },
        fact: { entity: 'North', field: 'amount' },
        coverage: () => 'complete',
      },
    ],
    authorizeEvidence: () => ({ resultVisible: true, scopeVisible: true }),
  },
  completeColumns: () => ['entity', 'amount'],
});

function privateScope(hideHistory = false): TypedScope<AgentState> {
  const scope = {} as TypedScope<AgentState>;
  const redaction = createRunRedaction({
    policy: hideHistory ? { keys: ['history'] } : undefined,
    privateFields: addPrivateRecordFields(undefined, CITATION_PRIVATE_FIELDS),
    dispatcher: new EventDispatcher(),
    getRunContext: () => ({ runId } as never),
  });
  redaction.bindScope(scope, {
    runtimeStageId: 'tool-call#1',
    getRedactionRule: () => new RedactionRule(redaction.recordPolicy),
  } as never);
  return scope;
}

it('mounts opted-in custody only for a bound call with private native state', () => {
  const scope = privateScope();
  const deps = { isRunRetired: () => false, currentRun: () => ({ runId }) };
  expect(nativeResultFinalizer(scope, tool, call, deps, runId)).toBeUndefined();
  expect(
    nativeResultFinalizer(
      {} as TypedScope<AgentState>,
      tool,
      call,
      { ...deps, citationOptions: config },
      runId,
    ),
  ).toBeUndefined();
  const finalizer = nativeResultFinalizer(
    scope,
    tool,
    call,
    { ...deps, citationOptions: config },
    runId,
  );
  expect(finalizer).toBeDefined();
  expect(finalizer?.needsPublications).toBe(false);
  expect(
    nativeResultFinalizer(
      scope,
      tool,
      { toolName: 'measure', toolCallId: 'c1', iteration: 0 },
      { ...deps, citationOptions: config },
      runId,
    ),
  ).toBeUndefined();
});

function reading(amount: number) {
  return describedResult({
    facts: [{ entity: 'North', amount }],
    provenance: { measuredAt: '2026-11-23T00:00:00Z', source: 'synthetic fixture' },
    coverage: { checked: ['amount'] },
  });
}

it.each(['eligible', 'withheld', 'capped', 'redacted'] as const)(
  'keeps citation custody aligned with native delivery (%s)',
  async (condition) => {
    const scope = privateScope(condition === 'redacted');
    const finalizer = nativeResultFinalizer(
      scope,
      tool,
      call,
      { currentRun: () => ({ runId }), isRunRetired: () => false, citationOptions: config },
      runId,
    );
    expect(finalizer).toBeDefined();
    const original = reading(12);
    finalizer?.entered({ hasArtifacts: false } as ToolExecutionContext, { unit: 'mm' });
    finalizer?.captureReturned?.(original);
    finalizer?.returned();
    if (condition === 'withheld') finalizer?.withheld();
    await finalizer?.(semanticsForModel(original), { eligible: condition !== 'capped' });
    expect(scope.citationSources?.length ?? 0).toBe(condition === 'eligible' ? 1 : 0);
  },
);

it('omits a non-plain schema declaration without losing authorized result evidence', () => {
  const columns = resolveProseCitations({
    verification: {
      rules: config.verification.rules,
      authorizeEvidence: () => ({ resultVisible: true, scopeVisible: true }),
    },
    completeColumns: () => ['valid', 'bad\nname'],
  });
  const scope: Pick<AgentState, 'resultIdentities' | 'citationSources'> = {};
  const capture = captureCitationResult(scope, call, runId, columns);
  const original = reading(12);
  capture?.entered({ unit: 'mm' });
  capture?.returned(original);
  capture?.finalize(semanticsForModel(original));
  expect(scope.citationSources).toHaveLength(1);
  expect(scope.citationSources?.[0]).not.toHaveProperty('completeColumns');
});

it('retains only exact governed evidence and a locator under an existing result reservation', () => {
  const prior = reserveResultIdentity(
    createVerificationState(runId, () => 'record'),
    runId,
  );
  const scope: Pick<AgentState, 'resultIdentities' | 'citationSources'> = {
    resultIdentities: prior.state,
  };
  const args = { unit: 'mm' };
  const original = structuredClone(reading(12));
  const served = safeStringify(semanticsForModel(original));
  const capture = captureCitationResult(scope, call, runId, config);
  capture?.entered(args, prior.id);
  capture?.returned(original);
  args.unit = 'changed';
  Reflect.set(original.facts?.[0] as object, 'amount', 99);
  capture?.finalize(served);

  expect(scope.resultIdentities?.nextResultOrdinal).toBe(2);
  expect(scope.resultIdentities?.evidence.results).toMatchObject([
    {
      id: prior.id,
      scope: { unit: 'mm' },
      facts: [{ entity: 'North', field: 'amount', value: 12 }],
    },
  ]);
  expect(scope.citationSources).toEqual([
    {
      callOccurrenceKey: call.callOccurrenceKey,
      resultId: prior.id,
      bodyDigest: sha256Hex(JSON.stringify(served)),
      completeColumns: ['entity', 'amount'],
    },
  ]);
});

it('keeps two committed occurrences of the same provider ID separate', () => {
  const scope: Pick<AgentState, 'resultIdentities' | 'citationSources'> = {};
  const original = reading(12);
  const served = semanticsForModel(original);
  for (const key of [call.callOccurrenceKey, [1, 2, 3, 4, 1] as const]) {
    const capture = captureCitationResult(
      scope,
      { ...call, callOccurrenceKey: key },
      runId,
      config,
    );
    capture?.entered({ unit: 'mm' });
    capture?.returned(original);
    capture?.finalize(served);
  }
  expect(scope.citationSources?.map((source) => source.callOccurrenceKey)).toEqual([
    [1, 2, 3, 4, 0],
    [1, 2, 3, 4, 1],
  ]);
  expect(new Set(scope.citationSources?.map((source) => source.resultId)).size).toBe(2);
});

it.each([
  { resultVisible: false, scopeVisible: true },
  { resultVisible: true, scopeVisible: false },
])('requires both independent host grants (%j)', (grants) => {
  const denied = resolveProseCitations({
    verification: { rules: config.verification.rules, authorizeEvidence: () => grants },
  });
  const scope: Pick<AgentState, 'resultIdentities' | 'citationSources'> = {};
  const original = reading(12);
  const capture = captureCitationResult(scope, call, runId, denied);
  capture?.entered({ unit: 'mm' });
  capture?.returned(original);
  capture?.finalize(semanticsForModel(original));
  expect(scope.resultIdentities?.evidence.results).toEqual([]);
  expect(scope.citationSources).toBeUndefined();
});

it.each(['ticket', 'rewrite', 'no return'] as const)(
  'cannot retain a body through %s',
  (reason) => {
    const scope: Pick<AgentState, 'resultIdentities' | 'citationSources'> = {};
    const capture = captureCitationResult(scope, call, runId, config);
    const original = reading(12);
    capture?.entered({ unit: 'mm' });
    if (reason !== 'no return') capture?.returned(original);
    capture?.finalize(
      reason === 'ticket'
        ? { ref: 'placed-result' }
        : semanticsForModel(reason === 'rewrite' ? reading(11) : original),
    );
    expect(scope.resultIdentities?.evidence.results).toEqual([]);
    expect(scope.citationSources).toBeUndefined();
  },
);
