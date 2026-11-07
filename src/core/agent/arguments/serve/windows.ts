/** Lens: the late line over the person's windows and tool forms. */
import type { LLMToolSchema } from '../../../../provider-contract/types.js';
import { carriesArgumentView } from '../../../toolShownArgs.js';
import type { InputValue } from '../../../../tools/inputRequest.js';
import {
  isRefused,
  periodFactsOf,
  periodFormsOf,
  rulesOf,
  type RuledToolLike,
} from '../../../../tools/declare.js';
import {
  convertForTool,
  formArguments,
  granularityMsOf,
  toolFacts,
} from '../../../../time/convert.js';
import type { ReaderWindows } from '../../../../time/bind.js';
import { windowToConvert } from '../../../../time/windows.js';
import type { ZoneName } from '../../../../time/zone.js';
import { presentRange } from '../../../../time/present.js';
import { printedValue } from './values.js';
import { UNKNOWN_ZONE_CLAUSE } from './clock.js';
import { refusalReason } from './refusals.js';

// ─── The person's windows, served LATE at the decision point (time design TQ13) ───

/**
 * What the served line reads: the turn's SETTLED windows of the person's
 * words (`time/windows.ts` · `readerWindowsOf` — each mention's quote and
 * its one window: the one the person confirmed or gave in the time ask, or a
 * `model` reader's reading), the quotes still PENDING (a proposal the person
 * has not answered, a zone to name, or words the library could not read —
 * `pendingUnread`), the turn's clock, and the app's `.time({ zone })`.
 */
export interface ServedWindows extends ReaderWindows {
  readonly appZone?: ZoneName;
}

/** A converted value as the line prints it — an object form's as JSON. */
function printedArgument(value: unknown): string {
  return typeof value === 'object' && value !== null
    ? JSON.stringify(value)
    : printedValue(value as InputValue);
}

/** A served tool that declares a period — the only tools the line speaks about. */
interface PeriodTool {
  readonly name: string;
  readonly tool: RuledToolLike;
  readonly forms: ReturnType<typeof periodFormsOf>;
  readonly facts: ReturnType<typeof periodFactsOf>;
}

/** The served tools (in served order) whose winning implementation declares period forms. */
function periodToolsOf(
  served: readonly LLMToolSchema[],
  winningTools: ReadonlyMap<string, RuledToolLike>,
): readonly PeriodTool[] {
  const out: PeriodTool[] = [];
  for (const schema of served) {
    const tool = winningTools.get(schema.name);
    const rules = rulesOf(tool);
    if (tool === undefined || rules === undefined || isRefused(rules)) continue;
    const forms = periodFormsOf(rules.period);
    if (forms.length === 0) continue;
    out.push({ name: schema.name, tool, forms, facts: periodFactsOf(rules.period) });
  }
  return out;
}

/** Whose one window of the person's words is — the line's source clause. */
function whoseWindow(w: ServedWindows['windows'][number]): string {
  if (w.source === 'answered') {
    return w.answer === 'edited'
      ? 'the window the person gave when asked what their words meant'
      : 'the window the person confirmed when asked what their words meant';
  }
  return "a reading of the person's words they have not confirmed, not their words";
}

/**
 * A window for a person, in its zone, to the minute with its end AS SAID — the last minute inside
 * the half-open range (`time/present.ts` · `presentRange`); the ISO interval if it cannot be.
 */
function presentedWindow(w: ServedWindows['windows'][number]): string {
  try {
    return presentRange(w.range, { zone: w.zone }, 'minute');
  } catch {
    return `${w.range.from}/${w.range.to}`;
  }
}

