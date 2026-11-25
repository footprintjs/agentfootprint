/**
 * recordingParts/format — the stored shape of a recording saved in parts, and
 * the one check that admits an index read back from a store.
 *
 * Role:  Codec. Names the formats, the limits and the index's fields; admits
 *        an untrusted index (`readRecordingIndex`) or refuses it whole.
 * Reads: its argument.
 * Emits: N/A.
 *
 * The index is the one artifact a receipt names. It carries no recorded value:
 * refs, byte lengths and SHA-256 digests of every part, every invocation's
 * address and the part that holds it, and the aliases. Everything a reader
 * decides before reading bytes is decided from it, so everything in it is
 * checked here before anything else trusts it.
 */

import { buildRuntimeStageId, isExecutionKey, parseRuntimeStageId } from 'foottrace';
import { isArtifactRef } from '../../../artifacts/naming.js';

/** The format marker of an index. */
export const RECORDING_INDEX_FORMAT = 'agentfootprint.recording.index.v1';

/** The format marker of a part (the base part and every invocation part). */
export const RECORDING_PART_FORMAT = 'agentfootprint.recording.part.v1';

/**
 * The size a part is filled to: 1 MiB of JSON text. A part holds whole
 * results only, so one result bigger than this is a part of its own.
 */
export const RECORDING_PART_TARGET_BYTES = 1024 * 1024;

/**
 * The bounds of an index. The counts and path bounds equal the ones the lazy
 * viewer applies to a whole recording, so a recording the viewer would refuse
 * as too big is not split into one it cannot open either.
 */
export const RECORDING_PARTS_LIMITS = Object.freeze({
  invocations: 4096,
  parts: 4096,
  indexBytes: 2 * 1024 * 1024,
  pathSegments: 128,
  pathChars: 8192,
  nameChars: 4096,
  /** Tree nodes and result entries one walk may visit. */
  visits: 200_000,
});

/** One stored artifact, as the index names it. */
export interface StoredPartEntry {
  readonly ref: string;
  /** UTF-8 bytes of the stored JSON text. */
  readonly bytes: number;
  /** `sha-256:<hex>` over those bytes, the store's own spelling. */
  readonly digest: string;
}

/** One invocation part: the stored artifact and how many results it holds. */
export interface IndexPartEntry extends StoredPartEntry {
  readonly results: number;
}

/** One recorded invocation. `part` is `null` when the tree mounts it but no result was recorded. */
export interface IndexInvocation {
  /** The execution key: the `subflowResults` key and the mount's runtime stage id. */
  readonly key: string;
  /** Mount keys from the root to this invocation; the last one is `key`. */
  readonly path: readonly string[];
  readonly subflowId: string;
  readonly part: number | null;
  /** Compact JSON bytes of this one result; present exactly when `part` is a number. */
  readonly bytes?: number;
}

/** A path alias of `subflowResults`: proven equal to an execution key's result, or stored itself. */
export type IndexAlias =
  | { readonly name: string; readonly key: string }
  | { readonly name: string; readonly part: number };

/** A result no mount reaches: stored, readable whole, not addressable by the viewer. */
export interface IndexUnmounted {
  readonly key: string;
  readonly part: number;
}

/** An admitted index. */
export interface RecordingIndex {
  readonly format: typeof RECORDING_INDEX_FORMAT;
  /** The run the recording was filed for (`origin.runId`). */
  readonly runId?: string;
  /** `snapshot.runId`, the engine's executor id. */
  readonly snapshotRunId?: string;
  readonly packed: boolean;
  /** `false` when the tree and the results disagree, so the lazy viewer would refuse the whole too. */
  readonly complete: boolean;
  /** Whether the recorded snapshot had a `subflowResults` object at all. */
  readonly hasSubflowResults: boolean;
  readonly base: StoredPartEntry;
  readonly parts: readonly IndexPartEntry[];
  readonly invocations: readonly IndexInvocation[];
  readonly aliases: readonly IndexAlias[];
  readonly unmounted: readonly IndexUnmounted[];
}

