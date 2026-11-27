import { readTimeDisplay } from './admission.js';

/** Carry existing metadata only when present; no phantom absent-property read. */
export function displayFieldOf(row: unknown): { readonly display?: unknown } {
  if (row === null || typeof row !== 'object') return {};
  try {
    const field = Object.getOwnPropertyDescriptor(row, 'display');
    if (field === undefined) return {};
    return { display: 'value' in field ? field.value : undefined };
  } catch {
    return { display: undefined };
  }
}

/** Invalid or hidden record metadata is unavailable, never a new inferred zone. */
export function displayPresentationOf(row: unknown): {
  readonly viewerZone?: string;
  readonly viewerDisplayUnavailable?: true;
} {
  try {
    const field = displayFieldOf(row);
    if (!Object.hasOwn(field, 'display')) return {};
    const value = field.display;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const purpose = Object.getOwnPropertyDescriptor(value, 'purpose');
      const zone = Object.getOwnPropertyDescriptor(value, 'viewerZone');
      if (
        Reflect.ownKeys(value).length === 2 &&
        purpose !== undefined &&
        'value' in purpose &&
        purpose.value === 'display-only' &&
        zone !== undefined &&
        'value' in zone
      ) {
        const admitted = readTimeDisplay({ viewerZone: zone.value });
        if (admitted !== undefined) return { viewerZone: admitted.viewerZone };
      }
    }
    return { viewerDisplayUnavailable: true };
  } catch {
    return { viewerDisplayUnavailable: true };
  }
}

/**
 * A display belongs to the question's turn, not a replay leg's new semantic
 * clock. Error replay can append another clock for that same turn; keep the
 * one recorded display declaration, never inherit an earlier turn's.
 */
export function displayOfTurn(
  ledger: readonly unknown[] | undefined,
  turn: number | undefined,
): { readonly display?: unknown } {
  let kept: { readonly display?: unknown } = {};
  for (const row of ledger ?? []) {
    if (row === null || typeof row !== 'object') continue;
    const clock = row as { readonly kind?: unknown; readonly turn?: unknown };
    if (clock.kind !== 'clock' || clock.turn !== turn) continue;
    const field = displayFieldOf(row);
    if (!Object.hasOwn(field, 'display')) continue;
    // Conflicting declarations in an imported record are unavailable, not
    // whichever one happened to arrive last.
    if (Object.hasOwn(kept, 'display')) return { display: undefined };
    kept = field;
  }
  return kept;
}
