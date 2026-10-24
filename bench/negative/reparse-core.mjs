#!/usr/bin/env node
/** FREE, counterfactual reparse of saved full-path trials. Never imports a provider,
 * runs an Agent, invents evidence, or changes an original artifact. The app parser
 * is the original contract. The JSON-envelope parser/checkers are the fixed library.
 * CLI: npm run build && node bench/negative/reparse.mjs <run-dir> <new-private-out>
 * All registered trials remain denominators; no answer is not a repaired failure.
 * Inject source functions in tests; only the CLI loads dist. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { benchmarkSchemaIssues, parseBenchmarkAnswer } from './reparse-contract.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/** Audit native metadata independently of anything the model said. Fail closed:
 * malformed records get a binding-error row, never a reconstructed substitute. */
function auditRecord(raw, turn, lib) {
  const record = turn.nativeRecord;
  if (!record || record.turn !== turn.turn) throw new Error('native current-turn mismatch');
  if (!isDeepStrictEqual(turn.recording?.snapshot?.sharedState?.runIdentity, raw.identity))
    throw new Error('recording host identity mismatch');
  const ids = new Set();
  let matched = 0;
  for (const call of record.calls) {
    const identity = lib.readResultIdentity(call.resultId);
    if (identity.namespace !== record.leg.namespace || ids.has(call.resultId))
      throw new Error('native result identity mismatch');
    ids.add(call.resultId);
    if (!Number.isInteger(call.turn) || call.turn < 1 || call.turn > record.turn)
      throw new Error('native call turn mismatch');
    if (call.row) {
      const row = call.row;
      if (
        row.resultId !== call.resultId ||
        row.toolName !== call.toolName ||
        row.toolCallId !== call.toolCallId ||
        row.iteration !== call.batch ||
        (row.handle !== undefined && row.handle !== `r${identity.ordinal}`)
      )
        throw new Error('composed call tuple mismatch');
    }
    if (!call.dispatched) continue;
    const attempts = raw.attempts.filter(
      (a) => a.tool === call.toolName && a.toolCallId === call.toolCallId && a.turn === call.turn,
    );
    if (attempts.length !== 1) throw new Error('native call execution is not unique');
    const { benchTenant, ...args } = attempts[0].args;
    if (!isDeepStrictEqual(args, call.arguments) || benchTenant !== raw.identity.tenant)
      throw new Error('native executed arguments mismatch');
    const status = lib.readToolResultEnvelope(attempts[0].result)?.status;
    const returnedRefusal = ['invalid', 'denied', 'failure', 'pending'].includes(status);
    const expectedError = attempts[0].outcome === 'threw' || returnedRefusal;
    if (call.keptOut !== true && expectedError !== (call.outcome === 'error'))
      throw new Error('native execution outcome mismatch');
    matched++;
  }
  if (matched !== raw.attempts.length) throw new Error('execution missing from native record');
  for (const [name, tool] of Object.entries(record.tools))
    if (tool.name !== name) throw new Error('recorded app tool name mismatch');
  return {
    matchedExecutions: matched,
    calls: record.calls.length,
    ledgerComplete: record.ledgerComplete,
    recordedTools: Object.keys(record.tools).length,
    searchProfiles: Object.values(record.tools).filter((tool) => tool.search !== undefined).length,
    callsWithoutSearchProfile: record.calls.filter(
      (call) => record.tools[call.toolName]?.search === undefined,
    ).length,
  };
}

function citationBindings(candidate, record, lib) {
  return candidate.negatives.map((claim, index) => ({
    index,
    references: claim.restsOn.map((handle) => {
      const calls = record.calls.filter((c) => c.row?.handle === handle);
      const call = calls.length === 1 ? calls[0] : undefined;
      const status = !call
        ? 'missing-or-ambiguous'
        : call.turn < record.turn
        ? 'earlier-turn'
        : 'current-turn';
      return {
        handle,
        status,
        ...(call && {
          resultId: call.resultId,
          namespaceMatches:
            lib.readResultIdentity(call.resultId).namespace === record.leg.namespace,
          trustedContext: call.trustedContext === true,
        }),
      };
    }),
  }));
}

