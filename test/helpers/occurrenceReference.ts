import { expect } from 'vitest';

type Path = readonly string[];
export type OccurrenceAddition = readonly [path: Path, value: unknown];

/** Capture only the named fields. The caller compares the reconstructed record before writing. */
export function occurrenceAdditions(value: unknown): OccurrenceAddition[] {
  const additions: OccurrenceAddition[] = [];
  const walk = (value: unknown, path: Path): void => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      if (key === 'callOccurrenceKey' || key === 'callAddresses') additions.push([next, child]);
      else walk(child, next);
    }
  };
  walk(value, []);
  return additions;
}

/** Apply the capture to a freshly parsed expected record. */
export function withOccurrenceAdditions<T>(legacy: T, additions: readonly OccurrenceAddition[]): T {
  for (const [path, value] of additions) {
    const location = path.join('.');
    const parent = path.slice(0, -1).reduce<unknown>((entry, key) => {
      expect(entry !== null && typeof entry === 'object', location).toBe(true);
      expect(Object.hasOwn(entry as object, key), location).toBe(true);
      return (entry as Record<string, unknown>)[key];
    }, legacy);
    const field = path[path.length - 1];
    expect(field === 'callOccurrenceKey' || field === 'callAddresses', location).toBe(true);
    expect(Object.hasOwn(parent as object, field!), location).toBe(false);
    (parent as Record<string, unknown>)[field!] = value;
  }
  return legacy;
}

/** Keep each path and its value together on one line in the checked-in capture. */
export function occurrenceReferenceText(cases: Record<string, OccurrenceAddition[]>): string {
  const entries = Object.keys(cases)
    .sort()
    .map((name) => {
      const additions = cases[name]!;
      const lines = additions.map((addition) => `    ${JSON.stringify(addition)}`).sort();
      return `  ${JSON.stringify(name)}: [\n${lines.join(',\n')}\n  ]`;
    });
  return `{\n${entries.join(',\n')}\n}\n`;
}
