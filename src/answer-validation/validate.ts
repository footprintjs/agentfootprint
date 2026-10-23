/** One explicit JSON-answer validation; the runner owns when to invoke it. */
import { applyOutputSchema, type OutputSchemaParser } from './outputSchema.js';
import { copyJson as jsonCopy, ownData } from '../lib/boundedJson.js';
import type { ArtifactScope, ArtifactStore } from '../artifacts/types.js';
import { computeArtifactDigest } from '../artifacts/payload.js';
import { createAnswerEvidenceResolver } from './evidence.js';
import { toolCallsView } from './toolLedger.js';
import { AGENT_CHECK_PREFIX } from './agentChecks.js';
import type {
  AgentCheckName,
  AnswerToolCallsView,
  AnswerCheck,
  AnswerValidationContext,
  AnswerValidationOptions,
  AnswerValidationReport,
  ResolvedAnswerValidation,
} from './types.js';

const DEFAULT_LIMITS = Object.freeze({
  maxReads: 16,
  maxBytes: 4 * 1024 * 1024,
  maxChecks: 100,
  maxCandidateBytes: 1024 * 1024,
  timeoutMs: 5000,
  maxToolCalls: 256,
});
/** The ceiling `limits.maxToolCalls` may be raised to. */
const MAX_TOOL_CALLS = 10_000;
const encoder = new TextEncoder();
const dispositions = new Set(['checked-pass', 'checked-fail', 'not-applicable', 'unreachable']);
const AGENT_CHECK_NAMES: ReadonlySet<string> = new Set<AgentCheckName>([
  'claims',
  'names-and-numbers',
]);

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    throw new Error('Expected bounded non-empty text.');
  return value;
}

/**
 * `agentChecks`: a plain, non-empty list of known names, each once, every slot
 * a data property (no hole, no getter) — or absent, which is the empty list.
 */
function readAgentChecks(value: unknown): readonly AgentCheckName[] {
  if (value === undefined) return Object.freeze([]);
  const refuse = (): never => {
    throw new Error(
      "answerValidation.agentChecks must list 'claims' and/or 'names-and-numbers', each once " +
        '(omit it to validate with your checks alone).',
    );
  };
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return refuse();
  if (value.length === 0 || value.length > AGENT_CHECK_NAMES.size) return refuse();
  const names: AgentCheckName[] = [];
  for (let index = 0; index < value.length; index++) {
    const slot = Object.getOwnPropertyDescriptor(value, index);
    const name: unknown = slot !== undefined && 'value' in slot ? slot.value : undefined;
    if (typeof name !== 'string' || !AGENT_CHECK_NAMES.has(name)) return refuse();
    if (names.includes(name as AgentCheckName)) return refuse();
    names.push(name as AgentCheckName);
  }
  return Object.freeze(names);
}

/** Validate and snapshot an authored contract once, before running an agent. */
export function resolveAnswerValidation<T = unknown>(
  options: AnswerValidationOptions<T>,
): ResolvedAnswerValidation {
  const source = ownData(options, ['id', 'version', 'mode', 'limits', 'agentChecks', 'validate']);
  const id = text(source.id, 128);
  const version = text(source.version, 128);
  const mode = source.mode === undefined ? 'enforce' : source.mode;
  if (mode !== 'enforce' && mode !== 'observe')
    throw new Error('answerValidation.mode must be enforce or observe.');
  if (typeof source.validate !== 'function')
    throw new Error('answerValidation.validate must be a function.');
  const validate = source.validate as AnswerValidationOptions<T>['validate'];
  const agentChecks = readAgentChecks(source.agentChecks);
  const supplied =
    source.limits === undefined ? {} : ownData(source.limits, Object.keys(DEFAULT_LIMITS));
  const limits: { -readonly [K in keyof typeof DEFAULT_LIMITS]: number } = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof typeof DEFAULT_LIMITS>) {
    if (Object.hasOwn(supplied, key)) {
      const value = supplied[key];
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        (key === 'timeoutMs' && value > 2147483647) ||
        // Each landing rewrites the ledger, so its cost grows with the square.
        (key === 'maxToolCalls' && value > MAX_TOOL_CALLS)
      )
        throw new Error(`answerValidation.limits.${key} must be a positive bounded integer.`);
      limits[key] = value;
    }
  }
  return Object.freeze({
    id,
    version,
    mode,
    limits: Object.freeze(limits),
    agentChecks,
    validate: (candidate: unknown, context: AnswerValidationContext) =>
      validate(candidate as Readonly<T>, context),
  });
}

