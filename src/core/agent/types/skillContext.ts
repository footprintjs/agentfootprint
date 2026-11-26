/**
 * The agent option that states how skills reach the model, instead of letting
 * the model's binding decide (`core/agent/skillContext/`).
 */

export interface AgentSkillContextOptions {
  /**
   * How a skill's tools and body reach the model.
   *
   * - `'listed'`: every skill tool is on the tool list from the first request,
   *   with a description that does not change; `read_skill`'s description is
   *   the catalog, frozen for the run; a body `read_skill` loads is that call's
   *   result, never the system prompt. A call to a scoped skill's tool before
   *   its skill is loaded is refused and the tool does not run. Loading a skill
   *   then changes nothing a signed thinking block was written under.
   * - `'declared'`: each skill's own declarations (`autoActivate`,
   *   `surfaceMode`), as before this option existed.
   *
   * Absent (the default): `'listed'` when any provider the agent's calls reach
   * binds its reasoning to its context, or cannot tell (`thinkingBinding`
   * answers `bound` or `unknown`: the newest Claude models, an opaque inference
   * profile); `'declared'` otherwise, which keeps every other provider's
   * requests byte for byte. The choice is recorded as `skillContext` on the
   * first `agentfootprint.stream.llm_start` of each run, unless the default
   * chose `'declared'`.
   *
   * @example
   *   Agent.create({ provider, model: 'claude-haiku-5-5' }); // listed, by rule
   *   Agent.create({ provider, model, skillContext: 'declared' }); // stated by the app
   */
  readonly skillContext?: 'listed' | 'declared';
}
