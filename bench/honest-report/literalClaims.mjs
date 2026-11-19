import { terminalAnswerText } from './terminalAnswer.mjs';

export function literalClaims(rows, applyOutputSchema, { allowTerminalObject = false } = {}) {
  const counts = {
    literalDone: 0, literalPartly: 0, ruleFalseDone: 0, incompleteRows: 0, usableIncompleteRows: 0,
  };
  for (const row of rows) {
    if (row.truth.reached) continue;
    counts.incompleteRows++;
    const scored = allowTerminalObject ? row.supplementalScore : row.score;
    if (scored.falseDone) counts.ruleFalseDone++;
    if (!scored.usable) continue;
    counts.usableIncompleteRows++;

    // The frozen scores already establish admissibility and which text parsed.
    const text = row.score.usable ? row.modelText : terminalAnswerText(row.modelText);
    const answer = applyOutputSchema(text.trim(), { parse: (value) => value });
    if (answer.status === 'done') counts.literalDone++;
    if (answer.status === 'partly') counts.literalPartly++;
  }
  return counts;
}
