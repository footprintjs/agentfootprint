import { argumentRewritesOf, type ArgumentRewrite } from '../middleware/rewrites.js';
import type { historyCallResolver } from '../recordedCalls.js';
import { isRecord, str } from './recordValues.js';

interface DecisionRead {
  readonly row: Readonly<Record<string, unknown>>;
  readonly index: number;
}

/** Admit decisions by occurrence and retain the original middleware witness indexes. */
export function rewritesByOccurrence(
  decisions: unknown,
  resolve: ReturnType<typeof historyCallResolver>,
): ReadonlyMap<number, ReadonlyMap<string, ArgumentRewrite>> {
  const rewrites = new Map<number, ReadonlyMap<string, ArgumentRewrite>>();
  if (!Array.isArray(decisions)) return rewrites;
  const admitted = new Map<number, DecisionRead[]>();
  decisions.forEach((row: unknown, index) => {
    if (!isRecord(row) || row.at !== 'tool' || !Array.isArray(row.changedKeys)) return;
    const id = str(row.toolCallId);
    const resolved = id === undefined ? undefined : resolve(id, str(row.toolName));
    if (resolved?.kind !== 'matched') return;
    const occurrence = resolved.call.index;
    const rows = admitted.get(occurrence) ?? [];
    rows.push({ row, index });
    admitted.set(occurrence, rows);
  });
  for (const [occurrence, rows] of admitted) {
    const byArgument = argumentRewritesOf(rows.map((read) => read.row))
      .values()
      .next().value;
    if (byArgument === undefined) continue;
    const witnesses = new Map<string, ArgumentRewrite>();
    for (const [argument, rewrite] of byArgument) {
      const index = rows[rewrite.index]?.index;
      if (index !== undefined) witnesses.set(argument, { ...rewrite, index });
    }
    rewrites.set(occurrence, witnesses);
  }
  return rewrites;
}
