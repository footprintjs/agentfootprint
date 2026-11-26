/**
 * recordingParts/split — one recording, cut into a base part and invocation
 * parts of about 1 MiB, plus the index that names them.
 *
 * Role:  Codec. Pure: no store, no events. Returns each part's JSON text with
 *        its byte count and SHA-256, and the index without the refs a store
 *        mints. The writer puts the parts first and the index last; the
 *        reader of a whole recording runs this same split in memory, so both
 *        layouts are served by one cut.
 * Reads: its argument.
 * Emits: N/A.
 *
 * ── The cut ─────────────────────────────────────────────────────────────────
 *   • The BASE part is the recording with `snapshot.subflowResults` removed
 *     (the key itself, so a reader cannot mistake it for an empty map).
 *   • Each recorded invocation's result goes into an invocation part, in the
 *     viewer's order (`invocations.ts`). A part takes results while it stays
 *     within the target; a result larger than the target is a part of its own.
 *     Results no mount reaches follow, then path aliases that are not proven.
 *   • A path alias whose JSON text equals one stored result's text is stored
 *     only as `{ name, key }`: byte equality is the proof, so nothing the
 *     whole recording held is lost.
 *   • Format 2 (what the writer writes): a sub-flow invocation's entry and
 *     exit payloads leave the base row for the invocation's part, on proof
 *     only (`payloads.ts`). A stored payload is grouped WITH its result: the
 *     two are one unit for the target, never split across parts. A reader
 *     of a whole recording cuts format 1 (`subflowPayloads: 'in-row'`), so
 *     every read of a whole recording is what it was before format 2.
 *
 * ── Determinism ─────────────────────────────────────────────────────────────
 * Every part's text is a function of the recording, the run id and `packed`
 * alone: fixed key order, compact JSON, the wire rule for Errors
 * (`lib/wireJson.ts · toWireJson`). Two equal recordings give equal parts and
 * equal digests; their indexes differ only in the refs the store mints.
 */

import { computeArtifactDigest } from '../../../artifacts/payload.js';
import { utf8Length } from '../../../lib/utf8.js';
import { toWireJson } from '../../../lib/wireJson.js';
import {
  RECORDING_INDEX_FORMAT,
  RECORDING_INDEX_FORMAT_V1,
  RECORDING_PARTS_LIMITS,
  RECORDING_PART_TARGET_BYTES,
  assign,
  isName,
  isPlainObject,
  ownValue,
  partFormatOf,
  type IndexAlias,
  type IndexDraft,
  type IndexInvocation,
  type IndexInvocationPayloads,
  type IndexUnmounted,
  type RecordingIndex,
} from './format.js';
import { walkRecordedInvocations } from './invocations.js';
import { packPart } from './packing.js';
import { cutPayloads, type MovedPayloads, type PayloadCut } from './payloads.js';
import { RecordingSplitError } from './splitError.js';

/** One part, ready to store. */
export interface PartText {
  readonly text: string;
  /** UTF-8 bytes of `text`: what the store's `meta.bytes` must say. */
  readonly bytes: number;
  /** `sha-256:<hex>` over those bytes. */
  readonly digest: string;
}

/** A recording, cut. Store `base` and `parts`, then `recordingIndexText(draft, refs)`. */
export interface SplitRecording {
  readonly base: PartText;
  readonly parts: readonly PartText[];
  readonly draft: IndexDraft;
}

/** How to cut. */
export interface SplitRecordingOptions {
  /** The run the recording is filed for: written into every part and the index. */
  readonly runId?: string;
  /** Pack each part on its own (`packRecording`'s codec), so any part reads alone. */
  readonly packed?: boolean;
  /** The part size target. Default {@link RECORDING_PART_TARGET_BYTES}. */
  readonly targetBytes?: number;
  /**
   * Where sub-flow boundary payloads go. `'with-invocation'` (the default, and
   * all the writer writes) cuts format 2; `'in-row'` cuts format 1, every
   * payload in the base row: what a reader of a WHOLE recording uses, so its
   * reads stay what they were.
   */
  readonly subflowPayloads?: 'with-invocation' | 'in-row';
}

