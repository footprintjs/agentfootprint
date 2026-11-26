import { unitsOf, type TextSpan } from '../../../../../../integrity/negative-claim/units.js';
import { MAX_EXECUTION_CLAIM_FINDINGS, MAX_EXECUTION_CLAIM_PROSE_CHARS } from './bounds.js';

type Claim = 'ran-code' | 'no-code';
type Target = 'current' | 'previous';
type ClaimReference = Target | 'demonstrative';
type Evidence = 'confirmed' | 'none' | 'unknown';
type Outcome = 'verified' | 'contradicted' | 'unverified';

interface ExecutionClaimInput {
  readonly reply: string;
  readonly defaultTarget?: Target;
  readonly evidence: Partial<Record<Target, Evidence>>;
}

export interface ExecutionClaimAssessment {
  /** The prose and finding limits were not reached. */
  readonly complete: boolean;
  readonly findings: readonly {
    readonly claim: Claim;
    readonly target: Target | 'unresolved';
    readonly outcome: Outcome;
  }[];
}

const BLOCK_BREAK = /(?:\r\n|\n|\r(?!\n))[ \t]*(?:\r\n|\n|\r(?!\n))/gu;
const MARKED_PROSE = /[<>\x60[\]|:\\]|^(?: {4}|\t| {0,3}#{1,6}(?:[ \t]|$))/mu;
const QUOTE_MARKS = /["“”„«»‹›]|(?<![\p{L}\p{N}])['‘’]|['‘’](?![\p{L}\p{N}])/gu;
const QUOTE_PAIRS = new Map([
  ['"', '"'],
  ["'", "'"],
  ['“', '”'],
  ['„', '“'],
  ['‘', '’'],
  ['«', '»'],
  ['‹', '›'],
]);

function quoteState(block: string): 'none' | 'closed' | 'uncertain' {
  const closers: string[] = [];
  let quoted = false;
  for (const [mark] of block.matchAll(QUOTE_MARKS)) {
    quoted = true;
    if (mark === closers.at(-1)) {
      closers.pop();
    } else {
      const closer = QUOTE_PAIRS.get(mark);
      if (closer === undefined) return 'uncertain';
      closers.push(closer);
    }
  }
  if (closers.length > 0) return 'uncertain';
  return quoted ? 'closed' : 'none';
}

function plainBlocks(reply: string): readonly TextSpan[] {
  const blocks: TextSpan[] = [];
  const retain = (start: number, end: number): boolean => {
    const block = reply.slice(start, end);
    const quotes = quoteState(block);
    // A sustained quote, an HTML block, or a forwarded introduction could
    // continue through blank lines. Later attribution is uncertain.
    if (quotes === 'uncertain' || block.includes('<') || block.trimEnd().endsWith(':'))
      return false;
    // Omit the entire Markdown quote, including its lazy continuation lines.
    if (quotes === 'none' && !MARKED_PROSE.test(block)) blocks.push({ start, end });
    return true;
  };
  let start = 0;
  for (const split of reply.matchAll(BLOCK_BREAK)) {
    if (!retain(start, split.index)) return blocks;
    start = split.index + split[0].length;
  }
  retain(start, reply.length);
  return blocks;
}

const TURN_REFERENCE =
  / (?:for|in|during) ((?:this|that|the current) (?:answer|turn)|(?:the|my) (?:last|previous) answer)$/iu;
const RAN = /^i (?:ran|executed) code(?: to estimate)?$/iu;
const DID_NOT_RUN = /^i (?:did not|didn't) (?:run|execute) code$/iu;
const ESTIMATED_WITHOUT_CODE =
  /^i (?:(?:only|just) )?estimated(?:,? without (?:running|executing) code|,? and (?:did not|didn't) (?:run|execute) code)$/iu;
const OUTPUT_FROM_CODE =
  /^(?:this|that|the) (?:number|figure|total|value|result|estimate) (?:came from code|was calculated (?:by|using|with) code)$/iu;
const RAN_FOR_OUTPUT =
  /^i (?:ran|executed) code (?:for|to calculate) (?:this|that|the) (?:number|figure|total|value|result|estimate)$/iu;
const ESTIMATED_OUTPUT_WITHOUT_CODE =
  /^i (?:(?:only|just) )?estimated (?:this|that|the) (?:number|figure|total|value|result|estimate),? without (?:running|executing) code$/iu;

function readClaim(
  text: string,
): { claim: Claim; target: ClaimReference | undefined; outputScoped: boolean } | undefined {
  const sentence = text
    .replace(/[.!]$/u, '')
    .replace(/[ \t]+/gu, ' ')
    .replace(/’/gu, "'");
  const reference = TURN_REFERENCE.exec(sentence);
  const assertion = reference === null ? sentence : sentence.slice(0, reference.index);
  const wording = reference?.[1]?.toLowerCase();
  let target: ClaimReference | undefined;
  if (wording?.startsWith('that ')) target = 'demonstrative';
  else if (wording !== undefined)
    target = /\b(?:previous|last)\b/u.test(wording) ? 'previous' : 'current';

  if (RAN.test(assertion)) return { claim: 'ran-code', target, outputScoped: false };
  if (DID_NOT_RUN.test(assertion) || ESTIMATED_WITHOUT_CODE.test(assertion))
    return { claim: 'no-code', target, outputScoped: false };
  if (OUTPUT_FROM_CODE.test(assertion) || RAN_FOR_OUTPUT.test(assertion))
    return { claim: 'ran-code', target, outputScoped: true };
  if (ESTIMATED_OUTPUT_WITHOUT_CODE.test(assertion))
    return { claim: 'no-code', target, outputScoped: true };
  return undefined;
}

function own(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return field?.enumerable === true && Object.hasOwn(field, 'value') ? field.value : undefined;
  } catch {
    return undefined;
  }
}

function outcomeOf(claim: Claim, evidence: unknown): Outcome {
  if (evidence !== 'confirmed' && evidence !== 'none') return 'unverified';
  return (claim === 'ran-code') === (evidence === 'confirmed') ? 'verified' : 'contradicted';
}

/** Compare only narrow factual assertions against the selected turn's admitted evidence. */
export function assessExecutionClaims(
  input: ExecutionClaimInput,
): ExecutionClaimAssessment | undefined {
  const reply = own(input, 'reply');
  if (typeof reply !== 'string') return undefined;
  if (reply.length > MAX_EXECUTION_CLAIM_PROSE_CHARS) return { complete: false, findings: [] };
  // Every admitted phrase names code explicitly. Ordinary prose does not
  // need the Markdown and sentence scans.
  if (!/\bcode\b/iu.test(reply)) return undefined;
  const suppliedTarget = own(input, 'defaultTarget');
  const defaultTarget =
    suppliedTarget === 'current' || suppliedTarget === 'previous' ? suppliedTarget : undefined;
  // Only an exact earlier-answer question binds "that answer" to a turn.
  // The ordinary current default supplies no antecedent for a demonstrative.
  const demonstrativeTarget = defaultTarget === 'previous' ? defaultTarget : undefined;
  const evidence = own(input, 'evidence');
  const blocks = plainBlocks(reply);
  const { units } = unitsOf(reply);
  const findings: ExecutionClaimAssessment['findings'][number][] = [];
  let index = 0;
  for (const unit of units) {
    while (index < blocks.length && blocks[index].end < unit.end) index++;
    const block = blocks[index];
    if (unit.fenced || block === undefined || unit.start < block.start) continue;
    // The shared splitter also produces clauses. Reading one out of its
    // sentence can turn a hypothetical or attribution into an assertion.
    let preceding = unit.start - 1;
    while (preceding >= block.start && /\s/u.test(reply[preceding])) preceding--;
    if (preceding >= block.start && reply[preceding] !== '.') continue;
    const claim = readClaim(reply.slice(unit.start, unit.end));
    if (claim === undefined) continue;
    if (findings.length === MAX_EXECUTION_CLAIM_FINDINGS) return { complete: false, findings: [] };
    const target =
      claim.target === 'demonstrative' ? demonstrativeTarget : claim.target ?? defaultTarget;
    const outcome =
      target === undefined || claim.outputScoped
        ? 'unverified'
        : outcomeOf(claim.claim, own(evidence, target));
    findings.push({ claim: claim.claim, target: target ?? 'unresolved', outcome });
  }
  return findings.length > 0 ? { complete: true, findings } : undefined;
}
