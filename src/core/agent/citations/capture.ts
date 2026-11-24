import {
  captureDispatch,
  captureReturnedEvidence,
  finalizeEvidence,
  readResultIdentity,
} from '../../../integrity/claim-binding/capture.js';
import {
  BINDING_LIMITS,
  boundedText,
  ownConfigArray,
} from '../../../integrity/claim-binding/scope.js';
import type { CapturedDispatch, ReturnedEvidence } from '../../../integrity/claim-binding/types.js';
import { copyJson, jsonBytes } from '../../../lib/boundedJson.js';
import {
  readCallOccurrenceKey,
  storedCallOccurrenceField,
  type CallOccurrenceKey,
} from '../../../lib/callOccurrence.js';
import { plainLineProblem } from '../../../lib/plainLine.js';
import { sha256Hex } from '../../../lib/sha256.js';
import { utf8Length } from '../../../lib/utf8.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import {
  createVerificationState,
  reserveResultIdentity,
  retainVerificationEvidence,
} from '../findings/verificationState.js';
import type { AgentState } from '../types.js';
import { safeStringify } from '../validators.js';
import type { ResolvedProseCitations } from './config.js';

export interface StoredCitationSource {
  readonly callOccurrenceKey: CallOccurrenceKey;
  readonly resultId: string;
  readonly bodyDigest: string;
  readonly completeColumns?: readonly string[];
}

type CitationState = Pick<AgentState, 'citationSources' | 'resultIdentities'>;
interface CitationCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly callOccurrenceKey?: CallOccurrenceKey;
}

// A full array of these locators must fit the existing evidence snapshot limit.
const MAX_SOURCE_BYTES =
  Math.floor((BINDING_LIMITS.snapshotBytes - 1) / BINDING_LIMITS.results) - 1;

function completeColumnsOf(
  config: ResolvedProseCitations,
  toolName: string,
  served: unknown,
): readonly string[] | undefined {
  try {
    const columns = config.completeColumns?.(toolName, served);
    if (columns === undefined) return undefined;
    const names = ownConfigArray(columns, BINDING_LIMITS.results);
    const plain = names.every(
      (name) => boundedText(name) && plainLineProblem('Citation column', name) === undefined,
    );
    return plain && new Set(names).size === names.length ? (names as readonly string[]) : undefined;
  } catch {
    return undefined;
  }
}

/** One native dispatch and its return. Raw evidence lives only in this
 * closure until governed delivery proves it eligible for authorized retention. */
export function captureCitationResult(
  scope: CitationState,
  call: CitationCall,
  runId: string,
  config: ResolvedProseCitations,
) {
  const { callOccurrenceKey } = storedCallOccurrenceField(call);
  const declaration = config.verification.scopeForTool(call.toolName);
  if (callOccurrenceKey === undefined || declaration === undefined) return undefined;
  const occurrence = readCallOccurrenceKey({ callOccurrenceKey });
  let dispatch: CapturedDispatch | undefined;
  let returned: ReturnedEvidence | undefined;

  function discard() {
    dispatch = undefined;
    returned = undefined;
  }

  return {
    entered(args: unknown, priorResultId?: string) {
      try {
        const state = scope.resultIdentities ?? createVerificationState(runId);
        const reserved =
          priorResultId === undefined ? reserveResultIdentity(state, runId) : undefined;
        const identity = reserved?.identity ?? readResultIdentity(priorResultId);
        if (
          identity.namespace !== state.evidence.namespace ||
          identity.runId !== runId ||
          (reserved === undefined && identity.ordinal >= state.nextResultOrdinal)
        )
          return;
        if (reserved !== undefined) scope.resultIdentities = reserved.state;
        dispatch = captureDispatch(identity, call, args, declaration);
      } catch {
        discard();
      }
    },
    returned(original: unknown) {
      if (dispatch === undefined) return;
      try {
        const detached = copyJson(original, BINDING_LIMITS.resultBytes, true);
        const envelope = readToolResultEnvelope(detached);
        returned = captureReturnedEvidence(
          dispatch,
          envelope === undefined ? detached : envelope.content,
        );
      } catch {
        discard();
      }
    },
    finalize(served: unknown) {
      const state = scope.resultIdentities;
      const sources = scope.citationSources ?? [];
      if (
        dispatch === undefined ||
        returned === undefined ||
        state === undefined ||
        sources.length >= BINDING_LIMITS.results ||
        sources.some((source) => readCallOccurrenceKey(source) === occurrence)
      )
        return;
      try {
        const body = copyJson(served, BINDING_LIMITS.resultBytes, true);
        const access = config.verification.authorizeEvidence({ dispatch, returned, served: body });
        if (!access.resultVisible || !access.scopeVisible) return;
        const receipt = finalizeEvidence(dispatch, returned, body, { ...access, completed: true });
        if (receipt.unavailable !== undefined) return;

        const encoded = JSON.stringify(typeof body === 'string' ? body : safeStringify(body));
        if (utf8Length(encoded) > BINDING_LIMITS.resultBytes) return;
        const source: StoredCitationSource = {
          callOccurrenceKey,
          resultId: receipt.id,
          bodyDigest: sha256Hex(encoded),
        };
        const columns = completeColumnsOf(config, call.toolName, body);
        const withColumns =
          columns === undefined ? source : { ...source, completeColumns: columns };
        const locator = jsonBytes(withColumns) <= MAX_SOURCE_BYTES ? withColumns : source;
        if (jsonBytes(locator) > MAX_SOURCE_BYTES) return;
        if (state.evidence.results.some((result) => result.id === receipt.id)) return;

        const retained = retainVerificationEvidence(state, receipt);
        scope.resultIdentities = retained;
        if (retained.evidence.results.some((result) => result.id === receipt.id))
          scope.citationSources = [...sources, locator];
      } catch {
        // Evidence failure changes neither native delivery nor its disposition.
      } finally {
        discard();
      }
    },
    discard,
  };
}