/** Everything in an index except the refs the store mints. */
export type IndexDraft = Omit<RecordingIndex, 'format' | 'base' | 'parts'> & {
  readonly base: Omit<StoredPartEntry, 'ref'>;
  readonly parts: readonly Omit<IndexPartEntry, 'ref'>[];
};

const DIGEST = /^sha-256:[0-9a-f]{64}$/;

/**
 * A runtime stage id that names one execution, spelled exactly as the id
 * codec builds it: the same rule the lazy viewer applies to every address.
 */
export function isCanonicalExecutionKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.length === 0) return false;
  if (key.length > RECORDING_PARTS_LIMITS.nameChars || !isExecutionKey(key)) return false;
  try {
    const parsed = parseRuntimeStageId(key);
    return (
      parsed.stageId.length > 0 &&
      Number.isSafeInteger(parsed.executionIndex) &&
      parsed.executionIndex >= 0 &&
      buildRuntimeStageId(parsed.stageId, parsed.executionIndex, parsed.subflowPath) === key
    );
  } catch {
    return false;
  }
}

/** A plain JSON object (no class instance, no accessor reachable through JSON.parse). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** The own data value at `key`, never through a getter or the prototype. */
export function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/** An own data property, even for a key such as `__proto__` (a plain assignment would set the prototype). */
export function assign(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** A bounded, non-empty name. */
export function isName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= RECORDING_PARTS_LIMITS.nameChars
  );
}

/** The path key the viewer uses: length-prefixed, so no segment spelling can collide. */
export function pathKey(path: readonly string[]): string {
  let key = '';
  for (const segment of path) key += `${segment.length}:${segment}`;
  return key;
}

class Refused extends Error {}

function refuse(): never {
  throw new Refused();
}

/** The object's own keys, each one allowed, every required one present. */
function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(value)) refuse();
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  if (Object.getOwnPropertySymbols(value).length > 0) refuse();
  for (const key of keys) {
    if (!allowed.has(key)) refuse();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) refuse();
  }
  for (const key of required) if (!keys.includes(key)) refuse();
  return value;
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) refuse();
  return value;
}

function list(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) refuse();
  return value as readonly unknown[];
}

function stored(value: unknown, extra: readonly string[] = []): StoredPartEntry {
  const row = fields(value, ['ref', 'bytes', 'digest', ...extra]);
  if (!isArtifactRef(row.ref) || typeof row.digest !== 'string' || !DIGEST.test(row.digest)) {
    refuse();
  }
  return { ref: row.ref, bytes: count(row.bytes), digest: row.digest };
}

function ordinal(value: unknown, parts: number): number {
  const at = count(value);
  if (at >= parts) refuse();
  return at;
}

function optionalName(row: Record<string, unknown>, key: string): string | undefined {
  const value = ownValue(row, key);
  if (value === undefined) return undefined;
  if (!isName(value)) refuse();
  return value;
}

/**
 * Admit an index read back from a store, or refuse it whole (`undefined`).
 *
 * Checked: the exact field set at every level, plain data only; refs in the
 * artifact grammar; digests in `sha-256:<hex>`; byte counts; part ordinals in
 * range; unique, canonical execution keys; bounded paths that end at their key
 * and whose every prefix is itself an invocation; aliases that name a stored
 * key or a part; per-part result counts that match the invocations and
 * unmounted results that name the part; `complete` that admits what is listed.
 */
export function readRecordingIndex(value: unknown): RecordingIndex | undefined {
  try {
    return admit(value);
  } catch (err) {
    if (err instanceof Refused) return undefined;
    throw err;
  }
}

