/**
 * prose — the prose door (design § 5.2): negative phrases anchored in a dispatched read's
 * declared words, sent values or resolved names are resolved and NOTED against the record.
 * An anchor permits a finding, never binds an entity or establishes a claim. Observe-only:
 * a note never withholds, whatever the validation mode; a claim may carry no note.
 *
 * Pattern: detect (`detect.ts`) → data anchor (`anchor.ts`) → resolve (`resolve.ts`) → containment notes
 *          (`containment.ts`), one row per claim and one per unit the grammar could not judge
 *          (`in-code-block`, `language-unsupported`), in text order. A record that may be missing
 *          a call, or keeps one out by redaction, notes every claim `record-incomplete` and
 *          nothing else: nothing can be said around a hole. More than MAX_NEGATIVE_CLAIMS
 *          returns one `too-many-claims` note for the whole text, before reading the record.
 * Role:    integrity/ layer (L3). The agent's negativeClaims arm observes every original
 *          model string within a whole-answer budget and files these rows; no prose enforcement.
 *
 * Rows carry spans into the text, phrase ids, the pack version, note codes and result
 * identities — never a word of the text or a value of the record.
 */

import { claimWordsOf, entityNotes } from './containment.js';
import { proseAnchorOf } from './anchor.js';
import { detectNegativeClaims, type DetectedClaim } from './detect.js';
import { PROSE_NOTES } from './types.js';
import { MAX_NEGATIVE_CLAIMS } from './limits.js';
import { NEGATIVE_CLAIM_PHRASES_VERSION, type ResolvedNegativeClaimPhrases } from './phrases.js';
import { isCurrent, resolveProseClaim } from './resolve.js';
import { createProseWorkBudget, ProseWorkLimit, type ProseWorkBudget } from './work.js';
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
  /** App literal extensions, admitted once at configuration time. */
  readonly phrases?: ResolvedNegativeClaimPhrases;
  /** @internal One runtime observation shares this allowance across every field. */
  readonly work?: ProseWorkBudget;
}

const ordered = (notes: readonly ProseNote[]): ProseNote[] =>
  PROSE_NOTES.filter((note) => notes.includes(note));

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
  const resolution = resolveProseClaim(claim, text, record, input.personMessage, input.work);
  if (resolution.status === 'entity-unresolved') {
    return claimRow(field, claim, ['entity-unresolved'], [], { candidates: resolution.candidates });
  }
  const words = claimWordsOf(claim, text, record.clock, input.work);
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
  const detection = detectNegativeClaims(text, input.phrases);
  if (detection.claims.length > MAX_NEGATIVE_CLAIMS) {
    return [
      {
        kind: 'negative-claim-note',
        field,
        code: 'too-many-claims',
        span: { start: 0, end: text.length },
        packVersion: input.phrases?.version ?? NEGATIVE_CLAIM_PHRASES_VERSION,
      },
    ];
  }
  // Detection and its cap precede every record read. A phrase alone is not
  // a data claim; anchoring only permits a note, never resolves its entity.
  const work = input.work ?? createProseWorkBudget();
  try {
    work.charge(0);
    const anchored = detection.claims.length === 0 ? undefined : proseAnchorOf(record, work);
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
      ...detection.claims
        .filter((claim) => anchored?.(claim, text) === true)
        .map((claim) => judgeClaim({ ...input, work }, claim, peers)),
    ];
    return rows.sort((a, b) => a.span.start - b.span.start);
  } catch (error) {
    if (!(error instanceof ProseWorkLimit)) throw error;
    return [
      {
        kind: 'negative-claim-note',
        field,
        code: 'input-limit',
        span: { start: 0, end: text.length },
        packVersion: input.phrases?.version ?? NEGATIVE_CLAIM_PHRASES_VERSION,
      },
    ];
  }
}