interface Entry {
  readonly slot: 'results' | 'aliases';
  readonly key: string;
  readonly value: unknown;
  readonly text: string;
  readonly bytes: number;
  /** Format 2: this result's stored payloads, grouped with it. */
  readonly stored?: { readonly entry?: string; readonly exit?: string };
}

/** The stored (not `'same'`) payloads of one invocation, as JSON text. */
function storedOf(moved: MovedPayloads | undefined): Entry['stored'] {
  if (moved === undefined) return undefined;
  const entry = moved.entry?.place === 'stored' ? moved.entry.text : undefined;
  const exit = moved.exit?.place === 'stored' ? moved.exit.text : undefined;
  if (entry === undefined && exit === undefined) return undefined;
  return { ...(entry !== undefined && { entry }), ...(exit !== undefined && { exit }) };
}

/** The JSON text of one invocation's stored payloads member: `{"entry":…,"exit":…}`. */
function storedText(stored: NonNullable<Entry['stored']>): string {
  const members: string[] = [];
  if (stored.entry !== undefined) members.push(`"entry":${stored.entry}`);
  if (stored.exit !== undefined) members.push(`"exit":${stored.exit}`);
  return `{${members.join(',')}}`;
}

/** A placeholder ref of the minted length, to measure an index before refs exist. */
const PLACEHOLDER_REF = `art_${'0'.repeat(22)}`;

/**
 * Cut a live recording (`recordRun` · `toRecording()`), through the wire rule
 * first, so the parts hold exactly the bytes the whole recording would.
 *
 * @throws RecordingSplitError — `unserializable`, `not-a-recording`, `over-limit`.
 */
export async function splitRecording(
  recording: unknown,
  options: SplitRecordingOptions = {},
): Promise<SplitRecording> {
  // The bounds first, from the iterative walk's counts, before anything
  // recursive runs: serializing a deep tree overflows the stack at a depth that
  // depends on the runtime, so a recording past a bound would otherwise be
  // `unserializable` on one Node and `over-limit` on another.
  refuseOverLimit(recording);
  let text: string | undefined;
  try {
    text = toWireJson(recording);
  } catch {
    throw new RecordingSplitError('unserializable');
  }
  if (text === undefined) throw new RecordingSplitError('unserializable');
  return splitRecordingData(JSON.parse(text) as unknown, options);
}

/**
 * Cut a recording that is already plain JSON data (parsed from its text).
 *
 * @throws RecordingSplitError — `not-a-recording`, `over-limit`.
 */
