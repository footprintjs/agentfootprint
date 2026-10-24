/** Private-only rating pipeline. No call runs merely by importing this module. */
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { BudgetLedger } from './budget.mjs';
import { budgetClient } from './transport.mjs';
import { ROOT, RATER_MODEL, registeredReserve, digest, privatePath } from './plan.mjs';
import { loadDoors, readRaw } from './run.mjs';
import { loadBank } from './bank.mjs';
import {
  LABEL_PROMPT,
  USEFULNESS_PROMPT,
  RATER_LIMITATION,
  makeLabelPacket,
  makeUsefulnessPacket,
  validateLabels,
  agreementDisputes,
} from './labels.mjs';
import { scoreRows } from './score.mjs';

const readJson = (path) => JSON.parse(readFileSync(privatePath(path), 'utf8'));
const privateExists = (path) => existsSync(privatePath(path));
function save(path, value) {
  const fd = openSync(privatePath(path), 'w', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
const copy = (v) => JSON.parse(JSON.stringify(v));
const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const UNSENT_CAP = 'benchmark permits one answer and one genuine tools-off citation correction';

/** A postprocessing exception for the frozen harness's pre-dispatch cap only.
 * A missing vendor response is never repaired or assigned zero usage. */
function providerStages(artifact) {
  const all = artifact.raw.calls.filter((c) => c.source === 'provider');
  const terminal = all.filter((c) => typeof c.response?.content === 'string');
  if (!terminal.length)
    throw new Error('Every provider stage needs its original terminal response.');
  if (terminal.length === all.length) return { calls: all };
  const guard = all.at(-1),
    prior = all.at(-2),
    final = artifact.raw.turns.at(-1);
  const wire = artifact.wire;
  if (
    all.length !== terminal.length + 1 ||
    guard.response !== undefined ||
    guard.error?.name !== 'Error' ||
    guard.error.message !== UNSENT_CAP ||
    !Array.isArray(guard.chunks) ||
    guard.chunks.length !== 0 ||
    guard.turn !== final.turn ||
    !(guard.request?.tools?.length > 0) ||
    prior?.response?.stopReason !== 'tool_use' ||
    !prior.response.toolCalls?.length ||
    final.output !== null ||
    final.error?.name !== 'RunCheckpointError' ||
    !final.error.message?.includes(UNSENT_CAP) ||
    !Array.isArray(wire) ||
    wire.length !== terminal.length ||
    new Set(wire.map((w) => w.id)).size !== wire.length ||
    wire.some((w, i) => !sameTerminalResponse(w, terminal[i].response))
  )
    throw new Error('Missing terminal response is not a proven unsent harness-cap stage.');
  return {
    calls: terminal,
    trialFailure: { code: 'harness-call-cap', unsentStages: 1, finalError: 'RunCheckpointError' },
  };
}

/** Compare the wire's response-bearing fields under the frozen Anthropic mapping.
 * Replay metadata and request manifests are not model response content. */
function sameTerminalResponse(wire, port) {
  const response = wire.response,
    usage = response?.usage;
  if (
    wire.error !== undefined ||
    wire.preflight ||
    typeof wire.id !== 'string' ||
    !wire.id ||
    typeof response?.id !== 'string' ||
    !response.id ||
    response.id !== port.providerRef ||
    !Array.isArray(response.content) ||
    !usage
  )
    return false;
  const tools = response.content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: b.input }));
  const normalizedUsage = {
    input: usage.input_tokens,
    output: usage.output_tokens,
    ...(usage.cache_read_input_tokens !== undefined && {
      cacheRead: usage.cache_read_input_tokens,
    }),
    ...(usage.cache_creation_input_tokens !== undefined && {
      cacheWrite: usage.cache_creation_input_tokens,
    }),
  };
  return (
    responseText(response) === port.content &&
    isDeepStrictEqual(tools, port.toolCalls) &&
    isDeepStrictEqual(normalizedUsage, port.usage) &&
    (response.stop_reason === 'end_turn' ? 'stop' : response.stop_reason) === port.stopReason
  );
}

