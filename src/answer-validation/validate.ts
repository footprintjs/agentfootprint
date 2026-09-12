/** One explicit JSON-answer validation; the runner owns when to invoke it. */
import { applyOutputSchema, type OutputSchemaParser } from '../core/outputSchema.js';
import type { ArtifactScope, ArtifactStore } from '../artifacts/types.js';
import { computeArtifactDigest } from '../artifacts/payload.js';
import { createAnswerEvidenceResolver } from './evidence.js';
import type {
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
});
const encoder = new TextEncoder();
const dispositions = new Set(['checked-pass', 'checked-fail', 'not-applicable', 'unreachable']);

function ownData(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new Error('Expected a plain data object.');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (allowed && !allowed.includes(key)))
      throw new Error('Unknown property.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new Error('Expected an enumerable data property.');
    Object.defineProperty(result, key, { value: descriptor.value, enumerable: true });
  }
  return result;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    throw new Error('Expected bounded non-empty text.');
  return value;
}

/** Validate and snapshot an authored contract once, before running an agent. */
export function resolveAnswerValidation<T = unknown>(
  options: AnswerValidationOptions<T>,
): ResolvedAnswerValidation {
  const source = ownData(options, ['id', 'version', 'mode', 'limits', 'validate']);
  const id = text(source.id, 128);
  const version = text(source.version, 128);
  const mode = source.mode === undefined ? 'enforce' : source.mode;
  if (mode !== 'enforce' && mode !== 'observe')
    throw new Error('answerValidation.mode must be enforce or observe.');
  if (typeof source.validate !== 'function')
    throw new Error('answerValidation.validate must be a function.');
  const validate = source.validate as AnswerValidationOptions<T>['validate'];
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
        (key === 'timeoutMs' && value > 2147483647)
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
    validate: (candidate: unknown, context: AnswerValidationContext) =>
      validate(candidate as Readonly<T>, context),
  });
}

/** JSON copy without invoking toJSON/getters or silently dropping data. */
function jsonCopy(value: unknown, maxBytes: number, freeze: boolean): unknown {
  let budget = maxBytes;
  const ancestors = new Set<object>();
  const spend = (bytes: number) => {
    budget -= bytes;
    if (budget < 0) throw new Error('JSON byte limit.');
  };
  const string = (item: string) => {
    if (item.length > budget) throw new Error('JSON byte limit.');
    spend(encoder.encode(JSON.stringify(item)).byteLength);
  };
  const copy = (item: unknown, depth: number): unknown => {
    if (depth > 100) throw new Error('JSON nesting limit.');
    if (item === null) {
      spend(4);
      return null;
    }
    if (typeof item === 'string') {
      string(item);
      return item;
    }
    if (typeof item === 'boolean') {
      spend(item ? 4 : 5);
      return item;
    }
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0))
        throw new Error('Non-lossless JSON number.');
      spend(JSON.stringify(item).length);
      return item;
    }
    if (typeof item !== 'object') throw new Error('Non-JSON value.');
    if (ancestors.has(item)) throw new Error('Cyclic JSON value.');
    ancestors.add(item);
    spend(2);
    let output: unknown;
    if (Array.isArray(item)) {
      if (Object.getPrototypeOf(item) !== Array.prototype)
        throw new Error('Non-JSON array prototype.');
      if (item.length > budget + 1) throw new Error('JSON byte limit.');
      const keys = Reflect.ownKeys(item);
      if (keys.length !== item.length + 1) throw new Error('Sparse or decorated array.');
      const result: unknown[] = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor))
          throw new Error('Sparse or accessor array.');
        if (index) spend(1);
        result.push(copy(descriptor.value, depth + 1));
      }
      output = result;
    } else {
      const fields = ownData(item);
      const result: Record<string, unknown> = {};
      let index = 0;
      for (const key of Object.keys(fields)) {
        if (index++) spend(1);
        string(key);
        spend(1);
        Object.defineProperty(result, key, {
          value: copy(fields[key], depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      output = result;
    }
    ancestors.delete(item);
    return freeze ? Object.freeze(output) : output;
  };
  return copy(value, 0);
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
): Promise<{ report: AnswerValidationReport; content?: string }> {
  const controller = new AbortController();
  const evidence = createAnswerEvidenceResolver(store, scope, config.limits, controller.signal);
  let reason: string | undefined;
  let schemaAccepted = false;
  let canonical: string | undefined;
  let candidateDigest: string | undefined;
  let checks: AnswerCheck[] = [];
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
          Object.freeze({ signal: controller.signal, artifacts: evidence.resolver }),
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
  const failed = checks.filter((check) => check.disposition === 'checked-fail').length;
  const checked = failed + checks.filter((check) => check.disposition === 'checked-pass').length;
  const unreachable = checks.filter((check) => check.disposition === 'unreachable').length;
  const notApplicable = checks.filter((check) => check.disposition === 'not-applicable').length;
  if (!reason && evidence.failureReason()) reason = `evidence-${evidence.failureReason()}`;
  if (!reason && checked === 0) reason = 'no-comparable-checks';
  if (!reason && unreachable > 0) reason = 'unreachable-checks';
  const status = reason ? 'unverified' : failed > 0 ? 'failed' : 'passed';
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
