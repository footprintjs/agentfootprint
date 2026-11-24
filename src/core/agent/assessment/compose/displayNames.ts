import type { StandingAssumedValue } from '../assumedValues.js';
import type { AnswerAssessment } from '../types.js';

// FOLD · the one choice of which display names the standing line may use
// consumers read this and never re-derive it: assessment/stage.ts · assessAnswerStage (to name
// the calls and file the names on turn_end), answer-account/facts/standing.ts · appendedStandingLine
// (the line rebuilt from the names the record kept)
/**
 * The display names the line may use for `a`: for every tool a `not-sure`
 * reason's calls name, and every tool whose rule assumed a value, the app's
 * words when its tool declares them — read through `displayNameOf`, the
 * agent's own tools. Empty unless the standing is `not-sure` (only that line
 * names reasons) and a tool declared a name: the line then says what it always
 * said.
 */
export function standingDisplayNames(
  a: AnswerAssessment,
  assumed: readonly StandingAssumedValue[],
  displayNameOf: (toolName: string) => string | undefined,
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  if (a.standing !== 'not-sure') return names;
  const tools = [
    ...a.reasons.flatMap((r) => (r.source.kind === 'calls' ? r.source.calls : [])),
    ...assumed,
    ...a.reasons.flatMap((r) => r.detail?.toolSays?.entries ?? []),
  ].map((c) => c.toolName);
  for (const tool of tools) {
    if (tool === undefined || names.has(tool)) continue;
    const words = displayNameOf(tool);
    if (words !== undefined) names.set(tool, words);
  }
  return names;
}
