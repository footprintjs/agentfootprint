/**
 * anthropicThinkingReplay — which thinking blocks a request sends back, on a
 * model that binds them to the conversation they were produced in.
 *
 * Pattern: one pure rule over a keyed prefix digest (the replay half of the
 *          Messages body; `anthropicMessagesWire.ts` · `buildMessagesBody`
 *          asks it, `toAnthropicMessages` applies it).
 * Role:    Outer ring.
 *
 * WHY. On Claude Fable 5.1, Opus 5.5, Sonnet 5.5 and Haiku 5.5 a thinking block
 * stays valid only while everything sent before it — the top-level `system`,
 * the `tools`, every earlier message — is unchanged; for an account created on
 * or after 2026-08-31 a request that sends one back after such a change is a
 * 400 (https://platform.claude.com/docs/en/build-with-claude/preserved-thinking).
 * The agent changes that prefix by design — its system prompt is re-joined
 * every iteration as instructions and skills join and leave, it adds lines for
 * one request only, collapses judged results and evicts turns — and the wire
 * echoed every stored block, so the next call failed. These models think
 * whether or not `.thinking()` asked, so it failed either way.
 *
 * THE RULE. When a reply arrives on such a model, the adapter stamps each of
 * its thinking blocks (`ThinkingBlock.binding`) with a digest of what that
 * request sent before the reply. A later request sends an assistant turn's
 * thinking back only when EVERY block of the turn carries the digest of what
 * this request sends before that turn; otherwise the turn goes without its
 * thinking — all of it, because a partial turn is refused. The decision is a
 * pure function of the block and the request, so a block left out stays out
 * and a block produced while it was out stays valid: the docs' "remove from
 * the start, from the end, or all of them; never leave a gap; once you remove
 * a block, leave it out".
 *
 * WHAT THE DIGEST COVERS. What the docs say the check covers — `system`, the
 * `tools` (in order: a reorder reads as a change, the conservative side) and
 * every earlier message's role, text, tool calls and tool results — and NOT
 * earlier thinking (the docs exclude it), `cache_control` markers,
 * `tool_choice`, `max_tokens` or the thinking configuration. Messages the wire
 * does not carry (`role: 'system'`, an assistant turn left with nothing) are
 * not folded in. A block that followed text or a tool call in its reply is
 * stamped as never replayable: the wire sends a turn's thinking first, which
 * would move it.
 *
 * KEYED, PER PROCESS. The stamp rides in the record (history, checkpoints,
 * events), and an unkeyed digest of the conversation would let anyone holding
 * the record confirm a guessed value — a redacted one included. So it is keyed
 * with a secret drawn once per process and never written anywhere. The cost,
 * named: after a restart, a block from before it cannot be checked and is not
 * sent back (the model answers without that reasoning; nothing fails).
 *
 * A model that does not bind its thinking (the table's `boundThinking`, and
 * every budget model) never reaches this rule: its bodies are byte-identical
 * to before.
 *
 * @example
 *   const plan = planThinkingReplay(req); // req.messages[3] carries stale blocks
 *   plan.withheld;  // Set { 3 }
 *   plan.binding;   // the stamp the reply's blocks get
 */

import { isDevMode } from 'footprintjs';
import type { LLMMessage, LLMRequest } from '../types.js';
import type { ThinkingBlock } from '../../thinking/types.js';
import { sha256Hex } from '../../lib/time-travel/sha256.js';

/** Separates the pieces of every digest input — never part of a JSON string. */
const SEP = '\u001f';

/** Marks a stamp that can never match: the block followed content in its reply. */
const AFTER_CONTENT = '~late';

/**
 * The per-process secret. Drawn once; never recorded, logged or sent. Every
 * stamp chains from it, so a stamp proves nothing to anyone without it.
 */
const KEY: string = drawKey();

/**
 * Which process wrote a stamp — a digest OF the key, so a stamp from another
 * process reads as "no record here" rather than as a changed conversation.
 */
const PROCESS: string = sha256Hex(`${KEY}${SEP}process`).slice(0, 16);