export async function splitRecordingData(
  data: unknown,
  options: SplitRecordingOptions = {},
): Promise<SplitRecording> {
  const { runId, packed = false } = options;
  const target = options.targetBytes ?? RECORDING_PART_TARGET_BYTES;
  if (runId !== undefined && !isName(runId)) {
    throw new TypeError(
      'splitRecording: runId must be a non-empty name of at most 4096 characters.',
    );
  }
  if (!Number.isSafeInteger(target) || target < 1) {
    throw new TypeError('splitRecording: targetBytes must be a positive whole number of bytes.');
  }
  if (!isPlainObject(data) || !Array.isArray(ownValue(data, 'events'))) {
    throw new RecordingSplitError('not-a-recording');
  }
  const snapshot = ownValue(data, 'snapshot');
  const walk = walkRecordedInvocations(snapshot);
  const v2 = options.subflowPayloads !== 'in-row';
  const format = v2 ? RECORDING_INDEX_FORMAT : RECORDING_INDEX_FORMAT_V1;
  const partFormat = partFormatOf(format);
  const cut: PayloadCut | undefined = v2 ? cutPayloads(snapshot, walk.invocations) : undefined;

  const entry = (
    slot: Entry['slot'],
    key: string,
    value: unknown,
    stored?: Entry['stored'],
  ): Entry => {
    const text = serialize(() => toWireJson(value));
    return { slot, key, value, text, bytes: utf8Length(text), ...(stored && { stored }) };
  };
  const results: Entry[] = [];
  for (const invocation of walk.invocations) {
    if ('result' in invocation) {
      const stored = storedOf(cut?.moved.get(invocation.key));
      results.push(entry('results', invocation.key, invocation.result, stored));
    }
  }
  for (const { key, result } of walk.unmounted) results.push(entry('results', key, result));
  const byText = new Map<string, string>();
  for (const result of results) if (!byText.has(result.text)) byText.set(result.text, result.key);

  const proven = new Map<string, string>();
  const stored: Entry[] = [...results];
  for (const { name, value } of walk.aliases) {
    const candidate = entry('aliases', name, value);
    const key = byText.get(candidate.text);
    if (key !== undefined) proven.set(name, key);
    else stored.push(candidate);
  }

  // Group: whole entries only, in order, each part within the target unless one entry is larger.
  const groups: Entry[][] = [];
  let current: Entry[] = [];
  let size = 0;
  for (const item of stored) {
    // A result and its stored payloads are one unit: they share a part.
    const beside =
      item.stored === undefined
        ? 0
        : utf8Length(toWireJson(item.key)) + utf8Length(storedText(item.stored)) + 2;
    const cost = utf8Length(toWireJson(item.key)) + item.bytes + 2 + beside;
    if (current.length > 0 && size + cost > target) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += cost;
  }
  if (current.length > 0) groups.push(current);
  if (groups.length > RECORDING_PARTS_LIMITS.parts) {
    throw new RecordingSplitError('over-limit', 'parts');
  }

  const partOf = new Map<string, number>();
  groups.forEach((group, at) => {
    for (const item of group) if (item.slot === 'results') partOf.set(item.key, at);
  });
  const aliasPart = new Map<string, number>();
  groups.forEach((group, at) => {
    for (const item of group) if (item.slot === 'aliases') aliasPart.set(item.key, at);
  });
  const resultBytes = new Map(results.map((item) => [item.key, item.bytes]));

  const head = (part: number | 'base'): string =>
    `{"format":${toWireJson(partFormat)}` +
    (runId !== undefined ? `,"runId":${toWireJson(runId)}` : '') +
    `,"part":${toWireJson(part)}`;

  const partTexts: string[] = groups.map((group, at) => {
    const slot = (name: Entry['slot']): Entry[] => group.filter((item) => item.slot === name);
    const withStored = group.filter((item) => item.stored !== undefined);
    if (packed) {
      const fold = (items: Entry[]): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const item of items) assign(out, item.key, item.value);
        return out;
      };
      const storedFold = (): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const item of withStored) {
          const moved = cut?.moved.get(item.key);
          const member: Record<string, unknown> = {};
          if (moved?.entry?.place === 'stored') assign(member, 'entry', moved.entry.value);
          if (moved?.exit?.place === 'stored') assign(member, 'exit', moved.exit.value);
          assign(out, item.key, member);
        }
        return out;
      };
      return serialize(() =>
        toWireJson(
          packPart({
            format: partFormat,
            ...(runId !== undefined && { runId }),
            part: at,
            results: fold(slot('results')),
            aliases: fold(slot('aliases')),
            ...(v2 && { payloads: storedFold() }),
          }),
        ),
      );
    }
    const members = (items: Entry[]): string =>
      items.map((item) => `${toWireJson(item.key)}:${item.text}`).join(',');
    const payloads = withStored
      .map((item) =>
        item.stored === undefined ? '' : `${toWireJson(item.key)}:${storedText(item.stored)}`,
      )
      .join(',');
    return (
      `${head(at)},"results":{${members(slot('results'))}},"aliases":{${members(
        slot('aliases'),
      )}}` + (v2 ? `,"payloads":{${payloads}}}` : '}')
    );
  });

  const basePayload = {
    format: partFormat,
    ...(runId !== undefined && { runId }),
    part: 'base',
    recording: withoutResults(data, snapshot, cut?.recorders),
  };
  const baseText = serialize(() => toWireJson(packed ? packPart(basePayload) : basePayload));

  const withDigest = async (text: string): Promise<PartText> => ({
    text,
    bytes: utf8Length(text),
    digest: await computeArtifactDigest(text),
  });
  const base = await withDigest(baseText);
  const parts: PartText[] = [];
  for (const text of partTexts) parts.push(await withDigest(text));

  const invocations: IndexInvocation[] = walk.invocations.map((invocation) => {
    const part = partOf.get(invocation.key);
    if (part === undefined) {
      return {
        key: invocation.key,
        path: invocation.path,
        subflowId: invocation.subflowId,
        part: null,
      };
    }
    const moved = cut?.moved.get(invocation.key);
    const places: IndexInvocationPayloads | undefined =
      moved === undefined
        ? undefined
        : {
            ...(moved.entry !== undefined && { entry: moved.entry.place }),
            ...(moved.exit !== undefined && { exit: moved.exit.place }),
          };
    const restored = [moved?.entry, moved?.exit].reduce(
      (sum, one) => (one?.place === 'same' ? sum + one.bytes : sum),
      0,
    );
    const hasSame = moved?.entry?.place === 'same' || moved?.exit?.place === 'same';
    return {
      key: invocation.key,
      path: invocation.path,
      subflowId: invocation.subflowId,
      part,
      bytes: resultBytes.get(invocation.key) as number,
      ...(places !== undefined && { payloads: places }),
      ...(hasSame && { restoredBytes: restored }),
    };
  });
  const unmounted: IndexUnmounted[] = walk.unmounted.map(({ key }) => ({
    key,
    part: partOf.get(key) as number,
  }));
  const aliases: IndexAlias[] = walk.aliases.map(({ name }) => {
    const key = proven.get(name);
    return key !== undefined ? { name, key } : { name, part: aliasPart.get(name) as number };
  });

  const draft: IndexDraft = {
    format,
    ...(runId !== undefined && { runId }),
    ...(walk.snapshotRunId !== undefined && { snapshotRunId: walk.snapshotRunId }),
    packed,
    complete: walk.complete,
    hasSubflowResults: walk.hasSubflowResults,
    base: { bytes: base.bytes, digest: base.digest },
    parts: parts.map((part, at) => {
      const group = groups[at] as Entry[];
      const results = group.filter((item) => item.slot === 'results').length;
      if (!v2) return { bytes: part.bytes, digest: part.digest, results };
      const payloads = group.reduce(
        (sum, item) =>
          sum +
          (item.stored?.entry !== undefined ? 1 : 0) +
          (item.stored?.exit !== undefined ? 1 : 0),
        0,
      );
      return { bytes: part.bytes, digest: part.digest, results, payloads };
    }),
    invocations,
    aliases,
    unmounted,
    ...(cut !== undefined && { subflowPayloads: cut.counts }),
  };
  const measured = recordingIndexText(draft, {
    base: PLACEHOLDER_REF,
    parts: parts.map(() => PLACEHOLDER_REF),
  });
  if (utf8Length(measured) > RECORDING_PARTS_LIMITS.indexBytes) {
    throw new RecordingSplitError('over-limit', 'index');
  }
  return { base, parts, draft };
}

