import type { LogAddress } from 'foottrace';

import { admitCompletedTurn } from './admitCompletedTurn.js';
import {
  type CompletedTurnChild,
  completedTurnChild,
  completedTurnTarget,
  retainedChildResult,
  sameCompletedLog,
} from './completedTurnScope.js';
import { isRecord, type RecordedTurn } from './source.js';
import type { TurnEvidenceSource } from './types.js';

declare const completedTurnBrand: unique symbol;

/** A host-issued capability for one exact completed Agent turn. */
export interface CompletedAgentTurn {
  readonly [completedTurnBrand]: true;
}

export interface CompletedTurnNode {
  readonly id: string;
  readonly runId: string;
  readonly logAddress: LogAddress;
}

interface TurnScope {
  readonly tenant: string | undefined;
  readonly principal: string;
  readonly conversation: string;
}

interface CompletedTurnOrigin {
  readonly runId: string;
  readonly engineRunId: string;
  readonly resumed?: true;
  readonly logAddress: LogAddress;
}

interface ResolvedSource {
  readonly recording: TurnEvidenceSource;
  readonly readChild?: (path: readonly string[], signal: AbortSignal) => Promise<unknown>;
}

type Source =
  | { readonly kind: 'live'; readonly recording: TurnEvidenceSource }
  | {
      readonly kind: 'saved';
      readonly receiptRef: string;
      readonly redeem: (
        ref: string,
      ) => Promise<
        | (ResolvedSource & { readonly ref: string; readonly originRunId: string })
        | { readonly ref: string; readonly status: 'too-large' }
        | undefined
      >;
    };

interface TurnBinding {
  readonly owner: object;
  readonly scope: TurnScope;
  readonly origin: CompletedTurnOrigin;
  readonly source: Source;
  readonly allowed: (scope: TurnScope) => boolean | Promise<boolean>;
}

const bindings = new WeakMap<CompletedAgentTurn, TurnBinding>();

/** @internal The host binds a capability after admitting its own terminal invocation. */
export function issueCompletedTurn(binding: TurnBinding): CompletedAgentTurn {
  const handle = Object.freeze({}) as CompletedAgentTurn;
  const { logAddress } = binding.origin;
  bindings.set(handle, {
    ...binding,
    scope: Object.freeze({ ...binding.scope }),
    origin: Object.freeze({
      ...binding.origin,
      logAddress: Object.freeze({
        logRunId: logAddress.logRunId,
        drillPath: Object.freeze([...logAddress.drillPath]),
      }),
    }),
    source: Object.freeze({ ...binding.source }),
  });
  return handle;
}

type TurnRead =
  | {
      readonly status: 'ready';
      readonly turn: RecordedTurn;
      readonly nodeId?: string;
      readonly child?: CompletedTurnChild;
    }
  | {
      readonly status:
        | 'turn-unavailable'
        | 'coverage-work-limit'
        | 'recording-too-large'
        | 'subflow-evidence-unavailable';
    };

const unavailable = Object.freeze({ status: 'turn-unavailable' } as const);

async function redeemExact(
  source: Source,
  runId: string,
): Promise<ResolvedSource | 'too-large' | undefined> {
  if (source.kind === 'live') return source;
  const redeemed = await source.redeem(source.receiptRef);
  if (redeemed?.ref !== source.receiptRef) return undefined;
  if ('status' in redeemed) return redeemed.status;
  return redeemed.originRunId === runId ? redeemed : undefined;
}

/** @internal The only reader of a held turn. Refusals carry no facts about the turn. */
export async function readCompletedTurn(
  owner: object,
  handle: CompletedAgentTurn | undefined,
  node?: CompletedTurnNode,
  childTimeoutMs = 1000,
): Promise<TurnRead> {
  const binding = handle === undefined ? undefined : bindings.get(handle);
  if (binding === undefined || binding.owner !== owner) return unavailable;
  const { origin, scope, source, allowed } = binding;
  try {
    const target =
      node === undefined ? undefined : completedTurnTarget(node, origin.runId, origin.logAddress);
    if (node !== undefined && target === undefined) return unavailable;
    if (!(await allowed(scope))) return unavailable;
    const sourceRead = await redeemExact(source, origin.runId);
    if (sourceRead === undefined || !(await allowed(scope))) return unavailable;
    if (sourceRead === 'too-large') return { status: 'recording-too-large' };
    const { recording, readChild } = sourceRead;
    const { snapshot } = recording;
    if (
      !isRecord(snapshot) ||
      snapshot.runId !== origin.engineRunId ||
      !sameCompletedLog(snapshot.logAddress, origin.logAddress)
    )
      return unavailable;
    const admitted = admitCompletedTurn(
      { events: recording.events, snapshot },
      origin.runId,
      origin.resumed,
    );
    if (admitted.status !== 'ready' || target === undefined) return admitted;
    const mount = target.relativePath.at(-1);
    if (mount === undefined) return { ...admitted, nodeId: target.id };
    let result: unknown;
    if (source.kind === 'live') {
      result = retainedChildResult(snapshot, mount);
    } else {
      try {
        const signal = AbortSignal.timeout(childTimeoutMs);
        const opened = await readChild?.(target.relativePath, signal);
        if (!signal.aborted) result = opened;
      } catch {
        // A part that could not be read cannot supply evidence.
      }
      if (!(await allowed(scope))) return unavailable;
    }
    const child = completedTurnChild(result, mount, target.address);
    return child === undefined
      ? { status: 'subflow-evidence-unavailable' }
      : { ...admitted, nodeId: target.id, child };
  } catch {
    return unavailable;
  }
}
