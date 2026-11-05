/**
 * The answer account's "How sure" reason lines — one part of the closed table
 * (`templates.ts`, which holds its laws and its version), one line per reason
 * of the fold (`facts/howSure.ts` · `REASON_LINES`).
 */

import { t, type AccountTemplate } from './templateEntry.js';

export const HOW_SURE_REASON_TEMPLATES = {
  'howSure.reason.asked': t('A question the run asked is still waiting for its answer.'),
  // The inputs layer's own ask (honesty layer 2, step 4) — set 4.
  'howSure.reason.argumentAsked': t(
    'The run asked the person for values its calls need, before any of them ran; the answer has not come yet.',
  ),
  'howSure.reason.argumentAssumed': t(
    "{{count:n,'value a call ran with was','values the calls ran with were'}} assumed: set by a tool's rule or a rewrite, not given in the conversation.",
  ),
  // Set 7: a failed declared-source check fires this reason on ANY argument, so "ruled" went.
  'howSure.reason.argumentUnverified': t(
    "{{count:n,'value came','values came'}} from the model, with no source on the record: not the conversation, a result or the app.",
    'library',
    2,
  ),
  'howSure.reason.argumentRead': t(
    "{{count:n,'value a call ran with was','values the calls ran with were'}} read into the conversation: the quoted words are on the record, the value itself is not in them.",
  ),
  'howSure.reason.valueContingent': t(
    "{{count:n,'value was','values were'}} taken from a result the model itself had set aside.",
  ),
  'howSure.reason.coverageGap': t(
    "{{count:n,'call declared ground it did not check or can never cover','calls declared ground they did not check or can never cover'}}.",
  ),
  'howSure.reason.declaredAbsent': t("{{count:n,'call','calls'}} declared that nothing matched."),
  'howSure.reason.emptyUndeclared': t(
    "{{count:n,'call returned nothing and did not say what it searched','calls returned nothing and did not say what they searched'}}.",
  ),
  // The results layer's period verdicts (honesty layer 3, step 7b) — set 6.
  'howSure.reason.periodNotHeld': t(
    "{{count:n,'call asked about a period its store does not hold','calls asked about periods their stores do not hold'}}.",
  ),
  'howSure.reason.periodPartlyHeld': t(
    "{{count:n,'call asked about a period its store holds only part of','calls asked about periods their stores hold only part of'}}.",
  ),
  'howSure.reason.periodUnknown': t(
    "{{count:n,'call could not say whether its store holds the period it asked about','calls could not say whether their stores hold the periods they asked about'}}.",
  ),
  'howSure.reason.periodUndeclared': t(
    "{{count:n,'call did not say what period its read covered, though its tool declares a period argument','calls did not say what period their reads covered, though their tools declare a period argument'}}.",
  ),
  // The time layer's result checks (step T8).
  'howSure.reason.periodDiffersFromAsked': t(
    "{{count:n,'call read a different stretch of time than the one asked about','calls read a different stretch of time than the one asked about'}}.",
  ),
  'howSure.reason.periodBeyondRetention': t(
    "{{count:n,'call asked about time older than its tool declares its source keeps','calls asked about time older than their tools declare their sources keep'}}.",
  ),
  'howSure.reason.sourcesConflict': t(
    "{{count:n,'conflict','conflicts'}} between results the model stood on.",
  ),
  'howSure.reason.valueUnsupported': t('Names or numbers in the answer appear in no tool result.'),
  'howSure.reason.valueSurvivedRevision': t(
    'Names or numbers in the answer appear in no tool result, even after one revision.',
  ),
  'howSure.reason.derivedFromReading': t(
    "A time in the answer is the library's own spelling of your words — an implied year, an offset or a converted form — not something you said or a tool returned.",
  ),
  // Code in an answer (`code: 'match'`) — set 14.
  'howSure.reason.scriptUnmatched': t(
    'A script shown in the answer matches no submission of this turn on the record.',
  ),
  'howSure.reason.stoppedEarly': t('The run stopped before the model finished.'),
  // The answer layer's witness (honesty layer 4) — set 5.
  'howSure.reason.stepsUnfinished': t(
    "The answer came before the active skill's declared steps finished.",
  ),
  'howSure.reason.negativeProseUnverified': t('Model prose was not verified for negative claims.'),
  // Integrity findings and unsettled claims on the record — set 15.
  'howSure.reason.invariantViolation': t(
    "The tools offered to the model contradict the run's own record of them.",
  ),
  'howSure.reason.unsupportedArgument': t(
    'A value a call ran with appears nowhere the run served the model.',
  ),
  'howSure.reason.columnTypeMismatch': t(
    "A tool's rows hold a different type than the tool declares.",
  ),
  'howSure.reason.missingColumn': t('A column a tool declares is in none of its rows.'),
  'howSure.reason.unsupportedClaim': t(
    "A field of the answer does not agree with a fact the run's tools settled.",
  ),
  'howSure.reason.claimUnsettled': t('The answer states a fact no tool settled.'),
  'howSure.reason.claimExceedsSearch': t('A negative claim exceeds the recorded search.'),
  'howSure.reason.declarationOverclaimed': t('A tool declaration overstates what was checked.'),
  'howSure.reason.answerCheckFailed': t("The app's answer checks failed this answer."),
  'howSure.reason.checkUnreachable': t(
    "The app's answer checks could not reach a verdict on this answer.",
  ),
} satisfies Record<string, AccountTemplate>;
