/**
 * recordedChat — the session-scoped turn recorder.
 *
 * `recordedChat({ makeAgent })` returns a `RecordedChat`: `send()` runs one
 * recorded turn through the consumer's agent factory and freezes that turn's
 * evidence immediately; `reason(k)` / `rerunTurn(k)` / `fork(k)` are the
 * per-turn transparency loop, composing with the existing context-bisect
 * surface (`localizeContextBug`, `rerunWithoutSources`) rather than
 * duplicating it. See `./types.ts` for the three traps this owns.
 *
 * Compose-don't-inherit house style: a module-private session class,
 * factory-returned; no base classes.
 */

import type { RuntimeSnapshot } from 'footprintjs';
import {
  llmCallIdsFromEvents,
  localizeContextBug,
  rerunWithoutSources,
  type AblationRunner,
  type AblationSpec,
  type CapturedEventLike,
  type ContextBugReport,
  type RerunWithoutSourcesResult,
} from '../context-bisect/index.js';
import type {
  ChatFormat,
  ChatMessage,
  ChatTurn,
  ForkOptions,
  ForkOrigin,
  MakeChatAgent,
  ReasonOptions,
  RecordedChat,
  RecordedChatOptions,
  RerunTurnOptions,
  SendOptions,
} from './types.js';

const DEFAULT_HEADER = 'Recent conversation:';
const DEFAULT_USER_LABEL = 'User';
const DEFAULT_ASSISTANT_LABEL = 'Assistant';

/** Deterministic key for spec dedup — recursively sorts object keys. */
function canonicalKey(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}

/** Union of ablation specs, deduped by canonical JSON (order-preserving, first wins). */
function dedupeSpecs(specs: readonly AblationSpec[]): AblationSpec[] {
  const seen = new Set<string>();
  const out: AblationSpec[] = [];
  for (const spec of specs) {
    const key = canonicalKey(spec);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(spec);
  }
  return out;
}

class RecordedChatSession implements RecordedChat {
  private readonly makeAgentFn: MakeChatAgent;
  private readonly formatOpt: ChatFormat | undefined;
  private readonly header: string;
  private readonly userLabel: string;
  private readonly assistantLabel: string;

  /** seed + one (user, assistant) pair per recorded turn. */
  private readonly entries: ChatMessage[];
  private readonly seedMessages: readonly ChatMessage[];
  private readonly removedSpecs: readonly AblationSpec[];
  private readonly turnsInternal: ChatTurn[] = [];
  private readonly reports = new Map<number, ContextBugReport>();
  /** result -> turnIndex, the in-process fork-provenance guard. */
  private readonly rerunOwner = new WeakMap<RerunWithoutSourcesResult, number>();
  private sending = false;
  private forkedFromValue: ForkOrigin | undefined = undefined;

  constructor(options: RecordedChatOptions) {
    this.makeAgentFn = options.makeAgent;
    this.formatOpt = options.format;
    this.header = options.format?.header ?? DEFAULT_HEADER;
    this.userLabel = options.format?.userLabel ?? DEFAULT_USER_LABEL;
    this.assistantLabel = options.format?.assistantLabel ?? DEFAULT_ASSISTANT_LABEL;
    this.seedMessages = Object.freeze((options.seed ?? []).map((m) => ({ ...m })));
    this.entries = [...this.seedMessages];
    this.removedSpecs = Object.freeze([...(options.removed ?? [])]);
  }

  get turns(): readonly ChatTurn[] {
    return this.turnsInternal;
  }

  get seed(): readonly ChatMessage[] {
    return this.seedMessages;
  }

  get removed(): readonly AblationSpec[] {
    return this.removedSpecs;
  }

  get forkedFrom(): ForkOrigin | undefined {
    return this.forkedFromValue;
  }

  private renderLine(message: ChatMessage): string {
    const label = message.role === 'user' ? this.userLabel : this.assistantLabel;
    return `${label}: ${message.text}`;
  }

  private composeMessage(lines: readonly string[], userMessage: string): string {
    if (lines.length === 0) return `${this.userLabel}: ${userMessage}`;
    return `${this.header}\n${lines.join('\n')}\n\n${this.userLabel}: ${userMessage}`;
  }

