/**
 * The answer account's words — ONE closed, versioned table.
 *
 * Every string a reader of the account sees comes from here: row headings,
 * chips, the lines, the signals, the one-liner, and the small pieces a line is
 * built from (the skill form, the distance, "it / both / all n"). The lens owns
 * layout only; no app overrides the words in v1.
 *
 * Laws (each pinned by `test/lib/answer-account/templates.test.ts`):
 *  - never "a" / "an" before a placeholder — a lint over this table;
 *  - plurals are explicit pairs, `{{count:n,'value','values'}}`; zero has its
 *    own template, chosen by the reader;
 *  - a sentence starts with fixed words or a `:code` tool id;
 *  - changing a template's words bumps its `version` AND
 *    `ANSWER_ACCOUNT_TEMPLATE_SET_VERSION`: a pinned digest of the table fails
 *    on a word change without a bump.
 *
 * Placeholder grammar (filled by `render.ts` · `fillParts`, non-recursively over
 * the VARS — a var's value is never re-read as a template):
 *   `{{name}}`                  the var's value as plain text
 *   `{{name:code}}`             a tool or skill id, verbatim
 *   `{{name:quote}}`            words quoted from the record
 *   `{{name:label}}`            a declared label (its own voucher)
 *   `{{name:skill}}`            `part.skill.labelled` / `part.skill.bare`, from
 *                               var `name` (the id) and var `nameLabel` (optional)
 *   `{{name:distance}}`         `distance.*`, from var `name` (n) and
 *                               var `nameWindowed` (1 = a window strategy ran)
 *   `{{count:name,'one','many'}}`  "n one" / "n many"
 *   `{{allOf:name}}`            `part.allOf.*` — it / both / all n
 *
 * `voucher` is the template's OWN claim-maker; a sentence's voucher is the
 * weakest of it and every truth-deciding var (`render.ts` · `sentence`).
 * `tool` means "the tool named by the `tool` var".
 */

export type TemplateVoucher = 'person' | 'library' | 'tool' | 'model' | 'app';

export interface AccountTemplate {
  readonly version: number;
  readonly text: string;
  readonly voucher: TemplateVoucher;
}

/** Bumped whenever any template's words change (a pinned digest enforces it). */
export const ANSWER_ACCOUNT_TEMPLATE_SET_VERSION = 1;

const t = (text: string, voucher: TemplateVoucher = 'library', version = 1): AccountTemplate =>
  Object.freeze({ version, text, voucher });

