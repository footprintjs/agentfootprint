/** Paired saved protocol at real checkpoint doors; runtime opt-in is not mounted yet. */
import { describe, expect, it, vi } from 'vitest';
import { RedactionRule } from 'footprintjs/advanced';
import { Agent, askHuman, defineTool, describedResult, isPaused } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { conversationRedaction } from '../../../src/doors/security.js';
import {
  buildCheckpoint,
  validateCheckpoint,
  type RunCheckpointTracker,
} from '../../../src/core/runCheckpoint.js';
import { appendRows, foldLedger } from '../../../src/core/agent/findings/ledger.js';
import { checkFindingClaim } from '../../../src/core/agent/findings/verificationCheck.js';
import { claimIdentityOf } from '../../../src/core/agent/findings/verificationRow.js';
import {
  createVerificationState,
  reserveClaimIdentity,
  reserveResultIdentity,
  retainVerificationEvidence,
} from '../../../src/core/agent/findings/verificationState.js';
import {
  readVerificationCheckpoint,
  requireVerificationOnResume,
  verificationCheckpointOf,
} from '../../../src/core/agent/findings/verificationCheckpoint.js';
import {
  captureDispatch,
  captureReturnedEvidence,
  finalizeEvidence,
  resultIdentityOf,
} from '../../../src/integrity/claim-binding/capture.js';
import type { ClaimBindingRule } from '../../../src/integrity/claim-binding/types.js';
import { readSemantics, semanticsForModel } from '../../../src/lib/semantics/envelope.js';

const tracker: RunCheckpointTracker = {
  runId: 'run',
  history: [{ role: 'user', content: 'Synthetic revenue question.' }],
  lastCompletedIteration: 1,
  originalInput: { message: 'Synthetic revenue question.' },
};

function fixture(value = 51200) {
  const coverageCheck = vi.fn(() => 'complete' as const);
  const rule: ClaimBindingRule = {
    id: 'revenue',
    version: 'one',
    toolName: 'read_sales',
    scopeDeclaration: {
      id: 'sales-scope',
      version: 'one',
      dimensions: [
        { name: 'region', argumentPath: ['region'] },
        { name: 'channel', argumentPath: ['channel'] },
      ],
    },
    fact: { entity: { scopeDimension: 'region' }, field: 'revenue' },
    coverage: coverageCheck,
  };
  let state = createVerificationState('run', () => 'record');
  const result = reserveResultIdentity(state, 'run');
  state = result.state;
  const dispatch = captureDispatch(
    result.identity,
    { toolName: 'read_sales', toolCallId: 'provider-id', iteration: 0 },
    { region: 'north', channel: 'online' },
    rule.scopeDeclaration,
  );
  const returned = describedResult({
    facts: [{ entity: 'north', revenue: 51200 }],
    provenance: { source: 'synthetic test only', measuredAt: '2026-10-01T00:00:00Z' },
    coverage: { checked: ['north online revenue'] },
  });
  const semantics = readSemantics(returned);
  if (semantics === undefined) throw new Error('Fixture needs recognized evidence.');
  const receipt = finalizeEvidence(
    dispatch,
    captureReturnedEvidence(dispatch, returned),
    semanticsForModel(semantics),
    { completed: true, resultVisible: true, scopeVisible: true },
  );
  state = retainVerificationEvidence(state, receipt);
  const claim = reserveClaimIdentity(state, 'run');
  state = claim.state;
  const row = checkFindingClaim({
    identity: { namespace: state.evidence.namespace, runId: 'run', ordinal: claim.ordinal },
    declaredOn: 'answer',
    standing: 'fact',
    iteration: 1,
    request: { value, check: { rule: 'revenue' } },
    parentResult: receipt.id,
    snapshot: state.evidence,
    rules: [rule],
  });
  const checkpoint = buildCheckpoint(
    tracker,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [row],
    undefined,
    state,
  );
  coverageCheck.mockClear();
  return { state, row, receipt, checkpoint, coverageCheck };
}