function drawKey(): string {
  const bytes = new Uint8Array(32);
  const crypto = (globalThis as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } }).crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Digests ─────────────────────────────────────────────────────────

/** What a message's digest was taken from, field by field, for the memo's identity check. */
interface MemoEntry {
  readonly role: unknown;
  readonly content: unknown;
  readonly toolCallId: unknown;
  readonly toolCalls: unknown;
  readonly digest: string;
}

/**
 * A message's own digest, kept per message OBJECT: the agent hands the same
 * history objects to every call of a run, so a long run digests each message
 * once instead of once per call. A hit is checked field by field by identity —
 * a caller that hands in a new object, or edits a field, digests again.
 */
const memo = new WeakMap<object, MemoEntry>();

function messageDigest(m: LLMMessage): string {
  const hit = memo.get(m);
  if (
    hit !== undefined &&
    hit.role === m.role &&
    hit.content === m.content &&
    hit.toolCallId === m.toolCallId &&
    hit.toolCalls === m.toolCalls
  ) {
    return hit.digest;
  }
  // What the wire carries of a message, its thinking excluded (the docs keep
  // earlier thinking out of the checked prefix).
  const calls = (m.toolCalls ?? []).map((c) => [c.id, c.name, c.args]);
  const digest = sha256Hex(JSON.stringify([m.role, m.content, m.toolCallId ?? null, calls]));
  memo.set(m, {
    role: m.role,
    content: m.content,
    toolCallId: m.toolCallId,
    toolCalls: m.toolCalls,
    digest,
  });
  return digest;
}

/** The digest of `system` and `tools` — where every prefix starts. */
function headDigest(req: Pick<LLMRequest, 'systemPrompt' | 'tools'>): string {
  const tools = (req.tools ?? []).map((t) => [t.name, t.description, t.inputSchema]);
  return sha256Hex([KEY, req.systemPrompt ?? '', JSON.stringify(tools)].join(SEP));
}

const link = (prefix: string, m: LLMMessage): string =>
  sha256Hex(`${prefix}${SEP}${messageDigest(m)}`);

/** Does this assistant turn reach the wire? The rule `toAnthropicMessages` applies. */
function assistantOnWire(m: LLMMessage, sendsThinking: boolean): boolean {
  return (
    (m.content !== undefined && m.content !== '') ||
    (m.toolCalls?.length ?? 0) > 0 ||
    (sendsThinking && (m.thinkingBlocks?.length ?? 0) > 0)
  );
}

// ─── The plan ────────────────────────────────────────────────────────

/** Why a turn's thinking stayed home — the first reason met, for the dev warning. */
export type WithheldCause = 'no-record' | 'system-or-tools' | 'earlier-message' | 'after-content';

/** Which assistant turns of one request go without their thinking. */
export interface ThinkingReplayPlan {
  /** Indices into `req.messages` of the assistant turns sent without their thinking. */
  readonly withheld: ReadonlySet<number>;
  /** How many thinking blocks those turns held. */
  readonly blocksWithheld: number;
  /** Why the first of them was left out. */
  readonly cause?: WithheldCause;
  /** The stamp this request's reply gets: the digest of everything it sends. */
  readonly binding: string;
}

/**
 * The replay plan for one request to a model that binds its thinking: which
 * assistant turns keep their thinking, and the binding the reply is stamped
 * with. Pure — the same request always plans the same way.
 */
export function planThinkingReplay(
  req: Pick<LLMRequest, 'systemPrompt' | 'tools' | 'messages'>,
): ThinkingReplayPlan {
  const head = `${PROCESS}.${headDigest(req)}`;
  const withheld = new Set<number>();
  let blocksWithheld = 0;
  let cause: WithheldCause | undefined;
  let prefix = head;
  req.messages.forEach((m, i) => {
    if (m.role === 'system') return; // this wire never carries it
    let sendsThinking = true;
    const blocks = m.role === 'assistant' ? m.thinkingBlocks ?? [] : [];
    if (blocks.length > 0) {
      const failed = firstFailure(blocks, head, `${head}.${prefix}`);
      if (failed !== undefined) {
        sendsThinking = false;
        withheld.add(i);
        blocksWithheld += blocks.length;
        cause ??= failed;
      }
    }
    if (m.role === 'assistant' && !assistantOnWire(m, sendsThinking)) return;
    prefix = link(prefix, m);
  });
  return {
    withheld,
    blocksWithheld,
    ...(cause !== undefined && { cause }),
    binding: `${head}.${prefix}`,
  };
}

