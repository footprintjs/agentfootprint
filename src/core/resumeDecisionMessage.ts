/**
 * resumeDecisionMessage — the sentence each refused resume carries
 * (`pause.ts` · `ResumeDecisionError`), in one place beside the error.
 *
 * Pattern: one switch over the refusal reasons. Role: the error's message;
 * a host sends it as the refusal's body, so it names no request id (an id
 * would let a client approve a request nobody was shown) and no argument
 * value. A changed argument view is named by ARGUMENT NAME, each quoted as
 * data (`lib/quotedText.ts`), because the names are the model's text:
 *
 *   hidden now, shown when asked: `memo`; hidden when asked, shown now: none
 */
import { quotedText } from '../lib/quotedText.js';
import type { HiddenViewChange } from './checkInHiddenArgs.js';
import type { ResumeDecisionRefusal } from './pause.js';

/** At most this many names of each side are written; the rest are counted. */
const NAMES_SHOWN = 12;
/** One argument name, quoted, at most this many code points. */
const NAME_CHARS = 64;

function namesWords(names: readonly string[]): string {
  if (names.length === 0) return 'none';
  const shown = names.slice(0, NAMES_SHOWN).map((name) => quotedText(name, NAME_CHARS));
  const more = names.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

function viewChangeWords(change: HiddenViewChange | undefined): string {
  if (change === undefined) return 'the names were not handed to this error';
  return (
    `hidden now, shown when asked: ${namesWords(change.nowHidden)}; ` +
    `hidden when asked, shown now: ${namesWords(change.noLongerHidden)}`
  );
}

/**
 * What a host that keeps the pause does with one no decision can answer
 * (`hosting/answeredPause.ts`): it closes it rather than hold the session.
 */
const CLOSED_BY_A_HOST =
  'A host that keeps the pause (standingAgent, streamHandler) closes it: the next message ' +
  'continues the conversation, the call recorded as not run only when proven, otherwise as ' +
  'not known.';

/** The sentence a {@link ResumeDecisionError} carries for `reason`; names, never values or ids. */
export function resumeDecisionMessage(
  reason: ResumeDecisionRefusal,
  viewChange?: HiddenViewChange,
): string {
  switch (reason) {
    case 'no-request':
      return (
        `[resume] this decision names no request. A person's decision answers ONE paused ` +
        `request: build it with checkInApproved({ request, by }) or checkInDeclined({ request, ` +
        `by }), passing the request the person was shown — outcome.checkIn or outcome.ask ` +
        `(PendingAsk.checkIn / .ask on a hosted door). A decision without \`requestId\` cannot ` +
        `say which request it answers, so it answers none. Nothing was executed.`
      );
    case 'request-not-recorded':
      return (
        `[resume] this run paused on a consent gate without a record of the request it asked — ` +
        `a checkpoint written before requests were named, or one whose record was removed. No ` +
        `decision can answer it. Nothing was executed; abandon this pause and ask again in a ` +
        `new run. ${CLOSED_BY_A_HOST}`
      );
    case 'other-request':
      return (
        `[resume] this decision answers a different request than the one this run is paused ` +
        `on. A decision answers only the request it names — not a later pause of the same run, ` +
        `not a parallel sibling's, not another conversation's. Nothing was executed; show the ` +
        `person the paused request and build the decision from what they were shown.`
      );
    case 'call-changed':
      return (
        `[resume] this decision names the paused request, but the paused call is no longer the ` +
        `call the person was asked about: the checkpoint's tool, arguments, call id, served ` +
        `party or middleware position changed after the ask. An approval binds to the exact ` +
        `call it was shown. Nothing was executed; treat the checkpoint as altered — no ` +
        `decision can answer it. ${CLOSED_BY_A_HOST}`
      );
    case 'chain-changed':
      return (
        `[resume] this decision names the paused request, but this agent's toolMiddleware ` +
        `chain is not the one the request was asked under: the link that asked, or a link ` +
        `after it, was removed, added, renamed or moved since (a redeploy). The rest of the ` +
        `chain would not be the rules the approval was given under, so the approval is not ` +
        `used. Nothing was executed; resume on an agent built with the same chain, or abandon ` +
        `the pause and ask again in a new run. ${CLOSED_BY_A_HOST}`
      );
    case 'already-answered':
      return (
        `[resume] the request this decision names was already answered by an earlier resume — ` +
        `one decision runs one call, and a request is spent the moment a resume uses its ` +
        `decision, approved or declined. This resume ran nothing. Whether the earlier resume ` +
        `finished, and so whether the call ran, is not known here: check the call's own ` +
        `record (its system, the conversation) before the person is asked again.`
      );
    case 'ledger-changed':
      return (
        `[resume] this decision names the paused request, but the agent resuming it records ` +
        `decisions in a different ledger than the one the request was asked under (a redeploy ` +
        `or a ledger migration). An approval is spent only in the ledger its request was asked ` +
        `under, so that ledger can say whether the call ran. Nothing was executed; the person ` +
        `has to be asked again. ${CLOSED_BY_A_HOST}`
      );
    case 'view-changed':
      return (
        `[resume] this decision names the paused request, but the tool's argument view no ` +
        `longer hides what the person was told was hidden (${viewChangeWords(viewChange)}). ` +
        `An approval covers exactly what was shown, and a changed view voids it. Nothing was ` +
        `executed; the person has to be asked again. ${CLOSED_BY_A_HOST}`
      );
    case 'closed-by-host':
      return (
        `[resume] the request this decision names was closed by the host that kept the ` +
        `pause: no answer could reach it any more, so the host closed it and recorded that ` +
        `its call did not run — and no decision can run it now. This resume ran nothing. The ` +
        `next message continues the conversation.`
      );
  }
}
