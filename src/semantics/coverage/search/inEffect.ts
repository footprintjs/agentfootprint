/**
 * search/inEffect — what ONE classified argument was, for the call that ran.
 *
 * Pattern: one pure reader, the first step of composition. Every other step
 *          asks it, so "sent", "defaulted", "no narrowing" and "unsent" have
 *          one meaning.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * The arguments are the ones the tool RAN with: after the inputs layer's fill
 * and any before-tool rewrite. A host-filled argument never appears there —
 * `hostFilled` fills it inside `execute` — so the caller names those from the
 * wrapper's own declaration (`tools/hostFilled.ts` · `hostFillsOf`).
 */

import { isAnyValue } from './declaration.js';
import type { SearchArgument, SearchScalar } from './types.js';

/** Arguments the host fills inside `execute`, by where their value comes from. */
export interface HostFilledArguments {
  /** argument → the identity field it is filled from (`'tenant'`). */
  readonly identity: Readonly<Record<string, string>>;
  /** Arguments filled from the call's credential — never composed. */
  readonly credential: readonly string[];
}

/** What one classified argument was, for this call. */
export type ArgumentReading =
  /** The call sent it (`null` included: a value the tool was handed). */
  | { readonly kind: 'sent'; readonly value: unknown }
  /** Left out, and the declaration says what `execute` applies. */
  | { readonly kind: 'default'; readonly value: SearchScalar | readonly SearchScalar[] }
  /** Left out, and omission narrows nothing (`{ any: true }`). */
  | { readonly kind: 'any' }
  /** Left out, and the declaration says nothing: its default may live in `execute`. */
  | { readonly kind: 'unsent' }
  /** Sent as an empty list — it names nothing, so what `execute` did with it is unknown. */
  | { readonly kind: 'empty' }
  /** Filled by the host from the run's identity. */
  | { readonly kind: 'host'; readonly identity: string }
  /** Filled by the host from the call's credential. */
  | { readonly kind: 'credential' };

/**
 * Read one argument against the arguments the call ran with.
 *
 * @example
 * ```ts
 * readArgument({ name: 'window', role: 'period', whenOmitted: '2h' }, {});
 * // { kind: 'default', value: '2h' }
 * ```
 */
export function readArgument(
  arg: SearchArgument,
  args: Readonly<Record<string, unknown>>,
  hostFilled?: HostFilledArguments,
): ArgumentReading {
  if (hostFilled !== undefined) {
    if (hostFilled.credential.includes(arg.name)) return { kind: 'credential' };
    const identity = Object.hasOwn(hostFilled.identity, arg.name)
      ? hostFilled.identity[arg.name]
      : undefined;
    if (identity !== undefined) return { kind: 'host', identity };
  }
  if (Object.hasOwn(args, arg.name) && args[arg.name] !== undefined) {
    const value = args[arg.name];
    if (Array.isArray(value) && value.length === 0) return { kind: 'empty' };
    return { kind: 'sent', value };
  }
  const omitted = arg.whenOmitted;
  if (omitted === undefined) return { kind: 'unsent' };
  if (isAnyValue(omitted)) return { kind: 'any' };
  return { kind: 'default', value: omitted as SearchScalar | readonly SearchScalar[] };
}
