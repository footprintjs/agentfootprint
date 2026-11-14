import type { Standing } from '../../../../core/agent/findings/types.js';
import type {
  AgentEvidenceCheckedPayload,
  EvalScorePayload,
  FindingsStandingPayload,
  IntegrityDispositionPayload,
  ToolAbsentPayload,
} from '../../../../events/payloads.js';
import { toWireJson } from '../../../../lib/wireJson.js';
import type { OtelAttributeValue } from '../types.js';
import { bound, boundList } from './bounds.js';

// ─── What an evaluation tool reads — pure projections ────────────────
//
// One function per event: payload in, attributes out. Payload types are the
// canonical ones made Partial, because this adapter also takes hand-fed
// streams. Every projection is content-free unless it takes `captureContent`.

export type Attrs = Record<string, OtelAttributeValue>;

/** Name the closed standing vocabulary once — the per-turn counts key on it. */
export const STANDINGS: readonly Standing[] = ['fact', 'open', 'noise', 'ruled-out'];

/**
 * Standing span events written per turn. The MODEL chooses how many standing
 * rows it files, and a real OTel SDK keeps 128 events per span by evicting
 * the OLDEST: unbounded rows would let a model (or a prompt injection in a
 * tool result) push the span's earlier record — its route decision — off
 * the wire. Past the cap, rows are counted and summarized once.
 */
export const MAX_STANDING_EVENTS_PER_TURN = 32;

/** The default ceiling on one exported CONTENT value, in characters. */
export const DEFAULT_MAX_CONTENT_CHARS = 65_536;

export const isPlainObject = (value: unknown): value is object =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Text that is a serialized plain object — the "serialized string" the spec
 *  says to take as the object it encodes. Only text opening with `{` is
 *  parsed; the caller has already refused anything over the ceiling. */
function isSerializedObject(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false;
  try {
    return isPlainObject(JSON.parse(text));
  } catch {
    return false;
  }
}

/**
 * A tool call's arguments or result, as this adapter may export it:
 *
 *   - a plain object, or text that parses to one → the spec's
 *     `gen_ai.tool.call.arguments` / `.result`, as a JSON string (the spec's
 *     span form: its schema is `{"type": "object"}`, and OTel JS span
 *     attributes hold no objects);
 *   - anything else — plain text, a number, an array, the string `"123"` —
 *     → `agentfootprint.tool.<args|result>.content`: text verbatim, other
 *     values as JSON. Never the spec attribute, so a string is never
 *     exported as the number it spells;
 *   - over `maxChars` → neither: `agentfootprint.tool.<…>.omitted_chars`
 *     states the size. Never a cut value, which reads as complete data;
 *   - nothing serializable (undefined, a function, a cycle, a BigInt) → {}.
 */
export function toolContentAttrs(kind: 'args' | 'result', value: unknown, maxChars: number): Attrs {
  const specKey = kind === 'args' ? 'gen_ai.tool.call.arguments' : 'gen_ai.tool.call.result';
  if (value === undefined) return {};
  let text: string | undefined;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = toWireJson(value);
    } catch {
      return {};
    }
  }
  if (text === undefined) return {};
  if (text.length > maxChars) return { [`agentfootprint.tool.${kind}.omitted_chars`]: text.length };
  const object = typeof value === 'string' ? isSerializedObject(value) : isPlainObject(value);
  return { [object ? specKey : `agentfootprint.tool.${kind}.content`]: text };
}

const countOf = (list: unknown): number => (Array.isArray(list) ? list.length : 0);

/**
 * `tools.absent` / `tools.coverage_declared` — a COUNT per declared list, and
 * the suggested tool's NAME only when `knownTool` recognizes it as a tool this
 * strategy has seen RUN (a call that returned without error — it is held, by
 * construction). Never a sentence: `looked_for`, `what`, `why`, `tryInstead` —
 * and an unrecognized `tryInsteadTool.tool`, which is as much author text as
 * the rest — can each interpolate an argument (coverage README, "What that
 * does not close"); an unrecognized suggestion says only that it exists. A
 * registered tool the agent has not run yet is not recognized: the event
 * carries no roster (that would change every `absent()` event's bytes), so
 * this may omit a real name — never export text that is not one.
 */
