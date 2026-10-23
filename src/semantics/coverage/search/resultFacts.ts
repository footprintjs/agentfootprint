/**
 * search/resultFacts — the two facts a search tool's RESULT states out loud:
 * `resolved` (the entity a population value resolved to) and `paging` (whether
 * there is a next page).
 *
 * Pattern: one rule set, two doors (the `readItemExtras` law). The mint
 *          (`absent()`, `describedResult()`) THROWS a refusal at the line the
 *          author wrote; the reader (any envelope, minted anywhere) DROPS a
 *          malformed value — read, never repaired.
 * Role:    semantics/ layer, pure. The same spelling on the wire and in code
 *          (every key is one word).
 * Emits:   N/A.
 *
 * Both are the tool's own claims, said out loud — the trusted base. Each can
 * only NARROW what the library composes: `resolved` attaches to the value the
 * call was sent for and to no other entity; `paging.next` that is not null is
 * a gap, and a first page is complete only with `next: null`.
 */

import { refusal } from '../refusal.js';

/** One population value, resolved — `{ argument, id, name?, aliases? }`. */
export interface ResolvedDeclaration {
  /** The population argument the value was sent as. */
  readonly argument: string;
  readonly id: string;
  readonly name?: string;
  readonly aliases?: readonly string[];
}

/** `{ next }` — `null` says there is no next page; a cursor or page number says there is. */
export interface PagingDeclaration {
  readonly next: string | number | null;
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isWord = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

const RESOLVED_KEYS = ['argument', 'id', 'name', 'aliases'];

/** What is wrong with a `resolved` list, or `undefined` when it is fine. */
export function resolvedProblem(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return '`resolved` must be a non-empty list of { argument, id, name?, aliases? } — omit it to say nothing.';
  }
  for (const [i, raw] of value.entries()) {
    const at = `\`resolved[${i}]\``;
    if (!isPlain(raw)) return `${at} must be { argument, id, name?, aliases? }.`;
    const unknown = Object.keys(raw).find((k) => !RESOLVED_KEYS.includes(k));
    if (unknown !== undefined) return `${at} has an unknown key '${unknown}'.`;
    if (!isWord(raw.argument)) return `${at}.argument must name the population argument.`;
    if (!isWord(raw.id)) return `${at}.id must be a non-empty string.`;
    if (raw.name !== undefined && !isWord(raw.name))
      return `${at}.name must be a non-empty string.`;
    if (raw.aliases !== undefined && (!Array.isArray(raw.aliases) || !raw.aliases.every(isWord))) {
      return `${at}.aliases must be a list of non-empty strings.`;
    }
  }
  return undefined;
}

/** What is wrong with a `paging`, or `undefined` when it is fine. */
export function pagingProblem(value: unknown): string | undefined {
  if (!isPlain(value) || !('next' in value)) {
    return '`paging` must be { next } — `next: null` when there is no next page.';
  }
  const unknown = Object.keys(value).find((k) => k !== 'next');
  if (unknown !== undefined) return `\`paging\` has an unknown key '${unknown}'.`;
  const next = value.next;
  const ok = next === null || isWord(next) || (typeof next === 'number' && Number.isFinite(next));
  return ok
    ? undefined
    : '`paging.next` must be null (no next page), a cursor string or a page number.';
}

function copyResolved(list: readonly ResolvedDeclaration[]): readonly ResolvedDeclaration[] {
  return list.map((r) => ({
    argument: r.argument,
    id: r.id,
    ...(r.name !== undefined && { name: r.name }),
    ...(r.aliases !== undefined && { aliases: [...r.aliases] }),
  }));
}

/** The minted `resolved` — a copy — or `undefined` for none; THROWS a refusal when malformed. */
export function mintResolved(value: unknown): readonly ResolvedDeclaration[] | undefined {
  if (value === undefined || value === null) return undefined;
  const problem = resolvedProblem(value);
  if (problem !== undefined) throw refusal(problem);
  return copyResolved(value as readonly ResolvedDeclaration[]);
}

/** The minted `paging` — a copy — or `undefined` for none; THROWS a refusal when malformed. */
export function mintPaging(value: unknown): PagingDeclaration | undefined {
  if (value === undefined) return undefined;
  const problem = pagingProblem(value);
  if (problem !== undefined) throw refusal(problem);
  return { next: (value as PagingDeclaration).next };
}

/** A `resolved` read off an envelope — a copy, or `undefined` when absent or malformed. */
export function readResolved(value: unknown): readonly ResolvedDeclaration[] | undefined {
  if (value === undefined || value === null || resolvedProblem(value) !== undefined) {
    return undefined;
  }
  return copyResolved(value as readonly ResolvedDeclaration[]);
}

/** A `paging` read off an envelope — a copy, or `undefined` when absent or malformed. */
export function readPaging(value: unknown): PagingDeclaration | undefined {
  if (value === undefined || pagingProblem(value) !== undefined) return undefined;
  return { next: (value as PagingDeclaration).next };
}
