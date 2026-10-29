/**
 * What both code adapters hand back about a run's output — bounded, and saying
 * so — and the one check of a command's options.
 *
 * One implementation, because the two promises it keeps are the port's, not an
 * adapter's: a cut is always stated (`truncated`), and a command's result says
 * only what the backend reported (no exit status is ever made up).
 */

import type {
  CodeCommandOptions,
  CodeCommandResult,
  CodeTruncation,
} from '../../provider-contract/types.js';

/** stdout and stderr after the cut, and what the cut took. */
export interface BoundedOutput {
  readonly stdout: string;
  readonly stderr: string;
  /** Present IFF something was cut — an empty object here would read as
   *  "truncation happened, magnitude unknown". */
  readonly truncated?: CodeTruncation;
}

/**
 * Cut each stream to `max` characters, saying whether — and from how much — it
 * cut.
 *
 * `overflowed` names a stream the BACKEND already cut (a child whose output
 * passed its buffer ceiling): that stream is marked cut even when it fits
 * `max`, and `ofChars` is left out, because the length before that cut was
 * never seen — a number here would understate it.
 */
export function boundOutput(
  stdout: string,
  stderr: string,
  max: number,
  overflowed?: 'stdout' | 'stderr',
): BoundedOutput {
  const out = cut(stdout, max);
  const err = cut(stderr, max);
  const stdoutCut = out.cut || overflowed === 'stdout';
  const stderrCut = err.cut || overflowed === 'stderr';
  const truncated = {
    ...(stdoutCut && { stdout: true }),
    ...(stderrCut && { stderr: true }),
    ...((out.cut || err.cut) &&
      overflowed === undefined && { ofChars: Math.max(stdout.length, stderr.length) }),
  };
  return {
    stdout: out.text,
    stderr: err.text,
    ...(Object.keys(truncated).length > 0 && { truncated }),
  };
}

/** Cut to `max` characters, saying whether it cut. */
function cut(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  return { text: text.slice(0, max), cut: true };
}

/** What a backend reported about one command, before the bound. */
export interface CommandReport {
  readonly stdout: string;
  readonly stderr: string;
  /** Only when the backend reported one. */
  readonly exitCode?: number;
  /** Only when the backend reported one. */
  readonly isError?: boolean;
  /** A stream the backend itself cut before handing it over. */
  readonly overflowed?: 'stdout' | 'stderr';
}

/** A command's options, checked once. */
export interface CommandBounds {
  readonly maxOutputChars: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly checkpoint?: string;
}

/**
 * The result of one command: bounded output, and every other field copied
 * from the report only when the report had it.
 *
 * `checkpointSeen` is read over the WHOLE stdout, before the cut — a marker
 * printed after `maxOutputChars` characters is the common case, not the edge.
 */
export function commandResult(report: CommandReport, bounds: CommandBounds): CodeCommandResult {
  const bounded = boundOutput(
    report.stdout,
    report.stderr,
    bounds.maxOutputChars,
    report.overflowed,
  );
  return {
    stdout: bounded.stdout,
    stderr: bounded.stderr,
    ...(report.exitCode !== undefined && { exitCode: report.exitCode }),
    ...(report.isError !== undefined && { isError: report.isError }),
    ...(bounded.truncated !== undefined && { truncated: bounded.truncated }),
    ...(bounds.checkpoint !== undefined && {
      checkpointSeen: printedLine(report.stdout, bounds.checkpoint),
    }),
  };
}

/** Did `stdout` hold `line` as one whole line (a trailing `\r` allowed)? */
export function printedLine(stdout: string, line: string): boolean {
  for (const printed of stdout.split('\n')) {
    if (printed === line || printed === `${line}\r`) return true;
  }
  return false;
}

/**
 * Check a command and its options, or throw a `TypeError` naming the option.
 *
 * The message never repeats the command: it is caller data, and an error is
 * the one place nobody expects to have to scrub.
 */
export function commandBounds(
  command: unknown,
  options: CodeCommandOptions | undefined,
  runnerMaxOutputChars: number,
): CommandBounds {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new TypeError('code session: runCommand needs a non-empty command string.');
  }
  const timeoutMs = options?.timeoutMs;
  if (timeoutMs !== undefined && !(Number.isSafeInteger(timeoutMs) && timeoutMs > 0)) {
    throw new TypeError(
      'code session: runCommand `timeoutMs` must be a positive whole number of milliseconds.',
    );
  }
  const maxOutputChars = options?.maxOutputChars ?? runnerMaxOutputChars;
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 0) {
    throw new TypeError(
      'code session: runCommand `maxOutputChars` must be a whole number of characters.',
    );
  }
  const checkpoint = options?.checkpoint;
  if (
    checkpoint !== undefined &&
    (typeof checkpoint !== 'string' || checkpoint.length === 0 || /[\r\n]/.test(checkpoint))
  ) {
    throw new TypeError(
      'code session: runCommand `checkpoint` must be one non-empty line — the line the ' +
        'command prints when it reaches that point.',
    );
  }
  return {
    maxOutputChars,
    ...(timeoutMs !== undefined && { timeoutMs }),
    ...(options?.signal !== undefined && { signal: options.signal }),
    ...(checkpoint !== undefined && { checkpoint }),
  };
}

/** UTF-8 byte length of a string, without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(i + 1))) {
      bytes += 4;
      i++;
    } else bytes += 3; // other BMP, and a lone surrogate (written as U+FFFD, 3 bytes)
  }
  return bytes;
}

/** Bytes of a staged or returned payload: a string's UTF-8 length, bytes as they are. */
export function payloadBytes(data: string | Uint8Array): number {
  return typeof data === 'string' ? utf8Length(data) : data.byteLength;
}

export function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

export function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}
