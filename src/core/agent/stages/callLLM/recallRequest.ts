import { matchesPreparedData } from '../../../../lib/matchesPreparedData.js';
import {
  observeRequestAttempts,
  type RequestAttemptObservation,
} from '../../../../provider-contract/requestObserver.js';
import type { LLMCallHooks, LLMMessage, LLMRequest } from '../../../../provider-contract/types.js';
import type { InjectionRecord } from '../../../../recorders/core/types.js';
import { isPlaceholder } from '../../../../redaction/marker.js';
import { contributingPieces, joinSystemPrompt } from '../../composeRequest.js';
import type { RecallRequestSummary } from '../../honesty/retrievalRequests.js';
import { sameReplayProjection } from '../../requestTurn/state.js';

type Recall = RecallRequestSummary['exposure'];
type SystemPiece = Pick<
  InjectionRecord,
  'source' | 'rawContent' | 'sourceId' | 'rankPosition' | 'retrievalScore'
>;
interface RequestProof {
  readonly inclusion: Recall;
  readonly candidateCount?: number;
}
const UNKNOWN: RequestProof = { inclusion: 'unknown' };
const MAX_ATTEMPTS = 64;
const MAX_MESSAGES = 512;
const requestFields = new Set<keyof LLMRequest>([
  'systemPrompt',
  'messages',
  'tools',
  'model',
  'temperature',
  'maxTokens',
  'stop',
  'signal',
  'cacheMarkers',
  'thinking',
  'toolChoice',
  'outputFormat',
]);

function isRecall(source: string | undefined): boolean {
  return source === 'memory' || source === 'rag';
}

function combine(left: Recall, right: Recall): Recall {
  if (left === 'present' || right === 'present') return 'present';
  return left === 'unknown' || right === 'unknown' ? 'unknown' : 'absent';
}

function agree(first: RequestProof, second: RequestProof): RequestProof {
  if (first.inclusion !== second.inclusion) return UNKNOWN;
  return first.candidateCount === second.candidateCount ? first : { inclusion: first.inclusion };
}

/** The system slot carries rank/score only for a library-attributed candidate. */
function rankedPieceCount(pieces: readonly SystemPiece[]): number | undefined {
  if (pieces.length === 0 || pieces.length > MAX_MESSAGES) return undefined;
  const ids = new Set<string>();
  for (const { sourceId, rankPosition, retrievalScore } of pieces) {
    if (
      typeof sourceId !== 'string' ||
      sourceId.length === 0 ||
      isPlaceholder(sourceId) ||
      typeof rankPosition !== 'number' ||
      rankPosition < 1 ||
      !Number.isSafeInteger(rankPosition) ||
      !Number.isFinite(retrievalScore) ||
      ids.has(sourceId)
    )
      return undefined;
    ids.add(sourceId);
  }
  return ids.size;
}

/** Compare the known composition at the port without looking for text fragments. */
function recallOf(
  pieces: readonly SystemPiece[],
  history: readonly LLMMessage[],
  wire: readonly LLMMessage[],
  historyPositions?: readonly (number | undefined)[],
  fullSystem = joinSystemPrompt(pieces),
) {
  let withoutRecall: string | undefined;
  const recalledPieces = contributingPieces(pieces).filter(
    (piece) => isRecall(piece.source) && !isPlaceholder(piece.rawContent),
  );
  const systemRecall = recalledPieces.length > 0;
  const missingSystemRecall = pieces.some(
    (piece) =>
      typeof piece.source !== 'string' ||
      isPlaceholder(piece.source) ||
      (isRecall(piece.source) &&
        (piece.rawContent === undefined || isPlaceholder(piece.rawContent))),
  );
  let ordinaryRecall: Recall = 'absent';
  if (wire.length > MAX_MESSAGES || history.length > MAX_MESSAGES) {
    ordinaryRecall = 'unknown';
  } else {
    for (const [index, source] of history.entries()) {
      const origin = source.injectedBy;
      if (origin === undefined) continue;
      if (typeof origin?.flavor !== 'string' || isPlaceholder(origin.flavor)) {
        ordinaryRecall = combine(ordinaryRecall, 'unknown');
        continue;
      }
      if (!isRecall(origin.flavor)) continue;
      const at = historyPositions === undefined ? index : historyPositions.indexOf(index);
      const sent = wire[at];
      ordinaryRecall = combine(
        ordinaryRecall,
        sent !== undefined &&
          sent.role === source.role &&
          sent.content === source.content &&
          !isPlaceholder(source.content)
          ? 'present'
          : 'unknown',
      );
    }
  }

  const attributedCount = missingSystemRecall ? undefined : rankedPieceCount(recalledPieces);

  return (request: LLMRequest, prepared: boolean): RequestProof => {
    try {
      // An extra field may be a host cache handle or another content carrier.
      const fields = Object.getOwnPropertyDescriptors(request);
      const opaque = Reflect.ownKeys(fields).some((key) => {
        const field = fields[key as keyof typeof fields];
        return !requestFields.has(key as keyof LLMRequest) || !field || !('value' in field);
      });
      const system = fields.systemPrompt?.value ?? '';
      let systemProof: Recall = 'unknown';
      if (system === fullSystem && systemRecall) {
        systemProof = 'present';
      } else if (!missingSystemRecall) {
        if (system === fullSystem || system === '') systemProof = 'absent';
        else if (systemRecall) {
          withoutRecall ??= joinSystemPrompt(pieces.filter((piece) => !isRecall(piece.source)));
          if (system === withoutRecall) systemProof = 'absent';
        }
      }
      const messages: unknown = fields.messages?.value;
      // An approved replay retirement may change thinking metadata only.
      const messageProof =
        wire.length <= MAX_MESSAGES &&
        Array.isArray(messages) &&
        messages.length === wire.length &&
        (prepared
          ? sameReplayProjection(wire, messages)
          : wire.every((message, i) => matchesPreparedData(message, messages[i])))
          ? ordinaryRecall
          : 'unknown';
      const inclusion = combine(combine(systemProof, messageProof), opaque ? 'unknown' : 'absent');
      if (
        !opaque &&
        messageProof === 'absent' &&
        systemProof === 'present' &&
        attributedCount !== undefined
      )
        return { inclusion, candidateCount: attributedCount };
      return { inclusion };
    } catch {
      return UNKNOWN;
    }
  };
}

