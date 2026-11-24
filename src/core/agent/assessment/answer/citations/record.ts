import { BINDING_REASONS } from '../../../../../integrity/claim-binding/types.js';
import { readOwnList } from '../../../../../lib/boundedJson.js';
import { isPlaceholder } from '../../../../../redaction/marker.js';
import type { AnswerCitationRecord } from '../../../citations/accepted.js';
import { fire, type Gathered } from '../../gathered.js';
import { statePointer } from '../../pointer.js';
import { MAX_CITATION_PROSE_CHARS, MAX_CITATION_REFERENCES } from './bounds.js';
import { isCitationColumnName } from './check/checkColumn.js';

type CitationFinding = AnswerCitationRecord['findings'][number];
type CitationVerdict = Extract<CitationFinding, { kind: 'citation'; outcome: 'unverified' }>;
const UNVERIFIED_REASONS: ReadonlySet<unknown> = new Set<CitationVerdict['reason']>([
  ...BINDING_REASONS,
  'assertion-mismatch',
  'comparison-unavailable',
  'evidence-unavailable',
  'offer-unavailable',
  'scope-unresolved',
  'value-type-mismatch',
]);

function dataAt(value: unknown, key: PropertyKey): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const property = Object.getOwnPropertyDescriptor(value, key);
  return property?.enumerable === true && Object.hasOwn(property, 'value')
    ? property.value
    : undefined;
}