  async send(userMessage: string, options?: SendOptions): Promise<ChatTurn> {
    if (this.sending) {
      throw new Error(
        'recordedChat.send: a turn is already in flight — one turn at a time; await the previous send',
      );
    }
    this.sending = true;
    try {
      // Compose the message ONCE, at record time, from the frozen transcript
      // (trap 2 — byte-exact history is threaded HERE and replayed verbatim).
      const transcriptBefore = Object.freeze(this.entries.map((m) => this.renderLine(m)));
      const message = this.composeMessage(transcriptBefore, userMessage);

      const agent = await this.makeAgentFn({ specs: this.removedSpecs, seed: 0 });
      const events: CapturedEventLike[] = [];
      // Attach the tap BEFORE run() — listener-presence gating drops events
      // otherwise (agentfootprint invariant). Unsubscribe in finally.
      const off = agent.on('*', (event) => {
        events.push(event as CapturedEventLike);
      });
      let out: string;
      try {
        const raw = await agent.run({
          message,
          ...(options?.identity !== undefined ? { identity: options.identity } : {}),
        });
        if (typeof raw !== 'string') {
          throw new Error(
            "recordedChat.send: the run paused (askHuman/checkIn) — recorded chat turns don't " +
              'support pauses; drive pausing agents with agent.run() directly',
          );
        }
        out = raw;
      } finally {
        off();
      }

      // Capture IMMEDIATELY (trap 1) — getLastSnapshot() is last-run-only, but
      // the per-turn agent is discarded here, so clobbering is impossible.
      const snapshot: RuntimeSnapshot | undefined = agent.getLastSnapshot();
      if (snapshot === undefined) {
        throw new Error('recordedChat.send: the run produced no snapshot — cannot record the turn');
      }
      const lastLlmCallId = llmCallIdsFromEvents(events).at(-1);

      const index = this.turnsInternal.length;
      this.entries.push({ role: 'user', text: userMessage }, { role: 'assistant', text: out });
      const turn: ChatTurn = Object.freeze({
        index,
        userMessage,
        reply: out,
        message,
        transcriptBefore,
        artifacts: Object.freeze({
          snapshot,
          events: Object.freeze(events),
          // The third piece of a recording: the chart. Captured from the
          // per-turn agent HERE, because that agent is discarded on the next
          // line and its spec goes with it — and nothing can reproduce the
          // chart from a finished run. With it, a stored turn both localizes
          // AND draws.
          structure: (agent.getSpec() as { buildTimeStructure?: unknown }).buildTimeStructure,
        }),
        lastLlmCallId,
        identity: options?.identity,
      });
      this.turnsInternal.push(turn);
      return turn;
    } finally {
      this.sending = false;
    }
  }

  turn(k: number): ChatTurn {
    const n = this.turnsInternal.length;
    if (!Number.isInteger(k) || k < 0 || k >= n) {
      const range = n === 0 ? '(no turns recorded yet)' : `0..${n - 1}`;
      throw new RangeError(`recordedChat.turn: no turn ${k} — valid range is ${range}`);
    }
    return this.turnsInternal[k];
  }

  async reason(k: number, options: ReasonOptions): Promise<ContextBugReport> {
    const turn = this.turn(k);
    const { fresh, atStep, ...rest } = options;
    const memo = this.reports.get(k);
    if (memo !== undefined && fresh !== true) return memo;

    const resolvedAtStep = atStep ?? turn.lastLlmCallId;
    const report = await localizeContextBug({
      ...rest,
      artifacts: turn.artifacts,
      ...(resolvedAtStep !== undefined ? { atStep: resolvedAtStep } : {}),
    });
    this.reports.set(k, report);
    return report;
  }

  async rerunTurn(k: number, options: RerunTurnOptions): Promise<RerunWithoutSourcesResult> {
    const turn = this.turn(k);
    const { report: reportOption, ...rerunRest } = options;

    let report = reportOption ?? this.reports.get(k);
    if (report === undefined) {
      report = await this.reason(k, { embedder: options.embedder });
    }

    // Derive the runner from the SAME factory (traps 2 + 3): the frozen
    // message bytes are replayed verbatim, and the session's persistent
    // removals ALWAYS apply on top of the probe's specs (empty specs = the
    // baseline probe, which replays the identical turn).
    const runner: AblationRunner = async (specs, run) => {
      const agent = await this.makeAgentFn({
        specs: [...this.removedSpecs, ...specs],
        seed: run.seed,
      });
      const out = await agent.run({
        message: turn.message,
        ...(turn.identity !== undefined ? { identity: turn.identity } : {}),
      });
      if (typeof out !== 'string') {
        throw new Error(
          'recordedChat.rerunTurn: a probe run paused (askHuman/checkIn) — recorded chat re-runs ' +
            "don't support pauses",
        );
      }
      return out;
    };

    const result = await rerunWithoutSources({
      ...rerunRest,
      report,
      runner,
      originalAnswer: turn.reply,
    });
    this.rerunOwner.set(result, k);
    return result;
  }

  fork(k: number, options?: ForkOptions): RecordedChat {
    const turn = this.turn(k);
    const fromRerun = options?.fromRerun;
    if (fromRerun !== undefined && this.rerunOwner.get(fromRerun) !== k) {
      throw new Error(
        `recordedChat.fork: that result was not produced by this session's rerunTurn for turn ${k} — ` +
          're-run this turn first, then fork',
      );
    }

    const reply = fromRerun?.answer ?? turn.reply;
    const cut = this.seedMessages.length + 2 * k;
    const seed: ChatMessage[] = [
      ...this.entries.slice(0, cut).map((m) => ({ ...m })),
      { role: 'user', text: turn.userMessage },
      { role: 'assistant', text: reply },
    ];
    const removed = dedupeSpecs([...this.removedSpecs, ...(fromRerun?.removed ?? [])]);

    const child = new RecordedChatSession({
      makeAgent: this.makeAgentFn,
      ...(this.formatOpt !== undefined ? { format: this.formatOpt } : {}),
      seed,
      removed,
    });
    child.forkedFromValue = { parent: this, turnIndex: k, viaRerun: fromRerun !== undefined };
    return child;
  }
}

/**
 * Record a chat turn-by-turn so any reply can be explained, counterfactually
 * re-run, and forked — without re-writing the correctness-critical glue every
 * chat host gets subtly wrong. See the [recordedChat guide](doc:recorded-chat).
 */
export function recordedChat(options: RecordedChatOptions): RecordedChat {
  return new RecordedChatSession(options);
}