/** One tool's values for one settled window — exact, else the wider read the fill would use, said so. */
function toolValues(
  pt: PeriodTool,
  w: ServedWindows['windows'][number],
  windows: ServedWindows,
): string | undefined {
  const ctx = {
    now: windows.now,
    zone: w.zone,
    ...(windows.appZone !== undefined && { appZone: windows.appZone }),
    granularityMs: granularityMsOf(pt.facts),
  };
  // The one answer (`convertForTool`) over the one input (`windowToConvert`) the fill and the time
  // ask's answer also use: the values named here are the values the call is handed, and a window
  // the tool would refuse is named for no tool.
  const read = convertForTool(windowToConvert(w), pt.forms, pt.facts, ctx);
  if ('refused' in read) return undefined;
  const conversion = read.conversion;
  const values = Object.entries(conversion.values).map(([argument, value]) =>
    carriesArgumentView(pt.tool)
      ? `${argument} (hidden by the tool's view)`
      : `${argument} ${printedArgument(value)}`,
  );
  const wider = 'sent' in conversion ? ' (a wider read than the words named)' : '';
  return `${pt.name} ${values.join(', ')}${wider}`;
}

/** The settled half: each window, whose it is, and each tool's values for it. */
function settledSentence(tools: readonly PeriodTool[], windows: ServedWindows): string | undefined {
  const clauses: string[] = [];
  for (const w of windows.windows) {
    if (w.quote === undefined && w.corrected !== true) continue;
    const values = tools.flatMap((pt) => toolValues(pt, w, windows) ?? []);
    if (values.length === 0) continue;
    const subject = w.corrected === true ? 'The corrected window' : `“${w.quote}”`;
    clauses.push(`${subject} is ${presentedWindow(w)}, ${whoseWindow(w)} — ${values.join('; ')}`);
  }
  if (clauses.length === 0) return undefined;
  const these = clauses.length === 1 ? 'that window' : 'those windows';
  return (
    `The person's time words, as the library holds them: ${clauses.join('. ')}. ` +
    `A call may pass these values as written; an answer built on them states ${these}.`
  );
}

/**
 * The control half: the window the person set in the app's time control (the run's `time.window`,
 * `source: 'control'`, TQ26) — the person's own, like an answer — in their zone, with each served
 * period tool's values for it, the same conversion the fill uses. So an app never writes its own
 * prompt text for a window it set from a UI. The window is a fact about the person's TURN, not
 * about a tool (G14): with no served period tool that can read it, the sentence still names it —
 * without values, and without a permission to pass any.
 */
function controlSentence(tools: readonly PeriodTool[], windows: ServedWindows): string | undefined {
  const w = windows.control;
  if (w === undefined) return undefined;
  const values = tools.flatMap((pt) => toolValues(pt, w, windows) ?? []);
  // Under an unknown zone (G15) the window is spelled in UTC — the zone the presented window
  // already names — and the line says why, once.
  const unknown = windows.zoneUnknown === true ? ` (${UNKNOWN_ZONE_CLAUSE})` : '';
  const named = `The window the person set in the app's time control is ${presentedWindow(
    w,
  )}${unknown}`;
  if (values.length === 0) return `${named}. An answer built on it states that window.`;
  return (
    `${named} — ${values.join('; ')}. A call may pass these values as written; an answer built ` +
    'on them states that window.'
  );
}

/**
 * The pending half: the quotes no one has confirmed. Before any call ran on a window of the
 * model's own, the one move that asks the person — the call with the period left out — named as
 * the next step, with the two moves that do not (a question in the reply, a written window).
 * After one did, the limit the answer states instead, as a CONCLUSION about the results in hand:
 * whose reading their window is and what the answer names — never a story of the call that ran
 * and never a negation of a confirmation. Measured twice: "the person has not confirmed it" drew
 * "You're right… I apologize" on 37/37 answers (T6b round 1); "the call that ran carried a window
 * written into the call, not one the person confirmed", under the library's opening, still drew it
 * on 7/10 (`bench/time/runs/haiku45-t6b-r2`, stopped) — a past-tense account of the call reads as
 * the person's complaint, whoever the opening says is talking.
 */
