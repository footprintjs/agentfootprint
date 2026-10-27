import type { StageSnapshot } from 'footprintjs/advanced';
import type { StoredCaptureHistory } from 'footprintjs/trace';
import { copyJson } from '../lib/boundedJson.js';
import { captureOwn as own } from './causeCapture.js';
import { projectCauseBasis } from './causeProjection.js';
import { bindStoredCause } from './storedCauseBinding.js';
import type { StoredCauseResult } from './storedCauseTypes.js';

function savedNodes(history: StoredCaptureHistory): {
  nodes: ReadonlyMap<string, StageSnapshot>;
  readKeys: ReadonlyMap<string, readonly string[]>;
} {
  const nodes = new Map<string, StageSnapshot>();
  const paths = new Map<string, string>();
  const pending: { node: unknown; path: string[] }[] = [
    { node: history.executionTree, path: ['executionTree'] },
  ];
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const { node, path } = current;
    if (++visited > 4096 || node === null || typeof node !== 'object' || Array.isArray(node))
      throw Error('Invalid saved tree.');
    for (const field of ['stageReads', 'stageWrites']) {
      const view = own(node, field);
      if (
        view !== undefined &&
        (view === null ||
          typeof view !== 'object' ||
          Array.isArray(view) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(view)))
      )
        throw Error('Invalid saved captured view.');
    }
    const id = own(node, 'runtimeStageId');
    if (id !== undefined) {
      if (typeof id !== 'string' || !id.length || id.length > 128 || nodes.has(id))
        throw Error('Ambiguous saved tree.');
      nodes.set(id, node as StageSnapshot);
      // JSON arrays of literal segments are injective; dotted/slashed business keys stay whole.
      paths.set(JSON.stringify(path), id);
    }
    const next = own(node, 'next');
    if (next !== undefined) pending.push({ node: next, path: [...path, 'next'] });
    const children = own(node, 'children');
    if (children !== undefined) {
      if (!Array.isArray(children) || children.length > 4096) throw Error('Invalid saved tree.');
      for (let index = children.length - 1; index >= 0; index--)
        pending.push({ node: children[index], path: [...path, 'children', String(index)] });
    }
  }
  const readKeys = new Map<string, string[]>();
  // FootPrint already validated the paths and their digest. Only project their recorded meaning.
  for (const path of history.absent ?? []) {
    const id = paths.get(JSON.stringify(path.slice(0, -2)));
    if (id === undefined) throw Error('Missing saved observation owner.');
    if (path[path.length - 2] !== 'stageReads') continue;
    const keys = readKeys.get(id) ?? [];
    const key = path[path.length - 1];
    if (key === undefined) throw Error('Missing saved observation key.');
    keys.push(key);
    readKeys.set(id, keys);
  }
  return { nodes, readKeys };
}

/** A narrow graph projection over admitted producer history, never a synthetic RuntimeSnapshot. */
export function projectStoredCause(
  value: unknown,
  runId: string,
  maxBytes: number,
): StoredCauseResult {
  try {
    // Reuse the shared data-only copier. Its detached tree/sidecar/log are retained privately together.
    const history = copyJson(value, maxBytes * 4, true, 256) as StoredCaptureHistory;
    if (history.runId !== runId || !Array.isArray(history.commitLog))
      return { status: 'unknown', reason: 'native-capture' };
    if (history.commitLog.length > 4096)
      return { status: 'unknown', reason: 'projection-incomplete' };
    if (own(history.capture, 'version') !== 1 || own(history, 'readSources') !== undefined)
      return { status: 'unknown', reason: 'native-capture' };
    const { nodes, readKeys } = savedNodes(history);
    // These are facts from this one history; no runtime-only fields or alternate history are synthesized.
    const basis = {
      runId: history.runId,
      capture: history.capture,
      logAddress: own(history.capture, 'logAddress'),
      commitValues: own(own(history.capture, 'modes'), 'commitValues'),
      writeProvenance: own(own(history.capture, 'modes'), 'writeProvenance'),
      commitLog: history.commitLog,
      recorders: history.recorders,
    };
    const projected = projectCauseBasis(basis, nodes, undefined, {
      readKeys,
      ...(history.initialState === undefined ? {} : { initialState: history.initialState }),
    });
    if (projected === undefined || projected === 'truncated')
      return { status: 'unknown', reason: 'projection-incomplete' };
    if (
      [
        'missing-attestation',
        'invalid-attestation',
        'run-mismatch',
        'scope-not-covered',
        'incomplete-extent',
        'capture-limited',
      ].includes(projected.capture.reason)
    )
      return { status: 'unknown', reason: 'native-capture' };
    return { status: 'ready', cause: bindStoredCause(projected.graph, projected.capture, history) };
  } catch {
    return { status: 'unknown', reason: 'projection-incomplete' };
  }
}
