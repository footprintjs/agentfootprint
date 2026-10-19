import { measureArtifactBytes } from './payload.js';
import { DETAIL_LIMITS, detailTokens } from './detailRequest.js';
import { invalidDetail, unavailableDetail } from './detailError.js';
import type {
  ArtifactDetailArgs,
  ArtifactDetailChild,
  ArtifactDetailResult,
} from './detailTypes.js';

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const container = (value: unknown): value is Record<string, unknown> | unknown[] =>
  object(value) || Array.isArray(value);
// The payload owner counts bare strings as text; a one-element JSON array also counts quotes.
const jsonBytes = (value: unknown) => measureArtifactBytes([value]) - 2;
const kind = (value: unknown): ArtifactDetailChild['type'] =>
  value === null
    ? 'null'
    : Array.isArray(value)
    ? 'array'
    : (typeof value as ArtifactDetailChild['type']);

function select(root: unknown, path: string): unknown {
  let value = root;
  for (const key of detailTokens(path)) {
    if (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)) return invalidDetail();
    if (!container(value) || !Object.hasOwn(value, key)) return unavailableDetail();
    value = Array.isArray(value) ? value[Number(key)] : value[key];
  }
  return value;
}

function childPath(parent: string, key: string): string {
  return `${parent}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function bounded<T extends ArtifactDetailResult>(value: T): T {
  if (jsonBytes(value) > DETAIL_LIMITS.outputBytes) return unavailableDetail();
  return value;
}

/** Navigate only detached ordinary JSON; this function reads no store and authorizes no claim. */
export function projectArtifactDetail(
  root: unknown,
  args: Required<ArtifactDetailArgs>,
  tool: string,
  context?: Readonly<Record<string, unknown>>,
): ArtifactDetailResult {
  const value = select(root, args.path);
  const base = {
    ref: args.ref,
    path: args.path,
    kind: kind(value),
    ...(context === undefined ? {} : { context }),
  };
  const keys = container(value) ? Object.keys(value) : [];
  const inline = { ...base, mode: 'value' as const, value, complete: true as const };
  if (
    args.offset === 0 &&
    keys.length <= args.limit &&
    jsonBytes(value) <= DETAIL_LIMITS.valueBytes &&
    jsonBytes(inline) <= DETAIL_LIMITS.outputBytes
  )
    return inline;
  if (!container(value)) {
    if (args.offset !== 0) return invalidDetail();
    return bounded({
      ...base,
      mode: 'scalar-omitted',
      omitted: true,
      scalarBytes: jsonBytes(value),
      complete: false,
      reason: 'Selected scalar exceeds the bounded view; no partial value was returned.',
    });
  }
  if (args.offset > keys.length) return invalidDetail();
  const children: ArtifactDetailChild[] = [];
  const response = (): ArtifactDetailResult => ({
    ...base,
    mode: 'children',
    children,
    offset: args.offset,
    shown: children.length,
    total: keys.length,
    complete: args.offset + children.length === keys.length,
    ...(args.offset + children.length < keys.length
      ? { nextOffset: args.offset + children.length }
      : {}),
  });
  for (const key of keys.slice(args.offset, args.offset + args.limit)) {
    const path = childPath(args.path, key);
    detailTokens(path);
    const child = Array.isArray(value) ? value[Number(key)] : value[key];
    children.push({
      path,
      type: kind(child),
      ...(container(child) ? { count: Object.keys(child).length } : {}),
      action: { tool, args: { ref: args.ref, path } },
    });
    if (jsonBytes(response()) > DETAIL_LIMITS.outputBytes - DETAIL_LIMITS.reserveBytes) {
      children.pop();
      break;
    }
  }
  if (!children.length && args.offset < keys.length) return unavailableDetail();
  return bounded(response());
}