function readChecks(
  value: unknown,
  config: ResolvedAnswerValidation,
  resolved: readonly string[],
): AnswerCheck[] {
  // Bound before copying. The copy rejects getters, class instances, cycles,
  // decorated arrays and values JSON would otherwise silently discard.
  const source = ownData(value, ['checks']);
  if (!Array.isArray(source.checks) || source.checks.length > config.limits.maxChecks)
    throw new Error('Invalid checks.');
  const detached = jsonCopy(source.checks, config.limits.maxChecks * 4096, false) as unknown[];
  const ids = new Set<string>();
  const refs = new Set(resolved);
  return detached.map((raw) => {
    const check = ownData(raw, ['id', 'disposition', 'reason', 'path', 'evidenceRefs']);
    const id = text(check.id, 128);
    if (
      ids.has(id) ||
      // Refused by domain, never renamed: an agent row owns this prefix.
      (config.agentChecks.length > 0 && id.startsWith(AGENT_CHECK_PREFIX)) ||
      typeof check.disposition !== 'string' ||
      !dispositions.has(check.disposition)
    )
      throw new Error('Invalid check identity or disposition.');
    ids.add(id);
    const reason = check.reason === undefined ? undefined : text(check.reason, 1024);
    const path = check.path;
    if (path !== undefined && (typeof path !== 'string' || path.length > 256))
      throw new Error('Invalid check path.');
    let evidenceRefs: string[] | undefined;
    if (check.evidenceRefs !== undefined) {
      if (!Array.isArray(check.evidenceRefs) || check.evidenceRefs.length > config.limits.maxReads)
        throw new Error('Invalid evidence references.');
      evidenceRefs = check.evidenceRefs.map((ref) => {
        if (typeof ref !== 'string' || !refs.has(ref))
          throw new Error('Unresolved evidence reference.');
        return ref;
      });
      if (new Set(evidenceRefs).size !== evidenceRefs.length)
        throw new Error('Duplicate evidence reference.');
    }
    return Object.freeze({
      id,
      disposition: check.disposition as AnswerCheck['disposition'],
      ...(reason !== undefined && { reason }),
      ...(path !== undefined && { path }),
      ...(evidenceRefs !== undefined && { evidenceRefs: Object.freeze(evidenceRefs) }),
    });
  });
}

/**
 * Validate once. Content is present only when delivery is permitted by this
 * contract. It is the exact JSON string whose detached value was checked;
 * callers must not reparse through a transforming schema or rewrite afterward.
 */
