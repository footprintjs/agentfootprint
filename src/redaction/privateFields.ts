import type { RedactionPolicy } from 'footprintjs';
import { copyJson, jsonBytes, ownData, readOwnList } from '../lib/boundedJson.js';

/** Raw checkpoint carrier; its native record anchor is always private. */
export const PRIVATE_FIELDS_KEY = 'privateRecordFields';

/** Library working carriers only; never caller-selected keys or event policy. */
export const PRIVATE_FIELD_ROOTS = Object.freeze([
  'argumentAsk',
  'argumentAnswersKept',
  'argumentResolutions',
  'pausedCheckInArgs',
] as const);
export type PrivateFieldRoot = (typeof PRIVATE_FIELD_ROOTS)[number];

export interface PrivateRecordFields {
  readonly version: 1;
  /** Whole-carrier fallback when an exact private field cannot be represented. */
  readonly keys: readonly PrivateFieldRoot[];
  readonly fields: Readonly<Partial<Record<PrivateFieldRoot, readonly string[]>>>;
}

export const PRIVATE_FIELD_LIMITS = Object.freeze({ paths: 1024, bytes: 65536, path: 512 });
const roots: ReadonlySet<string> = new Set(PRIVATE_FIELD_ROOTS);
const index = '(?:0|[1-9][0-9]{0,4})';
const forms: Readonly<Partial<Record<PrivateFieldRoot, RegExp>>> = {
  argumentAsk: new RegExp(`^progress\\.${index}\\.(?:answer|fills)$`),
  argumentAnswersKept: new RegExp(`^${index}\\.value$`),
  argumentResolutions: new RegExp(`^${index}\\.fills\\.${index}\\.value$`),
};
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const privateNamePunctuation = new Set(['.', '\\', '/', ':', '*', '[', ']']);
type Fields = Partial<Record<PrivateFieldRoot, readonly string[]>>;

function invalid(): never {
  throw new TypeError('Invalid private record field carrier.');
}
function rootOf(value: unknown): PrivateFieldRoot {
  if (typeof value !== 'string' || !roots.has(value)) invalid();
  return value as PrivateFieldRoot;
}
function pathFits(root: PrivateFieldRoot, value: string): boolean {
  return (
    value.length <= PRIVATE_FIELD_LIMITS.path &&
    (root === 'pausedCheckInArgs'
      ? value.length > 0 &&
        [...value].length <= 256 &&
        [...value].every(
          (character) =>
            character.charCodeAt(0) > 31 &&
            character.charCodeAt(0) !== 127 &&
            !privateNamePunctuation.has(character),
        )
      : forms[root]?.test(value) === true) &&
    !(root === 'pausedCheckInArgs' && reserved.has(value))
  );
}
function freeze(keys: readonly PrivateFieldRoot[], fields: Fields): PrivateRecordFields {
  return Object.freeze({
    version: 1,
    keys: Object.freeze([...keys]),
    fields: Object.freeze(
      Object.fromEntries(
        Object.entries(fields).map(([key, paths]) => [key, Object.freeze([...(paths ?? [])])]),
      ),
    ),
  });
}
const EMPTY = freeze([], {});
const WHOLE = freeze(PRIVATE_FIELD_ROOTS, {});

/** Closed own-data schema. No mode or caller-policy declaration can ride this value. */
export function readPrivateRecordFields(value: unknown): PrivateRecordFields {
  try {
    const record = ownData(copyJson(value, PRIVATE_FIELD_LIMITS.bytes, false, 5), [
      'version',
      'keys',
      'fields',
    ]);
    if (record.version !== 1 || !Array.isArray(record.keys)) invalid();
    const keys = record.keys.map(rootOf);
    if (keys.length > PRIVATE_FIELD_ROOTS.length || new Set(keys).size !== keys.length) invalid();
    const rawFields = ownData(record.fields, PRIVATE_FIELD_ROOTS);
    const fields: Fields = {};
    let count = 0;
    for (const [key, raw] of Object.entries(rawFields)) {
      const root = rootOf(key);
      if (keys.includes(root) || !Array.isArray(raw) || raw.length === 0) invalid();
      const paths = raw as unknown[];
      count += paths.length;
      if (
        count > PRIVATE_FIELD_LIMITS.paths ||
        paths.some((path) => typeof path !== 'string' || !pathFits(root, path)) ||
        new Set(paths).size !== paths.length
      )
        invalid();
      fields[root] = paths as string[];
    }
    return freeze(keys, fields);
  } catch {
    return invalid();
  }
}

