/**
 * ToT — Tree of Thoughts: breadth-first iterative expansion + pruning.
 *
 * Paper: "Tree of Thoughts: Deliberate Problem Solving with Large
 *        Language Models" — Yao et al., 2023
 *        (https://arxiv.org/abs/2305.10601).
 *
 * Pattern: Factory → produces a `Runner` built from `Loop(depth times,
 *          Parallel(K thought branches) + prune-to-top-M)`.
 * Role:    patterns/ layer. Pure composition over existing primitives.
 *          Build-time-fixed depth + branching factor; runtime frontier
 *          is pruned to `beamWidth` per level via a consumer-supplied
 *          scorer.
 *
 * Tradeoff vs. full DFS: this shipped variant is BFS with constant
 * width. True DFS with backtracking or adaptive branching factor would
 * need runtime-variable Parallel (DynamicParallel) or recursion.
 */

import type { LLMProvider } from '../adapters/types.js';
import { LLMCall } from '../core/LLMCall.js';
import type { Runner } from '../core/runner.js';
import { Loop } from '../core-flow/Loop.js';
import { Parallel } from '../core-flow/Parallel.js';

export interface ToTOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  /** System prompt for the thought-generation LLMCall. */
  readonly thoughtPrompt: string;
  /** Depth of the tree (number of expansion iterations). */
  readonly depth: number;
  /** Branching factor — K thoughts generated per frontier node per iteration. */
  readonly branchingFactor: number;
  /**
   * Scorer: given a thought, return a numeric score. Higher is better.
   * The top `beamWidth` thoughts survive each level; the rest are pruned.
   * Synchronous so pruning is deterministic.
   */
  readonly score: (thought: string) => number;
  /** Beam width — how many thoughts survive after each level. Default 1 (greedy). */
  readonly beamWidth?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly name?: string;
  readonly id?: string;
}

/**
 * Build a ToT Runner. At run time:
 *   1. Seed — treat the input message as the initial frontier of 1 thought.
 *   2. For each of `depth` iterations:
 *      a. Parallel fan-out: generate `branchingFactor` new thoughts.
 *      b. Score all new thoughts, keep top `beamWidth`, pass to next iteration.
 *   3. Return the single best-scoring thought from the final frontier.
 */
export function tot(opts: ToTOptions): Runner<{ message: string }, string> {
  if (opts.depth < 1) throw new Error('ToT: depth must be >= 1');
  if (opts.branchingFactor < 2) {
    throw new Error('ToT: branchingFactor must be >= 2 (use Reflection for depth-only)');
  }
  const beamWidth = opts.beamWidth ?? 1;
  if (beamWidth < 1) throw new Error('ToT: beamWidth must be >= 1');

  // Each iteration's body is a Parallel fan-out of `branchingFactor`
  // identical LLMCalls, followed by a scoring-and-pruning pass. The
  // Parallel branches all receive the same parent-frontier message;
  // since temperature drives diversity, they produce distinct thoughts.
  let par = Parallel.create({ id: 'thoughts' });
  for (let i = 0; i < opts.branchingFactor; i++) {
    const thoughtLLM = LLMCall.create({
      provider: opts.provider,
      model: opts.model,
      temperature: opts.temperature ?? 0.7,
      ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
    })
      .system(opts.thoughtPrompt)
      .build();
    par = par.branch(`thought-${i}`, thoughtLLM);
  }
  // Merge: score all branch outputs, keep top `beamWidth`, concatenate
  // them as the body's output. Next iteration's LLMCalls will see this
  // combined survivor text as their input.
  const parallelStage = par
    .mergeWithFn((results) => {
      const ordered = Object.entries(results)
        .map(([id, thought]) => ({ id, thought, score: opts.score(thought) }))
        .sort((a, b) => b.score - a.score);
      const survivors = ordered.slice(0, beamWidth);
      // Join survivors with a delimiter so the next iteration's LLM can
      // see the full surviving frontier context. When beamWidth=1 this
      // is just the winning thought.
      return survivors.map((s) => s.thought).join('\n\n---\n\n');
    })
    .build();

  // Loop body: the Parallel fan-out + merge. `times(depth)` bounds the
  // iteration count. Each iteration's output becomes the next
  // iteration's input automatically (Loop.current = body output).
  const loop = Loop.create({
    id: opts.id ?? 'tot',
    name: opts.name ?? 'ToT',
  })
    .repeat(parallelStage)
    .times(opts.depth)
    .build();

  // Return loop directly — its final output is the best surviving thought
  // after `depth` iterations. Wrapping in Sequence would just add an
  // identity step. For single-thought selection at the end, consumers
  // can wrap in their own Sequence step.
  return wrapAsRunner(loop, opts.name ?? 'ToT', opts.id ?? 'tot');
}

/**
 * Identity wrapper so the ToT runner surface stays consistent with
 * other patterns (factory returns Runner, not Loop directly). Loop is
 * already a Runner — this is a stable identity passthrough that also
 * lets us stamp the composition id/name for topology clarity.
 */
function wrapAsRunner(
  inner: Runner<{ message: string }, string>,
  _name: string,
  _id: string,
): Runner<{ message: string }, string> {
  // Loop already IS a Runner — return directly. The identity wrapper
  // would only be needed if we wanted to layer extra events. The
  // underscore params are future-proofing for adding a seed step.
  return inner;
}