function argumentsMatch(call, attempt, identity) {
  if (isDeepStrictEqual(call.arguments, attempt.args)) return true;
  // fixtureTools host-fills only this reserved key. The native record can omit it;
  // every other argument still matches exactly, and the actual fill must match the
  // host identity. Never drop arbitrary keys or bind by tool name alone.
  if (
    !Object.hasOwn(call.arguments, 'benchTenant') &&
    typeof identity?.tenant === 'string' &&
    attempt.args?.benchTenant === identity.tenant
  ) {
    const { benchTenant, ...visible } = attempt.args;
    return isDeepStrictEqual(call.arguments, visible);
  }
  return false;
}

/** Keep all provider drafts, including malformed JSON, distinct from delivered text. */
export function normalizeArtifact(artifact, caseDef, blindId) {
  const raw = artifact.raw,
    final = raw?.turns?.at(-1);
  if (!final || !Array.isArray(raw.calls) || !Array.isArray(raw.attempts))
    throw new Error(
      'Incomplete native artifact; it cannot be silently labelled as an empty answer.',
    );
  const { calls: paid, trialFailure } = providerStages(artifact);
  const stages = paid.map((call) => {
    let value;
    try {
      value = JSON.parse(call.response.content);
    } catch {
      /* Preserve invalid text below. */
    }
    return {
      text: typeof value?.summary === 'string' ? value.summary : call.response.content,
      citations: Array.isArray(value?.negatives) ? copy(value.negatives) : [],
    };
  });
  // Deduplicate inherited native records by exact native identity, not provider call IDs.
  const calls = new Map();
  for (const turn of raw.turns)
    for (const call of turn.nativeRecord?.calls ?? []) calls.set(call.resultId, call);
  const native = [...calls.values()],
    used = new Set(),
    ids = new Set();
  const toolTruth = raw.attempts.map((attempt, index) => {
    const candidates = native.filter(
      (c) =>
        c.toolName === attempt.tool &&
        c.turn === attempt.turn &&
        argumentsMatch(c, attempt, raw.identity) &&
        (attempt.toolCallId === undefined || c.toolCallId === attempt.toolCallId) &&
        !used.has(c.resultId),
    );
    // Repeated identical invocations retain their dispatch order in both arrays.
    const call = candidates[0];
    if (call) used.add(call.resultId);
    const id = call?.row?.handle ?? `unserved-read-${index + 1}`;
    if (ids.has(id))
      throw new Error('Ambiguous served handle across turns; label binding needs reconciliation.');
    ids.add(id);
    const definition = caseDef.tools.find((t) => t.name === attempt.tool);
    return {
      id,
      name: attempt.tool,
      arguments: copy(attempt.args),
      result: {
        data: attempt.outcome === 'returned' ? copy(attempt.result ?? null) : null,
        ...(attempt.error && { error: copy(attempt.error) }),
        readTurn: attempt.turn,
        answeringTurn: final.turn,
        readAt: call?.readAt ?? null,
        ...(definition?.search && { searchDeclaration: copy(definition.search) }),
        declaredEffect: definition?.effects ?? (definition?.search ? 'read' : 'unknown'),
      },
      outcome: attempt.outcome === 'returned' ? 'returned' : 'failed',
    };
  });
  // Calls refused before execute remain visible as non-dispatched, never as an empty search.
  for (const call of native)
    if (!used.has(call.resultId) && call.dispatched === false) {
      const id = call.row?.handle ?? `unserved-refusal-${toolTruth.length + 1}`;
      if (ids.has(id)) throw new Error('Ambiguous refused handle');
      ids.add(id);
      toolTruth.push({
        id,
        name: call.toolName,
        arguments: copy(call.arguments),
        result: {
          data: null,
          readTurn: call.turn,
          answeringTurn: final.turn,
          readAt: call.readAt ?? null,
        },
        outcome: 'not-dispatched',
      });
    }
  return {
    blindId,
    question: final.message ?? caseDef.prompt,
    toolTruth,
    stages,
    ...(trialFailure && { trialFailure }),
    delivered:
      final.output == null
        ? final.delivered?.tokens?.join('')
          ? `[Partial streamed text before the run ended without a final answer:]\n${final.delivered.tokens.join(
              '',
            )}\n[No final answer was delivered; the run withheld or failed.]`
          : '[No final answer was delivered; the run withheld or failed.]'
        : asText(final.output),
  };
}