interface Attempt {
  readonly parent?: symbol;
  proof: RequestProof;
  prepared: boolean;
  pendingChildren: number;
  hasChild: boolean;
  redirected: boolean;
  childResponses: number;
  childResponse: RequestProof;
  incomplete: boolean;
}

/** Scope evidence to this ReAct call. Neither prompt text nor attempt objects are committed. */
export function trackRecallRequests(
  systemPieces: readonly SystemPiece[],
  history: readonly LLMMessage[],
  wire: readonly LLMMessage[],
  historyPositions?: readonly (number | undefined)[],
  fullSystem?: string,
) {
  const proof = recallOf(systemPieces, history, wire, historyPositions, fullSystem);
  const attempts = new Map<symbol, Attempt>();
  let observed = 0;
  let exposure: Recall = 'absent';
  let accepted = UNKNOWN;
  let committedProviderResponse = false;

  function observe(event: RequestAttemptObservation): void {
    if (event.kind === 'start') {
      const parent = event.parent === undefined ? undefined : attempts.get(event.parent);
      if (parent !== undefined) {
        parent.hasChild = true;
        parent.pendingChildren++;
      }
      if (observed >= MAX_ATTEMPTS || (event.parent !== undefined && parent === undefined)) {
        exposure = combine(exposure, 'unknown');
        if (parent !== undefined) parent.incomplete = true;
        else if (event.parent === undefined) {
          accepted = UNKNOWN;
          committedProviderResponse = false;
        }
        return;
      }
      observed++;
      attempts.set(event.id, {
        parent: event.parent,
        proof: proof(event.request, false),
        prepared: false,
        pendingChildren: 0,
        hasChild: false,
        redirected: false,
        childResponses: 0,
        childResponse: UNKNOWN,
        incomplete: false,
      });
      return;
    }
    const attempt = attempts.get(event.id);
    if (attempt === undefined) return;
    if (event.kind === 'prepare') {
      const prepared = proof(event.request, true);
      attempt.proof = attempt.prepared ? agree(attempt.proof, prepared) : prepared;
      attempt.prepared = true;
      return;
    }
    if (event.kind === 'redirect') {
      attempt.redirected = true;
      return;
    }

    attempts.delete(event.id);
    if (!attempt.hasChild && event.settlement !== 'not-dispatched') {
      // An in-place edit after observation can have happened on either side of
      // adapter I/O. Neither version proves a known effective request.
      attempt.proof = attempt.redirected
        ? UNKNOWN
        : agree(attempt.proof, proof(event.request, attempt.prepared));
      exposure = combine(exposure, attempt.proof.inclusion);
    } else if (attempt.incomplete || attempt.pendingChildren > 0) {
      exposure = combine(exposure, 'unknown');
    }
    const answered =
      event.settlement === 'response' &&
      (attempt.hasChild
        ? attempt.childResponses === 1 && !attempt.incomplete && attempt.pendingChildren === 0
        : !attempt.redirected);
    const settled = attempt.hasChild ? attempt.childResponse : attempt.proof;
    if (attempt.parent === undefined) {
      committedProviderResponse = answered;
      accepted = answered ? settled : UNKNOWN;
      return;
    }

    const parent = attempts.get(attempt.parent);
    if (parent === undefined) return;
    parent.pendingChildren--;
    if (answered) {
      parent.childResponses++;
      parent.childResponse = settled;
    } else if (event.settlement === 'response') {
      parent.incomplete = true;
    }
  }

  return {
    hooks(hooks: LLMCallHooks): LLMCallHooks {
      return observeRequestAttempts(hooks, observe);
    },
    summary(result: 'provider' | 'local' | 'incomplete' = 'provider'): RecallRequestSummary {
      const candidateCount = accepted.inclusion === 'absent' ? 0 : accepted.candidateCount;
      return {
        accepted:
          result === 'provider' ? accepted.inclusion : result === 'local' ? 'local' : 'unknown',
        ...(result === 'provider' &&
          candidateCount !== undefined && { acceptedCount: candidateCount }),
        exposure: observed === 0 || attempts.size > 0 ? combine(exposure, 'unknown') : exposure,
        committedProviderResponse: result === 'provider' && committedProviderResponse,
      };
    },
  };
}