function admit(value: unknown): RecordingIndex {
  const limits = RECORDING_PARTS_LIMITS;
  const root = fields(
    value,
    [
      'format',
      'packed',
      'complete',
      'hasSubflowResults',
      'base',
      'parts',
      'invocations',
      'aliases',
      'unmounted',
    ],
    ['runId', 'snapshotRunId'],
  );
  if (root.format !== RECORDING_INDEX_FORMAT) refuse();
  const runId = optionalName(root, 'runId');
  const snapshotRunId = optionalName(root, 'snapshotRunId');
  const { packed, complete, hasSubflowResults } = root;
  if (
    typeof packed !== 'boolean' ||
    typeof complete !== 'boolean' ||
    typeof hasSubflowResults !== 'boolean'
  ) {
    refuse();
  }
  const base = stored(root.base);
  const parts = list(root.parts, limits.parts).map((row): IndexPartEntry => {
    const entry = stored(row, ['results']);
    return { ...entry, results: count((row as Record<string, unknown>).results) };
  });
  const refs = new Set([base.ref, ...parts.map((part) => part.ref)]);
  if (refs.size !== parts.length + 1) refuse();

  const perPart = new Array<number>(parts.length).fill(0);
  const keys = new Set<string>();
  const paths = new Set<string>();
  const invocations = list(root.invocations, limits.invocations).map((item): IndexInvocation => {
    const row = fields(item, ['key', 'path', 'subflowId', 'part'], ['bytes']);
    if (!isCanonicalExecutionKey(row.key) || keys.has(row.key) || !isName(row.subflowId)) refuse();
    const path = list(row.path, limits.pathSegments);
    let chars = 0;
    for (const segment of path) {
      if (!isCanonicalExecutionKey(segment)) refuse();
      chars += segment.length;
    }
    if (path.length === 0 || chars > limits.pathChars || path[path.length - 1] !== row.key) {
      refuse();
    }
    keys.add(row.key);
    paths.add(pathKey(path as string[]));
    if (row.part === null) {
      if (ownValue(row, 'bytes') !== undefined) refuse();
      return { key: row.key, path: path as string[], subflowId: row.subflowId, part: null };
    }
    const part = ordinal(row.part, parts.length);
    perPart[part] = (perPart[part] ?? 0) + 1;
    return {
      key: row.key,
      path: path as string[],
      subflowId: row.subflowId,
      part,
      bytes: count(row.bytes),
    };
  });
  for (const invocation of invocations) {
    for (let depth = 1; depth < invocation.path.length; depth++) {
      if (!paths.has(pathKey(invocation.path.slice(0, depth)))) refuse();
    }
  }

  const storedKeys = new Set(invocations.filter((i) => i.part !== null).map((i) => i.key));
  const unmounted = list(root.unmounted, limits.invocations).map((item): IndexUnmounted => {
    const row = fields(item, ['key', 'part']);
    if (!isCanonicalExecutionKey(row.key) || keys.has(row.key)) refuse();
    keys.add(row.key);
    storedKeys.add(row.key);
    const part = ordinal(row.part, parts.length);
    perPart[part] = (perPart[part] ?? 0) + 1;
    return { key: row.key, part };
  });

  const names = new Set<string>();
  const aliases = list(root.aliases, limits.invocations).map((item): IndexAlias => {
    const row = fields(item, ['name'], ['key', 'part']);
    if (!isName(row.name) || names.has(row.name) || keys.has(row.name)) refuse();
    names.add(row.name);
    const key = ownValue(row, 'key');
    const part = ownValue(row, 'part');
    if ((key === undefined) === (part === undefined)) refuse();
    if (key !== undefined) {
      if (typeof key !== 'string' || !storedKeys.has(key)) refuse();
      return { name: row.name, key };
    }
    return { name: row.name, part: ordinal(part, parts.length) };
  });

  parts.forEach((part, at) => {
    if (part.results !== perPart[at]) refuse();
  });
  if (complete && (unmounted.length > 0 || invocations.some((i) => i.part === null))) refuse();
  if (!hasSubflowResults && (parts.length > 0 || aliases.length > 0)) refuse();

  return {
    format: RECORDING_INDEX_FORMAT,
    ...(runId !== undefined && { runId }),
    ...(snapshotRunId !== undefined && { snapshotRunId }),
    packed,
    complete,
    hasSubflowResults,
    base,
    parts,
    invocations,
    aliases,
    unmounted,
  };
}