export async function executeAnswerValidation(
  raw: string,
  parser: OutputSchemaParser<unknown>,
  config: ResolvedAnswerValidation,
  store: ArtifactStore | undefined,
  scope: ArtifactScope,
  signal?: AbortSignal,
  toolCalls?: AnswerToolCallsView,
  /**
   * Builds the rows of the agent's own checks that `config.agentChecks` lists
   * (`agentChecks.ts`) from the candidate this validation delivers: the same
   * frozen value the validator receives, and its canonical JSON — the exact
   * text that would be delivered. Synchronous library code: a throw, a
   * listed check with no builder, or a row that claims `checked-pass` (an
   * agent row never verifies) makes the report `unverified` — never a pass.
   */
  buildAgentRows?: (candidate: unknown, canonical: string) => readonly AnswerCheck[],
): Promise<{ report: AnswerValidationReport; content?: string }> {
  const controller = new AbortController();
  // Detached and frozen before the callback exists: the check reads a copy of
  // this run's ledger, never the run's state.
  const calls = toolCallsView(toolCalls, config.limits.maxToolCalls);
  // A check that READ an incomplete list cannot pass on it: the verdict is
  // unverified whatever the check returned (fail closed). A check that never
  // looks at the list is not held to it.
  let toolCallsRead = false;
  const evidence = createAnswerEvidenceResolver(store, scope, config.limits, controller.signal);
  let reason: string | undefined;
  let schemaAccepted = false;
  let canonical: string | undefined;
  let candidateDigest: string | undefined;
  let checks: AnswerCheck[] = [];
  let agentRows: readonly AnswerCheck[] = [];
  let active = true;
  let stop: (() => void) | undefined;
  const abort = () => {
    reason = 'aborted';
    controller.abort();
    stop?.();
  };
  const timedOut = () => {
    reason = 'timeout';
    controller.abort();
    stop?.();
  };
  const deadline = Date.now() + config.limits.timeoutMs;
  const timer = setTimeout(timedOut, config.limits.timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const interrupted = new Promise<void>((resolve) => {
      stop = resolve;
      if (controller.signal.aborted) resolve();
    });
    const work = async () => {
      if (controller.signal.aborted) return;
      let candidate: unknown;
      try {
        if (
          raw.length > config.limits.maxCandidateBytes ||
          encoder.encode(raw).byteLength > config.limits.maxCandidateBytes
        ) {
          reason = 'candidate-limit';
          return;
        }
        candidate = applyOutputSchema(raw, parser);
      } catch {
        reason = 'schema-rejected';
        return;
      }
      try {
        candidate = jsonCopy(candidate, config.limits.maxCandidateBytes, true);
        canonical = JSON.stringify(candidate);
        schemaAccepted = true;
      } catch {
        reason = 'non-json-candidate';
        return;
      }
      // The agent's own rows judge the very candidate delivered — and fail
      // closed: a listed check that cannot produce its rows passes nothing.
      if (config.agentChecks.length > 0) {
        try {
          if (buildAgentRows === undefined) throw new Error('No builder for the listed checks.');
          const rows = Object.freeze([...buildAgentRows(candidate, canonical)]);
          // An agent row can withhold an answer and never verify one: only
          // your checks make a report pass. A row claiming to is refused.
          if (rows.some((row) => row.disposition === 'checked-pass'))
            throw new Error('An agent check never passes an answer.');
          agentRows = rows;
        } catch {
          reason = 'agent-check-error';
          return;
        }
      }
      if (Date.now() >= deadline) {
        timedOut();
        return;
      }
      try {
        const digest = await computeArtifactDigest(canonical);
        if (!active || controller.signal.aborted) return;
        candidateDigest = digest;
        const returned = await config.validate(
          candidate,
          Object.freeze({
            signal: controller.signal,
            artifacts: evidence.resolver,
            get toolCalls() {
              toolCallsRead = true;
              return calls;
            },
          }),
        );
        if (!active || controller.signal.aborted) return;
        if (Date.now() >= deadline) {
          timedOut();
          return;
        }
        try {
          checks = readChecks(returned, config, evidence.resolvedRefs());
        } catch {
          reason = 'invalid-validator-result';
        }
      } catch {
        if (active && !controller.signal.aborted) reason = 'validator-error';
      }
    };
    await Promise.race([work(), interrupted]);
  } finally {
    active = false;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    evidence.close();
    controller.abort();
  }
  // Your checks first, then the agent's: one list, one count, one status rule.
  checks = [...checks, ...agentRows];
  const failed = checks.filter((check) => check.disposition === 'checked-fail').length;
  const checked = failed + checks.filter((check) => check.disposition === 'checked-pass').length;
  const unreachable = checks.filter((check) => check.disposition === 'unreachable').length;
  const notApplicable = checks.filter((check) => check.disposition === 'not-applicable').length;
  if (!reason && evidence.failureReason()) reason = `evidence-${evidence.failureReason()}`;
  if (!reason && toolCallsRead && !calls.complete) reason = 'tool-calls-incomplete';
  if (!reason && checked === 0) reason = 'no-comparable-checks';
  if (!reason && unreachable > 0) reason = 'unreachable-checks';
  // What could not be reached never hides what was found. An agent row is
  // computed by the library on the delivered candidate, before and apart from
  // your validator, so its contradiction makes the report `failed` whatever
  // the validator did — the reason still says that (`validator-error`, a
  // timeout, …). Your own failed check is a verdict beside unreachable rows;
  // under any other reason your check did not complete, so nothing it
  // returned is one.
  const agentFailed = agentRows.some((row) => row.disposition === 'checked-fail');
  const status =
    agentFailed || (failed > 0 && (reason === undefined || reason === 'unreachable-checks'))
      ? 'failed'
      : reason !== undefined
      ? 'unverified'
      : 'passed';
  const report: AnswerValidationReport = Object.freeze({
    validatorId: config.id,
    validatorVersion: config.version,
    mode: config.mode,
    status,
    checked,
    failed,
    unreachable,
    notApplicable,
    checks: Object.freeze(checks),
    schemaAccepted,
    ...(reason !== undefined && { reason }),
    ...(candidateDigest !== undefined && { candidateDigest }),
    resolvedRefs: Object.freeze(evidence.resolvedRefs()),
  });
  const content = status === 'passed' || config.mode === 'observe' ? canonical ?? raw : undefined;
  return { report, ...(content !== undefined && { content }) };
}