/**
 * The index's JSON text once the store has minted every ref: `refs.parts[i]`
 * is the ref of `split.parts[i]`. Fixed key order, compact JSON.
 */
export function recordingIndexText(
  draft: IndexDraft,
  refs: { readonly base: string; readonly parts: readonly string[] },
): string {
  if (refs.parts.length !== draft.parts.length) {
    throw new TypeError('recordingIndexText: one ref per part is required.');
  }
  const index: RecordingIndex = {
    format: draft.format,
    ...(draft.runId !== undefined && { runId: draft.runId }),
    ...(draft.snapshotRunId !== undefined && { snapshotRunId: draft.snapshotRunId }),
    packed: draft.packed,
    complete: draft.complete,
    hasSubflowResults: draft.hasSubflowResults,
    base: { ref: refs.base, bytes: draft.base.bytes, digest: draft.base.digest },
    parts: draft.parts.map((part, at) => ({
      ref: refs.parts[at] as string,
      bytes: part.bytes,
      digest: part.digest,
      results: part.results,
      ...(part.payloads !== undefined && { payloads: part.payloads }),
    })),
    invocations: draft.invocations.map((invocation) =>
      invocation.part === null
        ? {
            key: invocation.key,
            path: invocation.path,
            subflowId: invocation.subflowId,
            part: null,
          }
        : {
            key: invocation.key,
            path: invocation.path,
            subflowId: invocation.subflowId,
            part: invocation.part,
            bytes: invocation.bytes as number,
            ...(invocation.payloads !== undefined && {
              payloads: {
                ...(invocation.payloads.entry !== undefined && {
                  entry: invocation.payloads.entry,
                }),
                ...(invocation.payloads.exit !== undefined && { exit: invocation.payloads.exit }),
              },
            }),
            ...(invocation.restoredBytes !== undefined && {
              restoredBytes: invocation.restoredBytes,
            }),
          },
    ),
    aliases: draft.aliases.map((alias) =>
      'key' in alias
        ? { name: alias.name, key: alias.key }
        : { name: alias.name, part: alias.part },
    ),
    unmounted: draft.unmounted.map(({ key, part }) => ({ key, part })),
    ...(draft.subflowPayloads !== undefined && {
      subflowPayloads: {
        same: draft.subflowPayloads.same,
        stored: draft.subflowPayloads.stored,
        restoredBytes: draft.subflowPayloads.restoredBytes,
        kept: {
          ambiguous: draft.subflowPayloads.kept.ambiguous,
          notLast: draft.subflowPayloads.kept.notLast,
          noPart: draft.subflowPayloads.kept.noPart,
        },
      },
    }),
  };
  return toWireJson(index);
}

