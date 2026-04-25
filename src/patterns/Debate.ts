/**
 * Debate — two agents alternate proposing + critiquing, a judge decides.
 *
 * Paper: "Improving Factuality and Reasoning in Language Models through
 *        Multiagent Debate" — Du et al., 2023
 *        (https://arxiv.org/abs/2305.14325).
 *
 * Pattern: Factory → produces a `Runner` built from
 *          `Sequence(Proposer → Critic → Judge)` by default, or an
 *          iterated `Loop(Sequence(…))` when `rounds > 1`.
 * Role:    patterns/ layer.
 * Emits:   Everything Sequence + Loop + LLMCall emit.
 */

import type { LLMProvider } from '../adapters/types.js';
import { LLMCall } from '../core/LLMCall.js';
import type { Runner } from '../core/runner.js';
import { Loop } from '../core-flow/Loop.js';
import { Sequence } from '../core-flow/Sequence.js';

export interface DebateOptions {
  readonly provider: LLMProvider;
  readonly model: string;
  /** Proposer persona — asserts a position given the question. */
  readonly proposerPrompt: string;
  /** Critic persona — argues against the proposer's position. */
  readonly criticPrompt: string;
  /** Judge persona — reads the debate transcript, returns the verdict. */
  readonly judgePrompt: string;
  /** Rounds of propose+critique before the judge weighs in. Default 1. */
  readonly rounds?: number;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly name?: string;
  readonly id?: string;
}

/**
 * Build a Debate Runner. One debate "round" = Proposer → Critic. After
 * N rounds, the Judge sees the final exchange and renders the verdict.
 * The Judge's output is the Runner's return value.
 */
export function debate(opts: DebateOptions): Runner<{ message: string }, string> {
  const rounds = opts.rounds ?? 1;
  if (rounds < 1) {
    throw new Error('Debate: rounds must be >= 1');
  }

  const makeCall = (systemPrompt: string) =>
    LLMCall.create({
      provider: opts.provider,
      model: opts.model,
      ...(opts.temperature !== undefined && { temperature: opts.temperature }),
      ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
    })
      .system(systemPrompt)
      .build();

  // A debate round: Proposer → pipeVia(transcript-to-critic) → Critic.
  // The round's output is the critic's response; the next layer (Loop
  // or the outer Sequence) decides how to frame it for the next
  // consumer (another round or the Judge).
  const buildRound = () =>
    Sequence.create({ id: 'debate-round' })
      .step('proposer', makeCall(opts.proposerPrompt))
      .pipeVia((proposalMsg) => ({
        message: `A proposer argued:\n\n${proposalMsg}\n\nCritique this argument.`,
      }))
      .step('critic', makeCall(opts.criticPrompt))
      .build();

  // A full debate is: N rounds (via Loop) → Judge.
  const roundsRunner =
    rounds === 1
      ? buildRound()
      : Loop.create({ id: 'debate-rounds' })
          .repeat(buildRound())
          .times(rounds)
          .build();

  return Sequence.create({
    name: opts.name ?? 'Debate',
    id: opts.id ?? 'debate',
  })
    .step('rounds', roundsRunner)
    .pipeVia((transcript) => ({
      message: `Full debate transcript:\n\n${transcript}\n\nGive your verdict.`,
    }))
    .step('judge', makeCall(opts.judgePrompt))
    .build();
}
