/** Read the actual findings DATA wire, not a second composer or an expectation normalizer. */
export const findingsPrefix = '[AgentFootprint findings DATA v1]';
export function findingsFrame(messages: readonly { content?: string; text?: string }[]) {
  const frames = messages.filter((message) =>
    (message.content ?? message.text ?? '').startsWith(findingsPrefix),
  );
  if (frames.length !== 1)
    throw new Error(`Expected one findings DATA frame, got ${frames.length}`);
  const text = frames[0]!.content ?? frames[0]!.text!;
  return { text, ...JSON.parse(text.slice(findingsPrefix.length)) };
}