describe('typed findings checkpoint protocol', () => {
  it.each([51200, 40960])('writes and reads the literal scoped observation for %i', (value) => {
    const f = fixture(value);
    const encoded = JSON.stringify(f.checkpoint);
    const restored = validateCheckpoint(JSON.parse(encoded));
    expect(JSON.stringify(restored)).toBe(encoded);
    expect(restored.findingsLedger).toEqual([f.row]);
    expect(restored.claimVerification).toEqual(f.state);
    expect(restored.findingsLedger?.[0]).not.toBe(f.row);
    expect(Object.isFrozen(restored.claimVerification?.evidence.results[0]?.facts)).toBe(true);
    expect(f.coverageCheck).not.toHaveBeenCalled();
    expect(requireVerificationOnResume(restored, true)).toEqual(f.state);
  });

  it('uses the existing one ledger writer without changing the model standing fold', () => {
    const { row } = fixture();
    const standing = {
      kind: 'standing' as const,
      toolCallId: 'provider-id',
      standing: 'fact' as const,
      assertions: [],
      declaredOn: 'answer' as const,
      iteration: 1,
    };
    const appended = appendRows([], [standing, row]);
    expect(appended.ledger).toEqual([standing, row]);
    const before = foldLedger([standing]);
    const after = foldLedger(appended.ledger);
    expect(after).toEqual(before);
    expect(appended.newConflicts).toEqual([]);
  });

  it('keeps old checkpoint identity/keys when no verifier is present', () => {
    const original = buildCheckpoint(tracker);
    expect(validateCheckpoint(original)).toBe(original);
    expect(buildCheckpoint(tracker)).not.toHaveProperty('claimVerification');
    expect(requireVerificationOnResume(original, false)).toBeUndefined();
    const oldOptional = { ...original, findingsLedger: undefined };
    expect(validateCheckpoint(oldOptional)).toBe(oldOptional);
    expect(requireVerificationOnResume(oldOptional, false)).toBeUndefined();
  });

  it('keeps carrier-free observations readable, but does not invent evidence for continuation', () => {
    const { row } = fixture();
    const original = { ...buildCheckpoint(tracker), findingsLedger: [row] };
    const read = validateCheckpoint(JSON.parse(JSON.stringify(original)));
    expect(read.findingsLedger).toEqual([row]);
    expect(read).not.toHaveProperty('claimVerification');
    expect(() => requireVerificationOnResume(read, true)).toThrow(/readable history/);
    expect(() => requireVerificationOnResume(read, false)).toThrow(/readable history/);
  });

  it('refuses to silently drop a valid saved carrier when verification is unarmed', () => {
    const { checkpoint } = fixture();
    expect(() => requireVerificationOnResume(checkpoint, false)).toThrow(/enabled/);
  });

  it.each([undefined, null, false, {}, { version: 2 }])(
    'refuses present malformed state %j, instead of treating it as absence',
    (raw) => {
      const checkpoint = { ...buildCheckpoint(tracker), claimVerification: raw };
      expect(() => validateCheckpoint(checkpoint)).toThrow(/claimVerification/);
    },
  );

  it('refuses an inherited carrier or getter without executing it', () => {
    const { state } = fixture();
    expect(() => verificationCheckpointOf(Object.create({ claimVerification: state }))).toThrow(
      /Inherited/,
    );
    const get = vi.fn(() => state);
    const raw = Object.defineProperty({}, 'claimVerification', { enumerable: true, get });
    expect(() => verificationCheckpointOf(raw)).toThrow(/stored data/);
    expect(get).not.toHaveBeenCalled();
  });

  it('refuses unknown row fields, checker versions and incoherent verdicts at the native reader', () => {
    const { checkpoint, row } = fixture();
    for (const altered of [
      { ...row, extra: true },
      { ...row, checker: { id: 'claim-pair', version: 2 } },
      { ...row, outcome: 'unverified' },
    ])
      expect(() => validateCheckpoint({ ...checkpoint, findingsLedger: [altered] })).toThrow(
        /findingsLedger/,
      );
  });

  it.each([
    { namespace: 'other', runId: 'run', ordinal: 1 },
    { namespace: 'record', runId: 'other', ordinal: 1 },
    { namespace: 'record', runId: 'run', ordinal: 2 },
  ])('checks claim namespace/lineage and fresh global counter: %j', (identity) => {
    const { checkpoint, row } = fixture();
    expect(() =>
      validateCheckpoint({
        ...checkpoint,
        findingsLedger: [{ ...row, claimId: claimIdentityOf(identity) }],
      }),
    ).toThrow(identity.namespace === 'other' ? /findingsLedger/ : /claimVerification/);
  });

  it('refuses duplicate global claim ordinals even across recorded run ids', () => {
    const { state, row } = fixture();
    const twoRuns = { ...state, evidence: { ...state.evidence, runIds: ['run', 'later'] } };
    const second = {
      ...row,
      claimId: claimIdentityOf({ namespace: 'record', runId: 'later', ordinal: 1 }),
    };
    expect(() => readVerificationCheckpoint(twoRuns, [row, second])).toThrow(/lineage/);
  });

  it('reads row indices as data without invoking a saved getter at any boundary', () => {
    const { state, row, checkpoint } = fixture();
    const get = vi.fn(() => row);
    const ledger = Object.defineProperty([], '0', { enumerable: true, get });
    expect(() => readVerificationCheckpoint(state, ledger)).toThrow(/data/);
    expect(() =>
      verificationCheckpointOf({ claimVerification: state, findingsLedger: ledger }),
    ).toThrow(/data/);
    expect(() => requireVerificationOnResume({ findingsLedger: ledger }, false)).toThrow(/data/);
    expect(() => validateCheckpoint({ ...checkpoint, findingsLedger: ledger })).toThrow(
      /findingsLedger/,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('does not let an accessor choose a row kind in a carrier-free paused ledger', () => {
    const { row } = fixture();
    const get = vi.fn(() => 'claim-verification');
    const altered = Object.defineProperty({ ...row }, 'kind', { enumerable: true, get });
    expect(() => requireVerificationOnResume({ findingsLedger: [altered] }, false)).toThrow(/kind/);
    expect(get).not.toHaveBeenCalled();
  });

  it('refuses an own custom iterator instead of letting it hide a stale claim counter', () => {
    const { state, row, checkpoint } = fixture();
    const iterator = vi.fn(() => [][Symbol.iterator]());
    const ledger = Object.defineProperty([row], Symbol.iterator, { value: iterator });
    const stale = { ...state, nextClaimOrdinal: 1 };
    expect(() => readVerificationCheckpoint(stale, ledger)).toThrow(/array/);
    expect(() =>
      verificationCheckpointOf({ claimVerification: stale, findingsLedger: ledger }),
    ).toThrow(/array/);
    expect(() => requireVerificationOnResume({ findingsLedger: ledger }, false)).toThrow(/array/);
    expect(() =>
      validateCheckpoint({ ...checkpoint, claimVerification: stale, findingsLedger: ledger }),
    ).toThrow(/findingsLedger/);
    expect(iterator).not.toHaveBeenCalled();
  });

  it('refuses a sparse saved ledger and an own some override before scanning observations', () => {
    const { row } = fixture();
    const sparse = [row, row];
    delete sparse[0];
    expect(() => requireVerificationOnResume({ findingsLedger: sparse }, false)).toThrow(
      /array|data/,
    );
    const some = vi.fn(() => false);
    const modified = Object.defineProperty([row], 'some', { value: some });
    expect(() => requireVerificationOnResume({ findingsLedger: modified }, false)).toThrow(/array/);
    expect(some).not.toHaveBeenCalled();
  });

  it('checks namespace on an unverified row even without any resolved evidence', () => {
    const { row, state } = fixture();
    const { resolved: _resolved, declaredRule: _rule, ...unresolved } = row;
    const historical = {
      ...unresolved,
      outcome: 'unverified',
      reason: 'missing-check',
      claimId: claimIdentityOf({ namespace: 'foreign', runId: 'run', ordinal: 1 }),
    };
    expect(() => readVerificationCheckpoint(state, [historical])).toThrow(/lineage/);
  });

  it.each([
    { namespace: 'record', runId: 'other', ordinal: 1 },
    { namespace: 'record', runId: 'run', ordinal: 2 },
  ])('checks a compared result identity against retained lineage/counters: %j', (identity) => {
    const { checkpoint, row } = fixture();
    if (row.outcome === 'unverified') throw new Error('Fixture must compare.');
    const id = resultIdentityOf(identity);
    const altered = {
      ...row,
      declaredResult: id,
      resolved: {
        ...row.resolved,
        resultId: id,
        evidence: { ...row.resolved.evidence, provenance: `result ${id}` },
      },
    };
    expect(() => validateCheckpoint({ ...checkpoint, findingsLedger: [altered] })).toThrow(
      /claimVerification/,
    );
  });

  it('compares saved association to its receipt without reevaluating the historical verdict', () => {
    const { state, row, coverageCheck } = fixture();
    if (row.outcome === 'unverified') throw new Error('Fixture must compare.');
    const samePairDifferentVerdict = { ...row, outcome: 'contradicted', reason: 'conflict' };
    expect(() => readVerificationCheckpoint(state, [samePairDifferentVerdict])).not.toThrow();
    for (const resolved of [
      { ...row.resolved, scope: { region: 'north', channel: 'all' } },
      { ...row.resolved, evidence: { ...row.resolved.evidence, value: 1 } },
      { ...row.resolved, coverage: { checked: [], notChecked: [], cannotCover: [] } },
    ])
      expect(() => readVerificationCheckpoint(state, [{ ...row, resolved }])).toThrow(
        /retained receipt/,
      );
    expect(coverageCheck).not.toHaveBeenCalled();
  });

  it('admits an old exact receipt and new run claim after sticky retention refusal', () => {
    const { state, row } = fixture();
    const later = {
      ...state,
      limited: true as const,
      evidence: { ...state.evidence, runIds: ['run', 'later'] },
      nextClaimOrdinal: 3,
    };
    const laterRow = {
      ...row,
      claimId: claimIdentityOf({ namespace: 'record', runId: 'later', ordinal: 2 }),
    };
    expect(readVerificationCheckpoint(later, [row, laterRow])).toEqual(later);
  });

  it('places private verifier state under the existing conversation tools redaction', () => {
    expect(new RedactionRule(conversationRedaction()).isKeyRedacted('claimVerification')).toBe(
      true,
    );
  });
});

describe('native unarmed continuation refusals', () => {
  it.each(['continueFrom', 'resumeOnError'] as const)(
    '%s still continues an old explicit undefined ledger',
    async (door) => {
      const checkpoint = { ...buildCheckpoint(tracker), findingsLedger: undefined };
      const agent = Agent.create({
        provider: mock({ reply: 'legacy works' }),
        model: 'mock',
      }).build();
      const result =
        door === 'continueFrom'
          ? await agent.run({ message: 'old continuation', continueFrom: checkpoint })
          : await agent.resumeOnError(checkpoint);
      expect(result).toBe('legacy works');
      expect(agent.checkpoint()).not.toHaveProperty('claimVerification');
    },
  );
  it.each(['continueFrom', 'resumeOnError'] as const)(
    '%s refuses verification state before calling a provider or altering pending history',
    async (door) => {
      const { checkpoint } = fixture();
      const complete = vi.fn(async () => ({
        content: 'fresh',
        toolCalls: [],
        usage: { input: 1, output: 1 },
        stopReason: 'end_turn',
      }));
      const agent = Agent.create({
        provider: { name: 'fixture', complete },
        model: 'fixture',
      }).build();
      const attempt =
        door === 'continueFrom'
          ? agent.run({ message: 'continue', continueFrom: checkpoint })
          : agent.resumeOnError(checkpoint);
      await expect(attempt).rejects.toThrow(/verification enabled/);
      expect(complete).not.toHaveBeenCalled();
      await expect(agent.run({ message: 'fresh question' })).resolves.toBe('fresh');
      expect(agent.checkpoint()?.history).toEqual([
        { role: 'user', content: 'fresh question' },
        { role: 'assistant', content: 'fresh' },
      ]);
    },
  );

  it('full pause refuses the same carrier before any resumed execution', async () => {
    const { checkpoint } = fixture();
    const provider = mock({ replies: [{ toolCalls: [{ id: 'ask', name: 'ask', args: {} }] }] });
    const complete = vi.spyOn(provider, 'complete');
    const stream = vi.spyOn(provider, 'stream');
    const execute = vi.fn(() => askHuman({ question: 'Continue?' }));
    const agent = Agent.create({
      provider,
      model: 'mock',
      maxIterations: 2,
    })
      .tool(
        defineTool({
          name: 'ask',
          description: 'Ask in a synthetic test.',
          inputSchema: { type: 'object' },
          execute,
        }),
      )
      .build();
    const paused = await agent.run({ message: 'ask me' });
    if (!isPaused(paused)) throw new Error('Fixture must really pause.');
    expect(complete).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    const full = {
      ...paused.checkpoint,
      sharedState: {
        ...paused.checkpoint.sharedState,
        claimVerification: checkpoint.claimVerification,
        findingsLedger: checkpoint.findingsLedger,
      },
    };
    const before = JSON.stringify(full);
    await expect(agent.resume(full, 'yes')).rejects.toThrow(/verification enabled/);
    expect(JSON.stringify(full)).toBe(before);
    expect(complete).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
