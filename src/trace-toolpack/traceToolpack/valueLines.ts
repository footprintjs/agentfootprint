import type { CommitBundle, HonestyCode } from 'foottrace';
import type { ToolpackIndex } from './packIndex.js';
import { HONESTY_CODES, commitValueAt } from 'foottrace';

/** Is `path` redacted in any bundle of this step (or, keyless, of the writer)? */
function redactionNote(bundles: readonly CommitBundle[] | undefined, path: string): string {
  const redacted = (bundles ?? []).some((b) => b.redactedPaths.includes(path));
  return redacted ? ' (redacted by policy)' : '';
}

/**
 * A footprintjs reason code as the toolpack prints it. The FIRST time a code appears in this
 * toolpack instance it is `⚠ <code>: <sentence>` — the sentence is footprintjs's own
 * (`HONESTY_CODES` on `foottrace`), this pack keeps no copy — and every later time the
 * bare `⚠ <code>`: the sentence is already in the model's context, and repeating it on every
 * answer is pure token cost.
 */
function honestyLine(index: ToolpackIndex, code: HonestyCode): string {
  if (index.explained.has(code)) return `⚠ ${code}`;
  index.explained.add(code);
  return `⚠ ${code}: ${HONESTY_CODES[code]}`;
}

/** One `honestyLine` per distinct code, each on its own line after `\n`; '' when exact. */
function basisLines(index: ToolpackIndex, codes: readonly HonestyCode[]): string {
  return [...new Set(codes)].map((code) => `\n${honestyLine(index, code)}`).join('');
}

/** Union of untracked sources across a step's bundles. */
function untrackedSourcesOf(bundles: readonly CommitBundle[] | undefined): string[] {
  const set = new Set<string>();
  for (const bundle of bundles ?? []) {
    for (const source of bundle.untrackedSources ?? []) set.add(source);
  }
  return [...set];
}

function truncateText(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

/**
 * The final COMMITTED view of a key — reconstructed from the commit log,
 * never read off `snapshot.sharedState`.
 *
 * That distinction is the whole redaction contract: `sharedState` is the
 * run's LIVE state (unredacted by construction), while the commit log
 * carries what footprintjs scrubbed at commit time. Everything in this
 * file that serves a VALUE goes through here or through `commitValueAt`
 * directly; `sharedState` is read for key NAMES only.
 */
function committedFinal(index: ToolpackIndex, path: string): unknown {
  if (index.commitLog.length === 0) return undefined;
  return commitValueAt(index.commitLog, index.commitLog.length - 1, path);
}

export { redactionNote, honestyLine, basisLines, untrackedSourcesOf, truncateText, committedFinal };