/**
 * The first reason one of a turn's blocks fails its binding, or `undefined`
 * when all hold. A stamp reads `<process>.<system+tools>.<prefix>`.
 */
function firstFailure(
  blocks: readonly ThinkingBlock[],
  head: string,
  expected: string,
): WithheldCause | undefined {
  for (const block of blocks) {
    const binding = block.binding;
    if (binding === expected) continue;
    if (typeof binding !== 'string' || !binding.startsWith(`${PROCESS}.`)) return 'no-record';
    if (binding.endsWith(AFTER_CONTENT)) return 'after-content';
    return binding.startsWith(`${head}.`) ? 'earlier-message' : 'system-or-tools';
  }
  return undefined;
}

// ─── Stamping a reply ────────────────────────────────────────────────

/** A reply's content block, as the wire returns it. */
interface ReplyBlock {
  readonly type: string;
}

/**
 * One reply thinking block, stamped: `binding` when only thinking preceded it
 * in its reply, a stamp that never matches when text or a tool call did (the
 * wire sends a turn's thinking first, which would move it).
 */
export function stampThinkingBlock<B extends object>(
  block: B,
  binding: string,
  afterContent: boolean,
): B & { binding: string } {
  return { ...block, binding: afterContent ? `${binding}${AFTER_CONTENT}` : binding };
}

/**
 * The reply's content with each thinking block stamped (`stampThinkingBlock`).
 * Other blocks are returned as they are; the array is new.
 *
 * @example
 *   stampReply([{ type: 'thinking', thinking: '', signature: 's' }, toolUse], plan.binding);
 *   // [{ type: 'thinking', thinking: '', signature: 's', binding: plan.binding }, toolUse]
 */
export function stampReply<B extends ReplyBlock>(content: readonly B[], binding: string): B[] {
  let afterContent = false;
  return content.map((block) => {
    if (block.type !== 'thinking' && block.type !== 'redacted_thinking') {
      afterContent = true;
      return block;
    }
    return stampThinkingBlock(block, binding, afterContent);
  });
}

// ─── Saying so ───────────────────────────────────────────────────────

const CAUSE_WORDS: Readonly<Record<WithheldCause, string>> = {
  'no-record':
    'they carry no record of the conversation they were produced in (an earlier process, ' +
    'another adapter, or a model that does not bind its thinking)',
  'system-or-tools': 'the system prompt or the tool list changed since they were produced',
  'earlier-message': 'an earlier message changed since they were produced',
  'after-content':
    'a block followed text or a tool call in its reply, and this wire sends a turn’s ' +
    'thinking first, which would move it',
};

/** Models already told — once per (provider, model, cause) per process. */
const told = new Set<string>();

/**
 * Dev mode: say, once per provider, model and cause, that thinking was left
 * out — configured and quietly not delivered must not look like delivered.
 */
export function warnWithheld(provider: string, model: string, plan: ThinkingReplayPlan): void {
  if (plan.cause === undefined || !isDevMode()) return;
  const key = JSON.stringify([provider, model, plan.cause]);
  if (told.has(key)) return;
  if (told.size < 500) told.add(key);
  // eslint-disable-next-line no-console
  console.warn(
    `agentfootprint: ${plan.blocksWithheld} thinking block(s) from earlier turns were not sent ` +
      `back to '${model}' on '${provider}': ${CAUSE_WORDS[plan.cause]}. This model accepts a ` +
      `thinking block only while everything sent before it is unchanged (preserved thinking), ` +
      `and accounts created on or after 2026-08-31 refuse the request otherwise. The model ` +
      `answers without that reasoning. A fixed system prompt and tool list, and history that ` +
      `is only appended to, keep it. This warning fires once per model and cause per process.`,
  );
}