/** One actual saved final-turn response, checked against its original native record.
 * The generated statements are counterfactual only and never observed as model prose. */
export function reparseTrial(artifact, scheduled, lib) {
  if (!isDeepStrictEqual(artifact.row, scheduled))
    throw new Error('registered trial tuple mismatch');
  const raw = artifact.raw;
  for (const key of ['caseId', 'model', 'cell', 'arm', 'rep'])
    if (raw[key] !== scheduled[key]) throw new Error('raw trial tuple mismatch');
  const turn = raw.turns.at(-1);
  const expectedTurn = raw.cell === 'long' ? 2 : 1;
  if (turn?.turn !== expectedTurn || raw.turns.length !== expectedTurn)
    throw new Error('actual trial turn count mismatch');
  const result = { row: scheduled, kind: 'counterfactual-only', status: 'no-answer' };
  try {
    result.nativeAudit = auditRecord(raw, turn, lib);
  } catch (error) {
    return { ...result, status: 'binding-error', error: error.message };
  }
  const terminal = raw.calls
    .filter(
      (c) =>
        c.source === 'provider' &&
        c.turn === turn.turn &&
        typeof c.response?.content === 'string' &&
        (c.response.toolCalls?.length ?? 0) === 0,
    )
    .at(-1);
  if (!terminal)
    return { ...result, reason: 'no-saved-terminal-answer', actualError: turn.error?.name ?? null };
  // An end-of-turn record is usable only when every recorded dispatch precedes
  // this answer. A later tool proposal is conservatively unsupported; never cut
  // or reconstruct the record to make an earlier candidate look current.
  const laterTools = raw.calls.some(
    (c) => c.index > terminal.index && (c.response?.toolCalls?.length ?? 0) > 0,
  );
  const allBefore = turn.nativeRecord.calls
    .filter((c) => c.dispatched)
    .every(
      (call) =>
        raw.calls.filter(
          (stage) =>
            stage.index < terminal.index &&
            stage.turn === call.turn &&
            stage.response?.toolCalls?.some(
              (tc) => tc.id === call.toolCallId && tc.name === call.toolName,
            ),
        ).length === 1,
    );
  if (laterTools || !allBefore)
    return {
      ...result,
      status: 'binding-error',
      error: 'native evidence is not bound before selected answer',
    };
  const wire = artifact.wire.filter((w) => w.response?.id === terminal.response.providerRef);
  if (
    wire.length !== 1 ||
    wire[0].error ||
    wire[0].response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('') !== terminal.response.content ||
    wire[0].response.content.some((b) => b.type === 'tool_use')
  )
    throw new Error('selected answer does not match exactly one saved wire response');
  result.response = {
    providerStage: terminal.index,
    turn: turn.turn,
    rawSha256: hash(terminal.response.content),
  };
  const record = turn.nativeRecord;
  const before = JSON.stringify(record);
  freeze(record);
  result.evidenceSha256 = hash(before);
  let candidate;
  try {
    candidate = lib.applyOutputSchema(terminal.response.content, { parse: parseBenchmarkAnswer });
  } catch (error) {
    const schemaIssues =
      error.stage === 'schema-validate'
        ? benchmarkSchemaIssues(
            lib.applyOutputSchema(terminal.response.content, { parse: (value) => value }),
          )
        : [];
    return { ...result, status: 'schema-fail', stage: error.stage ?? 'unknown', schemaIssues };
  }
  // Both readers receive this exact saved native record. The model supplies only
  // a candidate argument: no summary/history/statement is appended to evidence.
  const original = JSON.stringify(candidate);
  freeze(candidate);
  const prose = lib.observeNegativeProse(candidate, record, 'negatives');
  const rendered = lib.renderNegativeCandidate(
    candidate,
    { field: 'negatives', tools: Object.keys(record.tools), unestablished: 'withhold' },
    record,
    (call) => call.trustedContext === true && record.ledgerComplete,
  );
  if (JSON.stringify(record) !== before || JSON.stringify(candidate) !== original)
    throw new Error('replay mutated its original candidate or evidence');
  const checks = rendered.answer.checks;
  return {
    ...result,
    status: 'schema-pass',
    candidate,
    bindings: citationBindings(candidate, record, lib),
    claimCount: candidate.negatives.length,
    zeroClaims: candidate.negatives.length === 0,
    allClaimsEstablished: checks.length > 0 && checks.every((c) => c.code === 'established'),
    counterfactual: {
      checks,
      claims: rendered.answer.claims,
      allowed: rendered.allowed,
      correctionNeeded: rendered.correction,
    },
    proseHeuristic: prose,
    evidenceUnchanged: true,
  };
}

