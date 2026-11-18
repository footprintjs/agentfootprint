export interface AnswerLimitsPort {
  limitsTravelValue: boolean;
}

export function configureAnswerLimits<TReceiver extends AnswerLimitsPort>(
  self: TReceiver,
  original: object,
): object {
  // Refused rather than shrugged at, like every other one-per-agent policy
  // (`toolsFromActiveSkill` verbatim): a second call means the author
  // believes there are two of these to set, and the honest answer is that
  // there is one boundary block per answer.
  if (self.limitsTravelValue) {
    throw new Error(
      'AgentBuilder.limitsTravelWithTheAnswer: already set. One agent appends one coverage ' +
        'block to one answer, folded from every declaration its tools made — so a second ' +
        'call has nothing left to say. Drop it.',
    );
  }
  self.limitsTravelValue = true;
  return original;
}
