/**
 * transcript — the conversation, read back out of the event stream.
 *
 * A maintainer opening a bug report reads the conversation first: what was
 * asked, what the model said, which tools ran, what came back. All of that is
 * already in the typed events — `agent.turn_start` carries the prompt,
 * `stream.llm_end` the model's content, `stream.tool_start` / `tool_end` the
 * call and its result, `agent.turn_end` the final answer — so `conversation.json`
 * is DERIVED, never a second copy the reporter has to keep in sync.
 *
 * ## Derivable, and when it is not
 *
 * Turn markers come from the Agent loop. A bare `LLMCall`, a `Sequence` of
 * them, a pattern — none of those fire `turn_start`, so the walk falls back to
 * ONE synthetic turn holding the model and tool steps in order, and says so on
 * the turn (`derived: 'no-turn-markers'`). A recording with no LLM and no tool
 * events yields no transcript at all, and the manifest carries a note rather
 * than an empty file that reads like an empty conversation.
 *
 * ## What it does NOT do
 *
 * It does not summarize, truncate or scrub. Whatever the events carry is what
 * this writes — including tool arguments and results. Redaction is upstream, at
 * commit time; the manifest lists the keys that were scrubbed so the reporter
 * can see it happened. Anything that must never leave must never reach the
 * event stream in the first place.
 */

/** The loose event shape — these may have been through JSON. */
interface LooseEvent {
  readonly type?: unknown;
  readonly payload?: unknown;
  readonly meta?: unknown;
}

/** One model or tool step inside a turn. */
export type TranscriptStep =
  | {
      readonly kind: 'assistant';
      readonly content: string;
      readonly stopReason?: string;
      readonly toolCallCount?: number;
    }
  | {
      readonly kind: 'tool';
      readonly name: string;
      readonly toolCallId?: string;
      readonly args?: unknown;
      readonly result?: unknown;
      readonly error?: boolean;
    };

/** One turn: what the user asked, what happened, what came back. */
export interface TranscriptTurn {
  readonly index: number;
  readonly user?: string;
  readonly steps: readonly TranscriptStep[];
  readonly final?: string;
  /** Present when there were no turn markers and this turn was inferred. */
  readonly derived?: 'no-turn-markers';
}

/** One conversation's readable transcript. */
export interface Transcript {
  readonly turns: readonly TranscriptTurn[];
}

type MutableTurn = {
  index: number;
  user?: string;
  steps: TranscriptStep[];
  final?: string;
  derived?: 'no-turn-markers';
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/**
 * Walk one conversation's events into turns.
 *
 * @returns the transcript, or `undefined` when nothing conversational
 *          happened — which the manifest reports as a note.
 */
export function deriveTranscript(events: readonly unknown[]): Transcript | undefined {
  const turns: MutableTurn[] = [];
  let open: MutableTurn | undefined;
  /** `tool_start` args, held until the matching `tool_end` names the result. */
  const pendingTools = new Map<string, { name: string; args: unknown }>();

  /** Open a turn the Agent never announced — an LLMCall or a composition. */
  const ensureTurn = (): MutableTurn => {
    if (open) return open;
    open = { index: turns.length, steps: [], derived: 'no-turn-markers' };
    turns.push(open);
    return open;
  };

  for (const raw of events) {
    const event = raw as LooseEvent;
    const type = asString(event?.type);
    if (!type) continue;
    const payload = asRecord(event.payload);

    switch (type) {
      case 'agentfootprint.agent.turn_start': {
        open = {
          index: typeof payload.turnIndex === 'number' ? payload.turnIndex : turns.length,
          steps: [],
          ...(asString(payload.userPrompt) !== undefined && {
            user: asString(payload.userPrompt),
          }),
        };
        turns.push(open);
        break;
      }
      case 'agentfootprint.agent.turn_end': {
        const turn = ensureTurn();
        const final = asString(payload.finalContent);
        if (final !== undefined) turn.final = final;
        open = undefined;
        break;
      }
      case 'agentfootprint.stream.llm_end': {
        const turn = ensureTurn();
        turn.steps.push({
          kind: 'assistant',
          content: asString(payload.content) ?? '',
          ...(asString(payload.stopReason) !== undefined && {
            stopReason: asString(payload.stopReason),
          }),
          ...(typeof payload.toolCallCount === 'number' && {
            toolCallCount: payload.toolCallCount,
          }),
        });
        break;
      }
      case 'agentfootprint.stream.tool_start': {
        const id = asString(payload.toolCallId);
        const name = asString(payload.toolName) ?? 'unknown-tool';
        if (id) pendingTools.set(id, { name, args: payload.args });
        break;
      }
      case 'agentfootprint.stream.tool_end': {
        const turn = ensureTurn();
        const id = asString(payload.toolCallId);
        const started = id ? pendingTools.get(id) : undefined;
        if (id) pendingTools.delete(id);
        turn.steps.push({
          kind: 'tool',
          name: started?.name ?? 'unknown-tool',
          ...(id !== undefined && { toolCallId: id }),
          ...(started !== undefined && { args: started.args }),
          ...('result' in payload && { result: payload.result }),
          ...(payload.error === true && { error: true }),
        });
        break;
      }
      default:
        break;
    }
  }

  if (turns.length === 0) return undefined;
  // A single inferred turn with nothing in it is not a conversation.
  if (turns.length === 1 && turns[0]!.steps.length === 0 && turns[0]!.user === undefined) {
    return undefined;
  }
  return { turns: turns.map((turn) => ({ ...turn, steps: [...turn.steps] })) };
}
