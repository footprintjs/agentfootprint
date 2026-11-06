/**
 * The report's overall reading of its verdicts.
 *
 * A single "confirmed" can mislead. Removing a true fact the model needs can flip
 * a fragile answer, so a model's own mistake can look like several causes. And
 * when two items are each enough alone, removing either one changes nothing, so
 * real causes can look like none. This reads the verdicts together:
 *
 * - One item flips the answer alone: name it.
 * - Several flip it, and the record shows they lie on one path: name them, earliest
 *   first. A tool's result that came after a model call that read a planted
 *   instruction isn't a second cause.
 * - Several separate items flip it: name them, highest ranked first, unless they're
 *   too large a share of the items to single any out.
 * - None flip it: try pairs from the top of the ranking. Exactly one flipping pair
 *   is named, several mean no single cause, and none means none found.
 *
 * The share cut-off and the pair budget were chosen on development cases, so both
 * can be set on `rerun`. Every statement says what wasn't tested.
 */

import {
  isRemovable,
  pairsOf,
  probeFlipped,
  resolvePairSearchTop,
  runAblationProbe,
  suspectLabel,
  type ProbeConfig,
} from './ablation.js';
import type { CausalNode } from 'foottrace';

import { stageRole } from '../lib/conventions.js';
import type {
  BisectionProbe,
  ContextBugConclusion,
  ContextBugConclusionKind,
  ContextBugLink,
  ContextBugPairSearch,
  RestoredCandidate,
  Suspect,
} from './types.js';
import { CONTEXT_BISECT_DEFAULTS } from './types.js';

/** How a later item relates to an earlier one in the record, if it does. */
export type SuspectRelation = (
  later: Suspect,
  earlier: Suspect,
) => ContextBugLink['via'] | undefined;

