/**
 * snapshotPipeline — composes `loadSnapshot` + `writeSnapshot` into a
 * `MemoryPipeline` ready to be mounted by `defineMemory({ type: CAUSAL })`.
 *
 *   READ  :  LoadSnapshot — embed query → search → project → format
 *   WRITE :  WriteSnapshot — embed query → store as MemoryEntry<SnapshotEntry>
 *
 * The pipeline emits the same `agentfootprint.context.injected` event
 * (with `source: 'memory'`) as every other memory flavor, so Lens
 * shows Causal injections as memory chips alongside Episodic /
 * Semantic / Narrative without special UI.
 */

import { flowChart } from 'footprintjs';

import type { MemoryStore } from '../store/index.js';
import type { Embedder } from '../embedding/index.js';
import type { MemoryState } from '../stages/index.js';
import type { MemoryPipeline } from '../pipeline/types.js';
import type { SnapshotProjection } from '../define.types.js';

import { loadSnapshot, type LoadSnapshotConfig } from './loadSnapshot.js';
import { writeSnapshot, type WriteSnapshotConfig } from './writeSnapshot.js';

export interface SnapshotPipelineConfig {
  /** Vector-capable store for the snapshots. Must implement `search()`. */
  readonly store: MemoryStore;

  /** Embedder used for both write-side indexing and read-side query. */
  readonly embedder: Embedder;

  /** Stable id of the embedder — prevents cross-model similarity pollution. */
  readonly embedderId?: string;

  /** Top-k past snapshots to consider on read. Default 1. */
  readonly topK?: number;

  /** Cosine threshold below which matches are dropped. Default 0.7. */
  readonly minScore?: number;

  /** Slice of the snapshot to inject. Default `'decisions'`. */
  readonly projection?: SnapshotProjection;

  /** Optional TTL for snapshots in ms. Useful for compliance windows. */
  readonly ttlMs?: number;

  /** Optional tier tag for written snapshots. */
  readonly tier?: 'hot' | 'warm' | 'cold';
}

export function snapshotPipeline(config: SnapshotPipelineConfig): MemoryPipeline {
  const loadConfig: LoadSnapshotConfig = {
    store: config.store,
    embedder: config.embedder,
    ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
    ...(config.topK !== undefined && { topK: config.topK }),
    ...(config.minScore !== undefined && { minScore: config.minScore }),
    ...(config.projection !== undefined && { projection: config.projection }),
  };
  const writeConfig: WriteSnapshotConfig = {
    store: config.store,
    embedder: config.embedder,
    ...(config.embedderId !== undefined && { embedderId: config.embedderId }),
    ...(config.ttlMs !== undefined && { ttlMs: config.ttlMs }),
    ...(config.tier && { tier: config.tier }),
  };

  const read = flowChart<MemoryState>(
    'LoadSnapshot',
    loadSnapshot(loadConfig),
    'load-snapshot',
    undefined,
    'Embed query, retrieve top-K past snapshots, project + format as system messages',
  ).build();

  const write = flowChart<MemoryState>(
    'WriteSnapshot',
    writeSnapshot(writeConfig),
    'write-snapshot',
    undefined,
    'Capture (query, finalContent) from the run, embed query, persist as MemoryEntry<SnapshotEntry>',
  ).build();

  return { read, write };
}
