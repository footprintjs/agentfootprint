import type { ObserverStats } from 'footprintjs';
import type { AccountEventEvidence } from './evidence.js';

/** Loss ahead of the ordinary recording tail, from the served runner snapshot. */
export function lostObserverEvidence(
  stats: (ObserverStats & { readonly summarizedEmits?: number }) | undefined,
): boolean {
  return (
    stats !== undefined &&
    (stats.drops > 0 ||
      stats.depth > 0 ||
      stats.terminalStranded > 0 ||
      (stats.summarizedEmits ?? 0) > 0)
  );
}

/** A terminal envelope can survive an incomplete recording of its model turn. */
export function hasAnswerWitnesses(events: readonly AccountEventEvidence[]): boolean {
  const configurations = events.filter(
    ({ event }) => event.type === 'agentfootprint.agent.run_configured',
  );
  const [configured] = configurations;
  const runId = configured?.event.meta.runId;
  if (configurations.length !== 1 || typeof runId !== 'string' || runId.length === 0) return false;

  const own = events.filter(({ event }) => event.meta.runId === runId);
  const question = own.find(({ event }) => event.type === 'agentfootprint.agent.turn_start');
  const newestFirst = own.reverse();
  const answer = newestFirst.find(({ event }) => event.type === 'agentfootprint.agent.turn_end');
  if (
    question === undefined ||
    answer === undefined ||
    question.index <= configured.index ||
    typeof question.event.payload.userPrompt !== 'string' ||
    !Number.isSafeInteger(question.event.payload.turnIndex) ||
    question.event.payload.turnIndex !== answer.event.payload.turnIndex ||
    typeof answer.event.payload.finalContent !== 'string' ||
    answer.event.payload.replyAuthor === 'host'
  )
    return false;

  const model = newestFirst.find(
    ({ index, event }) =>
      index > question.index &&
      index < answer.index &&
      event.type === 'agentfootprint.stream.llm_start',
  );
  const iteration = model?.event.payload.iteration;
  return Number.isSafeInteger(iteration) && iteration === answer.event.payload.iterationCount;
}