function pendingSentence(
  allTools: readonly PeriodTool[],
  windows: ServedWindows,
): string | undefined {
  // A tool that refused a quote cannot confirm it: the quote is pending only for the tools that
  // did not, and one every served period tool refused is the refused half's alone.
  const pending = (windows.pending ?? []).filter((q) =>
    allTools.some((t) => !refusedFor(windows, q, t.name)),
  );
  if (pending.length === 0) return undefined;
  const tools = allTools.filter((t) => pending.some((q) => !refusedFor(windows, q, t.name)));
  const quotes = pending.map((q) => `“${q}”`).join(', ');
  if (windows.ranUnconfirmed === true) {
    return (
      `The results for ${quotes} cover the window written into the call — the assistant's own ` +
      `reading of those words. So the answer gives those results and names that window as the ` +
      `assistant's reading of ${quotes}.`
    );
  }
  const leftOut = tools.flatMap((pt) => {
    const args = [...new Set(pt.forms.flatMap((f) => formArguments(f).map((a) => a.argument)))];
    return args.length === 0 ? [] : [{ name: pt.name, args: args.join(', ') }];
  });
  if (leftOut.length === 0) return undefined;
  const unread = (windows.pendingUnread ?? []).filter((q) => pending.includes(q));
  if (unread.length > 0) {
    return unreadSentence(
      pending,
      windows.pendingZones ?? [],
      unread,
      leftOut.map((c) => `${c.name} with ${c.args} left out`).join(', or '),
    );
  }
  const calls = leftOut.map((c) => `${c.name} is called with ${c.args} left out`);
  return (
    `The window for ${quotes} is not settled yet: ${formClause(pending, windows.pendingZones)} ` +
    `${calls.join(', or ')} (or the call is refused with the reason). So the next step is that ` +
    'call — not a question about the time in the reply, and not a window written into the call, ' +
    'which would run unconfirmed.'
  );
}

/**
 * What the library's own form does for the pending quotes, up to "opens when": it shows its
 * reading to confirm — or, for a quote it holds no reading of (`ReaderWindows.pendingZones`: a
 * zone it cannot resolve), it asks which time zone the words name and shows no reading. Words it
 * could not read at all (`ReaderWindows.pendingUnread`) are {@link unreadSentence}'s.
 */
function formClause(pending: readonly string[], zones: readonly string[] = []): string {
  const zoned = pending.filter((q) => zones.includes(q));
  const read = pending.filter((q) => !zones.includes(q));
  if (zoned.length === 0) {
    return (
      "the person confirms it in the library's own form, which shows its reading of those " +
      'words with the zone and opens when'
    );
  }
  const zq = zoned.map((q) => `“${q}”`).join(', ');
  if (read.length === 0) {
    return (
      'the library holds no reading of those words until it knows which time zone they name, ' +
      'so its own form asks the person for that zone, and it opens when'
    );
  }
  const rq = read.map((q) => `“${q}”`).join(', ');
  return (
    `the person confirms ${rq} in the library's own form, which shows its reading of those ` +
    `words with the zone, and names the time zone of ${zq}, which the library holds no reading ` +
    'of until it knows it; the form opens when'
  );
}

/**
 * The pending half when some of the person's words were not read at all
 * (`ReaderWindows.pendingUnread`): the library's CONCLUSION and the ONE next step, in that order —
 * it could not read those words, so the next step is the call with the period left out, which
 * opens its own form (asking which time they meant, nothing filled in; beside it, a reading to
 * confirm and a zone to name, each quote with what the form does for it) — then the two moves
 * that are not it, said as what not to do.
 *
 * WHY THIS SHAPE. The line before it opened "The window for … is not settled yet: the library
 * could not read those words, so its own form asks the person which time they meant … So the next
 * step is that call — not a question about the time in the reply". Haiku 4.5 answered it with a
 * question in prose and no call on 15/15 `yesterday-morning` runs of the T6b bench
 * (`bench/time/runs/haiku45-t6b-v2`), and again in the 2026-10-01 demo video ("which clients had
 * slow operations yesterday morning"): "could not read" read as permission to ask, and the next
 * step came last. So the step comes first, as the conclusion of what the library could not read,
 * and the reply's question is named as the move NOT to make (`bench/time/RULE-unread.md`).
 */