export function coverageAttrs(
  p: Partial<ToolAbsentPayload>,
  knownTool: (name: string) => boolean,
): Attrs {
  const suggested = typeof p.tryInsteadTool?.tool === 'string';
  return {
    ...(typeof p.toolName === 'string' && { 'gen_ai.tool.name': p.toolName }),
    ...(typeof p.toolCallId === 'string' && { 'gen_ai.tool.call.id': p.toolCallId }),
    ...(typeof p.iteration === 'number' && { 'agentfootprint.iteration.index': p.iteration }),
    'agentfootprint.coverage.checked.count': countOf(p.checked),
    'agentfootprint.coverage.not_checked.count': countOf(p.notChecked),
    'agentfootprint.coverage.cannot_cover.count': countOf(p.cannotCover),
    ...(suggested &&
      (knownTool(String(p.tryInsteadTool?.tool))
        ? { 'agentfootprint.coverage.try_instead.tool': bound(p.tryInsteadTool?.tool) }
        : { 'agentfootprint.coverage.try_instead.unregistered': true })),
  };
}

/** `agent.evidence_checked` — the verdict and a COUNT; the unsupported
 *  values themselves only under `captureContent`. */
export function evidenceVerdictAttrs(
  p: Partial<AgentEvidenceCheckedPayload>,
  content: boolean,
): Attrs {
  const unsupported = Array.isArray(p.unsupported) ? p.unsupported : [];
  return {
    ...(typeof p.action === 'string' && { 'agentfootprint.evidence.action': p.action }),
    ...(typeof p.posture === 'string' && { 'agentfootprint.evidence.posture': p.posture }),
    ...(typeof p.candidates === 'number' && { 'agentfootprint.evidence.candidates': p.candidates }),
    // How many of `candidates` were actually looked up (exempt values are
    // not) — absent on an event recorded before the field existed.
    ...(typeof p.lookedUp === 'number' && { 'agentfootprint.evidence.looked_up': p.lookedUp }),
    'agentfootprint.evidence.unsupported.count': unsupported.length,
    ...(typeof p.afterRevision === 'boolean' && {
      'agentfootprint.evidence.after_revision': p.afterRevision,
    }),
    ...(p.evidenceTruncated === true && { 'agentfootprint.evidence.truncated': true }),
    ...(typeof p.iteration === 'number' && { 'agentfootprint.iteration.index': p.iteration }),
    ...(content &&
      unsupported.length > 0 && {
        'agentfootprint.evidence.unsupported.values': boundList(
          unsupported.map((u) => String(u.value)),
        ),
      }),
  };
}

/**
 * `findings.standing` — ids, the enum and counts. The assertions, `line` and
 * every other word the model wrote stay in the committed ledger. An
 * `unknownId` row exports the FLAG only: its `toolCallId` is a string the
 * MODEL wrote that names no result the run returned — model text, and
 * nothing any reader could join on.
 */
export function standingAttrs(p: Partial<FindingsStandingPayload>): Attrs {
  const knownId = p.unknownId !== true && typeof p.toolCallId === 'string';
  return {
    ...(typeof p.standing === 'string' && { 'agentfootprint.findings.standing': p.standing }),
    ...(knownId && { 'gen_ai.tool.call.id': bound(p.toolCallId) }),
    ...(typeof p.toolName === 'string' && { 'gen_ai.tool.name': p.toolName }),
    ...(typeof p.declaredOn === 'string' && {
      'agentfootprint.findings.declared_on': p.declaredOn,
    }),
    ...(typeof p.assertionCount === 'number' && {
      'agentfootprint.findings.assertion_count': p.assertionCount,
    }),
    ...(Array.isArray(p.conflictKeys) && {
      'agentfootprint.findings.conflict_count': p.conflictKeys.length,
    }),
    ...(p.unknownId === true && { 'agentfootprint.findings.unknown_id': true }),
    ...(typeof p.agrees === 'boolean' && { 'agentfootprint.findings.agrees': p.agrees }),
    ...(typeof p.iteration === 'number' && { 'agentfootprint.iteration.index': p.iteration }),
  };
}

/** One count per standing in the closed vocabulary — zeros included, since
 *  the adapter saw every standing row the traced turn filed. */
