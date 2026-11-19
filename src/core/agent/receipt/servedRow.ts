/** Internal copy of the Foottrace source-links wire v5 served-row shape. */
export interface ServedRow {
  readonly kind: 'served';
  readonly version: 1;
  /** The committing execution's own runtime stage ID. */
  readonly consumer: string;
  readonly served: readonly {
    readonly key: string;
    /** Ascending, disjoint [start, end) ranges. Absent when a whole key was served. */
    readonly elements?: readonly (readonly [number, number])[];
  }[];
  /** Omitted positions are unknown when the range budget was exhausted. */
  readonly bounded?: true;
}

const MAX_RANGES = 64;

/** Record where the request carried retained history entries whole, without their values. */
export function servedHistoryRow(
  consumer: string,
  wholeHistoryEntries: readonly boolean[],
): ServedRow {
  const elements: (readonly [number, number])[] = [];
  let start: number | undefined;
  let bounded = false;
  for (let index = 0; index <= wholeHistoryEntries.length; index++) {
    if (wholeHistoryEntries[index] === true) {
      if (start !== undefined) continue;
      if (elements.length === MAX_RANGES) {
        bounded = true;
        break;
      }
      start = index;
    } else if (start !== undefined) {
      elements.push([start, index]);
      start = undefined;
    }
  }
  return {
    kind: 'served',
    version: 1,
    consumer,
    served: elements.length > 0 ? [{ key: 'history', elements }] : [],
    ...(bounded && { bounded: true }),
  };
}