function unreadSentence(
  pending: readonly string[],
  zones: readonly string[],
  unread: readonly string[],
  leftOut: string,
): string {
  const listed = (qs: readonly string[]): string => qs.map((q) => `“${q}”`).join(', ');
  const zoned = pending.filter((q) => zones.includes(q) && !unread.includes(q));
  const read = pending.filter((q) => !zones.includes(q) && !unread.includes(q));
  const alone = zoned.length === 0 && read.length === 0;
  const does = [
    alone
      ? 'asks the person which time they meant, with nothing filled in'
      : `asks the person which time ${listed(unread)} meant, with nothing filled in`,
    ...(read.length > 0
      ? [`shows its reading of ${listed(read)} with the zone for the person to confirm`]
      : []),
    ...(zoned.length > 0
      ? [
          `asks the time zone of ${listed(
            zoned,
          )}, which the library holds no reading of until it knows it`,
        ]
      : []),
  ];
  const doing =
    does.length === 1
      ? does[0]
      : `${does.slice(0, -1).join(', ')}, and ${does[does.length - 1] as string}`;
  return (
    `The library could not read ${listed(unread)}, so the next step is to call ${leftOut}: ` +
    `that call opens the library's own form, which ${doing} (or the call is refused with the ` +
    'reason). Do not ask about the time in the reply — the form asks it — and do not write a ' +
    'window into the call, which would run unconfirmed.'
  );
}

// LENS · late-line · request-ephemeral
// reads: the person's windows a SERVED period tool refused this turn before dispatch (`time/windows.ts` ·
//        `readerWindowsOf`, `refused`: the quote, the tool and the reason code) and that tool's
//        declared facts
// law: the library's CONCLUSION about a call that did not run: past tense for the refusal, the
//      reason in the tool's declared facts only (the one text `timeRefusal` also serves — never the
//      window's value), then what an answer states; it names no next move for that window.
/**
 * The refused half of the served time line: each window of the person's a
 * served period tool refused before dispatch — the call's reason in the same
 * words its result read ({@link timeRefusal}), then the conclusion an answer
 * states. A refused window is not a pending one to ask about again: the T6b
 * bench's future case asked the same refused call five times and ran out of
 * budget while the pending half kept naming that call as the next step.
 * `undefined` when nothing was refused.
 */
function refusedSentence(tools: readonly PeriodTool[], windows: ServedWindows): string | undefined {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const refused = (windows.refused ?? []).filter((r) => byName.has(r.toolName));
  if (refused.length === 0) return undefined;
  const clauses = refused.map((r) => {
    // The person's window was refused before a form was chosen: the tool's facts (`toolFacts`).
    const pt = byName.get(r.toolName) as PeriodTool;
    const facts = toolFacts(pt.forms, pt.facts);
    return `${r.toolName} was not run for “${r.quote}”: ${refusalReason(
      r.refused,
      facts,
      r.argument,
    )}.`;
  });
  const names = [...new Set(refused.map((r) => r.toolName))];
  const conclusion =
    refused.length === 1
      ? `So the answer tells the person that ${names[0]} could not read that time, and claims ` +
        `nothing about it from ${names[0]}.`
      : 'So the answer tells the person which of those times each tool could not read, and ' +
        'claims nothing about them from that tool.';
  return `${clauses.join(' ')} ${conclusion}`;
}

/** Whether `tool` refused the person's window for `quote` this turn. */
const refusedFor = (windows: ServedWindows, quote: string, tool: string): boolean =>
  (windows.refused ?? []).some((r) => r.quote === quote && r.toolName === tool);

