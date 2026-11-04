import { copyJson, ownData } from '../lib/boundedJson.js';

export interface ToolTurnBirth {
  readonly runId: string;
  readonly componentOrdinal: number;
}
export interface ToolCallOwner {
  readonly version: 1;
  readonly birth: ToolTurnBirth;
  readonly ordinal: number;
}
export interface ToolOwnerCarrier {
  readonly version: 1;
  readonly birth: ToolTurnBirth;
  readonly nextDispatch: number;
  readonly pending?: ToolCallOwner;
}
export const TOOL_OWNER_MAX_BYTES = 8_192;

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function birthOf(value: unknown): ToolTurnBirth {
  const b = ownData(value, ['runId', 'componentOrdinal']);
  if (typeof b.runId !== 'string' || b.runId.length === 0 || !integer(b.componentOrdinal))
    throw new TypeError('Invalid tool resource birth');
  return { runId: b.runId, componentOrdinal: b.componentOrdinal };
}
export function sameToolBirth(a: ToolTurnBirth, b: ToolTurnBirth): boolean {
  return a.runId === b.runId && a.componentOrdinal === b.componentOrdinal;
}

/** Admit finite data only; a reference never proves authorization or remote liveness. */
export function readToolOwner(value: unknown): ToolOwnerCarrier {
  const data = ownData(copyJson(value, TOOL_OWNER_MAX_BYTES, false, 6), [
    'version',
    'birth',
    'nextDispatch',
    'pending',
  ]);
  if (data.version !== 1 || !integer(data.nextDispatch))
    throw new TypeError('Invalid tool resource owner version or dispatch counter');
  const birth = birthOf(data.birth);
  let pending: ToolCallOwner | undefined;
  if (data.pending !== undefined) {
    const p = ownData(data.pending, ['version', 'birth', 'ordinal']);
    const pendingBirth = birthOf(p.birth);
    if (
      p.version !== 1 ||
      !integer(p.ordinal) ||
      p.ordinal >= data.nextDispatch ||
      !sameToolBirth(birth, pendingBirth)
    )
      throw new TypeError('Invalid pending tool resource owner');
    pending = { version: 1, birth: Object.freeze(pendingBirth), ordinal: p.ordinal };
  }
  return Object.freeze({
    version: 1,
    birth: Object.freeze(birth),
    nextDispatch: data.nextDispatch,
    ...(pending && { pending: Object.freeze(pending) }),
  });
}

/** Closed logical-call data used by tier views and adapter cache keys. */
export function readToolCallOwner(value: unknown): ToolCallOwner {
  const data = ownData(copyJson(value, TOOL_OWNER_MAX_BYTES, false, 4), [
    'version',
    'birth',
    'ordinal',
  ]);
  if (data.version !== 1 || !integer(data.ordinal) || data.ordinal === Number.MAX_SAFE_INTEGER)
    throw new TypeError('Invalid logical tool resource call');
  return Object.freeze({
    version: 1,
    birth: Object.freeze(birthOf(data.birth)),
    ordinal: data.ordinal,
  });
}

export function newToolOwner(entry: {
  readonly runId: string;
  readonly ordinal: number;
}): ToolOwnerCarrier {
  return readToolOwner({
    version: 1,
    birth: { runId: entry.runId, componentOrdinal: entry.ordinal },
    nextDispatch: 0,
  });
}

/** Reserve BEFORE resource effects; exhaustion is not a wrapped or reused ordinal. */
export function nextToolDispatch(value: ToolOwnerCarrier): ToolOwnerCarrier {
  const carrier = readToolOwner(value);
  if (carrier.pending !== undefined) return carrier;
  if (carrier.nextDispatch === Number.MAX_SAFE_INTEGER)
    throw new RangeError('Tool resource dispatch counter exhausted');
  return readToolOwner({
    ...carrier,
    nextDispatch: carrier.nextDispatch + 1,
    pending: { version: 1, birth: carrier.birth, ordinal: carrier.nextDispatch },
  });
}
