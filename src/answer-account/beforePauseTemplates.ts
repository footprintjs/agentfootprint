import { t, type AccountTemplate } from './templateEntry.js';

export const BEFORE_PAUSE_TEMPLATES = {
  // A call answered BEFORE a pause, read from the committed state (`facts/pausedLeg.ts`): what
  // came back is in history, what its tool declared is in `coverageDeclared` — never its events.
  'checked.beforePause.declared': t('Before the pause, {{tool:code}} said it checked:', 'tool'),
  'checked.beforePause.silent': t(
    'Before the pause, {{tool:code}} declared its limits but did not say what it checked.',
  ),
  'checked.beforePause.undeclared': t(
    'Before the pause, the model read what came back from {{tool:code}}; the tool did not say what it checked.',
  ),
  'beforePause.more': t(
    "…and {{count:n,'more tool call','more tool calls'}} from before the pause.",
  ),
  'beforePause.noResults': t("No tool result from before the pause is in this record's history."),
  'beforePause.unmatched': t(
    'This record cannot match tool results from before the pause to its final history.',
  ),
  'beforePause.keptOut': t(
    "This record keeps the run's history out, so what came back before the pause cannot be told.",
  ),
} satisfies Record<string, AccountTemplate>;
