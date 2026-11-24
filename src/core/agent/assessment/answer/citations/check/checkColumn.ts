import { readOwnList } from '../../../../../../lib/boundedJson.js';
import { plainLineProblem } from '../../../../../../lib/plainLine.js';

const MAX_COLUMNS = 128;
const MAX_NAME_LENGTH = 128;

export interface UngroundedCitationEntity {
  readonly reason: 'ungrounded-entity';
  readonly name: string;
  readonly nearestName?: string;
}

export function isCitationColumnName(name: unknown): name is string {
  return (
    typeof name === 'string' &&
    name.length <= MAX_NAME_LENGTH &&
    name.trim().length > 0 &&
    plainLineProblem('Column name', name) === undefined
  );
}

/** Compute edit distance on Unicode code points with a single working row. */
function editDistance(requested: readonly string[], candidate: readonly string[]): number {
  const distances = candidate.map((_value, column) => column + 1);
  for (const [row, from] of requested.entries()) {
    let diagonal = row;
    let left = row + 1;
    distances.forEach((above, column) => {
      const next = Math.min(above + 1, left + 1, diagonal + (from === candidate[column] ? 0 : 1));
      distances[column] = next;
      diagonal = above;
      left = next;
    });
  }
  return distances.at(-1) ?? requested.length;
}

function nearestName(name: string, columns: ReadonlySet<string>): string | undefined {
  const requested = Array.from(name);
  let minimum = Infinity;
  let nearest: string | undefined;
  for (const candidate of columns) {
    const distance = editDistance(requested, Array.from(candidate));
    if (distance < minimum) {
      minimum = distance;
      nearest = candidate;
    } else if (distance === minimum) {
      nearest = undefined;
    }
  }
  return nearest;
}

/** Check an explicitly requested column against one complete, authorized, served schema. */
export function checkCitationColumn(
  requestedName: string | undefined,
  visibleSchema: readonly string[] | undefined,
): UngroundedCitationEntity | undefined {
  if (!isCitationColumnName(requestedName) || visibleSchema === undefined) return undefined;
  let columns: Set<string>;
  try {
    const schema = readOwnList(visibleSchema, MAX_COLUMNS);
    if (schema === undefined || schema.unread !== 0) return undefined;
    const names = schema.entries.filter(isCitationColumnName);
    if (names.length !== schema.entries.length) return undefined;
    columns = new Set(names);
  } catch {
    return undefined;
  }
  if (columns.has(requestedName)) return undefined;

  const nearest = nearestName(requestedName, columns);
  return {
    reason: 'ungrounded-entity',
    name: requestedName,
    ...(nearest !== undefined && { nearestName: nearest }),
  };
}
