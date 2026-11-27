import { skillVisibleToRole } from '../lib/spokenIds.js';
import type {
  LLMMessage,
  PermissionChecker,
  PermissionRequest,
} from '../provider-contract/types.js';
import { hiddenSkillIdsFor } from './skillVisibility.js';

const WITHHELD = 'A saved skill catalog result is unavailable to this recipient.';

interface ListingRow {
  readonly id: string;
  readonly description: string;
}

function isRow(value: unknown): value is ListingRow {
  return (
    value !== null &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'string' &&
    'description' in value &&
    typeof value.description === 'string' &&
    Object.keys(value).length === 2
  );
}

/** Only the producer's recorded row order can authorize a selective rewrite. */
function rowsOf(content: string, ids: readonly string[]): readonly ListingRow[] | undefined {
  try {
    const rows: unknown = JSON.parse(content);
    return Array.isArray(rows) &&
      rows.length === ids.length &&
      rows.every((row: unknown, index) => isRow(row) && row.id === ids[index])
      ? rows
      : undefined;
  } catch {
    return undefined;
  }
}

function validIds(ids: unknown): ids is readonly string[] {
  return Array.isArray(ids) && ids.every((id: unknown) => typeof id === 'string');
}

function withheld(message: LLMMessage): LLMMessage {
  const { skillListing: _listing, toolChars: _toolChars, ...frame } = message;
  void _listing;
  void _toolChars;
  return { ...frame, content: WITHHELD };
}

function projectMessage(message: LLMMessage, hidden: ReadonlySet<string>): LLMMessage {
  const record = message.skillListing;
  if (!record || !validIds(record.ids)) return withheld(message);
  if (record.kind === 'derived')
    return record.ids.every((id) => skillVisibleToRole(id, hidden)) ? message : withheld(message);
  if (record.kind !== 'rows') return withheld(message);
  const rows = rowsOf(message.content, record.ids);
  if (rows === undefined) return withheld(message);
  const visible = rows.filter(({ id }) => skillVisibleToRole(id, hidden));
  return visible.length === rows.length
    ? message
    : {
        ...message,
        content: JSON.stringify(visible, null, 2),
        skillListing: { kind: 'rows', ids: visible.map(({ id }) => id) },
      };
}

/** Project saved catalog content without changing operator history or message framing. */
export async function projectSkillListingHistory(
  history: readonly LLMMessage[],
  checker: PermissionChecker | undefined,
  identity: PermissionRequest['identity'],
  signal?: AbortSignal,
): Promise<readonly LLMMessage[]> {
  const ids = new Set<string>();
  for (const message of history) {
    const recorded = message.skillListing?.ids;
    if (validIds(recorded)) for (const id of recorded) ids.add(id);
  }
  const hidden =
    checker === undefined
      ? undefined
      : new Set(await hiddenSkillIdsFor(checker, ids, identity, signal));
  let result: LLMMessage[] | undefined;
  for (const [index, message] of history.entries()) {
    if (!('skillListing' in message)) continue;
    const projected = hidden === undefined ? withheld(message) : projectMessage(message, hidden);
    if (projected === message) continue;
    result ??= [...history];
    result[index] = projected;
  }
  return result ?? history;
}

/** A fold inherits the provenance of catalog content admitted to the summarizer. */
export function foldedSkillListingOf(span: readonly LLMMessage[]): LLMMessage['skillListing'] {
  const ids = new Set<string>();
  for (const message of span) {
    if (!('skillListing' in message)) continue;
    const source = message.skillListing;
    if (!source || !validIds(source.ids) || (source.kind !== 'rows' && source.kind !== 'derived'))
      return { kind: 'unknown', ids: [] };
    for (const id of source.ids) ids.add(id);
  }
  return ids.size > 0 ? { kind: 'derived', ids: [...ids] } : undefined;
}
