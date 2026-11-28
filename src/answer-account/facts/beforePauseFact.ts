import type { BeforePauseFact } from '../types.js';
import { countedFields, FACT_TEXT_CHARS } from './common.js';
import { beforePausePointers } from './found.js';
import type { BeforePauseCall } from './pausedLeg.js';

/** One call answered before the pause, as the facts list it (read from the committed state). */
export function beforePauseFact(c: BeforePauseCall): BeforePauseFact {
  const reading = c.reading;
  const coverage = c.coverage;
  return {
    toolName: c.toolName.slice(0, FACT_TEXT_CHARS),
    toolCallId: c.toolCallId.slice(0, FACT_TEXT_CHARS),
    emptiness: reading.emptiness,
    ...countedFields(reading),
    ...(coverage !== undefined && {
      coverage: {
        kind: coverage.kind,
        ...(coverage.lookedFor !== undefined && {
          lookedFor: coverage.lookedFor.text.slice(0, FACT_TEXT_CHARS),
        }),
        checked: coverage.items.filter((i) => i.section === 'checked').length,
        notChecked: coverage.items.filter((i) => i.section === 'notChecked').length,
        cannotCover: coverage.items.filter((i) => i.section === 'cannotCover').length,
        kinds: coverage.items.filter((i) => i.kind !== undefined).length,
      },
    }),
    pointers: beforePausePointers(c),
  };
}
