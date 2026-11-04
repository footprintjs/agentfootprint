import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { frozenCopyOf } from '../../../../../lib/frozenCopy.js';
import type { ConsentGateKind } from '../../../../pause.js';
import type { MiddlewareDecision } from '../../../middleware/types.js';

/**
 * The copy of a paused call's arguments its request was bound to, detached
 * from the run's state — what an approved call runs with, as at a fresh
 * dispatch. A live view of the state goes on changing after the call (the
 * resume clears it, a later pause rewrites it), so a tool or a rule that kept
 * its arguments would read values nobody approved. `heldAnswer` already
 * proved them faithful JSON, which is what makes the copy safe to take.
 */
export const boundArgsOf = (
  scope: TypedScope<AgentState>,
  key: 'pausedAskArgs' | 'pausedCheckInArgs',
): Readonly<Record<string, unknown>> => {
  const raw = scope.$getValue(key);
  return typeof raw === 'object' && raw !== null
    ? (structuredClone(raw) as Readonly<Record<string, unknown>>)
    : {};
};

/**
 * The permission checker's view of a call's arguments: the call's shared
 * frozen copy (`lib/frozenCopy.ts`), never the object the tool runs with — a
 * checker that wrote into its `context` used to change the call. Arguments
 * no copy can be made of are not handed over: the throw lands in the gate's
 * fail-closed catch, so the call is denied.
 */
export const checkerContextOf = (view: ToolArgs | undefined): Readonly<Record<string, unknown>> => {
  if (view === undefined) {
    throw new Error("the call's arguments could not be copied for the permission checker");
  }
  return view;
};

/**
 * One frozen copy of a batch's assistant turn — every call's arguments in
 * it — for the callbacks and events that see the batch before its calls run
 * (`lib/frozenCopy.ts`). The turn holds the very objects the calls run
 * with, so a history handed to a callback carries this copy in its place.
 * A turn no copy can be made of is replaced by a frozen shell without its
 * calls: nothing a callback holds may reach what runs.
 */
export const frozenTurnOf = (turn: LLMMessage): LLMMessage =>
  frozenCopyOf(turn) ?? (Object.freeze({ role: turn.role, content: turn.content }) as LLMMessage);

/**
 * What a consent gate refuses with when the call cannot be bound to a
 * request — its arguments are not values JSON writes down faithfully, so an
 * approval could not be held to them. The call does not run and nobody is
 * asked; the model reads why — as a past fact about that one call, never an
 * order for the next one, because a tool result is re-read on every later
 * call of the turn (`test/modelFacingScan.test.ts`).
 */
export const unboundCallRefusal = (toolName: string, gate: ConsentGateKind): string =>
  `tool '${toolName}' was not run on that call: it needed a person's ${
    gate === 'ask' ? 'answer to a middleware ask' : 'approval (checkIn)'
  }, and an approval binds to the exact arguments it is shown — those arguments held a ` +
  `value plain JSON cannot write down (a date object, a map, a non-finite number, …), so no ` +
  `approval could be bound to them.`;

/**
 * The chain's rows for an ask no approval could be bound to. Nobody was
 * asked, so no row may say a person was: the asking link's `ask` row (the
 * walk's last — it stops at the ask) becomes the refusal it turned into,
 * naming why, the way `askPolicy: 'refuse'` files a refused ask.
 */
export const unboundAskRows = (
  rows: readonly MiddlewareDecision[],
  middleware: string,
  question: string,
): MiddlewareDecision[] =>
  rows.map((row, at) =>
    at === rows.length - 1 && row.outcome === 'ask'
      ? {
          ...row,
          outcome: 'deny',
          why:
            `middleware '${middleware}' asked a person to decide, and the call could not be ` +
            `bound to a request a decision names — its arguments held a value plain JSON ` +
            `cannot write down — so nobody was asked: ${question}`,
        }
      : row,
  );

/**
 * Who changed an approved ask's arguments after the approval, in words: the
 * links whose rows declared a rewrite — or, when none did (an edit in place
 * declares nothing), every link that ran after the ask, without claiming
 * which of them it was.
 */
export const changedAfterApproval = (rows: readonly MiddlewareDecision[]): string => {
  const quoted = (picked: readonly MiddlewareDecision[]): string =>
    [...new Set(picked.map((row) => `'${row.middleware}'`))].join(', ');
  const declared = rows.filter((row) => row.changed);
  if (declared.length > 0) {
    return `the middleware ${quoted(declared)} changed those arguments after the approval`;
  }
  return rows.length > 0
    ? `those arguments came back changed from the middleware after the ask (${quoted(rows)})`
    : 'a middleware after the ask changed those arguments';
};

/**
 * What the model reads when the rest of an approved ask's chain handed back
 * other arguments than the ones the person approved: the call does not run.
 * A past fact about that call.
 */
export const rewrittenAfterApproval = (toolName: string, changedBy: string): string =>
  `tool '${toolName}' was not run on that call: a person approved it with the arguments ` +
  `they were shown, and ${changedBy}, so the approval did not cover the call that would ` +
  `have run.`;
