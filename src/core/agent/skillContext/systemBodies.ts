import type { ActiveInjection } from '../../../injection-engine/types.js';
import type { InjectionRecord } from '../../../recorders/core/types.js';

/** Capture only the slot's skill pieces, preserving their order among all slot pieces. */
export function systemSkillRecords(pieces: readonly InjectionRecord[]): readonly InjectionRecord[] {
  return pieces.flatMap((record, position) =>
    record.source === 'skill' && record.sourceId && record.rawContent
      ? [{ ...record, position }]
      : [],
  );
}

/** Retain an already-served skill body when the graph stops projecting that skill. */
export function retainSystemSkillRecords(
  next: InjectionRecord[],
  prior: readonly InjectionRecord[],
  active: readonly ActiveInjection[],
  registered: ReadonlySet<string>,
  hidden: readonly string[],
): void {
  const current = new Set(
    active.filter((injection) => injection.flavor === 'skill').map((injection) => injection.id),
  );
  const withheld = new Set(hidden);
  for (const record of prior) {
    const id = record.sourceId;
    if (
      record.source !== 'skill' ||
      record.position === undefined ||
      !record.rawContent ||
      !id ||
      !registered.has(id) ||
      current.has(id) ||
      withheld.has(id)
    )
      continue;
    next.splice(record.position, 0, record);
    current.add(id);
  }
}
