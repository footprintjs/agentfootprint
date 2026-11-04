import type { ToolpackIndex } from './packIndex.js';
import { subflowWrote } from '../subflowRecords.js';
import { mountLine } from './navigationHints.js';
import { displayKey } from '../bounded.js';

/**
 * A write by a subflow MOUNT is its merge-back: the value was made inside. One
 * line names the question that reaches the inner writer; '' otherwise.
 */
function mergeBackLine(index: ToolpackIndex, writerId: string, path: string): string {
  if (!index.subflowDoor || index.nodes.get(writerId)?.subflowId === undefined) return '';
  // The outputMapper may rename or compute the key: claim a writer inside only
  // when the mount's own log wrote this very path. Otherwise name the mount.
  if (!subflowWrote(index.subflowResults?.[writerId], path)) {
    return `\n↳ ${writerId} is a subflow mount — ${mountLine(index, writerId)}`;
  }
  return (
    `\n↳ ${writerId} is a subflow mount — this write is its merge-back. ` +
    `inspect_subflow({ mount: '${writerId}', key: '${displayKey(path)}' }) names the writer ` +
    `inside.`
  );
}

/**
 * A key this log never wrote may still be written INSIDE a subflow mounted at
 * this level — its own log never merged it back. One line naming the latest
 * such mount; '' when none did (asked only on a miss).
 */
function writtenInsideLine(index: ToolpackIndex, path: string, beforeIdx?: number): string {
  const results = index.subflowResults;
  if (!index.subflowDoor || results === undefined) return '';
  // Only mounts that ran BEFORE the anchor answer "who wrote it before X".
  const mounts = [...index.orderedIds]
    .reverse()
    .filter((id) => index.nodes.get(id)?.subflowId !== undefined)
    .filter((id) => beforeIdx === undefined || (index.lastIdxOf.get(id) ?? Infinity) < beforeIdx);
  const inside = mounts.find((id) => subflowWrote(results[id], path));
  if (inside === undefined) return '';
  // "Not merged back" is a claim about THIS log: true only if it never wrote the key.
  const where = index.knownPaths.has(path) ? '' : ' (not merged back here)';
  return (
    `\n↳ but subflow ${inside} wrote '${displayKey(path)}' in its OWN log${where}: ` +
    `inspect_subflow({ mount: '${inside}', key: '${displayKey(path)}' }) names the writer.`
  );
}

export { mergeBackLine, writtenInsideLine };