/** Additive selectors only: a bound promotes fixed carriers, never drops privacy. */
export function addPrivateRecordFields(
  prior: PrivateRecordFields | undefined,
  selections: readonly { readonly root: PrivateFieldRoot; readonly path: string }[],
): PrivateRecordFields {
  try {
    const current = prior === undefined ? EMPTY : readPrivateRecordFields(prior);
    const selected = readOwnList(selections, PRIVATE_FIELD_LIMITS.paths + 1) ?? invalid();
    // Unread selections may belong to any closed root. Mask those carriers only.
    if (selected.unread > 0) return WHOLE;
    const keys = new Set(current.keys);
    const fields: Fields = { ...current.fields };
    for (const raw of selected.entries) {
      const selection = ownData(raw, ['root', 'path']);
      const root = rootOf(selection.root);
      if (typeof selection.path !== 'string') invalid();
      if (keys.has(root)) continue;
      const paths = [...new Set([...(fields[root] ?? []), selection.path])];
      fields[root] = paths;
      const candidate = { version: 1, keys: [...keys], fields };
      const count = Object.values(fields).reduce((sum, list) => sum + (list?.length ?? 0), 0);
      if (
        !pathFits(root, selection.path) ||
        count > PRIVATE_FIELD_LIMITS.paths ||
        jsonBytes(candidate) > PRIVATE_FIELD_LIMITS.bytes
      ) {
        keys.add(root);
        delete fields[root];
        // A new whole-root key may itself cross an already nearly-full budget.
        if (jsonBytes({ version: 1, keys: [...keys], fields }) > PRIVATE_FIELD_LIMITS.bytes)
          return WHOLE;
      }
    }
    return freeze([...keys], fields);
  } catch {
    return invalid();
  }
}

/** Native selectors only. Callers union these with their independent caller policy. */
export function privateRecordPolicy(carrier: PrivateRecordFields): RedactionPolicy | undefined {
  const current = readPrivateRecordFields(carrier);
  if (current.keys.length === 0 && Object.keys(current.fields).length === 0) return undefined;
  return {
    ...(current.keys.length > 0 && { keys: [...current.keys] }),
    ...(Object.keys(current.fields).length > 0 && {
      fields: Object.fromEntries(
        Object.entries(current.fields).map(([key, paths]) => [key, [...(paths ?? [])]]),
      ),
    }),
  };
}

/** Shared native components join admitted names; no component can remove another's. */
export function mergePrivateRecordFields(
  left: PrivateRecordFields,
  right: PrivateRecordFields,
): PrivateRecordFields {
  const a = readPrivateRecordFields(left),
    b = readPrivateRecordFields(right);
  const keys = [...new Set([...a.keys, ...b.keys])];
  const fields: Fields = {};
  let count = 0;
  for (const root of PRIVATE_FIELD_ROOTS) {
    if (keys.includes(root)) continue;
    const paths = [...new Set([...(a.fields[root] ?? []), ...(b.fields[root] ?? [])])];
    if (paths.length === 0) continue;
    fields[root] = paths;
    count += paths.length;
  }
  const joined = freeze(keys, fields);
  return count > PRIVATE_FIELD_LIMITS.paths || jsonBytes(joined) > PRIVATE_FIELD_LIMITS.bytes
    ? WHOLE
    : joined;
}
