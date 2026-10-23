/**
 * resolve — which reads a PROSE claim names (design § 5.2): by the entity each call was SENT
 * for (its `resolved` id, name and aliases — store data never binds another entity's name), or,
 * for a search with no population, by its `source.said` words.
 *
 * Pattern: mentions are token sequences of the unit; a mention joined to another word by "or",
 *          "and", "nor" or a comma is a second entity, and an entity no read resolves makes the
 *          whole claim `entity-unresolved` — "payments or checkout" with one searched cannot pass
 *          as checked. The reads a claim RESTS ON are this turn's reads (any leg) of a resolved
 *          entity whose tool's `subject.said` word the unit names; a call on the same entity and
 *          another subject is never pulled in. A claim naming no entity is unresolved; the
 *          person's message and the single call of the turn only name a CANDIDATE.
 * Role:    integrity/ layer (L3), read by `prose.ts`.
 */

import { readResultIdentity } from '../claim-binding/capture.js';
import type { DetectedClaim } from './detect.js';
import { isRead, scopeOf } from './readings.js';
import type { StaleSince, TurnCall, TurnRecord } from './types.js';
import { findWords, holdsAnySaid, spell, spellValue, tokensOf, type Token } from './words.js';

/** The reads of one entity a claim names. */
export interface EntityGroup {
  readonly status: 'resolved' | 'stale' | 'subject-unmatched';
  /** For `resolved`: the reads the claim rests on. Otherwise the reads that named the entity. */
  readonly calls: readonly TurnCall[];
  readonly staleSince?: StaleSince;
}

export type ProseResolution =
  | { readonly status: 'groups'; readonly groups: readonly EntityGroup[] }
  | { readonly status: 'entity-unresolved'; readonly candidates: readonly string[] };

/** The calls of the answer's turn, in this recording. */
export function isCurrent(call: TurnCall, record: TurnRecord): boolean {
  try {
    const identity = readResultIdentity(call.resultId);
    // Namespace and turn, never the run id: a pause between legs of one turn keeps a read current.
    return identity.namespace === record.leg.namespace && call.turn === record.turn;
  } catch {
    return false;
  }
}

/** The names a read was sent for: each population value's resolved id, name and aliases. */
function namesOf(call: TurnCall): { entity: string; words: string[] }[] {
  const out: { entity: string; words: string[] }[] = [];
  for (const item of scopeOf(call) ?? []) {
    if (item.facet !== 'population' || item.resolved === undefined) continue;
    const entity = spellValue(item.resolved.id);
    for (const name of [item.resolved.id, item.resolved.name, ...(item.resolved.aliases ?? [])]) {
      if (typeof name !== 'string') continue;
      const words = spell(name);
      if (words.length > 0) out.push({ entity, words });
    }
  }
  return out;
}

const hasPopulation = (call: TurnCall): boolean =>
  (scopeOf(call) ?? []).some((item) => item.facet === 'population');

/** Words that join or frame entities, never name one. */
const GRAMMAR = new Set(
  (
    'a an the any no none not nor or and but so then also only just all each every either ' +
    'neither both some many most more less few other others its it their they them this that ' +
    'these those there here is are was were be been being has have had do does did will would ' +
    'can could may might must should in on at of to for from with by into over under about ' +
    'across within without between during since until than as if when while where which who ' +
    'what why how i we you he she me us my our your his her yet still ' +
    'found exist exists'
  ).split(' '),
);

/** Every word a declaration uses for a subject, source, qualifier or filter value. */
function declaredWords(record: TurnRecord): Set<string> {
  const out = new Set<string>();
  const add = (phrases: readonly string[] | undefined) => {
    for (const phrase of phrases ?? []) for (const word of spell(phrase)) out.add(word);
  };
  for (const tool of Object.values(record.tools)) {
    const search = tool.search;
    if (search === undefined) continue;
    add(search.subject.said);
    add(search.source.said);
    for (const fixed of search.fixed ?? []) add(fixed.said);
    for (const argument of search.arguments)
      for (const said of Object.values(argument.said ?? {})) add(said);
  }
  return out;
}

const JOINERS = new Set(['or', 'and', 'nor']);

