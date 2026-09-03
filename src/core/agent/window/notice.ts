/**
 * window/notice — the authored message a DROP leaves behind, and why it has
 * to exist at all.
 *
 * Pattern: Authored envelope with no untrusted payload whatsoever.
 * Role:    core/ layer. Shared by both drop strategies.
 * Emits:   N/A.
 *
 * The first reason for this message is the WIRE, not the prose. An agent
 * window looks like `user, assistant+tool, assistant+tool, …`, so dropping
 * the oldest turns leaves an ASSISTANT message at the head — and the
 * providers that care (Anthropic) require the window to open on a user turn.
 * A silent drop of the window's head therefore produces a request the vendor
 * rejects. Something must occupy that position.
 *
 * Given that we have to author a message there anyway, it should say what
 * happened rather than be filler. So it does: how many messages left, at
 * which iteration, by which strategy, where they still are — and, since
 * 9.57.0, WHICH TOOLS' RESULTS were among them. Unlike the compaction frame
 * there is no model output involved at ALL — every character below is written
 * by this library, and the only caller data that reaches it is a tool NAME,
 * shape-filtered to a plain identifier and dropped outright when it is not
 * one. So a drop still has no prompt-injection surface to speak of.
 *
 * That last sentence is the one this file exists for now. A drop the model is
 * not told about is how a model came to invent an id: its `whats_here` result
 * left the window, nothing said so, and it assembled a plausible-looking id
 * out of an entity name it remembered. "Tool results are among them
 * (whats_here) — call the tool again" states the absence instead of leaving
 * it silent. Whether it changes what the model does next is NOT measured: the
 * archived runs behind 9.57.0 were not re-run with this sentence on. It ships
 * as honesty (a drop the model is not told about is unfindable from inside the
 * conversation), not as a behaviour claim.
 *
 * It appears ONLY when the removal reaches the front of what may leave. That
 * is the window's head in the ordinary case; since 9.55.0 it is the position
 * just after the CURRENT REQUEST when the request was sitting at the head and
 * refused to go (see currentRequest.ts) — the notice is still the first thing
 * after the last un-droppable message, and it says that the request was kept.
 * A removal further in leaves the original opening turn in place, so there is
 * no wire problem to solve — and splicing a lone `user` message between two
 * assistant turns is its own risk. The ledger names that removal either way.
 *
 * It does not accumulate: the notice is an ordinary oldest turn next time
 * round, so the next drop absorbs it and files a fresh one.
 */

import type { LLMMessage } from '../../../adapters/types.js';
import { DROP_NOTICE_PREFIX } from '../../../lib/saidByPerson.js';

// The marker and its recognizer live in the leaf both this file and the
// injection engine can import — a rule author has to be able to apply the same
// rule the window applies (9.84.0). The sentence below is still ours.
export { DROP_NOTICE_PREFIX, isDropNotice } from '../../../lib/saidByPerson.js';

/**
 * How many tool names the notice will print before it stops and says `…`.
 *
 * Four is enough to name what a turn was actually driving and small enough
 * that the notice stays a sentence rather than a list. The record is not
 * capped — see `WindowRecord.droppedObservations`.
 */
const MAX_NAMED_TOOLS = 4;

/**
 * The only shape a tool name may take to reach the wire.
 *
 * A tool name is CALLER DATA — it comes from a `defineTool`, an MCP server, or
 * a restored conversation somebody else wrote — and this notice is the one
 * message in the drop path with no untrusted payload in it. A name that is not
 * a plain identifier is DROPPED rather than truncated: truncating turns
 * `ignore previous instructions and…` into `ignore previous instruction`,
 * which is still an instruction. The record keeps the real name; the wire
 * simply says less.
 */
const SAFE_TOOL_NAME = /^[A-Za-z0-9_.:-]{1,48}$/;

/**
 * The tool names as the notice may print them: shape-filtered, deduplicated
 * by the caller, capped, and `…` when the cap bit. Empty when nothing
 * survived — and then the sentence is omitted entirely rather than printed
 * with an empty list.
 */
function namesForWire(toolNames: readonly string[]): string {
  const safe = toolNames.filter((n) => SAFE_TOOL_NAME.test(n));
  if (safe.length === 0) return '';
  const shown = safe.slice(0, MAX_NAMED_TOOLS);
  return safe.length > shown.length ? `${shown.join(', ')}, …` : shown.join(', ');
}

/**
 * Build the message that takes the head position after a drop.
 *
 * `role: 'user'` for the same reason the compaction frame is: it takes the
 * head of the window, and the head of the window must be a user turn. (When
 * the CURRENT REQUEST is holding that position it is already a user turn, and
 * the notice follows it — see below.)
 *
 * `currentRequestKept` (9.55.0) is set when the drop stopped short of the
 * window's head because the message the run is executing was sitting there
 * and refused to leave — so the notice takes the position AFTER it rather
 * than the head itself. It says so, because a model reading "3 earlier
 * messages were dropped" and then finding a request above it should be told
 * which of the two facts to trust. Omitted, the notice is byte-identical to
 * the one this library has always written.
 */
export function buildDropNotice(facts: {
  readonly droppedMessageCount: number;
  readonly iteration: number;
  readonly strategy: string;
  readonly currentRequestKept?: boolean;
  readonly toolNames?: readonly string[];
}): LLMMessage {
  const kept =
    facts.currentRequestKept === true
      ? `Your current request is kept — it is still in this window, above this line, and no ` +
        `window strategy may drop it. `
      : '';
  // 9.57.0. The measured failure: a model whose tool result had been dropped
  // assembled a plausible id out of an entity name it remembered and a shape
  // it had seen, got refused, and in one archived run named a host that
  // appears in no tool result at all. It was never told the evidence had
  // gone. Now it is, by name, with the one instruction that recovers it.
  const wireNames = facts.toolNames === undefined ? '' : namesForWire(facts.toolNames);
  const observations =
    wireNames.length > 0
      ? `Tool results are among them (${wireNames}) — call the tool again if you need its ` +
        `output; do not reconstruct ids or values from memory. `
      : '';
  return {
    role: 'user',
    content:
      `${DROP_NOTICE_PREFIX} — ${facts.droppedMessageCount} earlier message(s) were dropped ` +
      `from this window at iteration ${facts.iteration} by the '${facts.strategy}' window ` +
      `strategy. ${kept}${observations}Nothing was summarized: those turns are simply not ` +
      `being re-sent. They are retained verbatim in this run's commit log.]`,
  };
}
