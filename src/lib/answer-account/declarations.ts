/**
 * The app's declared data — validated at call time. A bad declaration is a
 * CALLER error and throws (on the server the declarations are the host's, handed
 * in at boot, so it throws when the host boots, never per request).
 *
 * Rules: labels non-empty, one plain visible line (`lib/plainLine.ts` ·
 * `plainLineProblem`, the rule `short` and `title` use), at most 60 characters; `rowsAt` a non-empty
 * top-level key with no `/` or `.`; unknown keys refused by name.
 */

import { plainLineProblem } from '../plainLine.js';
import type { AnswerAccountDeclarations } from './types.js';

export const MAX_LABEL_CHARS = 60;

const TOP_KEYS = new Set(['id', 'version', 'skills', 'tools', 'routing']);

function fail(message: string): never {
  throw new TypeError(`accountForAnswer declarations: ${message}`);
}

const isPlain = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function onlyKeys(where: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`unknown key "${key}" in ${where}`);
  }
}

function checkLabel(id: string, label: unknown): void {
  if (typeof label !== 'string' || label.trim().length === 0)
    fail(`skills.${id}.label must be a non-empty string`);
  // The same rule as a coverage item's `short` and a skill's `title`: all three print in
  // one report, so they must refuse the same characters (controls, separators, format).
  const problem = plainLineProblem(`skills.${id}.label`, label);
  if (problem !== undefined) fail(problem);
  if (label.length > MAX_LABEL_CHARS)
    fail(`skills.${id}.label is over ${MAX_LABEL_CHARS} characters`);
}

function checkRowsAt(tool: string, rowsAt: unknown): void {
  if (typeof rowsAt !== 'string' || rowsAt.length === 0)
    fail(`tools.${tool}.rowsAt must be a non-empty key`);
  if (/[/.]/.test(rowsAt)) fail(`tools.${tool}.rowsAt must be a top-level key (no "/" or ".")`);
}

/** Returns the declarations (or `{}`), or throws a `TypeError` naming the first problem. */
export function validateDeclarations(
  value: AnswerAccountDeclarations | undefined,
): AnswerAccountDeclarations {
  if (value === undefined) return {};
  if (!isPlain(value)) fail('must be an object');
  for (const key of Object.keys(value)) if (!TOP_KEYS.has(key)) fail(`unknown key "${key}"`);
  for (const key of ['id', 'version'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') fail(`${key} must be a string`);
  }
  if (value.skills !== undefined) {
    if (!isPlain(value.skills)) fail('skills must be an object keyed by skill id');
    for (const [id, entry] of Object.entries(value.skills)) {
      if (!isPlain(entry)) fail(`skills.${id} must be an object`);
      onlyKeys(`skills.${id}`, entry, ['label']);
      if (entry.label !== undefined) checkLabel(id, entry.label);
    }
  }
  if (value.tools !== undefined) {
    if (!isPlain(value.tools)) fail('tools must be an object keyed by tool name');
    for (const [tool, entry] of Object.entries(value.tools)) {
      if (!isPlain(entry)) fail(`tools.${tool} must be an object`);
      onlyKeys(`tools.${tool}`, entry, ['rowsAt']);
      if (entry.rowsAt !== undefined) checkRowsAt(tool, entry.rowsAt);
    }
  }
  if (value.routing !== undefined) {
    if (!isPlain(value.routing)) fail('routing must be an object');
    onlyKeys('routing', value.routing, ['appDecides']);
    if (value.routing.appDecides !== undefined && typeof value.routing.appDecides !== 'boolean') {
      fail('routing.appDecides must be a boolean');
    }
  }
  return value;
}
