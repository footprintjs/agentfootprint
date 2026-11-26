import type { AttemptCategory } from 'footprintjs';
import { ownData } from '../lib/boundedJson.js';

const failureCategories = {
  timeout: true,
  'rate-limited': true,
  server: true,
  network: true,
  auth: true,
  permanent: true,
  unknown: true,
} satisfies Record<AttemptCategory, true>;

/** Read only the engine's closed category vocabulary from a retained record. */
export function readToolFailureCategory(value: unknown): AttemptCategory | undefined {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(failureCategories, value)
    ? (value as AttemptCategory)
    : undefined;
}

export interface ToolFailureDeclaration {
  readonly category: AttemptCategory;
  readonly notChecked?: string;
  readonly tryInstead?: string;
}

declare const declaredFailure: unique symbol;

/** Native return value. Its declaration lives only on the original object identity. */
export interface ToolFailureResult {
  readonly content: unknown;
  readonly [declaredFailure]: true;
}

const declarations = new WeakMap<object, ToolFailureDeclaration>();

/** Return a measured failure to the tool runner without putting metadata on the provider wire. */
export function toolFailure(
  content: unknown,
  declaration: ToolFailureDeclaration,
): ToolFailureResult {
  const fields = ownData(declaration, ['category', 'notChecked', 'tryInstead']);
  const category = readToolFailureCategory(fields.category);
  const { notChecked, tryInstead } = fields;
  if (
    category === undefined ||
    (notChecked !== undefined && typeof notChecked !== 'string') ||
    (tryInstead !== undefined && typeof tryInstead !== 'string')
  ) {
    throw new TypeError('toolFailure requires a known category and optional text advice.');
  }
  const result = Object.freeze({ content }) as ToolFailureResult;
  declarations.set(
    result,
    Object.freeze({
      category,
      ...(notChecked !== undefined && { notChecked }),
      ...(tryInstead !== undefined && { tryInstead }),
    }),
  );
  return result;
}

/** Read at the native execution boundary before any structured copy of the result. */
export function readNativeToolFailure(value: unknown): ToolFailureDeclaration | undefined {
  return value !== null && typeof value === 'object' ? declarations.get(value) : undefined;
}
