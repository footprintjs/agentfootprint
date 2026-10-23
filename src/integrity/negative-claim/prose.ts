/**
 * prose — the prose door (design § 5.2): every negative claim the grammar finds in a text,
 * resolved to the reads it names and NOTED against them. Observe-only: a note never withholds,
 * whatever the validation mode; a claim may carry no note.
 *
 * Pattern: detect (`detect.ts`) → resolve (`resolve.ts`) → containment notes
 *          (`containment.ts`), one row per claim and one per unit the grammar could not judge
 *          (`in-code-block`, `language-unsupported`), in text order. A record that may be missing
 *          a call, or keeps one out by redaction, notes every claim `record-incomplete` and
 *          nothing else: nothing can be said around a hole. More than MAX_NEGATIVE_CLAIMS
 *          returns one `too-many-claims` note for the whole text, before reading the record.
 * Role:    integrity/ layer (L3). Not wired: PR 5 files these rows from the Route decider
 *          behind `.negativeClaims({ prose })`.
 *
 * Rows carry spans into the text, phrase ids, the pack version, note codes and result
 * identities — never a word of the text or a value of the record.
 */

import { claimWordsOf, entityNotes } from './containment.js';
import { detectNegativeClaims, type DetectedClaim } from './detect.js';
import { MAX_NEGATIVE_CLAIMS } from './limits.js';
import { NEGATIVE_CLAIM_PHRASES_VERSION } from './phrases.js';
import { isCurrent, resolveProseClaim } from './resolve.js';
import type {
  ProseClaimRow,
  ProseNote,
  ProseRow,
  StaleSince,
  TurnCall,
  TurnRecord,
} from './types.js';

export interface ProseCheckInput {
  /** The answer field the text came from — names the rows. */
  readonly field: string;
  /** The text — untrusted model output. */
  readonly text: string;
  readonly record: TurnRecord;
  /** The person's last message — names a CANDIDATE for an entity-less claim, never a binding. */
  readonly personMessage?: string;
}

/** The order notes are listed in on a row. */
const NOTE_ORDER: readonly ProseNote[] = [
  'record-incomplete',
  'stale-turn',
  'entity-unresolved',
  'subject-unmatched',
  'contradicted-by-rows',
  'readings-disagree',
  'call-not-read',
  'coverage-unverified',
  'declaration-overclaimed',
  'empty-undeclared',
  'clarify-open',
  'rows-undecided',
  'scope-wider',
  'coverage-gap',
  'gap-relevance-unknown',
  'cap-reached',
  'paged',
  'partial',
  'ranking',
  'search-incomplete',
  'period-not-held',
  'period-partly-held',
  'period-unknown',
  'period-undeclared',
  'later-read-failed',
  'superseded-by-write',
];

const ordered = (notes: readonly ProseNote[]): ProseNote[] =>
  NOTE_ORDER.filter((note) => notes.includes(note));

function claimRow(
  field: string,
  claim: DetectedClaim,
  notes: readonly ProseNote[],
  results: readonly TurnCall[],
  extra: { candidates?: readonly string[]; staleSince?: StaleSince } = {},
): ProseClaimRow {
  return {
    kind: 'negative-claim',
    field,
    claim: claim.kind,
    span: claim.span,
    phraseId: claim.phraseId,
    packVersion: claim.packVersion,
    notes: ordered(notes),
    results: [...new Set(results.map((call) => call.resultId))],
    ...(extra.candidates === undefined || extra.candidates.length === 0
      ? {}
      : { candidates: extra.candidates }),
    ...(extra.staleSince === undefined ? {} : { staleSince: extra.staleSince }),
  };
}

/** Judge one claim against the record. */
function judgeClaim(
  input: ProseCheckInput,
  claim: DetectedClaim,
  peers: readonly TurnCall[],
): ProseClaimRow {
  const { field, text, record } = input;
  if (!record.ledgerComplete || peers.some((call) => call.keptOut === true)) {
    return claimRow(field, claim, ['record-incomplete'], []);
  }
  const resolution = resolveProseClaim(claim, text, record, input.personMessage);
  if (resolution.status === 'entity-unresolved') {
    return claimRow(field, claim, ['entity-unresolved'], [], { candidates: resolution.candidates });
  }
  const words = claimWordsOf(claim, text, record.clock);
  const notes: ProseNote[] = [];
  const results: TurnCall[] = [];
  let staleSince: StaleSince | undefined;
  for (const group of resolution.groups) {
    results.push(...group.calls);
    if (group.status === 'stale') {
      notes.push('stale-turn');
      staleSince = group.staleSince;
    } else if (group.status === 'subject-unmatched') {
      notes.push('subject-unmatched');
    } else {
      notes.push(...entityNotes(group.calls, words, record, peers));
    }
  }
  const inOrder = record.calls.filter((call) => results.includes(call));
  return claimRow(field, claim, notes, inOrder, staleSince === undefined ? {} : { staleSince });
}

/** Note each claim, or one whole-text overflow note without judging any claim. */
export function judgeProseNegatives(input: ProseCheckInput): ProseRow[] {
  const { field, text, record } = input;
  const detection = detectNegativeClaims(text);
  if (detection.claims.length > MAX_NEGATIVE_CLAIMS) {
    return [
      {
        kind: 'negative-claim-note',
        field,
        code: 'too-many-claims',
        span: { start: 0, end: text.length },
        packVersion: NEGATIVE_CLAIM_PHRASES_VERSION,
      },
    ];
  }
  const peers = record.calls.filter((call) => isCurrent(call, record));
  const rows: ProseRow[] = [
    ...detection.notes.map((note) => ({
      kind: 'negative-claim-note' as const,
      field,
      code: note.code,
      span: note.span,
      packVersion: note.packVersion,
      ...(note.phraseId === undefined ? {} : { phraseId: note.phraseId }),
    })),
    ...detection.claims.map((claim) => judgeClaim(input, claim, peers)),
  ];
  return rows.sort((a, b) => a.span.start - b.span.start);
}