export function standingCountAttrs(counts: ReadonlyMap<Standing, number>): Attrs {
  const attrs: Attrs = {};
  for (const s of STANDINGS)
    attrs[`agentfootprint.findings.${s.replace('-', '_')}.count`] = counts.get(s) ?? 0;
  return attrs;
}

/** `integrity.disposition` rows summed — the "did any check fire?" a reader
 *  filters on. Synthetic (canary) counts stay out, as they do on each row. */
export function dispositionSpanAttrs(p: Partial<IntegrityDispositionPayload>): Attrs {
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const sum = (key: 'checked' | 'findings' | 'notApplicable' | 'unreachable'): number =>
    rows.reduce((n, row) => n + (typeof row[key] === 'number' ? row[key] : 0), 0);
  return {
    ...(typeof p.posture === 'string' && { 'agentfootprint.integrity.posture': p.posture }),
    ...(typeof p.workExisted === 'boolean' && {
      'agentfootprint.integrity.work_existed': p.workExisted,
    }),
    'agentfootprint.integrity.checked': sum('checked'),
    'agentfootprint.integrity.findings': sum('findings'),
    'agentfootprint.integrity.not_applicable': sum('notApplicable'),
    'agentfootprint.integrity.unreachable': sum('unreachable'),
  };
}

/** One registered (check, seam) row — the check's name and its outcomes. */
export function dispositionRowAttrs(
  row: Partial<IntegrityDispositionPayload['rows'][number]>,
): Attrs {
  const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    'agentfootprint.integrity.check.name': bound(row.check),
    'agentfootprint.integrity.check.seam': bound(row.seam),
    'agentfootprint.integrity.check.checked': n(row.checked),
    'agentfootprint.integrity.check.findings': n(row.findings),
    'agentfootprint.integrity.check.not_applicable': n(row.notApplicable),
    'agentfootprint.integrity.check.unreachable': n(row.unreachable),
    'agentfootprint.integrity.check.synthetic': n(row.synthetic),
  };
}

/**
 * `eval.score` → the GenAI semconv `gen_ai.evaluation.result` attributes
 * (github.com/open-telemetry/semantic-conventions-genai,
 * docs/gen-ai/gen-ai-events.md). The spec has no field for the target or the
 * evaluator kind, so those ride this adapter's own names — and only as words
 * of the payload's own closed vocabularies (a TypeScript union is not a
 * runtime check; a hand-fed sentence in `target` is not exported). The
 * explanation is content (a judge's reason can quote what it graded):
 * `captureContent` only, and omitted — its size stated — over `maxChars`.
 * `evidence` is a free-form record and is never exported.
 */
export function evaluationAttrs(
  p: Partial<EvalScorePayload>,
  content: boolean,
  maxChars: number,
): Attrs {
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const explanation = content && typeof p.explanation === 'string' ? p.explanation : undefined;
  return {
    'gen_ai.evaluation.name': bound(p.metricId),
    ...(finite(p.value) && { 'gen_ai.evaluation.score.value': p.value }),
    ...(typeof p.label === 'string' && { 'gen_ai.evaluation.score.label': bound(p.label) }),
    ...(explanation !== undefined &&
      (explanation.length > maxChars
        ? { 'agentfootprint.eval.explanation.omitted_chars': explanation.length }
        : { 'gen_ai.evaluation.explanation': explanation })),
    ...(EVAL_TARGETS.has(p.target as string) && {
      'agentfootprint.eval.target': p.target as string,
    }),
    ...(typeof p.targetRef === 'string' && {
      'agentfootprint.eval.target_ref': bound(p.targetRef),
    }),
    ...(finite(p.threshold) && { 'agentfootprint.eval.threshold': p.threshold }),
    ...(EVALUATORS.has(p.evaluator as string) && {
      'agentfootprint.eval.evaluator': p.evaluator as string,
    }),
  };
}

/** `EvalScorePayload`'s closed vocabularies, checked at run time. */
const EVAL_TARGETS: ReadonlySet<string> = new Set(['iteration', 'turn', 'run', 'toolCall']);
const EVALUATORS: ReadonlySet<string> = new Set(['llm', 'fn', 'heuristic']);
