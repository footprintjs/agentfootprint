import type { CodeResult } from '../../provider-contract/types.js';

/**
 * The one line that states how the run ended — built only from the fields the
 * runner supplied, and never contradicting one of them.
 *
 * - `[exit N]` appears only when N was supplied. An absent exit status is
 *   never written as one ("non-zero" was a guess the runner never made).
 * - A service error with no exit status is NOT a failed program: whether the
 *   code ran is not confirmed.
 * - A process ended before it exited says so, with the signal when known.
 * - An exit status that was supplied is never called missing: with
 *   `exitCode: 0` and no verdict, the run reported its exit, so there is
 *   nothing to add.
 * - Only when the runner supplied none of these is the outcome stated as
 *   unknown — UNKNOWN IS STATED, like a cut, because output alone cannot say
 *   a script finished: it can print its answer and then fail.
 */
export function outcomeLine(result: CodeResult, toolName: string): string | undefined {
  if (result.ok === true) return undefined;
  if (result.serviceError === true && result.exitCode === undefined) {
    return (
      `[not confirmed: the code runner flagged an error for the ${toolName} call this result ` +
      'answers and reported no exit status, so whether that code ran is not known]'
    );
  }
  if (result.exitCode !== undefined) {
    if (result.exitCode === 0 && result.ok === undefined) return undefined;
    return (
      `[exit ${result.exitCode}] the code did not complete successfully — read stderr above ` +
      'and fix it.'
    );
  }
  if (result.ok === false) {
    const ended =
      result.terminatedBy === undefined ? '' : ` (terminated by ${result.terminatedBy})`;
    return (
      `[no exit status reported${ended}: the code of the ${toolName} call this result answers ` +
      'did not run to completion — read stderr above]'
    );
  }
  return (
    `[exit status unknown: the code runner reported neither an exit status nor an error for ` +
    `the ${toolName} call this result answers, so whether that code finished is not known]`
  );
}

/** Clip to the tool's ceiling, and SAY SO — including a cut the runner made. */
function clip(
  text: string,
  max: number,
  alreadyCutUpstream: boolean,
): {
  readonly text: string;
  readonly kept: number;
  readonly truncated: boolean;
} {
  const cutHere = text.length > max;
  const shown = cutHere ? text.slice(0, max) : text;
  const kept = shown.length;
  if (!cutHere && !alreadyCutUpstream) return { text: shown, kept, truncated: false };
  const of = cutHere ? text.length : undefined;
  return {
    kept,
    truncated: true,
    text:
      `${shown}\n[truncated: showing ${kept}${of !== undefined ? ` of ${of}` : ''} ` +
      'characters. Re-run printing a summary, a slice, or an aggregate instead of the whole ' +
      'value.]',
  };
}

export function codeRunStatus(
  result: CodeResult,
  truncated: boolean,
): 'failure' | 'partial' | undefined {
  if (
    result.ok !== true &&
    (result.ok === false ||
      result.serviceError === true ||
      result.terminatedBy !== undefined ||
      (result.exitCode !== undefined && result.exitCode !== 0))
  )
    return 'failure';
  return truncated ? 'partial' : undefined;
}

export interface CodeOutputCounts {
  readonly kept: number;
  readonly total?: number;
  readonly unit: 'characters';
}

/** Render each stream and describe the cut, excluding presentation text from the counts. */
export function clipOutput(
  result: Pick<CodeResult, 'stdout' | 'stderr' | 'truncated'>,
  max: number,
): { readonly stdout: string; readonly stderr: string; readonly counts?: CodeOutputCounts } {
  const { stdout: rawOut, stderr: rawErr, truncated } = result;
  const upstreamOut = truncated?.stdout === true;
  const upstreamErr = truncated?.stderr === true;
  const stdout = clip(rawOut, max, upstreamOut);
  const stderr = clip(rawErr, max, upstreamErr);
  const rendered = { stdout: stdout.text, stderr: stderr.text };
  if (!stdout.truncated && !stderr.truncated) return rendered;

  let total: number | undefined = rawOut.length + rawErr.length;
  if (upstreamOut || upstreamErr) {
    // One adapter field can name the only upstream-clipped stream. When both
    // streams were cut, that field reports a maximum rather than a sum.
    const reported = Object.getOwnPropertyDescriptor(truncated ?? {}, 'ofChars')?.value;
    const clipped = upstreamOut ? rawOut : rawErr;
    const other = upstreamOut ? rawErr : rawOut;
    total =
      upstreamOut !== upstreamErr &&
      typeof reported === 'number' &&
      Number.isSafeInteger(reported) &&
      reported > clipped.length
        ? reported + other.length
        : undefined;
  }
  return {
    ...rendered,
    counts: {
      kept: stdout.kept + stderr.kept,
      ...(total !== undefined && Number.isSafeInteger(total) && { total }),
      unit: 'characters',
    },
  };
}
