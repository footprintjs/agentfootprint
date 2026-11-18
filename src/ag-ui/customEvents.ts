/** Served payload projections shared by record translation and explicit host delivery. */
/** What a CUSTOM projection is told beside the payload: where the event landed. */
export interface AgUiCustomContext {
  /** The served tool name, when the event names one. */
  readonly toolName?: string;
  /** The AG-UI id of the tool call open where the event happened, when one is. */
  readonly toolCallId?: string;
}

/**
 * One allow-listed event's CUSTOM value. Native observations provide the
 * served payload, with placeholders where redaction selected values. In explicit
 * host-delivery mode publish provides app-authorized reply data instead; it is
 * not a recorded observation. Return only fields the caller is meant to read.
 */
export type AgUiCustomProjection = (
  payload: Readonly<Record<string, unknown>>,
  at: AgUiCustomContext,
) => unknown;

/** The listed fields of `payload`, where present. */
const pick = (
  payload: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const field of fields) if (payload[field] !== undefined) out[field] = payload[field];
  return out;
};

/**
 * The agentfootprint events that go out as AG-UI `CUSTOM` by default, each with
 * the fields it carries: progress (which call, which iteration), spend, the
 * loop's route, the answer's standing and a provider's retries — counts and the
 * library's own words. Content (a tool's own progress `payload`,
 * `context.injected`'s assembled prompt, `error.retried`'s raw error, memory,
 * permission and credential facts) stays off the wire unless an app lists it:
 * `agUiSerializer({ ..., custom: { ...AG_UI_CUSTOM_EVENTS, [type]: projection } })`.
 */
export const AG_UI_CUSTOM_EVENTS: Readonly<Record<string, AgUiCustomProjection>> = Object.freeze({
  // Which call and which iteration — never the tool author's `payload`, which
  // is whatever the tool chose to report (list it to send it).
  'agentfootprint.stream.tool_progress': (payload, at) => ({
    ...(at.toolCallId !== undefined && { toolCallId: at.toolCallId }),
    ...pick(payload, ['iteration']),
  }),
  'agentfootprint.cost.tick': (payload) =>
    pick(payload, [
      'scope',
      'model',
      'provider',
      'tokensInput',
      'tokensOutput',
      'estimatedUsd',
      'cumulative',
    ]),
  'agentfootprint.agent.route_decided': (payload) => pick(payload, ['iterIndex', 'chosen']),
  'agentfootprint.answer.assessed': (payload) =>
    pick(payload, ['standing', 'assessment', 'reasons', 'checked', 'turn', 'iteration']),
  'agentfootprint.error.retried': (payload) =>
    pick(payload, ['attempt', 'maxAttempts', 'backoffMs', 'statedWaitMs']),
  'agentfootprint.error.recovered': (payload) => pick(payload, ['attempt', 'totalDurationMs']),
});
