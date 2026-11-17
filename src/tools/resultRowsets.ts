/** Explicit inert result bindings, shared by local definition and MCP intake. */
import { copyJson, ownData } from '../lib/boundedJson.js';
import { sourceEvidenceText } from '../artifacts/sourceEvidence/guards.js';
import { assertResultColumns, type ToolResultColumns } from '../integrity/column-types/types.js';

/** The final governed payload is addressed explicitly; no preview or historical fallback. */
export type ToolResultRowsetSource =
  | { readonly kind: 'inline'; readonly path: readonly string[] }
  | {
      readonly kind: 'published-dataset';
      readonly refPath: readonly string[];
      readonly artifactKind: string;
      readonly maxRows: number;
      readonly maxBytes: number;
    };

/** A named column contract on one rowset of the actual final tool payload. */
export interface ToolResultRowset {
  readonly key: string;
  readonly columns: ToolResultColumns;
  readonly source: ToolResultRowsetSource;
}

const pathIsValid = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.length <= 16 && value.every((key) => sourceEvidenceText(key, 256));

/** @internal Read the new metadata property without invoking an accessor or inheriting authority. */
export function resultRowsetsOf(
  toolName: string,
  owner: object,
  legacyColumns?: ToolResultColumns,
): readonly ToolResultRowset[] | undefined {
  const property = Object.getOwnPropertyDescriptor(owner, 'resultRowsets');
  if (property === undefined && !('resultRowsets' in owner)) return undefined;
  if (!property?.enumerable || !('value' in property))
    throw new TypeError(
      `defineTool: tool '${toolName}' requires resultRowsets as own enumerable data.`,
    );
  return readResultRowsets(toolName, property.value, legacyColumns);
}

/** @internal One bounded detached/frozen declaration reader; absent keeps the old path. */
export function readResultRowsets(
  toolName: string,
  input: unknown,
  legacyColumns?: ToolResultColumns,
): readonly ToolResultRowset[] | undefined {
  if (input === undefined) return undefined;
  if (legacyColumns !== undefined)
    throw new TypeError(
      `defineTool: tool '${toolName}' cannot combine resultColumns and resultRowsets.`,
    );
  try {
    const declarations = copyJson(input, 8192, true);
    if (!Array.isArray(declarations) || declarations.length < 1 || declarations.length > 8)
      throw new Error('Invalid rowset count.');
    const keys = new Set<string>();
    for (const raw of declarations) {
      const rowset = ownData(raw, ['key', 'columns', 'source']);
      if (!sourceEvidenceText(rowset.key, 128) || !rowset.key.trim() || keys.has(rowset.key))
        throw new Error('Invalid or duplicate rowset key.');
      keys.add(rowset.key);
      const columns = ownData(rowset.columns);
      for (const column of Object.values(columns))
        if (column !== null && typeof column === 'object') ownData(column, ['type', 'nullable']);
      assertResultColumns(toolName, columns);
      const source = ownData(rowset.source);
      if (source.kind === 'inline') {
        ownData(source, ['kind', 'path']);
        if (!pathIsValid(source.path)) throw new Error('Invalid inline path.');
      } else if (source.kind === 'published-dataset') {
        ownData(source, ['kind', 'refPath', 'artifactKind', 'maxRows', 'maxBytes']);
        if (
          !pathIsValid(source.refPath) ||
          !sourceEvidenceText(source.artifactKind, 256) ||
          !Number.isSafeInteger(source.maxRows) ||
          (source.maxRows as number) < 1 ||
          (source.maxRows as number) > 1000 ||
          !Number.isSafeInteger(source.maxBytes) ||
          (source.maxBytes as number) < 1 ||
          (source.maxBytes as number) > 1048576
        )
          throw new Error('Invalid published dataset binding.');
      } else throw new Error('Invalid rowset source.');
    }
    return declarations as unknown as readonly ToolResultRowset[];
  } catch {
    // Do not stringify untrusted declarations, call getters, or retain their values in diagnostics.
    throw new TypeError(
      `defineTool: tool '${toolName}' declares invalid resultRowsets. ` +
        'Use 1–8 unique named rowsets with valid columns and an explicit inline or bounded published-dataset source.',
    );
  }
}
