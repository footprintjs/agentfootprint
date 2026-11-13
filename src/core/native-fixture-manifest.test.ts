import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

interface Commit {
  readonly idx: number;
  readonly stage: string;
  readonly overwrite: Record<string, unknown>;
  readonly trace: readonly { readonly path: string; readonly verb: string }[];
  readonly [key: string]: unknown;
}
interface DomainCommit extends Omit<Commit, 'idx'> {
  readonly stage: string;
  readonly overwrite: Record<string, unknown>;
  readonly trace: Commit['trace'];
}
interface Capture {
  readonly commitLog: readonly Commit[];
  readonly served: unknown;
}
const root = new URL('../../test/core/tools/reference/', import.meta.url);
const native = new URL('../../test/core/tools/reference/v14-native-components/', import.meta.url);
const read = (base: URL, file: string) => readFileSync(new URL(file, base), 'utf8');
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const fields = new Set([
  'toolResourceOwner',
  'runIdentitySource',
  'runSessionId',
  'servedToolParties',
]);
const slots = new Set(['System Prompt', 'Messages']);

// Named delta (a step is done only when its tool says so): a step whose tool
// declared no status now reads "Step 1 of 2 ran; its tool declared no
// status." where it read "Step 1 of 2 done.", and the step nudge reads "had
// not been completed when …" where it read "had not run when …". Admitted for
// the two stepped cases only, and only where that text is:
//   - the step sentence (from " Step k of n done." / " Step k of n ran;" to
//     the end of the string) and the nudge's body (after "of '<skill>'") are
//     cut from every string, on both sides;
//   - `contentHash` is dropped only from an object whose own text carried one
//     of them (it is computed from that text);
//   - `jsonBytes` / `jsonChars` are dropped only for a request's `messages`
//     slot and `total`, and only for a request measured AFTER a commit put
//     that text into the history (the measured messages then hold it). The
//     system prompt and tools slots, and every earlier request, stay exact.
const stepSentenceCases = new Set(['agent-stepped-skill', 'agent-answer-layer']);
const STEP_SENTENCE = / Step \d+ of \d+ (done\.|ran;)[\s\S]*$/;
const NUDGE_BODY = /^(\[steps unrun — Steps? [\d–]+ of '[^']*')[\s\S]*$/;
const carriesStepText = (text: string): boolean =>
  STEP_SENTENCE.test(text) || NUDGE_BODY.test(text);
function cutStepText(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(STEP_SENTENCE, '').replace(NUDGE_BODY, '$1');
  if (Array.isArray(value)) return value.map(cutStepText);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value);
  const ownText = entries.some(([, inner]) => typeof inner === 'string' && carriesStepText(inner));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of entries)
    if (!(ownText && key === 'contentHash')) out[key] = cutStepText(inner);
  return out;
}
function withoutMeasuredMessages(commit: Record<string, unknown>): void {
  const overwrite = commit.overwrite as Record<string, unknown> | undefined;
  const receipt = overwrite?.receipt as Record<string, unknown> | undefined;
  const measured = receipt?.requestMeasurement as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (measured === undefined) return;
  for (const sizes of [measured.total, measured.slots?.messages as Record<string, unknown>])
    if (sizes !== undefined) {
      delete sizes.jsonBytes;
      delete sizes.jsonChars;
    }
}
function withoutStepSentence(capture: unknown): unknown {
  const { commitLog, ...rest } = capture as Capture;
  let historyHoldsStepText = false;
  return {
    ...(cutStepText(rest) as object),
    commitLog: commitLog.map((commit) => {
      const cut = cutStepText(commit) as Record<string, unknown>;
      if (historyHoldsStepText) withoutMeasuredMessages(cut);
      if (/ Step \d+ of \d+ (done\.|ran;)|\[steps unrun — /.test(JSON.stringify(commit)))
        historyHoldsStepText = true;
      return cut;
    }),
  };
}

/** Comparison only: canonical files and their full ordered equality stay untouched. */
function domainCommit(input: Commit): DomainCommit {
  const { idx: _idx, ...commit } = JSON.parse(JSON.stringify(input)) as Commit;
  for (const key of fields) delete commit.overwrite[key];
  // Named delta (tool-outcome marker): a committed tool message whose call did
  // not complete carries `outcome` (`execution/callOutcome.ts`). Only that key
  // on a `role: 'tool'` history entry is admitted; everything else stays exact.
  const history = commit.overwrite.history;
  if (Array.isArray(history))
    for (const m of history as Record<string, unknown>[])
      if (m !== null && typeof m === 'object' && m.role === 'tool') delete m.outcome;
  const ask = commit.overwrite.argumentAsk;
  if (ask !== null && typeof ask === 'object' && !Array.isArray(ask))
    delete (ask as Record<string, unknown>).toolParties;
  return { ...commit, trace: commit.trace.filter((t) => !fields.has(t.path.split('\u001f')[0]!)) };
}
function assertNamedDeltas(old: Capture, current: Capture): void {
  expect(current.served).toEqual(old.served);
  expect(current.commitLog).toHaveLength(old.commitLog.length);
  const left = old.commitLog.map(domainCommit),
    right = current.commitLog.map(domainCommit);
  for (let i = 0; i < left.length; ) {
    if (!slots.has(left[i]!.stage)) {
      expect(right[i]).toEqual(left[i]);
      i++;
      continue;
    }
    let end = i;
    while (end < left.length && slots.has(left[end]!.stage)) end++;
    const a = left.slice(i, end),
      b = right.slice(i, end);
    expect(b.every((c) => slots.has(c.stage))).toBe(true);
    // Only the two parallel context slots may complete in either order;
    // each slot's values, trace verbs, stage coordinates and internal order stay exact.
    for (const stage of slots)
      expect(b.filter((c) => c.stage === stage)).toEqual(a.filter((c) => c.stage === stage));
    i = end;
  }
}

it('manifest binds every complete capture, unchanged served content and only the named state/schedule deltas', () => {
  const manifest = JSON.parse(read(native, 'MANIFEST.json')) as {
    changed: { case: string; historicalSha256: string; expectedSha256: string }[];
    unchanged: { case: string; historicalSha256: string; expectedSha256: string }[];
  };
  expect(manifest.changed).toHaveLength(28);
  expect(new Set([...manifest.changed, ...manifest.unchanged].map((c) => c.case)).size).toBe(31);
  for (const row of [...manifest.changed, ...manifest.unchanged]) {
    const historical = read(root, row.case + '.json');
    const candidate = read(manifest.changed.includes(row) ? native : root, row.case + '.json');
    expect(digest(historical), row.case + ' historical').toBe(row.historicalSha256);
    expect(digest(candidate), row.case + ' expected').toBe(row.expectedSha256);
    const named = stepSentenceCases.has(row.case) ? withoutStepSentence : (c: unknown) => c;
    assertNamedDeltas(
      named(JSON.parse(historical)) as Capture,
      named(JSON.parse(candidate)) as Capture,
    );
  }
});
