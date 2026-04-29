/**
 * regionExtractor — pull a named region out of a source file.
 *
 * Region markers in source files (TypeScript / JavaScript / etc.) use
 * comment fences:
 *
 *   // #region <name>
 *   ...code...
 *   // #endregion <name>
 *
 * Used by the `<CodeFile>` Astro component so docs pages can import
 * just the relevant slice of an example, not the whole file. Anchor:
 * "name" must match exactly between #region and #endregion.
 *
 * Behavior:
 *   - Region not found → throws (so docs build fails loudly)
 *   - Region found    → returns the lines BETWEEN the markers,
 *                       trimmed of common leading whitespace so the
 *                       code reads naturally even if the region was
 *                       indented inside a function.
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

/**
 * Extract a named region from source content. Throws RegionNotFoundError
 * if either the start or end marker is missing.
 */
export function extractRegion(
  source: string,
  regionName: string,
  filePath: string,
): ExtractRegionResult {
  const lines = source.split('\n');
  let startIdx = -1;
  let endIdx = -1;

  // Use \\b boundary so #region defineFoo doesn't match #region define.
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

  // Take lines BETWEEN the markers (exclusive on both ends).
  const regionLines = lines.slice(startIdx + 1, endIdx);

  return {
    code: dedent(regionLines).join('\n'),
    startLine: startIdx + 2,
    endLine: endIdx,
  };
}

/**
 * Read the entire file contents as a code string. No region extraction.
 * Used when `<CodeFile>` is called without a `region` prop.
 */
export function extractWholeFile(source: string): string {
  return source;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip the longest common leading whitespace from a block of lines.
 * Empty lines are ignored when computing the common indent. Preserves
 * relative indentation between non-empty lines.
 */
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