function responseText(response) {
  if (!Array.isArray(response?.content)) return undefined;
  return response.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

export function validateBatch(packets, response) {
  if (response?.stop_reason === 'max_tokens')
    return packets.map((p) => ({ id: p.id, ok: false, errors: ['truncated rating response'] }));
  let parsed;
  try {
    parsed = JSON.parse(responseText(response));
  } catch {
    /* unknown, never a negative label */
  }
  const expected = new Set(packets.map((p) => p.id)),
    seen = new Set();
  const results = new Map();
  if (!parsed || Object.keys(parsed).length !== 1 || !Array.isArray(parsed.packets))
    return packets.map((p) => ({ id: p.id, ok: false, errors: ['invalid batch JSON'] }));
  let invalid = false;
  for (const value of parsed.packets) {
    if (
      !value ||
      Object.keys(value).sort().join(',') !== 'id,labels' ||
      !expected.has(value.id) ||
      seen.has(value.id)
    ) {
      invalid = true;
      continue;
    }
    seen.add(value.id);
    results.set(
      value.id,
      validateLabels(
        packets.find((p) => p.id === value.id),
        value.labels,
      ),
    );
  }
  if (invalid)
    return packets.map((p) => ({
      id: p.id,
      ok: false,
      errors: ['unknown/duplicate batch identity'],
    }));
  return packets.map((p) => ({
    id: p.id,
    ...(results.get(p.id) ?? { ok: false, errors: ['missing packet labels'] }),
  }));
}

/** One attempt only. An existing ledger purpose without raw response forbids resend. */
export async function rateBatch({ packets, kind, session, dir, ledger, fetchImpl }) {
  if (
    !['truth', 'usefulness'].includes(kind) ||
    !['A', 'B'].includes(session) ||
    !Array.isArray(packets) ||
    packets.length < 1 ||
    packets.length > 4
  )
    throw new Error('Registered rating batch requires kind, independent session, and1–4 packets.');
  const packetHash = digest(packets),
    purpose = `rate/${kind}/${session}/${packetHash}`;
  const path = privatePath(join(privatePath(dir), `${kind}-${session}-${packetHash}.json`));
  if (privateExists(path)) {
    const saved = readJson(path);
    if (saved.purpose !== purpose || saved.packetHash !== packetHash)
      throw new Error('Saved rating identity mismatch.');
    return { purpose, reused: true, ratings: validateBatch(packets, saved.response) };
  }
  if ([...ledger.entries.values()].some((e) => e.purpose === purpose))
    throw new Error(
      'Rating has a ledger entry but no saved response; reconcile, never automatically retry.',
    );
  const client = budgetClient({ ledger, purpose, fetchImpl });
  const response = await client.messages.create({
    model: RATER_MODEL,
    max_tokens: 4096,
    temperature: 0,
    stream: false,
    system: `${
      kind === 'truth' ? LABEL_PROMPT : USEFULNESS_PROMPT
    }\nYou have a batch of anonymous packets. Apply that single-packet label schema separately to each. Instead of a single label object, return ONLY {"packets":[{"id":"exact packet id","labels":{...}}]}. Include every packet exactly once. Do not compare responses or guess treatments.`,
    messages: [{ role: 'user', content: JSON.stringify({ packets }) }],
  });
  // Persist original response before parsing, validating, or deciding agreement.
  save(path, { purpose, packetHash, session, kind, response });
  return { purpose, reused: false, ratings: validateBatch(packets, response) };
}

export function ratingPlan(records) {
  const batches = [];
  for (const kind of ['truth', 'usefulness'])
    for (let offset = 0; offset < records.length; offset += 4) {
      const packets = records.slice(offset, offset + 4).map((r) => r[kind]);
      for (const session of ['A', 'B']) batches.push({ kind, session, packets });
    }
  return batches;
}

function ratingsFromDisk(batches, dir) {
  const all = new Map();
  for (const batch of batches) {
    const path = join(dir, `${batch.kind}-${batch.session}-${digest(batch.packets)}.json`);
    const ratings = privateExists(path)
      ? validateBatch(batch.packets, readJson(path).response)
      : [];
    for (const packet of batch.packets)
      all.set(
        JSON.stringify([packet.id, batch.kind, batch.session]),
        ratings.find((r) => r.id === packet.id)?.labels,
      );
  }
  return all;
}

export function resolveRatings(records, ratings, adjudications = []) {
  const decisions = new Map();
  for (const decision of adjudications) {
    const key = JSON.stringify([decision.packetId, decision.kind, decision.id ?? null]);
    if (decisions.has(key)) throw new Error('Duplicate owner adjudication.');
    decisions.set(key, decision);
  }
  const used = new Set(),
    queue = [],
    resolved = new Map();
  for (const record of records) {
    const result = {};
    for (const kind of ['truth', 'usefulness']) {
      const packet = record[kind],
        agreement = agreementDisputes(
          packet,
          ratings.get(JSON.stringify([packet.id, kind, 'A'])),
          ratings.get(JSON.stringify([packet.id, kind, 'B'])),
        );
      let labels = copy(agreement.agreed ?? {});
      for (const dispute of agreement.disputes) {
        const key = JSON.stringify([packet.id, dispute.kind, dispute.id ?? null]);
        const decision = decisions.get(key);
        if (!decision) {
          queue.push({ ...dispute, packet });
          continue;
        }
        if (dispute.kind === 'usefulness') {
          if (!validateLabels(packet, decision.value).ok)
            throw new Error('Invalid owner usefulness decision.');
          labels = copy(decision.value);
        } else {
          if (decision.value?.id !== dispute.id)
            throw new Error('Owner decision must preserve the disputed item identity.');
          const single = {
            ...packet,
            stages: packet.stages.map((stage) => ({
              ...stage,
              sentences: stage.sentences.filter(
                (s) => dispute.kind === 'sentences' && s.id === dispute.id,
              ),
              citations: stage.citations.filter(
                (s) => dispute.kind === 'citations' && s.id === dispute.id,
              ),
            })),
          };
          if (
            !validateLabels(single, {
              sentences: dispute.kind === 'sentences' ? [decision.value] : [],
              citations: dispute.kind === 'citations' ? [decision.value] : [],
            }).ok
          )
            throw new Error('Invalid owner truth decision.');
          labels[dispute.kind].push(copy(decision.value));
        }
        used.add(key);
      }
      const checked = validateLabels(packet, labels);
      if (!checked.ok && agreement.disputes.length === 0)
        queue.push({ packetId: packet.id, kind, reason: 'missing-or-invalid', packet });
      result[kind] = checked.ok ? checked.labels : undefined;
    }
    resolved.set(record.blindId, result);
  }
  for (const key of decisions.keys())
    if (!used.has(key)) throw new Error('Owner decision names no current dispute.');
  return { queue, resolved };
}

/** Final prose is scored separately from citation proposals at EVERY model stage.
 * A proposal is delivered only when an equal kind/about/read-set survives in the
 * actual final output and (under enforce) its final check is established. An
 * earlier correct proposal lost during correction remains an observed hold.
 */
export function normalizedScoreRow(record, labels, lib) {
  const { artifact, caseDef } = record,
    { row, raw } = artifact;
  const final = raw.turns.at(-1),
    { calls, trialFailure } = providerStages(artifact);
  const packet = record.truth,
    last = packet.stages.at(-1),
    truth = labels?.truth;
  const sentences = truth?.sentences.filter((s) => last.sentences.some((p) => p.id === s.id)) ?? [];
  const boundary = caseDef.oracle?.expected_answer_boundaries;
  const freshRead = raw.attempts.some(
    (attempt) =>
      attempt.turn === final.turn &&
      attempt.outcome === 'returned' &&
      final.nativeRecord?.calls?.some(
        (call) =>
          call.turn === final.turn &&
          call.toolName === attempt.tool &&
          call.effect === 'read' &&
          call.dispatched === true &&
          call.outcome === 'ok' &&
          argumentsMatch(call, attempt, raw.identity),
      ),
  );
  const negativeRequired =
    row.cell === 'long'
      ? freshRead
        ? caseDef.longContext?.expectedFresh?.negative_required
        : false
      : boundary?.negative_required;
  const hasUnknown = truth?.sentences.some((s) => s.truth === 'unknown');
  const observations = final.nativeRecord
    ? lib.observeNegativeProse(
        { summary: record.normalized.stages.at(-1).text },
        final.nativeRecord,
        'negatives',
      )
    : [];
  let cursor = 0;
  const detector = last.sentences.map((sentence) => {
    const text = record.normalized.stages.at(-1).text,
      start = text.indexOf(sentence.text, cursor);
    cursor = start + sentence.text.length;
    const label = sentences.find((s) => s.id === sentence.id);
    const overlap = observations.some(
      (o) =>
        o.span.start < cursor &&
        o.span.end > start &&
        (o.kind === 'negative-claim' ||
          (o.code === 'no-read' && lib.detectNegativeClaims(sentence.text).claims.length > 0)),
    );
    return {
      // R3 observes negative claim forms, including supported scoped reports.
      // Whether a claim overstates its evidence is a separate truth measure.
      positive: ['non-existence', 'completeness', 'scoped-negative'].includes(label?.kind),
      detected: overlap,
    };
  });
  const trueZero =
    row.cell === 'long'
      ? freshRead && caseDef.longContext?.expectedFresh?.negative_required === true
      : caseDef.oracle?.primary_stratum === 'true_zero';
  const sameSubjectPositive = caseDef.oracle?.tool_calls?.some(
    (c) =>
      c.schema?.search_read_declaration?.subject?.plural === caseDef.oracle.subject?.plural &&
      c.arguments?.[c.schema.search_read_declaration.entity_argument] === caseDef.oracle.entity &&
      c.result?.rows?.length > 0,
  );
  const contradictionEligible =
    caseDef.oracle?.primary_stratum === 'contradiction' && sameSubjectPositive;
  let delivered;
  try {
    delivered = typeof final.output === 'string' ? JSON.parse(final.output) : final.output;
  } catch {
    delivered = null;
  }
  const sameClaim = (a, b) =>
    a?.kind === b?.kind &&
    isDeepStrictEqual(a?.about, b?.about) &&
    Array.isArray(a?.restsOn) &&
    Array.isArray(b?.restsOn) &&
    isDeepStrictEqual([...new Set(a.restsOn)].sort(), [...new Set(b.restsOn)].sort());
  const finalClaims = Array.isArray(delivered?.negatives) ? delivered.negatives : [];
  const finalCheck = (index) =>
    final.answerNegatives?.checks?.find((c) => c.index === index) ??
    final.answerNegatives?.checks?.[index];
  const citations = packet.stages.flatMap((stage) =>
    stage.citations.flatMap((proposal) => {
      const label = truth?.citations.find((c) => c.id === proposal.id);
      if (!label) return [];
      const deliveredIndex = finalClaims.findIndex(
        (claim, index) =>
          sameClaim(proposal, claim) &&
          (row.arm !== 'enforce' || finalCheck(index)?.code === 'established'),
      );
      return [
        {
          stageId: stage.id,
          proposalId: proposal.id,
          valid: label.valid,
          correct: label.correct,
          trueZero,
          held: deliveredIndex < 0,
          deliveredIndex: deliveredIndex < 0 ? null : deliveredIndex,
        },
      ];
    }),
  );
  const lastCandidate = calls.at(-1)?.candidate?.value;
  const negativeOverclaim = sentences.some((s) => s.truth === 'unsupported' && s.kind !== 'other');
  const hadCorrection = calls.some(
    (call) =>
      (call.request?.tools?.length ?? 0) === 0 &&
      JSON.stringify(call.request ?? {}).includes('internal citation correction'),
  );
  const totals = calls.map((c) => c.response?.usage);
  const count = (value) => Number.isSafeInteger(value) && value >= 0;
  const tokensKnown = totals.every(
    (u) =>
      count(u?.input) &&
      count(u?.output) &&
      ['cacheRead', 'cacheWrite'].every((key) => u[key] === undefined || count(u[key])),
  );
  // Anthropic input excludes cache traffic. Include both cache channels across
  // every paid stage; malformed counts remain unknown rather than disappearing.
  const tokenTotal = tokensKnown
    ? totals.reduce((n, u) => n + u.input + u.output + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), 0)
    : undefined;
  return {
    id: row.id,
    caseId: row.caseId,
    model: row.model,
    cell: row.cell,
    arm: row.arm,
    ...(trialFailure && { trialFailure }),
    pairId: digest([row.model, row.caseId, row.cell, row.rep]),
    labelsComplete: Boolean(
      truth &&
        labels?.usefulness &&
        !hasUnknown &&
        typeof negativeRequired === 'boolean' &&
        final.nativeRecord &&
        !observations.some((o) => ['input-limit', 'too-many-claims'].includes(o.code)),
    ),
    ownerPending: !truth || !labels?.usefulness,
    citations,
    negativeRequired,
    fieldPresent: Array.isArray(lastCandidate?.negatives) && lastCandidate.negatives.length > 0,
    contradictionEligible: Boolean(contradictionEligible),
    missedContradiction: Boolean(
      contradictionEligible && delivered?.negatives?.some((c) => c.kind === 'none'),
    ),
    rewordingEligible: hadCorrection,
    reworded: hadCorrection && negativeOverclaim,
    detector,
    usefulness: labels?.usefulness?.score,
    tokens: count(tokenTotal) ? tokenTotal : undefined,
    latencyMs: final.latencyMs,
    ...(row.cell === 'near' && {
      nearMatch: {
        substitution: sentences.some((s) => s.substitution),
        flat: sentences.some((s) => s.flat && s.kind === 'non-existence'),
        ask: sentences.some((s) => s.asks),
        notFound: last.citations.some((c) => c.kind === 'not-found'),
      },
    }),
  };
}

