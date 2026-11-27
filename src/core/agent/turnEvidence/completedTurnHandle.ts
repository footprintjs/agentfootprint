import type { LogAddress } from 'foottrace';

import { admitCompletedTurn } from './admitCompletedTurn.js';
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

type Source =
  | { readonly kind: 'live'; readonly recording: TurnEvidenceSource }
  | {
      readonly kind: 'saved';
      readonly receiptRef: string;
      readonly redeem: (ref: string) => Promise<
        | {
            readonly ref: string;
            readonly originRunId: string;
            readonly recording: TurnEvidenceSource;
          }
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

function sameLog(candidate: unknown, expected: LogAddress): boolean {
  if (!isRecord(candidate) || candidate.logRunId !== expected.logRunId) return false;
  const path = candidate.drillPath;
  return (
    Array.isArray(path) &&
    path.length === expected.drillPath.length &&
    expected.drillPath.every((segment, index) => segment === path[index])
  );
}

type TurnRead =
  | { readonly status: 'ready'; readonly turn: RecordedTurn }
  | { readonly status: 'turn-unavailable' | 'coverage-work-limit' | 'recording-too-large' };

const unavailable = Object.freeze({ status: 'turn-unavailable' } as const);

async function redeemExact(
  source: Source,
  runId: string,
): Promise<TurnEvidenceSource | 'too-large' | undefined> {
  if (source.kind === 'live') return source.recording;
  const redeemed = await source.redeem(source.receiptRef);
  if (redeemed?.ref !== source.receiptRef) return undefined;
  if ('status' in redeemed) return redeemed.status;
  return redeemed.originRunId === runId ? redeemed.recording : undefined;
}

/** @internal The only reader of a held turn. Refusals carry no facts about the turn. */
export async function readCompletedTurn(
  owner: object,
  handle: CompletedAgentTurn | undefined,
  node?: CompletedTurnNode,
): Promise<TurnRead> {
  const binding = handle === undefined ? undefined : bindings.get(handle);
  if (binding === undefined || binding.owner !== owner) return unavailable;
  const { origin, scope, source, allowed } = binding;
  try {
    if (
      node !== undefined &&
      (node.runId !== origin.runId || !sameLog(node.logAddress, origin.logAddress))
    )
      return unavailable;
    if (!(await allowed(scope))) return unavailable;
    const recording = await redeemExact(source, origin.runId);
    if (recording === undefined || !(await allowed(scope))) return unavailable;
    if (recording === 'too-large') return { status: 'recording-too-large' };
    const { snapshot } = recording;
    if (
      !isRecord(snapshot) ||
      snapshot.runId !== origin.engineRunId ||
      !sameLog(snapshot.logAddress, origin.logAddress)
    )
      return unavailable;
    return admitCompletedTurn({ events: recording.events, snapshot }, origin.runId, origin.resumed);
  } catch {
    return unavailable;
  }
}
