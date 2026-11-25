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
  RECORDING_PARTS_LIMITS,
  RECORDING_PART_FORMAT,
  RECORDING_PART_TARGET_BYTES,
  assign,
  isName,
  isPlainObject,
  ownValue,
  type IndexAlias,
  type IndexDraft,
  type IndexInvocation,
  type IndexUnmounted,
  type RecordingIndex,
} from './format.js';
import { walkRecordedInvocations } from './invocations.js';
import { packPart } from './packing.js';
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
}

interface Entry {
  readonly slot: 'results' | 'aliases';
  readonly key: string;
  readonly value: unknown;
  readonly text: string;
  readonly bytes: number;
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

  const entry = (slot: Entry['slot'], key: string, value: unknown): Entry => {
    const text = toWireJson(value);
    return { slot, key, value, text, bytes: utf8Length(text) };
  };
  const results: Entry[] = [];
  for (const invocation of walk.invocations) {
    if ('result' in invocation) results.push(entry('results', invocation.key, invocation.result));
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
    const cost = utf8Length(toWireJson(item.key)) + item.bytes + 2;
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
    `{"format":${toWireJson(RECORDING_PART_FORMAT)}` +
    (runId !== undefined ? `,"runId":${toWireJson(runId)}` : '') +
    `,"part":${toWireJson(part)}`;

  const partTexts: string[] = groups.map((group, at) => {
    const slot = (name: Entry['slot']): Entry[] => group.filter((item) => item.slot === name);
    if (packed) {
      const fold = (items: Entry[]): Record<string, unknown> => {
        const out: Record<string, unknown> = {};
        for (const item of items) assign(out, item.key, item.value);
        return out;
      };
      return toWireJson(
        packPart({
          format: RECORDING_PART_FORMAT,
          ...(runId !== undefined && { runId }),
          part: at,
          results: fold(slot('results')),
          aliases: fold(slot('aliases')),
        }),
      );
    }
    const members = (items: Entry[]): string =>
      items.map((item) => `${toWireJson(item.key)}:${item.text}`).join(',');
    return `${head(at)},"results":{${members(slot('results'))}},"aliases":{${members(
      slot('aliases'),
    )}}}`;
  });

  const basePayload = {
    format: RECORDING_PART_FORMAT,
    ...(runId !== undefined && { runId }),
    part: 'base',
    recording: withoutResults(data, snapshot),
  };
  const baseText = toWireJson(packed ? packPart(basePayload) : basePayload);

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
    return part === undefined
      ? { key: invocation.key, path: invocation.path, subflowId: invocation.subflowId, part: null }
      : {
          key: invocation.key,
          path: invocation.path,
          subflowId: invocation.subflowId,
          part,
          bytes: resultBytes.get(invocation.key) as number,
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
    ...(runId !== undefined && { runId }),
    ...(walk.snapshotRunId !== undefined && { snapshotRunId: walk.snapshotRunId }),
    packed,
    complete: walk.complete,
    hasSubflowResults: walk.hasSubflowResults,
    base: { bytes: base.bytes, digest: base.digest },
    parts: parts.map((part, at) => ({
      bytes: part.bytes,
      digest: part.digest,
      results: (groups[at] as Entry[]).filter((item) => item.slot === 'results').length,
    })),
    invocations,
    aliases,
    unmounted,
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
    format: RECORDING_INDEX_FORMAT,
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
          },
    ),
    aliases: draft.aliases.map((alias) =>
      'key' in alias
        ? { name: alias.name, key: alias.key }
        : { name: alias.name, part: alias.part },
    ),
    unmounted: draft.unmounted.map(({ key, part }) => ({ key, part })),
  };
  return toWireJson(index);
}

/** The recording with the snapshot's `subflowResults` key removed; every other key in place. */
function withoutResults(data: Record<string, unknown>, snapshot: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    const value = ownValue(data, key);
    if (key === 'snapshot' && isPlainObject(snapshot)) {
      const stripped: Record<string, unknown> = {};
      for (const field of Object.keys(snapshot)) {
        if (field !== 'subflowResults') assign(stripped, field, ownValue(snapshot, field));
      }
      assign(out, key, stripped);
    } else assign(out, key, value);
  }
  return out;
}
