/**
 * Shared fixtures for the recording-parts tests: real engine runs, a test-only
 * filer (parts first, index last — the writer itself is a later change), and
 * a counting, tamperable view of a store.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Agent, defineTool, inMemoryArtifacts, sqliteArtifacts } from '../../../../src/index.js';
import type {
  ArtifactMeta,
  ArtifactRecord,
  ArtifactScope,
  ArtifactStore,
} from '../../../../src/artifacts/types.js';
import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import {
  RECORDING_INDEX_ARTIFACT_KIND,
  RECORDING_PART_ARTIFACT_KIND,
  recordingPutInput,
} from '../../../../src/artifacts/recordingArtifact.js';
import { recordRun, type Recording } from '../../../../src/observe.js';
import { mock } from '../../../../src/providers.js';
import { conversationRedaction } from '../../../../src/doors/security.js';
import {
  recordingIndexText,
  splitRecording,
  type SplitRecording,
  type SplitRecordingOptions,
} from '../../../../src/recorders/observability/recordingParts/split.js';

export const SCOPE: ArtifactScope = { conversationId: 'recording-parts' };
export const RUN_ID = 'run-parts-1';

/** `node:sqlite` is missing on older Node; the sqlite rows skip visibly there. */
export const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

export interface StoreCase {
  readonly name: string;
  create(): { store: ArtifactStore; close(): void };
}

export const STORES: readonly StoreCase[] = [
  { name: 'inMemoryArtifacts', create: () => ({ store: inMemoryArtifacts(), close: () => {} }) },
  ...(sqliteAvailable
    ? [
        {
          name: 'sqliteArtifacts',
          create: () => {
            const dir = mkdtempSync(join(tmpdir(), 'af-recording-parts-'));
            const store = sqliteArtifacts({ file: join(dir, 'artifacts.sqlite') });
            return {
              store,
              close: () => {
                store.close();
                rmSync(dir, { recursive: true, force: true });
              },
            };
          },
        },
      ]
    : []),
];

/**
 * A real agent run: grouped ReAct mode mounts one call subflow per iteration,
 * each with nested slot subflows, loops re-mount them (path aliases), and the
 * tool returns `rows` rows so results have weight.
 */
export async function realRecording(
  options: { readonly rows?: number; readonly redact?: boolean; readonly marker?: string } = {},
): Promise<Recording> {
  const { rows = 40, marker = 'PLANTED-SECRET-7f3a' } = options;
  const lookup = defineTool<{ page: number }, unknown>({
    name: 'lookup',
    description: 'Returns one page of rows.',
    inputSchema: { type: 'object', properties: { page: { type: 'number' } } },
    execute: ({ page }) =>
      Array.from({ length: rows }, (_, i) => ({ id: i, page, note: `row ${i} ${marker}` })),
  });
  const runner = Agent.create({
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'a', name: 'lookup', args: { page: 1 } }] },
        { toolCalls: [{ id: 'b', name: 'lookup', args: { page: 2 } }] },
        { content: `Done. ${marker}` },
      ],
    }),
    model: 'mock',
    reactMode: 'dynamic-grouped',
    ...(options.redact === true && {
      redact: conversationRedaction({ patterns: [/note/] }),
    }),
  })
    .tool(lookup)
    .build();
  const recorder = recordRun(runner);
  try {
    await runner.run({ message: `Read two pages. ${marker}` });
    return recorder.toRecording();
  } finally {
    recorder.stop();
    await runner.shutdown();
  }
}

/** The text a whole recording is stored as. */
export function wholeText(recording: Recording): string {
  return recordingPutInput(recording).data as string;
}

/** Store a whole recording; returns its ref. */
export async function fileWhole(
  store: ArtifactStore,
  recording: Recording,
  runId = RUN_ID,
): Promise<string> {
  const input = recordingPutInput(recording, { runId });
  return (await store.put(SCOPE, { ...input, digest: 'sha-256' })).meta.ref;
}

export interface FiledParts {
  readonly index: string;
  readonly base: string;
  readonly parts: readonly string[];
  readonly split: SplitRecording;
  readonly indexText: string;
}

/** Store a recording in parts the way the writer will: every part first, the index last. */
export async function fileParts(
  store: ArtifactStore,
  recording: Recording,
  options: SplitRecordingOptions = {},
): Promise<FiledParts> {
  const runId = options.runId ?? RUN_ID;
  const split = await splitRecording(recording, { ...options, runId });
  const put = async (kind: string, text: string): Promise<string> =>
    (
      await store.put(SCOPE, {
        kind,
        mediaType: 'application/json',
        data: text,
        digest: 'sha-256',
        origin: { runId },
        label: `run ${runId}`,
      })
    ).meta.ref;
  const base = await put(RECORDING_PART_ARTIFACT_KIND, split.base.text);
  const parts: string[] = [];
  for (const part of split.parts) parts.push(await put(RECORDING_PART_ARTIFACT_KIND, part.text));
  const indexText = recordingIndexText(split.draft, { base, parts });
  const index = await put(RECORDING_INDEX_ARTIFACT_KIND, indexText);
  return { index, base, parts, split, indexText };
}

export interface Counted {
  readonly artifacts: {
    head(ref: string): Promise<ArtifactMeta | null>;
    get(ref: string): Promise<ArtifactRecord | null>;
  };
  readonly calls: { head: string[]; get: string[] };
}

/**
 * A scope-bound view of `store` that counts every call, and lets a test change
 * what a ref answers: its meta (as `head` and `get` report it), its data, or a
 * thrown error.
 */
export function counted(
  store: ArtifactStore,
  tamper: {
    readonly meta?: (meta: ArtifactMeta) => ArtifactMeta;
    readonly data?: (record: ArtifactRecord) => unknown;
    readonly fail?: (ref: string, verb: 'head' | 'get') => Error | undefined;
  } = {},
  scope: ArtifactScope = SCOPE,
): Counted {
  const bound = bindArtifacts(store, scope);
  const calls = { head: [] as string[], get: [] as string[] };
  return {
    calls,
    artifacts: {
      async head(ref) {
        calls.head.push(ref);
        const error = tamper.fail?.(ref, 'head');
        if (error !== undefined) throw error;
        const meta = await bound.head(ref);
        return meta === null || tamper.meta === undefined ? meta : tamper.meta(meta);
      },
      async get(ref) {
        calls.get.push(ref);
        const error = tamper.fail?.(ref, 'get');
        if (error !== undefined) throw error;
        const record = await bound.get(ref);
        if (record === null) return null;
        const meta = tamper.meta === undefined ? record.meta : tamper.meta(record.meta);
        const data = tamper.data === undefined ? record.data : tamper.data(record);
        return { meta, data };
      },
    },
  };
}

/** Parse the whole text a recording is stored as. */
export function parsedWhole(recording: Recording): Record<string, unknown> {
  return JSON.parse(wholeText(recording)) as Record<string, unknown>;
}

/** The execution keys of a parsed whole recording's subflow results. */
export function executionKeys(whole: Record<string, unknown>): string[] {
  const snapshot = whole.snapshot as { subflowResults?: Record<string, unknown> };
  return Object.keys(snapshot.subflowResults ?? {}).filter((key) => key.includes('#'));
}