// LENS · late-line · request-ephemeral
// reads: the turn's settled windows of the person's words (each mention's quote, its one window and
//        WHOSE it is — the person's answer in the time ask, or a model reader's reading), the
//        quotes still pending (a rule reading the person has not answered — `bind.ts` ·
//        `pendingQuotesOf`), the turn's clock, and the SERVED tools' declared period forms and
//        facts — converted by the one owner (`time/convert.ts`)
// law: the library's CONCLUSION, never raw facts: a settled window is named with its source (a
//      reading is never called the person's words) and the values each tool takes, as a
//      permission ("may pass"); a pending quote names no window and no reading (a proposal is not
//      a fact the model may pass) — only that it is not confirmed and the one move that asks the
//      person. Whether a call is filled, bound or refused is decided at dispatch and recorded there.
/**
 * The ONE served time line (TQ13; step T6b's serving placement): one
 * request-only `user` line appended LAST to the request, at the decision
 * point — composed at the tools slot's one decoration site
 * (`core/slots/buildToolsSlot.ts` · `commitWire`) from the tools it really
 * serves, carried to `callLLM` on `timeLine`, and rebuilt by
 * `time-travel/servedView.ts` from the same committed key. Four parts:
 *
 * - SETTLED — each window the person confirmed or gave in the time ask (or a
 *   `model` reader's reading), in the person's zone, WHOSE it is, and each
 *   served period tool's values for it — the exact conversion, else the wider
 *   one the fill would use (said so); a value the tool's view hides is named
 *   hidden. So the model never re-derives a window from words, and the answer
 *   states the window it was built on.
 * - CONTROL — the window the person set in the app's time control, in
 *   their zone, with each served period tool's values for it; with none
 *   (no period tool served, or none can read it) the window alone (G14).
 * - REFUSED — a window of the person's a served period tool refused before
 *   dispatch this turn: the refusal's reason in the result's own words, then
 *   what an answer states. That quote is no longer pending for that tool.
 * - PENDING — a proposal the person has not answered is no window yet, and a
 *   call that writes its own window runs as sent, unconfirmed (§ 7.3). The
 *   line names the next step — the call with the period arguments left out,
 *   so the library's own form confirms the window with the person — and the
 *   two moves that are not it (a question about the time in the reply, a
 *   written window). Once a call of the turn already ran on a written window
 *   (`ranUnconfirmed`), it names the limit an answer states instead.
 *
 * `undefined` when no part has anything to say — a turn with no time words
 * and no control window serves no line at all; with no served period tool
 * only the control half can speak. The halves carry no opening: {@link timeLine} composes the served line and
 * opens it, once, with {@link TIME_LINE_SOURCE}.
 *
 * @example
 * ```ts
 * timeWindowsLine(served, winningTools, { now, windows: [], pending: ['yesterday'] });
 * // 'The window for “yesterday” is not settled yet: the person confirms it in the library's own
 * //  form, which shows its reading of those words with the zone and opens when client_activity
 * //  is called with start_time, end_time left out (or the call is refused with the reason). So
 * //  the next step is that call — not a question about the time in the reply, and not a window
 * //  written into the call, which would run unconfirmed.'
 * ```
 */
export function timeWindowsLine(
  served: readonly LLMToolSchema[],
  winningTools: ReadonlyMap<string, RuledToolLike>,
  windows: ServedWindows,
): string | undefined {
  const tools = periodToolsOf(served, winningTools);
  // The control window is the person's turn's, served whether or not a period tool is (G14); the
  // other halves speak about period tools only.
  if (tools.length === 0) return controlSentence(tools, windows);
  const halves = [
    settledSentence(tools, windows),
    controlSentence(tools, windows),
    refusedSentence(tools, windows),
    pendingSentence(tools, windows),
  ].filter((h): h is string => h !== undefined);
  return halves.length === 0 ? undefined : halves.join(' ');
}
