import type { ExternalGround } from '../../../../integrity/unsupported-argument/check.js';

/**
 * Consult the app's external-ground provider, throw-proof by law (9.72.0): a
 * provider that throws, or returns anything but an array, contributes
 * nothing — the check then runs on exactly what the run itself served, as if
 * the door were closed. An accounting door must never change a run's
 * outcome (the fileIntegrityDisposition rule, one tier down). Entry-level
 * hygiene — dropping blank values and unlabeled sources — lives in the
 * check itself, beside the fences it joins.
 */
export function readExternalGrounds(
  provider: (() => readonly ExternalGround[]) | undefined,
): readonly ExternalGround[] {
  if (provider === undefined) return [];
  try {
    const entries = provider();
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}
