/**
 * A classifier picked a tool for one model call (9.105.0, `.toolChoice()`):
 * the provider's pick among the OFFERED tools (the merged wire minus the
 * always-served doors), its confidence, how many were offered and how many
 * were served, whether the served list was narrowed to the top-N, and the
 * cost. The row (`ToolChoiceRow`) holds the whole distribution and the
 * provider's model string in the committed `toolChoices`; this payload
 * carries identities (tool names), enums, numbers and a boolean — never the
 * descriptions the classifier read, never the user's message. Fired by
 * `recordToolChoice` from the tools slot, BEFORE the model call.
 */
export interface ToolChoicePickedPayload {
  readonly iteration: number;
  readonly chosen?: string;
  readonly confidence: number;
  readonly offered: number;
  readonly served: number;
  readonly narrowed: boolean;
  readonly narrowedSkipped?:
    | 'unavailable'
    | 'too-few'
    | 'after-miss'
    | 'wrap-up'
    | 'evidence-revision';
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

/**
 * What the model DID on the call the pick was made for (9.105.0): the tools
 * it called in order (empty on an answer), whether its first call is the
 * classifier's pick (`firstAgrees`, absent when either side is absent) and
 * the names it asked for outside a NARROWED served list (`missed`). Fired by
 * `recordToolChoice` from `callLLM`, after the reply.
 */
export interface ToolChoiceOutcomePayload {
  readonly iteration: number;
  readonly called: readonly string[];
  readonly firstAgrees?: boolean;
  readonly missed?: readonly string[];
}

/**
 * The classifier was asked which tool and produced no answer (9.105.0): the
 * provider's HTTP status when there was one and the latency spent. The
 * error text lives on the `ToolChoiceErrorRow`; the full tool set was served
 * (fail open, never fail narrow) and the run continues.
 */
export interface ToolChoiceFailedPayload {
  readonly iteration: number;
  readonly status?: number;
  readonly latencyMs: number;
}

/**
 * The declared ontology was served on one model call (9.106.0,
 * `.ontology()`): the map's identities (`id`, `version`, the declaration's
 * `hash`) and its three counts. The map itself is the run constant
 * `AgentState.ontology`; the served text is on the receipt and rebuilt by
 * `servedAt`. This payload carries identities and numbers only — never a
 * meaning, a coverage sentence or a node name. Fired by `callLLM` at
 * request assembly, once per call that served the piece.
 */
export interface OntologyServedPayload {
  readonly iteration: number;
  readonly id: string;
  readonly version: string;
  readonly hash: string;
  readonly nodes: number;
  readonly sources: number;
  readonly edges: number;
}
