/**
 * scripts/match — is a fenced block the program ONE call of this turn
 * submitted? Identity against the record, never evidence for a value.
 *
 * Pattern: pure function over the answer and this turn's rows.
 * Role:    core/ layer. Asked inside the ONE judge closure the Route decider
 *          builds (`stages/route.ts` · `judgeEvidence`, through `judge.ts`),
 *          before the names-and-numbers extractor reads the text — so the
 *          draft and the delivered candidate are read alike. Only under
 *          `.namesAndNumbersFromEvidence({ code: 'match' })`.
 * Emits:   N/A.
 *
 * ## The match rule: exact, after removing only the wrapper (design § 5.2)
 *
 * A block matches a call only when its content (`../evidence/codeRegions.ts`)
 * equals the program the call SUBMITTED to the tool, byte for byte. Nothing is
 * transformed: no trailing-space strip, no line-ending rewrite, no Unicode
 * normalization, no shape, no edit distance — each can change a literal and so
 * the program (`print(len("""A  \nB"""))` prints 5, its copy without the two
 * spaces 3; `"é"` written with a combining mark is one more character than its
 * NFC form). The strings are compared as they hold the text (UTF-16 code
 * units): for well-formed text that is UTF-8 byte equality, and for a lone
 * surrogate it is stricter, the safe direction.
 *
 * - Against the rows of the CURRENT TURN only; earlier turns are counted
 *   (`earlierTurnRows`), never compared, and a miss says "no submission of
 *   this turn", never "no submission".
 * - A block over `MAX_SCRIPT_BYTES` is `over-size`: no row keeps a program
 *   that long, so it is never compared.
 * - Two calls that submitted byte-identical programs: the block names the
 *   LATEST, counts the rest (`alsoMatches`) and carries its label.
 * - No nearest submission is ever named: a near match is a different program.
 *
 * WHAT A MATCH YIELDS. The block is script content: it is cut out of the text
 * the extractor reads, so it yields no value candidates — and it grounds
 * nothing: the evidence corpus is untouched, so a value in the prose that also
 * sits in the script still needs a result. A MISS stays in the text and is
 * checked as prose, exactly as today.
 *
 * COST. One linear scan of the answer (`codeRegionsOf`); each of at most
 * `MAX_CODE_REGIONS` blocks is looked up once among at most `MAX_SCRIPT_ROWS`
 * programs of at most `MAX_SCRIPT_BYTES` — within the 512 comparisons per
 * judged answer of design § 4.4. Earlier turns add nothing.
 */

import { codeRegionsOf, type CodeRegion } from '../evidence/codeRegions.js';
import { utf8Length } from '../../../lib/utf8.js';
import { MAX_SCRIPT_BYTES, type TurnScripts } from './rows.js';
import type { ScriptBlockVerdict, ScriptRow, ScriptsVerdict } from './types.js';

/** One answer, read for its scripts. */
export interface ShownScripts {
  /** The answer with every MATCHED block cut out — what the extractor reads. */
  readonly prose: string;
  /** The answer with EVERY block cut out — "the prose", for `unsupported[].region`. */
  readonly outsideCode: string;
  readonly verdict: ScriptsVerdict;
}

/** The text with `cut` regions removed, whole lines each (fence lines included). */
function without(text: string, cut: readonly CodeRegion[]): string {
  if (cut.length === 0) return text;
  const parts: string[] = [];
  let from = 0;
  for (const region of cut) {
    parts.push(text.slice(from, region.start));
    from = region.end;
  }
  parts.push(text.slice(from));
  return parts.join('');
}

/** Whether a block's content is over the per-script bound — never compared then. */
function overSize(content: string): boolean {
  // Every UTF-16 unit is at least one UTF-8 byte: a long string is over at once.
  return content.length > MAX_SCRIPT_BYTES || utf8Length(content) > MAX_SCRIPT_BYTES;
}

/**
 * Read `answer`'s fenced blocks against this turn's submissions. Pure; the
 * rows are `rows.ts` · `scriptRowsOfTurn`'s reading (last row per call).
 */
export function readShownScripts(
  answer: string,
  turn: TurnScripts,
  scriptsDropped?: number,
): ShownScripts {
  const { regions, dropped } = codeRegionsOf(answer);
  // The programs this turn submitted, each with every call that submitted it,
  // in the order the calls were made — the last is "the latest".
  const byProgram = new Map<string, ScriptRow[]>();
  for (const row of turn.current) {
    if (row.text === undefined) continue;
    const calls = byProgram.get(row.text);
    if (calls === undefined) byProgram.set(row.text, [row]);
    else calls.push(row);
  }
  const blocks: ScriptBlockVerdict[] = [];
  const matched: CodeRegion[] = [];
  for (const region of regions) {
    if (overSize(region.content)) {
      blocks.push({ block: region.block, label: 'unmatched', reason: 'over-size' });
      continue;
    }
    const calls = byProgram.get(region.content);
    if (calls === undefined) {
      blocks.push({ block: region.block, label: 'unmatched', reason: 'no-submission-this-turn' });
      continue;
    }
    const latest = calls[calls.length - 1] as ScriptRow;
    matched.push(region);
    blocks.push({
      block: region.block,
      label: latest.outcome,
      ...(latest.exitCode !== undefined && { exitCode: latest.exitCode }),
      toolCallId: latest.toolCallId,
      tool: latest.tool,
      ...(calls.length > 1 && { alsoMatches: calls.length - 1 }),
    });
  }
  return {
    prose: without(answer, matched),
    outsideCode: without(answer, regions),
    verdict: {
      blocks,
      earlierTurnRows: turn.earlier,
      regionsDropped: dropped,
      ...(scriptsDropped !== undefined && scriptsDropped > 0 && { scriptsDropped }),
    },
  };
}

/**
 * A verdict as detached plain data — field by field, never a reference into
 * state (a value read back through a TypedScope is a live view, and an event
 * payload must be plain data).
 */
export function copyScriptsVerdict(verdict: ScriptsVerdict): ScriptsVerdict {
  return {
    blocks: verdict.blocks.map((b) =>
      b.label === 'unmatched'
        ? { block: b.block, label: 'unmatched' as const, reason: b.reason }
        : {
            block: b.block,
            label: b.label,
            ...(b.exitCode !== undefined && { exitCode: b.exitCode }),
            toolCallId: b.toolCallId,
            tool: b.tool,
            ...(b.alsoMatches !== undefined && { alsoMatches: b.alsoMatches }),
          },
    ),
    earlierTurnRows: verdict.earlierTurnRows,
    regionsDropped: verdict.regionsDropped,
    ...(verdict.scriptsDropped !== undefined && { scriptsDropped: verdict.scriptsDropped }),
  };
}
