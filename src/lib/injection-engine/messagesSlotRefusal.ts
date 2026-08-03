/**
 * The messages-slot refusals — said in the same words wherever they are said.
 *
 * ── The arc this module records ──────────────────────────────────────
 * 7.19.1 refused `slot: 'messages'` BY NAME. An Injection targeting the
 * messages slot was RECORDED as injected — `context.injected` fired with
 * its content, the slot composition counted it, the engine routed it —
 * while the request assembled its message list from the conversation
 * itself, so the model never saw it. The recording said one thing and the
 * wire said another, and absence beat that lie.
 *
 * 7.21.0 delivers it, so the refusal moves: from "this placement never
 * reaches the model" to "this placement reaches the model, but not with
 * THAT role on THIS provider, and not at THAT position this iteration."
 * The two facts the old sentence bundled together are now separate, and
 * each is decided against something real:
 *
 *   • ROLE — the wire has no system role inside the message list on the
 *     Anthropic family (system is a separate top-level field) while the
 *     OpenAI family carries it. A provider declares what it carries
 *     (`LLMProvider.carriesInMessages`); a role it does not carry is
 *     REFUSED at run start, naming the provider and the roles it does
 *     carry. Never silently re-roled: changing who appears to speak is a
 *     meaning change the app must make, not the library.
 *
 *   • POSITION — a delivered injection goes at the END of the history the
 *     iteration assembled. If its role would collide with the turn already
 *     there, or the tail is waiting on a tool result, delivery is DEFERRED
 *     to the next boundary and the deferral is recorded on
 *     `messagesDelivery.deferred`. Never a silent drop, never a reorder,
 *     never a split `tool_use` / `tool_result` pair.
 *
 * Both refusals are stated in full sentences that name the fix, because a
 * refusal that does not teach just moves the puzzle.
 */

import type { WireRole } from '../../adapters/types.js';

/** Render a role list the way the refusals quote it. */
function listRoles(roles: readonly WireRole[]): string {
  if (roles.length === 0) return 'no roles at all';
  if (roles.length === 1) return `\`${roles[0]}\``;
  const quoted = roles.map((r) => `\`${r}\``);
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * The role refusal (D2), addressed from `site` (e.g.
 * `defineFact('turn-time')` or the run-start check).
 *
 * Thrown when a `slot: 'messages'` injection declares a role the attached
 * provider drops on the wire. The alternative — quietly rewriting the role
 * to one that fits — would make the recording true and the meaning false.
 */
export function messagesRoleRefusal(args: {
  readonly site: string;
  readonly role: string;
  readonly providerName: string;
  readonly carries: readonly WireRole[];
}): string {
  return (
    `${args.site}: \`role: '${args.role}'\` cannot be delivered inside the message ` +
    `list by the '${args.providerName}' provider, which carries ${listRoles(args.carries)}. ` +
    `The message would be recorded as injected and dropped on the wire, so it is ` +
    `refused here instead. Pick a role this provider carries, put the content in ` +
    `\`slot: 'system-prompt'\` (delivered by every provider), or return it from the ` +
    `tool whose result it is about — a tool result IS a real message at the recency ` +
    `this option is reaching for. The role is never rewritten for you: who appears ` +
    `to speak is your decision, not the library's.`
  );
}

/**
 * The role refusal for a role no wire can carry (`'tool'`).
 *
 * A tool message answers one specific `tool_use` id. An injection has no
 * call to answer, so the message it would produce is malformed on every
 * provider — this one is refused by shape, not by capability.
 */
export function messagesToolRoleRefusal(site: string): string {
  return (
    `${site}: \`role: 'tool'\` cannot be injected. A tool message is the answer to a ` +
    `specific tool call and carries that call's id; an injection has no call to ` +
    `answer, so no provider would accept the result. Use \`'user'\` or \`'assistant'\` ` +
    `(\`'system'\` on providers that carry it), or return the content from the tool itself.`
  );
}

/** Why a delivery was held back this iteration. Recorded, never thrown. */
export type DeferralReason = 'role-collision' | 'unanswered-tool-call';

/**
 * The deferral note (D3) — a sentence on `messagesDelivery.deferred`, which
 * is the committed answer to "why is my declaration not on the wire yet?".
 *
 * Not an error: the next boundary retries it unchanged. The note names what
 * blocked it so the reader does not have to reconstruct the window to find out.
 */
export function messagesDeferralNote(args: {
  readonly injectionId: string;
  readonly role: string;
  readonly reason: DeferralReason;
  /** The effective wire role of the turn currently at the end of the window. */
  readonly tailRole?: string;
}): string {
  if (args.reason === 'unanswered-tool-call') {
    return (
      `'${args.injectionId}' was held back this iteration: the window ends on a tool ` +
      `call that has not been answered yet, and placing a message there would split a ` +
      `tool_use / tool_result pair. It is retried at the next boundary, unchanged.`
    );
  }
  return (
    `'${args.injectionId}' was held back this iteration: it would land as ` +
    `\`${args.role}\` immediately after a \`${args.tailRole ?? 'unknown'}\` turn, and ` +
    `providers reject two turns of the same role in a row. It is retried at the next ` +
    `boundary, unchanged — nothing is reordered to make room. In a tool-using loop the ` +
    `window ends on the user's turn or on tool results, so a \`user\` role typically ` +
    `never gets a slot; use \`assistant\`, use \`system\` on a provider that carries it, ` +
    `or return the content from the tool.`
  );
}
