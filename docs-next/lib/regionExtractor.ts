/**
 * regionExtractor — pull a named region out of a source file.
 *
 * Region markers use comment fences:
 *   // #region <name>
 *   ...code...
 *   // #endregion <name>
 *
 * Ported verbatim from the Starlight docs-site so <CodeFile> behaves identically:
 * region not found → throws (docs build fails loudly), region found → the lines
 * between the markers, dedented.
 */

export interface ExtractRegionResult {
  readonly code: string;
  readonly startLine: number;
  readonly endLine: number;
}

export class RegionNotFoundError extends Error {
  constructor(filePath: string, regionName: string) {
    super(
      `Region '${regionName}' not found in ${filePath}. Add markers:\n` +
        `  // #region ${regionName}\n` +
        `  ...your code...\n` +
        `  // #endregion ${regionName}`,
    );
    this.name = 'RegionNotFoundError';
  }
}

export function extractRegion(
  source: string,
  regionName: string,
  filePath: string,
): ExtractRegionResult {
  const lines = source.split('\n');
  let startIdx = -1;
  let endIdx = -1;

  const startRe = new RegExp(`//\\s*#region\\s+${escapeRegex(regionName)}\\b`);
  const endRe = new RegExp(`//\\s*#endregion\\s+${escapeRegex(regionName)}\\b`);

  for (let i = 0; i < lines.length; i++) {
    if (startIdx === -1 && startRe.test(lines[i]!)) startIdx = i;
    else if (startIdx !== -1 && endRe.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }

  if (startIdx === -1 || endIdx === -1) {
    throw new RegionNotFoundError(filePath, regionName);
  }

  const regionLines = lines.slice(startIdx + 1, endIdx);

  return {
    code: dedent(regionLines).join('\n'),
    startLine: startIdx + 2,
    endLine: endIdx,
  };
}

export function extractWholeFile(source: string): string {
  return source;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedent(lines: readonly string[]): string[] {
  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = line.match(/^(\s*)/);
    if (match) minIndent = Math.min(minIndent, match[1]!.length);
  }
  if (minIndent === Infinity || minIndent === 0) return [...lines];
  return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent)));
}
