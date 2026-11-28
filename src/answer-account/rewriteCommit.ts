import { commitValueAt, type CommitBundle } from 'foottrace';
import { pathSegments } from 'foottrace/paths';
import { measureBoundedJson, readOwnList } from '../lib/boundedJson.js';
import type { AccountEventEvidence } from '../recorders/observability/answerAccount/evidence.js';

const MAX_COMMITS = 4_096;
const MAX_WRITES = 4_096;
const ROOTS = ['history', 'middlewareDecisions'] as const;
export const MAX_REWRITE_HISTORY = 4_096;
export const MAX_REWRITE_LEDGER = 4_096;

export function own(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;
}

const isRoot = (path: unknown) => Array.isArray(path) && own(path, 'length') === 0;

function positionOf(row: AccountEventEvidence) {
  return own(row.event.meta, 'sourcePosition');
}

/** Read two named values from the bracket's unique owning root commit. */
export function readRewriteCommit(
  snapshot: unknown,
  stage: string,
  end: AccountEventEvidence,
  witnesses: readonly AccountEventEvidence[],
  budget: number,
) {
  const position = positionOf(end);
  const engine = own(position, 'engineRunId');
  const prefix = own(position, 'committedThroughIdx');
  const address = own(snapshot, 'logAddress');
  if (
    typeof engine !== 'string' ||
    engine !== own(snapshot, 'runId') ||
    engine !== own(address, 'logRunId') ||
    !isRoot(own(address, 'drillPath')) ||
    typeof prefix !== 'number' ||
    !Number.isSafeInteger(prefix) ||
    prefix < -1 ||
    witnesses.some((row) => {
      const source = positionOf(row);
      return (
        own(source, 'engineRunId') !== engine ||
        own(source, 'logRunId') !== engine ||
        !isRoot(own(source, 'drillPath')) ||
        own(source, 'committedThroughIdx') !== prefix
      );
    })
  )
    return undefined;

  const log = readOwnList(own(snapshot, 'commitLog'), MAX_COMMITS);
  if (log === undefined || log.unread !== 0 || log.entries.includes(undefined)) return undefined;
  const index = prefix + 1;
  const commit = log.entries[index];
  if (
    own(commit, 'idx') !== index ||
    own(commit, 'runtimeStageId') !== stage ||
    own(commit, 'untrackedSources') !== undefined ||
    log.entries.some((row, i) => i !== index && own(row, 'runtimeStageId') === stage)
  )
    return undefined;
  const trace = readOwnList(own(commit, 'trace'), MAX_WRITES);
  if (trace === undefined || trace.unread !== 0 || trace.entries.includes(undefined))
    return undefined;
  const paths = new Set(trace.entries.map((row) => own(row, 'path')));
  if (!ROOTS.every((path) => paths.has(path))) return undefined;

  // Fold just the two named roots through this write, with Foottrace's native
  // read rule for both encodings. Later history cannot stand in for this write.
  const committed = log.entries.slice(0, index + 1) as CommitBundle[];
  if (!writesFit(committed, budget)) return undefined;
  const history = readOwnList(commitValueAt(committed, index, 'history'), MAX_REWRITE_HISTORY);
  const ledger = readOwnList(
    commitValueAt(committed, index, 'middlewareDecisions'),
    MAX_REWRITE_LEDGER,
  );
  if (history?.unread !== 0 || ledger?.unread !== 0) return undefined;
  return { history: history.entries, ledger: ledger.entries };
}

/** Bound the read before Foottrace can clone any committed values. Only
 * writes to the two named roots are visited below their trace metadata. */
function writesFit(log: readonly CommitBundle[], bytes: number): boolean {
  let remainingRows = MAX_WRITES;
  let remainingBytes = bytes;
  try {
    for (const commit of log) {
      const trace = readOwnList(own(commit, 'trace'), remainingRows);
      if (trace === undefined || trace.unread !== 0) return false;
      remainingRows -= trace.entries.length;
      const measured = new Set<string>();
      for (const row of trace.entries) {
        const path = own(row, 'path');
        if (typeof path !== 'string' || path.length > 4_096) return false;
        const root = pathSegments(path)[0];
        if (root !== ROOTS[0] && root !== ROOTS[1]) continue;
        const verb = own(row, 'verb');
        if (verb === 'delete') continue;
        if (verb !== 'set' && verb !== 'append' && verb !== 'merge') return false;
        const patch = verb === 'merge' ? 'updates' : 'overwrite';
        const key = JSON.stringify([patch, path]);
        if (measured.has(key)) continue;
        measured.add(key);
        remainingBytes -= measureBoundedJson(
          own(own(commit, patch), path),
          remainingBytes,
          100,
          {},
        );
      }
    }
    return true;
  } catch {
    return false;
  }
}