/** The closed table. Ids are `row.part@version` in prose; the version lives on the entry. */
export const ANSWER_ACCOUNT_TEMPLATES = Object.freeze({
  // ── row headings ─────────────────────────────────────────────────────
  'row.asked': t('You asked'),
  'row.understood': t('It understood'),
  'row.checked': t('It checked'),
  'row.notChecked': t('It did not check'),
  'row.found': t('It found'),
  'row.howSure': t('How sure'),
  'row.wrong': t('Anything wrong'),
  'row.more': t("…and {{count:n,'more tool call','more tool calls'}}."),
  'items.more': t("…and {{count:n,'more item','more items'}}."),

  // ── chips ────────────────────────────────────────────────────────────
  'chip.saidBy': t('said by: {{who}}'),
  'chip.who.person': t('you'),
  'chip.who.library': t("the library's record"),
  'chip.who.model': t('the model'),
  'chip.who.app': t('the app (not recorded with the run)'),
  'chip.declared': t('declared'),
  'chip.notDeclared': t('no coverage declared'),
  'chip.undeclaredEmpty': t('undeclared empty'),
  'chip.decidedDelivered': t('decided = delivered'),
  'chip.decidedNotDelivered': t('decided ≠ delivered'),
  'chip.notRecorded': t('not recorded'),
  'chip.beforePause': t('before a pause — not in this record'),
  'chip.kind.existence': t('whether it exists'),
  'chip.kind.scope': t('outside what it covers'),
  'chip.signals': t("{{count:n,'signal','signals'}}"),
  'chip.noneFound': t('none found'),

  // ── pieces a line is built from ──────────────────────────────────────
  'part.skill.labelled': t('{{label:label}} skill ({{id:code}})'),
  'part.skill.bare': t('{{id:code}} skill'),
  'part.allOf.one': t('it'),
  'part.allOf.two': t('both'),
  'part.allOf.many': t('all {{n}}'),
  'part.clipped': t('… (the rest is in the record)'),
  'distance.previous': t('(the previous one)'),
  'distance.back': t('({{n}} answers back)'),
  'distance.atLeast': t("(at least {{count:n,'answer','answers'}} back)"),
  'unreadable.line': t('This line could not be written from the record.'),

  // ── You asked ────────────────────────────────────────────────────────
  asked: t('“{{question:quote}}”', 'person'),
  'asked.rewritten': t(
    'Your message, as the app passed it to the model: “{{question:quote}}”',
    'app',
  ),
  'asked.raw.notRecorded': t('Your own words before that change are not in this record.'),
  'asked.resumed': t(
    'This answer continued after a pause. The message, as the run held it: “{{question:quote}}”',
  ),
  'asked.none': t('The question is not recorded.'),

  // ── It understood ────────────────────────────────────────────────────
  'understood.rule': t(
    "The library's routing picked the {{skill:skill}} because one of the app's rules matched.",
  ),
  'understood.rule.witness': t(
    "The library's routing picked the {{skill:skill}} because one of the app's rules matched your words “{{witness:quote}}”.",
  ),
  'understood.intent': t("The library's routing picked the {{skill:skill}}."),
  'understood.scores.allOthers': t(
    "The app's scoring put it first: {{top}} against {{next}} for every other skill.",
    'app',
  ),
  'understood.scores': t(
    "The app's scoring put it first: {{top}} against {{next}} for the next one, the {{nextSkill:skill}}.",
    'app',
  ),
  'understood.continuity': t('It stayed with the {{skill:skill}} from the previous question.'),
  'understood.decider': t(
    'A separate routing model ({{model:code}}) picked the {{skill:skill}}.',
    'model',
  ),
  'understood.decider.noModel': t('A separate routing model picked the {{skill:skill}}.', 'model'),
  'understood.menu': t(
    "No routing rule decided; the model was offered {{count:offered,'skill','skills'}} to choose from.",
  ),
  'understood.menu.bare': t(
    'No routing rule decided; the model was offered skills to choose from.',
  ),
  'understood.menu.picked': t('The model then opened the {{skill:skill}}.', 'model'),
  'understood.none': t('No skill was chosen; the answer ran on the general instructions.'),
  'understood.notConfigured': t('This app does not route questions to skills.'),
  'understood.notRecorded': t('How the question was routed is not recorded.'),
  'understood.resumed': t('The routing happened before the pause and is not in this record.'),
  'understood.delivered': t('The skill was given to the model before it answered.'),
  'understood.notDelivered': t('The {{skill:skill}} was not given to the model.'),
  'understood.notDelivered.other': t(
    'The {{skill:skill}} was not given to the model; it was given the {{other:skill}} instead.',
  ),
  'understood.delivery.unknown': t(
    'Whether the skill was given to the model cannot be told from this record.',
  ),
  'understood.refused': t('A check named {{by:code}} refused to open the {{skill:skill}}.'),
  'understood.refused.unnamed': t('A check refused to open the {{skill:skill}}.'),
  'understood.refused.more': t(
    "…and {{count:n,'more refusal','more refusals'}} of the same skill, not listed here.",
  ),
  'understood.rejected': t('The skill graph refused to open the {{skill:skill}}.'),
  'understood.confidence.none': t('How sure the routing was is not recorded.'),
  'understood.app.notRecorded': t(
    'Whether the app itself decided a skill for this question is not recorded.',
    'app',
  ),

  // ── It checked ───────────────────────────────────────────────────────
  'checked.declared': t('{{tool:code}} says it checked:', 'tool'),
  'checked.item': t('{{short:label}}', 'tool'),
  'checked.item.full': t('{{what}}', 'tool'),
  'checked.silent': t('{{tool:code}} declared its limits but did not say what it checked.'),
  'checked.undeclared': t('It ran {{tool:code}}. The tool did not say what it checked.'),
  'checked.failed': t('It ran {{tool:code}}, and the tool reported an error.'),
  'checked.refused': t('It asked to run {{tool:code}}, and a rule named {{by:code}} refused it.'),
  'checked.refused.unnamed': t('It asked to run {{tool:code}}, and a rule refused it.'),
  'checked.declined': t('It asked to run {{tool:code}}; a person was asked and declined.'),
  'checked.notDispatched': t('It asked to run {{tool:code}}, but the call was not run.'),
  'checked.unknown': t('It started {{tool:code}}; how the call ended is not recorded.'),
  'checked.beforePause': t(
    "Before the pause it also ran {{count:n,'tool','tools'}} ({{names}}); what those checked is not in this record.",
  ),
  'checked.beforePause.many': t(
    "Before the pause it also ran {{count:n,'tool','tools'}} (among them {{names}}); what those checked is not in this record.",
  ),
  'checked.unnamed': t(
    'A tool call ({{id:code}}) is in this record, but no event of it names its tool.',
  ),
  'checked.beforePause.none': t('Anything run before the pause is not in this record.'),
  'checked.noCalls': t('It did not run any tools for this answer.'),

  // ── It did not check ─────────────────────────────────────────────────
  'notChecked.declared': t('{{tool:code}} says it did not check:', 'tool'),
  'notChecked.item': t('{{short:label}}', 'tool'),
  'notChecked.item.full': t('{{what}}', 'tool'),
  'notChecked.silent': t('{{tool:code}} did not say what it left unchecked.'),
  'notChecked.undeclared': t('{{tool:code}} did not say what it left unchecked.'),
  'cannotCover.declared': t('{{tool:code}} says it can never check:', 'tool'),
  'cannotCover.item': t('{{short:label}}', 'tool'),
  'cannotCover.item.full': t('{{what}}', 'tool'),
  'tryInstead.tool': t('{{tool:code}} suggested trying {{other:code}} instead.', 'tool'),
  'notChecked.unnamed': t(
    'What the call {{id:code}} left unchecked is not told here: no event of it names its tool.',
  ),
  'notChecked.notListed': t(
    "None of the tool calls listed here ran; {{count:n,'call that ran is','calls that ran are'}} among the ones not listed.",
  ),
  'notChecked.noCalls': t('Nothing to report: no tool ran.'),
  'notChecked.noneRan': t('Nothing to report: none of the tool calls ran.'),
  'notChecked.beforePause': t(
    'What the tools run before the pause did not check is not in this record.',
  ),

  // ── It found ─────────────────────────────────────────────────────────
  'found.absent': t('{{tool:code}} looked for {{lookedFor}} and found none.', 'tool'),
  'found.bare': t('{{tool:code}} found nothing matching.', 'tool'),
  'found.undeclaredEmpty': t(
    '{{tool:code}} returned an empty result and did not declare what it searched.',
  ),
  'found.rows': t("{{tool:code}} returned {{count:n,'item','items'}}."),
  'found.result': t('{{tool:code}} returned a result.'),
  'found.failed': t('{{tool:code}} returned an error, not a result.'),
  'found.refused': t('{{tool:code}} did not run, so it found nothing.'),
  'found.declined': t('{{tool:code}} did not run, so it found nothing.'),
  'found.notDispatched': t('{{tool:code}} did not run, so it found nothing.'),
  'found.unknown': t('What {{tool:code}} returned is not recorded.'),
  'found.withheld': t(
    '{{tool:code}} ran, but a rule named {{by:code}} withheld its result from the model.',
  ),
  'found.beforePause': t('What the tools found before the pause is not in this record.'),
  'found.inView': t(
    'The model could also see the result of {{tool:code}} from an earlier answer {{distance:distance}}.',
  ),
  'found.inView.undeclaredEmpty': t(
    'The model could also see the result of {{tool:code}} from an earlier answer {{distance:distance}}: an empty result that did not declare what it searched.',
  ),
  'found.inView.absent': t(
    'The model could also see the result of {{tool:code}} from an earlier answer {{distance:distance}}: it found nothing and declared what it searched.',
  ),
  'found.inView.more': t(
    "…and {{count:n,'more earlier result','more earlier results'}} the model could also see.",
  ),
  'found.unnamed': t(
    'What the call {{id:code}} returned is not told here: no event of it names its tool.',
  ),
  'found.noCalls': t('No tool ran for this answer.'),

  // ── How sure ─────────────────────────────────────────────────────────
  'howSure.standing.none': t('The record does not rate how sure this answer is.'),
  'howSure.expected.direct': t(
    'Before calling {{tool:code}}, the model said it expected this call to answer the question directly, and rated how useful it expected the result to be: {{expect}}.',
    'model',
  ),
  'howSure.expected.directNoRating': t(
    'Before calling {{tool:code}}, the model said it expected this call to answer the question directly.',
    'model',
  ),
  'howSure.expected.exploratory': t(
    'Before calling {{tool:code}}, the model said this call was exploratory.',
    'model',
  ),
  'howSure.expected.more': t(
    "…and {{count:n,'more call','more calls'}} the model declared an expectation for, not listed here.",
  ),
  'howSure.outcome.nothing': t('The call found nothing.', 'tool'),
  'howSure.outcome.empty': t('The call returned an empty result.'),
  'howSure.evidence.lookedUp': t(
    "The library looked up {{count:lookedUp,'value','values'}} from the answer in what the tools returned and found {{allOf:lookedUp}}.",
  ),
  'howSure.evidence.lookedUp.none': t(
    "Every value in the answer also appears in your message, the conversation or the app's own instructions (recalled memory included), so none needed looking up.",
  ),
  'howSure.evidence.unsplit': t(
    "The library checked the answer's names and numbers: none was missing from what the tools returned, your message, the conversation or the app's own instructions (recalled memory included).",
  ),
  'howSure.evidence.flagged': t(
    "The library could not find {{count:n,'value','values'}} from the answer in any tool result: {{values}}.",
  ),
  'howSure.evidence.flagged.list': t(
    "The library could not find {{count:n,'value','values'}} from the answer in any tool result:",
  ),
  'howSure.evidence.flagged.atLeast': t(
    'The library could not find at least {{n}} values from the answer in any tool result:',
  ),
  'howSure.evidence.value': t('{{value:code}}'),
  'howSure.evidence.revised': t('The answer was sent back once to be corrected before this check.'),
  'howSure.evidence.empty': t('The answer contained no names or numbers for the library to check.'),
  'howSure.evidence.truncated': t(
    "The library's index of tool results was full, so this check is incomplete.",
  ),
  'howSure.evidence.off': t("The library was not set to check the answer's names and numbers."),
  'howSure.evidence.notRecorded': t(
    "Whether the answer's names and numbers were checked is not recorded.",
  ),

  // ── Anything wrong: signals ──────────────────────────────────────────
  'signal.decidedNotDelivered': t(
    'The {{skill:skill}} was decided for this question but was not given to the model.',
  ),
  'signal.existenceNotChecked': t('{{tool:code}} says it did not check {{short:label}}.', 'tool'),
  'signal.existenceNotChecked.full': t('{{tool:code}} says it did not check {{what}}.', 'tool'),
  'signal.existenceCannotCover': t(
    '{{tool:code}} says it can never check {{short:label}}.',
    'tool',
  ),
  'signal.existenceCannotCover.full': t('{{tool:code}} says it can never check {{what}}.', 'tool'),
  'signal.undeclaredEmptyUsed': t(
    "This answer's {{tool:code}} call returned an empty result that did not declare what it searched.",
  ),
  'signal.undeclaredEmptyInView': t(
    'An empty result that did not declare what it searched, from {{tool:code}} in an earlier answer {{distance:distance}}, was in front of the model when it answered.',
  ),

  // ── Anything wrong: the checks that could not run ────────────────────
  'unreachable.decided': t(
    'It cannot be told whether the chosen skill was given to the model: the routing is not in this record.',
  ),
  'unreachable.delivery': t(
    'It cannot be told whether the chosen skill was given to the model: what the model was given is not fully in this record.',
  ),
  'unreachable.existence': t(
    'It cannot be told whether {{tool:code}} checked that the thing asked about exists: its not-checked items do not say what kind they are.',
  ),
  'unreachable.unnamed': t(
    'It cannot be told what the call {{id:code}} found: no event of it names its tool.',
  ),
  'unreachable.unnamed.existence': t(
    'It cannot be told whether the call {{id:code}} checked that the thing asked about exists: no event of it names its tool.',
  ),
  'unreachable.unnamed.both': t(
    'It cannot be told what the call {{id:code}} found, nor whether it checked that the thing asked about exists: no event of it names its tool.',
  ),
  'unreachable.empty': t(
    'It cannot be told whether the result of {{tool:code}} was empty: its shape is not declared.',
  ),

  // ── Anything wrong: the row's own lines ──────────────────────────────
  'wrong.errors': t(
    "{{count:n,'tool call','tool calls'}} did not run cleanly: {{failed}} failed, {{refused}} refused by a rule, {{declined}} declined by a person, {{notDispatched}} not run.",
  ),
  'wrong.withheld': t(
    "{{count:n,'result was','results were'}} withheld from the model by a rule after the tool ran.",
  ),
  'wrong.noErrors': t('No tool call failed or was refused.'),
  'wrong.none': t("The {{count:reachable,'check','checks'}} this report could run found nothing."),
  'wrong.unreachable': t(
    '{{unreachable}} of the {{applicable}} checks could not be run on this record.',
  ),
  'wrong.unreachable.all': t(
    'None of the checks this report looks for could be run on this record.',
  ),
  'wrong.more': t("…and {{count:n,'more line','more lines'}} from these checks, not listed here."),
  'wrong.notApplicable': t('None of the checks this report looks for applies to this answer.'),
  'wrong.beforePause': t(
    'Anything before the pause is not in this record, so these checks cover only the part after it.',
  ),
  'scope.noOwnEvents': t(
    "None of this record's events belong to the run asked for, so nothing about that run can be told from it.",
  ),
  'row.notInRecord': t('Not in this record: none of its events belong to the run asked for.'),
  'scope.unfiltered': t(
    'Which run these events belong to is not recorded, so this report reads every event in the record.',
  ),

  // ── In one line ──────────────────────────────────────────────────────
  'summary.signal': t('{{first}}'),
  'summary.signals': t('{{first}} {{second}}'),
  'summary.none': t('Nothing this report looks for turned up in the record.'),
  'summary.none.partial': t(
    'Nothing this report looks for turned up, but {{unreachable}} of the {{applicable}} checks could not be run on this record.',
  ),
  'summary.none.nothingRun': t('This report could not run any of its checks on this record.'),
  'summary.none.notApplicable': t(
    'None of the checks this report looks for applies to this answer.',
  ),
  'summary.resumed': t(
    'This answer continued after a pause; what happened before the pause is not in this record.',
  ),
  'summary.resumed.tail': t('What happened before the pause is not in this record.'),
  // What the RECORD shows, never what the run did: a missing `turn_end` can be a pause, a crash
  // or a truncated recording, and the record cannot tell those apart.
  'summary.unfinished': t('This record does not show the run finishing.'),
  'summary.notAvailable': t("This answer's record is not available, so it cannot be explained."),
} satisfies Record<string, AccountTemplate>);

export type TemplateId = keyof typeof ANSWER_ACCOUNT_TEMPLATES;
