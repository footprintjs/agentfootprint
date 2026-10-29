/**
 * Read a GitHub Actions workflow as TEXT, by indentation.
 *
 * No YAML parser is a dependency, and none is needed: every workflow in
 * `.github/workflows` keeps its jobs at two spaces, a job's steps at six, a
 * step's keys at eight and a `run: |` script at ten. These helpers rely on
 * exactly that layout, and THROW when the shape they look for is missing —
 * never an empty match — so a test built on them fails loudly instead of
 * passing on nothing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The text of `.github/workflows/<file>`. */
export function readWorkflow(file: string): string {
  return readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8');
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '';

/** Lines from `start` up to (not including) the next non-blank line indented `max` or less. */
function blockFrom(lines: readonly string[], start: number, max: number): string[] {
  let end = start + 1;
  while (end < lines.length && (isBlank(lines[end]) || indentOf(lines[end]) > max)) end++;
  return lines.slice(start, end);
}

function jobsStart(lines: readonly string[]): number {
  const at = lines.indexOf('jobs:');
  if (at < 0) throw new Error('the workflow has no top-level `jobs:`');
  return at;
}

/** Every job id under `jobs:`, in file order. */
export function jobIds(yml: string): string[] {
  const lines = yml.split('\n');
  return lines
    .slice(jobsStart(lines) + 1)
    .map((line) => /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined);
}

/**
 * Job `id`: its `  id:` line under `jobs:` and everything up to the next line
 * indented two spaces or less — the next job, or the comment above it.
 */
export function jobBlock(yml: string, id: string): string {
  const lines = yml.split('\n');
  const start = lines.indexOf(`  ${id}:`, jobsStart(lines));
  if (start < 0) throw new Error(`the workflow has no job "${id}"`);
  return blockFrom(lines, start, 2).join('\n');
}

/**
 * A job's steps, each from its `      - ` line up to the next line indented six
 * spaces or less (the next step, or a comment above it).
 */
export function stepsOf(job: string): string[] {
  const lines = job.split('\n');
  const steps: string[] = [];
  lines.forEach((line, at) => {
    if (line.startsWith('      - ')) steps.push(blockFrom(lines, at, 6).join('\n'));
  });
  if (steps.length === 0) throw new Error(`the job has no steps:\n${job}`);
  return steps;
}

/** A step's own key (`id`, `if`, `name`, `run`, `uses`…), as written; undefined when absent. */
export function stepKey(step: string, key: string): string | undefined {
  for (const line of step.split('\n')) {
    const match = /^ {6}(?:- | {2})([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (match?.[1] === key) return match[2].trim();
  }
  return undefined;
}

/**
 * The script a step runs, as the runner receives it: a `run: |` block with its
 * ten-space indent removed, or the text of a one-line `run:`.
 */
export function runScript(step: string): string {
  const lines = step.split('\n');
  const at = lines.findIndex((line) => /^ {6}(?:- | {2})run:/.test(line));
  if (at < 0) throw new Error(`the step has no run:\n${step}`);
  const inline = lines[at].replace(/^ {6}(?:- | {2})run:/, '').trim();
  if (inline !== '|') return inline;
  const body = blockFrom(lines, at, 9)
    .slice(1)
    .map((line) => line.slice(10));
  while (body.length > 0 && isBlank(body[body.length - 1])) body.pop();
  return `${body.join('\n')}\n`;
}

/** The commands a script runs: one per line, split at `&&`, comments and blank lines dropped. */
export function commandsOf(script: string): string[] {
  return script
    .split('\n')
    .flatMap((line) => line.split('&&'))
    .map((command) => command.trim())
    .filter((command) => command !== '' && !command.startsWith('#'));
}
