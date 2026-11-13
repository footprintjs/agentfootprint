/**
 * The answer account's words for "did this call's tool run?" — one part of
 * the closed table (`templates.ts`, which holds its laws and its version),
 * set 16. The account says "It ran {tool}" only when the record shows the
 * tool ran (`stream.tool_end.entered`, read by `semantics/toolRan.ts` ·
 * `toolRanOf`). A call that never reached its tool (an unknown name, rejected
 * arguments, a blocked credential), and an error on a record that does not
 * say (written before `entered`), get words that are true of them.
 *
 * Example, the model calls `reboot_host`, which no tool is named:
 *   It asked to run reboot_host; the call was not executed.
 *   reboot_host did not run, so it found nothing.
 *   1 tool call did not run cleanly: 0 failed, 1 not executed, 0 refused by a
 *   rule, 0 declined by a person, 0 not run.
 */

import { t, type AccountTemplate } from './templateEntry.js';

export const DID_IT_RUN_TEMPLATES = {
  'checked.notExecuted': t('It asked to run {{tool:code}}; the call was not executed.'),
  'checked.endedInError': t('It asked to run {{tool:code}}; the call ended in an error.'),
  // No call returned a result, and at least one of them may have run (`facts/checked.ts` ·
  // `knownNotRun`): "none ran" would be false of a tool that ran and threw.
  'notChecked.noResults': t('Nothing to report: no tool call returned a result in this record.'),
  'notChecked.notListed.noResults': t(
    "None of the tool calls listed here returned a result; {{count:n,'call that did is','calls that did are'}} among the ones not listed.",
  ),
  // Never "returned an error" for a call that did not reach its tool.
  'found.notExecuted': t('{{tool:code}} did not run, so it found nothing.'),
  'found.endedInError': t('The call to {{tool:code}} ended in an error, not a result.'),
  // Version 2: a call that never reached its tool has its own count ("not executed"),
  // never "failed" (`facts/errorCounts.ts` · `errorCounts`). Version 1 counted it as failed.
  'wrong.errors': t(
    "{{count:n,'tool call','tool calls'}} did not run cleanly: {{failed}} failed, {{notExecuted}} not executed, {{refused}} refused by a rule, {{declined}} declined by a person, {{notDispatched}} not run.",
    'library',
    2,
  ),
} satisfies Record<string, AccountTemplate>;
