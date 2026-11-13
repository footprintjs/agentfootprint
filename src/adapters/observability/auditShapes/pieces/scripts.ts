import type {
  ScriptBlockVerdict,
  ScriptsVerdict,
  ShownScript,
  TurnEndScripts,
} from '../../../../lib/scriptRecord.js';
import { charsMarker, listOf, num, oneOf, shapeOf, str } from '../../auditBounding.js';

export const SCRIPT_LABELS = [
  'submitted',
  'returned',
  'reported-success',
  'reported-failure',
  'completed',
  'completed-with-failure',
  'outcome-unknown',
] as const;

/** A submitted program's attached record: only its text is content. */
export const boundShownScript = shapeOf<ShownScript>({
  toolCallId: str,
  dispatch: num,
  tool: str,
  language: str,
  label: oneOf(...SCRIPT_LABELS),
  exitCode: num,
  resultWithheld: oneOf('over-ceiling'),
  rewritten: oneOf(true),
  bytes: num,
  lines: num,
  truncated: shapeOf<NonNullable<ShownScript['truncated']>>({ shownBytes: num }),
  text: charsMarker,
});

/** Attachment summary: preserve every declared field, check every runtime child. */
export const boundScripts = shapeOf<TurnEndScripts>({
  shown: listOf(boundShownScript),
  omitted: num,
  closedFence: shapeOf<NonNullable<TurnEndScripts['closedFence']>>({
    char: oneOf('backtick', 'tilde'),
    length: num,
  }),
  withheldFromText: oneOf(true),
});

/** Match verdicts contain labels and references, never the program. */
export const boundScriptsVerdict = shapeOf<ScriptsVerdict>({
  blocks: listOf(
    shapeOf<ScriptBlockVerdict>({
      block: num,
      label: oneOf(...SCRIPT_LABELS, 'unmatched'),
      exitCode: num,
      toolCallId: str,
      tool: str,
      dispatch: num,
      alsoMatches: num,
      reason: oneOf('no-submission-this-turn', 'over-size', 'kept-out'),
    }),
  ),
  earlierTurnRows: num,
  regionsDropped: num,
  scriptsDropped: num,
});