/** Only aggregate counts/metrics and model names, never private ids or free text. */
export function publicSummary(score, queueSize, budget) {
  return {
    status: !score.complete || queueSize ? 'pending-or-incomplete' : 'measured',
    raterLimitation: RATER_LIMITATION,
    ownerDecisionsPending: queueSize,
    expectedReplies: score.expectedReplies,
    receivedReplies: score.receivedReplies,
    scoredReplies: score.scoredReplies,
    budget,
    caseRule: score.caseRule,
    groups: score.groups,
    incompleteReasons: [...new Set(score.problems.map((p) => p.reason))],
  };
}

function argsOf(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (
      !['mode', 'bank', 'out', 'adjudications'].includes(key) ||
      !argv[i + 1] ||
      Object.hasOwn(flags, key)
    )
      throw new Error(
        'Use --mode packets|rate|score --bank PRIVATE --out PRIVATE [--adjudications PRIVATE].',
      );
    flags[key] = argv[i + 1];
  }
  if (!['packets', 'rate', 'score'].includes(flags.mode) || !flags.bank || !flags.out)
    throw new Error('A rating mode, private bank, and private output folder are required.');
  return flags;
}

export async function main(argv) {
  const flags = argsOf(argv),
    out = privatePath(flags.out),
    bankPath = privatePath(flags.bank);
  const lock = privatePath(join(out, 'run.lock')),
    fd = openSync(lock, 'wx', 0o600);
  try {
    const manifest = readJson(join(out, 'manifest.json')),
      bytes = readFileSync(privatePath(bankPath), 'utf8');
    registeredReserve(manifest, bytes, out);
    if (flags.mode === 'rate' && !manifest.aiBankAccepted)
      throw new Error('Owner acceptance of the disclosed AI-authored bank is required.');
    if (
      manifest.schedule.length !== 784 ||
      new Set(manifest.schedule.map((r) => r.id)).size !== 784
    )
      throw new Error('The complete frozen784-reply schedule is required.');
    const { cases } = await loadBank(JSON.parse(bytes)),
      byId = new Map(cases.map((c) => [c.id, c]));
    const keyPath = join(out, 'blind-key.json');
    const keys = privateExists(keyPath)
      ? readJson(keyPath)
      : { registrationSha256: digest(manifest), ids: {} };
    if (keys.registrationSha256 !== digest(manifest))
      throw new Error('Blind key belongs to another registration.');
    for (const row of manifest.schedule) keys.ids[row.id] ??= randomUUID();
    if (new Set(Object.values(keys.ids)).size !== manifest.schedule.length)
      throw new Error('Blind key collision or stale identity.');
    save(keyPath, keys);
    const records = [],
      missing = [];
    for (const row of manifest.schedule) {
      const path = privatePath(join(out, 'raw', `${row.id}.json.gz`));
      if (!privateExists(path)) {
        missing.push(row.id);
        continue;
      }
      const artifact = readRaw(privatePath(path)),
        caseDef = byId.get(row.caseId);
      if (!isDeepStrictEqual(artifact.row, row))
        throw new Error('Raw row differs from registered schedule.');
      try {
        const normalized = normalizeArtifact(artifact, caseDef, keys.ids[row.id]);
        records.push({
          blindId: normalized.blindId,
          artifact,
          caseDef,
          normalized,
          truth: makeLabelPacket(normalized),
          usefulness: makeUsefulnessPacket(normalized),
        });
      } catch (error) {
        missing.push(row.id);
      }
    }
    if (flags.mode === 'rate' && missing.length)
      throw new Error(
        'All784 native artifacts and provider responses are required before paid rating.',
      );
    save(
      join(out, 'rating-packets.json'),
      records.map((r) => ({ truth: r.truth, usefulness: r.usefulness })),
    );
    if (flags.mode === 'packets') {
      console.log(JSON.stringify({ packets: records.length, incomplete: missing.length }));
      return;
    }
    const dir = privatePath(join(out, 'ratings'));
    mkdirSync(privatePath(dir), { recursive: true, mode: 0o700 });
    const ledger = new BudgetLedger(privatePath(join(out, 'budget.jsonl'))),
      batches = ratingPlan(records);
    if (flags.mode === 'rate') {
      for (const batch of batches) await rateBatch({ ...batch, dir, ledger });
      console.log(
        JSON.stringify({
          packets: records.length,
          batches: batches.length,
          budget: ledger.summary(),
        }),
      );
      return;
    }
    const ratings = ratingsFromDisk(batches, dir);
    const decisions = flags.adjudications ? readJson(privatePath(flags.adjudications)) : undefined;
    if (
      decisions &&
      (decisions.registrationSha256 !== digest(manifest) || !Array.isArray(decisions.decisions))
    )
      throw new Error('Adjudications must name this registration and contain decisions.');
    const resolved = resolveRatings(records, ratings, decisions?.decisions);
    save(join(out, 'owner-queue.json'), {
      registrationSha256: digest(manifest),
      disputes: resolved.queue,
    });
    await loadDoors(); // Resolve the same built package used by the native harness.
    const lib = {
      ...(await import(
        pathToFileURL(join(ROOT, 'dist/esm/core/agent/negativeClaims/prose.js')).href
      )),
      ...(await import(
        pathToFileURL(join(ROOT, 'dist/esm/integrity/negative-claim/detect.js')).href
      )),
    };
    const rows = records.map((r) => normalizedScoreRow(r, resolved.resolved.get(r.blindId), lib));
    const mock = privateExists(join(out, 'scripted-validation.json'))
      ? readJson(join(out, 'scripted-validation.json'))
      : {};
    const score = scoreRows(rows, {
      expectedReplyIds: manifest.schedule.map((r) => r.id),
      scriptedPassed: mock.passed === true && mock.registrationSha256 === digest(manifest),
      baselineArm: 'observe',
      nearMatchBaselineArm: 'near-count',
    });
    save(join(out, 'scored-private.json'), { rows, score });
    save(
      join(out, 'public-summary.json'),
      publicSummary(score, resolved.queue.length, ledger.summary()),
    );
    console.log(
      JSON.stringify({
        status: !score.complete || resolved.queue.length ? 'pending-or-incomplete' : 'measured',
        expected: 784,
        normalized: rows.length,
        ownerDecisionsPending: resolved.queue.length,
      }),
    );
  } finally {
    closeSync(fd);
    unlinkSync(privatePath(lock));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