export interface ConcludeReportInput {
  /** The ranked suspects, with their verdicts. */
  readonly suspects: readonly Suspect[];
  /** Removable items in the whole ranking, including any cut from the report. */
  readonly removable: readonly Suspect[];
  readonly dropped: readonly RestoredCandidate[] | undefined;
  readonly baselineStable: boolean;
  readonly config: ProbeConfig;
  /** What the record shows about two items. Absent, no two items are treated as linked. */
  readonly relation?: SuspectRelation;
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Read a suspect's relation to another from the recorded slice, needing no model.
 * A step's output is fixed by its inputs unless it's a model or tool call. So when
 * only such fixed steps lie between two items, the record shows one came from the
 * other. When a model or tool call lies between them, it shows only that the later
 * one came after a step that read the earlier one.
 */
export function relationFromSlice(
  nodes: readonly CausalNode[],
  llmCallIds: readonly string[],
): SuspectRelation {
  const byId = new Map(nodes.map((node) => [node.runtimeStageId, node]));
  const llmIds = new Set(llmCallIds);
  const isFixed = (node: CausalNode): boolean => {
    if (llmIds.has(node.runtimeStageId)) return false;
    const role = stageRole(node.stageId);
    return role !== 'hero-llm' && role !== 'hero-action';
  };
  const reaches = (from: CausalNode, targetId: string, fixedOnly: boolean): boolean => {
    if (fixedOnly && !isFixed(from)) return false;
    const seen = new Set([from.runtimeStageId]);
    const queue = [...from.parents];
    while (queue.length > 0) {
      const node = queue.shift() as CausalNode;
      if (seen.has(node.runtimeStageId)) continue;
      seen.add(node.runtimeStageId);
      if (node.runtimeStageId === targetId) return true;
      if (!fixedOnly || isFixed(node)) queue.push(...node.parents);
    }
    return false;
  };
  return (later, earlier) => {
    const from = byId.get(later.source);
    if (from === undefined || later.source === earlier.source) return undefined;
    if (reaches(from, earlier.source, true)) return 'code';
    return reaches(from, earlier.source, false) ? 'model-or-tool' : undefined;
  };
}

/**
 * Keep the first suspect per label. One item can reach the slice through more than
 * one step, and removing it is the same removal each time, so it counts once.
 */
function distinct(suspects: readonly Suspect[]): readonly Suspect[] {
  const seen = new Set<string>();
  return suspects.filter((suspect) => {
    const label = suspectLabel(suspect);
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

/** A share cut-off from 0 to 1, or the default for anything else. */
function resolveMaxFlipShare(config: ProbeConfig): number {
  const raw = config.rerun.maxFlipShare ?? CONTEXT_BISECT_DEFAULTS.maxFlipShare;
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : CONTEXT_BISECT_DEFAULTS.maxFlipShare;
}

/** Remove every pair among the top items, and record what happened. */
async function searchPairs(
  items: readonly Suspect[],
  config: ProbeConfig,
): Promise<{
  readonly search: ContextBugPairSearch;
  readonly flipping: readonly (readonly [Suspect, Suspect])[];
}> {
  const probes: BisectionProbe[] = [];
  const flipping: (readonly [Suspect, Suspect])[] = [];
  let runsUsed = 0;
  for (const pair of pairsOf(items)) {
    const specs = pair.flatMap((suspect) => (suspect.ablation ? [suspect.ablation] : []));
    const stats = await runAblationProbe(config, specs);
    const flipped = probeFlipped(stats);
    runsUsed += stats.samples;
    probes.push({ ablated: pair.map((suspect) => suspectLabel(suspect)), stats, flipped });
    if (flipped) flipping.push(pair);
  }
  return { search: { top: items.length, probes, runsUsed }, flipping };
}

/** Read a report's verdicts together. Runs the pair search when no single removal flipped it. */
export async function concludeReport(input: ConcludeReportInput): Promise<ContextBugConclusion> {
  const { suspects, dropped, baselineStable, config, relation } = input;
  const removable = distinct(input.removable).length;
  const reported = distinct(suspects.filter(isRemovable));
  const tested = reported.filter((suspect) => suspect.verdict !== undefined);
  const flipped = tested.filter((suspect) => suspect.verdict?.verdict === 'confirmed');
  const mixed = tested.filter((suspect) => suspect.verdict?.verdict === 'inconclusive').length;
  const links: readonly ContextBugLink[] = flipped.flatMap((later) =>
    flipped.flatMap((earlier) => {
      const via = later === earlier ? undefined : relation?.(later, earlier);
      return via !== undefined ? [{ earlier, later, via }] : [];
    }),
  );
  const upstreamCount = (suspect: Suspect): number =>
    links.filter((link) => link.later === suspect).length;
  const separate = flipped.filter((suspect) => upstreamCount(suspect) === 0);
  const restored = (dropped ?? []).filter((unit) => unit.verdict?.verdict === 'confirmed');
  const restoredIds = restored.map((unit) => `"${unit.id}"`).join(', ');

  const untested = removable - tested.length;
  const conclude = (
    kind: ContextBugConclusionKind,
    named: readonly Suspect[],
    statement: string,
    pairSearch?: ContextBugPairSearch,
  ): ContextBugConclusion => {
    const notes = [
      statement,
      flipped.length > 0 && restored.length > 0
        ? `Restoring ${restoredIds}, which never reached the model, also flipped it.`
        : '',
      flipped.length > 0 && mixed > 0
        ? `${plural(mixed, 'more item')} flipped some reruns but not a majority.`
        : '',
      untested > 0
        ? `Not tested: ${plural(untested, 'ranked item')}. Raise rerun.maxSuspects to test more.`
        : '',
    ];
    return {
      kind,
      named,
      restored,
      flippedAlone: flipped.length,
      tested: tested.length,
      removable,
      ...(links.length > 0 ? { links } : {}),
      ...(pairSearch !== undefined ? { pairSearch } : {}),
      statement: notes.filter(Boolean).join(' '),
    };
  };
  /** What the record shows about each later item, relative to its nearest earlier one. */
  const pathNote = (): string =>
    flipped
      .filter((later) => upstreamCount(later) > 0)
      .map((later) => {
        const incoming = links.filter((link) => link.later === later);
        const nearest = incoming.reduce((best, link) =>
          upstreamCount(link.earlier) > upstreamCount(best.earlier) ? link : best,
        );
        return nearest.via === 'code'
          ? `The record shows ${suspectLabel(later)} came from ${suspectLabel(
              nearest.earlier,
            )} through code alone.`
          : `${suspectLabel(later)} came after a model or tool call that read ${suspectLabel(
              nearest.earlier,
            )}, so it may be on the same path.`;
      })
      .join(' ');

  if (!baselineStable) {
    return conclude(
      'inconclusive',
      [],
      'The unchanged run gave different answers across reruns, so no removal can be trusted.',
    );
  }

  if (flipped.length > 0) {
    const labels = flipped.map((suspect) => suspectLabel(suspect));
    if (flipped.length === 1) {
      return conclude(
        'one-cause',
        flipped,
        `Removing ${labels[0]} flipped the answer${
          tested.length > 1 && mixed === 0 ? ', and removing the other tested items did not' : ''
        }. The answer needed it here, which doesn't by itself show that it's wrong.`,
      );
    }
    const earliestFirst = [...flipped].sort((a, b) => upstreamCount(a) - upstreamCount(b));
    if (separate.length === 1) {
      const [first, ...rest] = earliestFirst.map((suspect) => suspectLabel(suspect));
      return conclude(
        'one-path',
        earliestFirst,
        `Removing ${first} flipped the answer, and so did removing ${rest.join(
          ', ',
        )}. ${pathNote()} ` +
          `Removal can't say which link is wrong. Start with ${first}, the earliest.`,
      );
    }
    // Items on one path count once. With untested items this share is a lower bound,
    // so going over the cut-off is still sound.
    if (separate.length / removable > resolveMaxFlipShare(config)) {
      return conclude(
        'no-single-cause',
        [],
        `Removing them one at a time, ${separate.length} of the ${removable} items each ` +
          `flipped the answer separately, so removal can't single one out. The model's own ` +
          `reasoning may be at fault.`,
      );
    }
    const note = pathNote();
    return conclude(
      'needed-together',
      earliestFirst,
      `Removing any one of ${labels.join(', ')} flipped the answer. Each was needed here, and ` +
        `removal can't tell which is wrong. ${note ? `${note} ` : ''}` +
        `Start with ${suspectLabel(earliestFirst[0])}, the highest ranked.`,
    );
  }

  if (restored.length > 0) {
    return conclude(
      'missing-context',
      [],
      `${
        tested.length > 0
          ? `No removal flipped the answer, but restoring ${restoredIds} did.`
          : `Restoring ${restoredIds} flipped the answer.`
      } Dropped units never reached the model.${
        tested.length > 1 ? " Pairs weren't tried, because this explains the flip." : ''
      }`,
    );
  }

  if (mixed > 0) {
    return conclude(
      'inconclusive',
      [],
      `No removal flipped a majority of reruns, but ${plural(mixed, 'item')} flipped some. ` +
        'Raise samples, or check that the scenario is stable.',
    );
  }

  if (tested.length === 0) {
    return conclude(
      'inconclusive',
      [],
      removable === 0
        ? 'Nothing in the slice could be removed, so nothing was tested.'
        : 'No item was tested.',
    );
  }

  if (reported.length < 2) {
    return conclude(
      'none-found',
      [],
      `Removing ${suspectLabel(
        tested[0],
      )} changed nothing, and there was no other item to pair it with.`,
    );
  }

  const paired = reported.slice(0, resolvePairSearchTop(config.rerun));
  if (paired.length < 2) {
    return conclude(
      'none-found',
      [],
      `Removing any one of ${plural(tested.length, 'item')} changed nothing. Pairs weren't ` +
        'tried, so two items that are each enough alone would look like this too.',
    );
  }

  const { search, flipping } = await searchPairs(paired, config);
  if (flipping.length === 1) {
    const pair = flipping[0];
    return conclude(
      'redundant-pair',
      pair,
      `No single removal flipped the answer, but removing ${suspectLabel(pair[0])} and ` +
        `${suspectLabel(pair[1])} together did. Either may be enough alone to produce this answer.`,
      search,
    );
  }
  if (flipping.length > 1) {
    return conclude(
      'no-single-cause',
      [],
      `No single removal flipped the answer, but ${flipping.length} of ${search.probes.length} ` +
        `pairs did, so removal can't single out a cause.`,
      search,
    );
  }
  return conclude(
    'none-found',
    [],
    `Nothing tested flipped the answer: ${plural(tested.length, 'item')} alone and ` +
      `${plural(search.probes.length, 'pair')} from the top ${paired.length}. A cause may still ` +
      'be in a larger group or an untested pair.',
    search,
  );
}