/**
 * The recording with the snapshot's `subflowResults` key removed and, when
 * payloads moved, `recorders` replaced by the cut's marked rows; every other
 * key in place.
 */
function withoutResults(
  data: Record<string, unknown>,
  snapshot: unknown,
  recorders: readonly unknown[] | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const value = ownValue(data, key);
    if (key === 'snapshot' && isPlainObject(snapshot)) {
      const stripped: Record<string, unknown> = {};
      for (const field of Object.keys(snapshot)) {
        if (field === 'subflowResults') continue;
        const kept = field === 'recorders' && recorders !== undefined ? recorders : undefined;
        assign(stripped, field, kept ?? ownValue(snapshot, field));
      }
      assign(out, key, stripped);
    } else assign(out, key, value);
  }
  return out;
}

/**
 * Write one value as JSON, or refuse the recording as `unserializable`: the one
 * boundary where a value too deep for the serializer's stack (a `RangeError`)
 * or one JSON cannot carry becomes a reason instead of an escaping error.
 */
function serialize(write: () => string | undefined): string {
  let text: string | undefined;
  try {
    text = write();
  } catch {
    throw new RecordingSplitError('unserializable');
  }
  if (text === undefined) throw new RecordingSplitError('unserializable');
  return text;
}

/**
 * Throw the walk's `over-limit` refusal for the live recording, if it has one.
 * Only the bounds are decided here: any other verdict (a shape the walk cannot
 * read before the wire rule has run) is left to the walk over the wire form.
 */
function refuseOverLimit(recording: unknown): void {
  if (!isPlainObject(recording)) return;
  try {
    walkRecordedInvocations(ownValue(recording, 'snapshot'));
  } catch (err) {
    if (err instanceof RecordingSplitError && err.code === 'over-limit') throw err;
  }
}
