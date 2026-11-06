/** Lens leaf: the unchanged value and assumption sentence spellings. */
import type { InputValue } from '../../../../tools/inputRequest.js';

/** A declared value as a sentence prints it: a string quoted, a number or boolean bare. */
export function printedValue(value: InputValue): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * The sentence a ruled `assume` property carries in the served schema: what the
 * library does when the call leaves the argument out, and what the record
 * keeps. It promises nothing a later path can break — not that the call runs
 * (permission may deny it), only what fills a value that is left out.
 */
export function assumeSentence(value: InputValue, hidden: boolean): string {
  return hidden
    ? "If left out, the tool's rule fills a declared value (hidden by the tool's view), recorded as assumed."
    : `If left out, the tool's rule fills ${printedValue(value)}, recorded as assumed.`;
}