const add = (object, key, n = 1) => (object[key] = (object[key] ?? 0) + n);
export function summarizeReparse(trials) {
  const totals = {},
    groups = new Map();
  for (const trial of trials) {
    const { model, cell, arm } = trial.row;
    const key = JSON.stringify([model, cell, arm]);
    if (!groups.has(key)) groups.set(key, { model, cell, arm, counts: {} });
    for (const counts of [totals, groups.get(key).counts]) {
      add(counts, 'trials');
      add(counts, trial.status);
      if (trial.nativeAudit?.searchProfiles === 0)
        add(counts, 'trials-without-recorded-search-profile');
      if (trial.status === 'schema-fail') {
        add(counts, `schema-stage:${trial.stage}`);
        for (const issue of trial.schemaIssues) add(counts, `schema-issue:${issue}`);
      }
      if (trial.status !== 'schema-pass') add(counts, `prose-unscanned:${trial.status}`);
      if (trial.status !== 'schema-pass') continue;
      add(counts, trial.zeroClaims ? 'zero-claim-answers' : 'answers-with-claims');
      if (trial.allClaimsEstablished) add(counts, 'nonempty-all-established');
      if (trial.counterfactual.correctionNeeded) add(counts, 'counterfactual-correction-needed');
      for (const check of trial.counterfactual.checks) {
        add(counts, 'claims');
        add(counts, `checker:${check.code}`);
        add(counts, `disposition:${check.disposition}`);
        add(counts, check.code === 'established' ? 'claims-established' : 'claims-unestablished');
      }
      for (const binding of trial.bindings) {
        add(
          counts,
          binding.references.every((r) => r.status === 'current-turn' && r.namespaceMatches)
            ? 'structurally-current-citations'
            : 'structurally-unresolved-or-stale-citations',
        );
        for (const ref of binding.references) add(counts, `reference:${ref.status}`);
      }
      if (trial.proseHeuristic.length) add(counts, 'answers-with-prose-observations');
      else add(counts, 'prose-scanned-no-observation');
      if (
        trial.proseHeuristic.some((r) =>
          r.kind === 'negative-claim'
            ? r.notes.length > 0
            : !['in-code-block', 'language-unsupported'].includes(r.code),
        )
      )
        add(counts, 'answers-with-prose-warnings');
      if (
        trial.proseHeuristic.some(
          (r) =>
            r.kind === 'negative-claim-note' &&
            ['in-code-block', 'language-unsupported', 'input-limit', 'too-many-claims'].includes(
              r.code,
            ),
        )
      )
        add(counts, 'answers-with-unjudged-prose-units');
      for (const row of trial.proseHeuristic) {
        add(counts, `prose-row:${row.kind}`);
        for (const code of row.kind === 'negative-claim-note' ? [row.code] : row.notes)
          add(counts, `prose-heuristic:${code}`);
      }
    }
  }
  return {
    kind: 'counterfactual-only',
    totals,
    groups: [...groups.values()],
    limitations: [
      'This is a parser/checker replay, not an Agent run or delivered result. No model call or correction was made.',
      'All registered trials remain in the denominator, including no-answer and schema failures.',
      'Zero claims is not a successful established negative answer; nonempty-all-established is separate.',
      'Establishment concerns recorded typed scope only, not answer truth, usefulness, or accuracy.',
      'Prose observations are bounded heuristic flags, not validated semantic repetition or truth labels. Schema failures/no-answer trials are unscanned; a scanned answer without observations is not clearance.',
      'The original candidate is observed before any library-written statement; evidence remains the exact saved native record.',
    ],
  };
}
