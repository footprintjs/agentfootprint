import { BINDING_LIMITS } from '../../../integrity/claim-binding/scope.js';
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import {
  compileComparisonGroups,
  type CitationComparisonGroup,
} from '../assessment/answer/citations/check/compareSources.js';
import type { CitationClaim } from '../assessment/answer/citations/check/checkClaim.js';
import {
  compileVerificationConfig,
  type CompiledVerificationConfig,
  type FindingsVerificationOptions,
} from '../findings/verificationConfig.js';

/** Opt-in prose citation presentation with explicitly authorized claim evidence. */
export interface ProseCitationOptions {
  readonly verification: FindingsVerificationOptions;
  /** Rule IDs for independent readings eligible for comparison on the same authored concept. */
  readonly comparisonGroups?: readonly CitationComparisonGroup[];
  /** Reads only the answer span without markers. Bind any host scope independently of the cited result. */
  readonly extractClaim?: (span: string) => CitationClaim | undefined;
  /** Reads an explicitly requested column from the admitted user's message. */
  readonly requestedColumn?: (message: string) => string | undefined;
  /** Declares the entire visible column set for an authorized exact result body, if known. */
  readonly completeColumns?: (toolName: string, served: unknown) => readonly string[] | undefined;
}

export interface ResolvedProseCitations extends ProseCitationOptions {
  readonly verification: CompiledVerificationConfig;
}

function optionalCallback<T>(value: unknown): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'function') throw new TypeError('Citation declarations must be functions.');
  return value as T;
}

function syncResult(value: unknown): unknown {
  if (!(value instanceof Promise)) return value;
  void Promise.prototype.then.call(value, undefined, () => undefined);
  return undefined;
}

/** Validate authoring once; no callback or function crosses a checkpoint. */
export function resolveProseCitations(options: ProseCitationOptions): ResolvedProseCitations {
  const source = ownData(options, [
    'verification',
    'comparisonGroups',
    'extractClaim',
    'requestedColumn',
    'completeColumns',
  ]);
  const verification = compileVerificationConfig(source.verification);
  const comparisonGroups =
    source.comparisonGroups === undefined
      ? undefined
      : compileComparisonGroups(source.comparisonGroups, verification.rules);
  const extract = optionalCallback<ProseCitationOptions['extractClaim']>(source.extractClaim);
  const requested = optionalCallback<ProseCitationOptions['requestedColumn']>(
    source.requestedColumn,
  );
  const columns = optionalCallback<ProseCitationOptions['completeColumns']>(source.completeColumns);
  return Object.freeze({
    verification,
    ...(comparisonGroups !== undefined && { comparisonGroups }),
    ...(extract !== undefined && {
      extractClaim: (span: string) => syncResult(extract(span)) as CitationClaim | undefined,
    }),
    ...(requested !== undefined && {
      requestedColumn(message: string) {
        if (message.length > BINDING_LIMITS.resultBytes) return undefined;
        const name = syncResult(requested(message));
        return typeof name === 'string' ? name : undefined;
      },
    }),
    ...(columns !== undefined && {
      completeColumns(toolName: string, served: unknown) {
        const names = syncResult(
          columns(toolName, copyJson(served, BINDING_LIMITS.resultBytes, true)),
        );
        return Array.isArray(names) ? (names as readonly string[]) : undefined;
      },
    }),
  });
}
