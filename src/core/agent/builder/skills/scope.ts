export interface SkillToolScopePort {
  toolsFromActiveSkillValue: boolean;
}

export function configureSkillToolScope<TReceiver extends SkillToolScopePort>(
  self: TReceiver,
  original: object,
): object {
  // Refused rather than shrugged at, like every other one-per-agent policy:
  // a second call means the author believes there are two of these to set,
  // and the honest answer is that there is one.
  if (self.toolsFromActiveSkillValue) {
    throw new Error(
      'AgentBuilder.toolsFromActiveSkill: already set. It is one posture for the whole ' +
        "agent — every skill's tools follow that skill's activation — so a second call " +
        'has nothing left to say. Drop it.',
    );
  }
  self.toolsFromActiveSkillValue = true;
  return original;
}