/** Whether a mention is joined to a word that names an entity no read resolved. */
function joinedToUnknown(
  text: string,
  tokens: readonly Token[],
  mention: { first: number; last: number },
  covered: ReadonlySet<number>,
  declared: ReadonlySet<string>,
): boolean {
  const named = (i: number) => {
    const token = tokens[i];
    return (
      token !== undefined &&
      !covered.has(i) &&
      /^[\p{L}\p{N}]/u.test(token.text) &&
      !GRAMMAR.has(token.text) &&
      !declared.has(token.text)
    );
  };
  const gap = (a: number, b: number) => {
    const left = tokens[a];
    const right = tokens[b];
    return left === undefined || right === undefined ? '' : text.slice(left.end, right.start);
  };
  const after = mention.last + 1;
  if (JOINERS.has(tokens[after]?.text ?? '') && named(after + 1)) return true;
  if (gap(mention.last, after).includes(',') && named(after)) return true;
  const before = mention.first - 1;
  if (JOINERS.has(tokens[before]?.text ?? '') && named(before - 1)) return true;
  return gap(before, mention.first).includes(',') && named(before);
}

/** The reads a prose claim resolves to, grouped by entity. */
export function resolveProseClaim(
  claim: DetectedClaim,
  text: string,
  record: TurnRecord,
  personMessage?: string,
): ProseResolution {
  const tokens = claim.tokens;
  const reads = record.calls.filter((call) => isRead(call));
  const mentions: { entity: string; first: number; last: number }[] = [];
  for (const call of reads) {
    for (const { entity, words } of namesOf(call)) {
      for (let at = findWords(tokens, words); at !== -1; at = findWords(tokens, words, at + 1)) {
        mentions.push({ entity, first: at, last: at + words.length - 1 });
      }
    }
  }
  const covered = new Set(
    mentions.flatMap((m) => Array.from({ length: m.last - m.first + 1 }, (_, i) => m.first + i)),
  );
  const declared = declaredWords(record);
  if (mentions.some((m) => joinedToUnknown(text, tokens, m, covered, declared))) {
    return { status: 'entity-unresolved', candidates: [] };
  }
  const subjectFits = (call: TurnCall) =>
    holdsAnySaid(tokens, record.tools[call.toolName]?.search?.subject.said);

  if (mentions.length === 0) {
    const bySource = reads.filter(
      (call) =>
        isCurrent(call, record) &&
        !hasPopulation(call) &&
        holdsAnySaid(tokens, record.tools[call.toolName]?.search?.source.said),
    );
    if (bySource.length > 0) {
      const restsOn = bySource.filter(subjectFits);
      return {
        status: 'groups',
        groups: [
          restsOn.length > 0
            ? { status: 'resolved', calls: restsOn }
            : { status: 'subject-unmatched', calls: bySource },
        ],
      };
    }
    return { status: 'entity-unresolved', candidates: candidatesOf(record, reads, personMessage) };
  }

  const entities = [...new Set(mentions.map((m) => m.entity))];
  const groups = entities.map((entity): EntityGroup => {
    const named = reads.filter((call) => namesOf(call).some((n) => n.entity === entity));
    const current = named.filter((call) => isCurrent(call, record));
    if (current.length === 0) {
      const last = named[named.length - 1] as TurnCall;
      return {
        status: 'stale',
        calls: named,
        staleSince: {
          turn: last.turn,
          ...(last.readAt === undefined ? {} : { readAt: last.readAt }),
        },
      };
    }
    const restsOn = current.filter(subjectFits);
    return restsOn.length > 0
      ? { status: 'resolved', calls: restsOn }
      : { status: 'subject-unmatched', calls: current };
  });
  return { status: 'groups', groups };
}

/** A fallback's candidates: the reads the person's message names, else the turn's single call. */
function candidatesOf(
  record: TurnRecord,
  reads: readonly TurnCall[],
  personMessage: string | undefined,
): string[] {
  const current = reads.filter((call) => isCurrent(call, record));
  if (personMessage !== undefined) {
    const said = tokensOf(personMessage);
    const named = current.filter((call) =>
      namesOf(call).some((n) => findWords(said, n.words) !== -1),
    );
    if (named.length > 0) return named.map((call) => call.resultId);
  }
  return current.length === 1 ? [(current[0] as TurnCall).resultId] : [];
}
