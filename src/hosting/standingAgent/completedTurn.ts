import type { Agent } from '../../core/Agent.js';
import type { HostedTurn } from '../../core/runnerLive.js';
import {
  type CompletedAgentTurn,
  type CompletedTurnNode,
  issueCompletedTurn,
} from '../../core/agent/turnEvidence/completedTurnHandle.js';
import { captureAddress } from '../../trace-toolpack/causeCapture.js';
import { openSavedRecording } from '../../recorders/observability/recordingParts/open.js';
import { verifyRequestIdentity } from '../identityVerification.js';
import type { ArtifactsForRequestInput } from '../types.js';
import type { ArtifactAccess } from './artifacts/access.js';
import type { Configuration } from './configuration/read.js';
import { repeatsAuthorization, singleValuedHeaders } from './identity/request.js';

/** The host's exact completed turn. Retain it only for the period your app serves evidence. */
export interface HostedCompletedAgentTurn {
  readonly agent: Agent;
  readonly runId: string;
  /** Scope an existing cause-graph node ID to this completed turn. */
  node(id: string): CompletedTurnNode;
  /** The callback supplies the current host request each time authorization is checked. */
  forRequest(
    request: () => ArtifactsForRequestInput,
    source?: 'live' | 'saved',
  ): Promise<CompletedAgentTurn | undefined>;
}

export interface CompletedTurnEvidenceOptions {
  /** Receive opted-in evidence from a verified, completed standing-agent session. */
  readonly onCompletedTurn?: (turn: HostedCompletedAgentTurn) => void | Promise<void>;
}

interface OfferOptions {
  readonly observe: NonNullable<CompletedTurnEvidenceOptions['onCompletedTurn']>;
  readonly identity: NonNullable<Configuration['identityOptions']>;
  readonly access: ArtifactAccess;
  readonly active: (agent: Agent) => boolean;
}

export function completedTurnOffer({ observe, identity, access, active }: OfferOptions) {
  return (
    agent: Agent,
    completed: HostedTurn,
    sessionId: string,
    principal: string,
    resumed?: true,
  ): void => {
    const { evidence, conversation, recording } = completed;
    const runId = conversation?.runId;
    const scope = conversation?.identity;
    const conversationId = scope?.conversationId;
    const tenant = scope?.tenant;
    const snapshot = evidence?.snapshot;
    if (runId === undefined || scope?.principal !== principal || conversationId === undefined)
      return;
    if (snapshot === null || typeof snapshot !== 'object') return;
    const engineRunId: unknown = Object.getOwnPropertyDescriptor(snapshot, 'runId')?.value;
    const nativeAddress = captureAddress(
      Object.getOwnPropertyDescriptor(snapshot, 'logAddress')?.value,
    );
    if (typeof engineRunId !== 'string' || nativeAddress === undefined || evidence === undefined)
      return;
    const logAddress = Object.freeze({
      logRunId: nativeAddress.logRunId,
      drillPath: Object.freeze([...nativeAddress.drillPath]),
    });

    async function authorized(input: ArtifactsForRequestInput): Promise<boolean> {
      if (!active(agent) || input.sessionId !== sessionId || repeatsAuthorization(input.headers))
        return false;
      const verified = await verifyRequestIdentity(
        identity,
        singleValuedHeaders(input.headers),
        input.userId,
        input.signInKey,
      );
      if (verified?.userId !== principal || !active(agent)) return false;
      const envelope = await access.storedFor(sessionId);
      if (envelope === undefined || !access.mayRedeemFrom(sessionId, envelope, verified))
        return false;
      const stored = access.storedIdentityOf(envelope, sessionId);
      return (
        active(agent) &&
        stored?.principal === principal &&
        stored.tenant === tenant &&
        stored.conversationId === conversationId
      );
    }

    const offer: HostedCompletedAgentTurn = {
      agent,
      runId,
      node: (id) => ({ id, runId, logAddress }),
      async forRequest(request, source = 'live') {
        try {
          if (source !== 'live' && source !== 'saved') return undefined;
          if (!(await authorized(request()))) return undefined;
          const common = {
            owner: agent,
            scope: { tenant, principal, conversation: conversationId },
            origin: { runId, engineRunId, logAddress, ...(resumed && { resumed }) },
            allowed: () => authorized(request()),
          };
          if (source === 'live')
            return issueCompletedTurn({ ...common, source: { kind: 'live', recording: evidence } });
          if (
            recording === undefined ||
            recording.scope.principal !== principal ||
            recording.scope.tenant !== tenant ||
            recording.scope.conversationId !== conversationId
          )
            return undefined;
          return issueCompletedTurn({
            ...common,
            source: {
              kind: 'saved',
              receiptRef: recording.receipt.ref,
              async redeem(ref) {
                const input = request();
                if (!(await authorized(input))) return undefined;
                const bound = await access.artifactsForRequest(input);
                if (!bound.bound) return undefined;
                const saved = await openSavedRecording(bound.artifacts, ref);
                if (saved.status !== 'ready')
                  return saved.reason === 'too-large' ? { ref, status: 'too-large' } : undefined;
                if (saved.runId !== runId) return undefined;
                const root = await saved.readRoot();
                if (root.status !== 'ready')
                  return root.reason === 'too-large' ? { ref, status: 'too-large' } : undefined;
                return { ref, originRunId: saved.runId, recording: root.recording };
              },
            },
          });
        } catch {
          return undefined;
        }
      },
    };
    // A host's diagnostic observer cannot replace or delay the answer.
    try {
      void Promise.resolve(observe(Object.freeze(offer))).catch(() => undefined);
    } catch {
      // A synchronous observer refusal has the same effect as a late one.
    }
  };
}