function validIndex(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function readableName(value: unknown, served: boolean): value is string {
  return isCitationColumnName(value) && !(served && isPlaceholder(value));
}

function readFinding(raw: unknown, served: boolean): CitationFinding | undefined {
  const start = dataAt(raw, 'start');
  const end = dataAt(raw, 'end');
  if (
    !validIndex(start, 0, MAX_CITATION_PROSE_CHARS) ||
    !validIndex(end, start + 1, MAX_CITATION_PROSE_CHARS)
  )
    return undefined;

  const slot = dataAt(raw, 'slot');
  const reason = dataAt(raw, 'reason');
  switch (dataAt(raw, 'kind')) {
    case 'column': {
      const name = dataAt(raw, 'name');
      if (
        reason !== 'ungrounded-entity' ||
        !readableName(name, served) ||
        !validIndex(slot, 1, MAX_CITATION_REFERENCES)
      )
        return undefined;
      const nearestName = dataAt(raw, 'nearestName');
      return {
        kind: 'column',
        start,
        end,
        slot,
        reason,
        name,
        ...(readableName(nearestName, served) && nearestName !== name && { nearestName }),
      };
    }
    case 'citation': {
      const outcome = dataAt(raw, 'outcome');
      if (outcome === 'unverified' && UNVERIFIED_REASONS.has(reason)) {
        if (reason === 'offer-unavailable' && slot === undefined)
          return { kind: 'citation', start, end, outcome, reason };
        if (!validIndex(slot, 1, MAX_CITATION_REFERENCES)) return undefined;
        return {
          kind: 'citation',
          start,
          end,
          slot,
          outcome,
          reason: reason as CitationVerdict['reason'],
        };
      }
      if (
        (outcome === 'supported' || outcome === 'contradicted') &&
        validIndex(slot, 1, MAX_CITATION_REFERENCES)
      )
        return { kind: 'citation', start, end, slot, outcome };
      return undefined;
    }
    default:
      return undefined;
  }
}

function findingRows(record: unknown) {
  const rows = readOwnList(dataAt(record, 'findings'), MAX_CITATION_REFERENCES + 1);
  return rows === undefined || rows.unread > 0 ? undefined : rows.entries;
}

/** Use the native retained record for the warning composed into the answer. */
export function citationRecordForWarning(original: unknown, retained: unknown): unknown {
  if (retained === original) return original;
  const complete = dataAt(retained, 'complete');
  const findings = findingRows(retained);
  if (typeof complete !== 'boolean' || findings === undefined) return undefined;
  // Keep original addresses for the fold's witnesses even when a row is masked.
  return {
    complete,
    findings: findings.map((row) => readFinding(row, true) ?? null),
    ...readComparisons(retained),
  };
}

type ComparisonRecord = Pick<AnswerCitationRecord, 'comparisonComplete' | 'conflicts'>;

function readComparisons(record: unknown): ComparisonRecord {
  const complete = dataAt(record, 'comparisonComplete');
  if (complete === undefined) return {};
  const unavailable = { comparisonComplete: false, conflicts: [] } as const;
  if (complete !== true) return unavailable;
  const rows = readOwnList(dataAt(record, 'conflicts'), MAX_CITATION_REFERENCES);
  if (rows === undefined || rows.unread > 0) return unavailable;
  const conflicts: [number, number][] = [];
  const seen = new Set<string>();
  for (const raw of rows.entries) {
    const pair = readOwnList(raw, 2);
    if (pair === undefined || pair.unread > 0 || pair.entries.length !== 2) return unavailable;
    const [first, second] = pair.entries;
    if (
      !validIndex(first, 1, MAX_CITATION_REFERENCES) ||
      !validIndex(second, first + 1, MAX_CITATION_REFERENCES)
    )
      return unavailable;
    const key = `${first}:${second}`;
    if (seen.has(key)) return unavailable;
    seen.add(key);
    conflicts.push([first, second]);
  }
  return { comparisonComplete: true, conflicts };
}

/** Read only the public fields of a terminal citation record, preserving witnessed indices. */
export function readCitationRows(
  state: Readonly<Record<string, unknown>>,
  gathered: Gathered,
  served: boolean,
): void {
  let entries: readonly { readonly finding: CitationFinding | undefined; readonly index: number }[];
  let compared: ComparisonRecord;
  try {
    // Register a whole-key redaction with the ordinary kept-out guard without invoking a getter.
    if (served && !Reflect.has(state, 'answerCitations')) return;
    const record = dataAt(state, 'answerCitations');
    const complete = dataAt(record, 'complete');
    if (typeof complete !== 'boolean') return;
    const rows = complete ? findingRows(record) : [];
    if (rows === undefined) return;
    entries = rows.map((raw, index) => ({ finding: readFinding(raw, served), index }));
    compared = readComparisons(record);
    if (!complete) {
      gathered.citations = { complete: false, findings: [], ...compared };
      fireComparisons(compared, gathered);
      return;
    }
  } catch {
    // A malformed saved citation cannot supply a public finding.
    return;
  }

  const links = entries.flatMap(({ finding }) =>
    finding?.kind === 'citation' && finding.slot !== undefined ? [finding] : [],
  );
  const oneSource = new Set(links.map(({ slot }) => slot)).size === 1;
  const oneColumn = entries.filter(({ finding }) => finding?.kind === 'column').length === 1;
  const findings: CitationFinding[] = [];
  for (const { index, finding } of entries) {
    if (finding === undefined) continue;
    if (finding.kind === 'column') {
      if (
        !oneSource ||
        !oneColumn ||
        !links.some(
          ({ slot, start, end }) =>
            slot === finding.slot && start === finding.start && end === finding.end,
        )
      )
        continue;
      fire(
        gathered,
        'ungrounded-entity',
        statePointer('answerCitations', 'findings', index, 'name'),
      );
    } else if (finding.outcome === 'contradicted') {
      fire(
        gathered,
        'unsupported-claim',
        statePointer('answerCitations', 'findings', index, 'outcome'),
      );
    }
    findings.push(finding);
  }
  fireComparisons(compared, gathered);
  gathered.citations = { complete: findings.length === entries.length, findings, ...compared };
}

function fireComparisons(record: ComparisonRecord, gathered: Gathered): void {
  record.conflicts?.forEach((_, index) => {
    fire(gathered, 'sources-conflict', statePointer('answerCitations', 'conflicts', index));
  });
}
