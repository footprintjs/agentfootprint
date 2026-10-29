// Run every reader over one set and score it.
//
//   TZ=UTC node scripts/run.mjs existing|heldout [--duckling-replay] [--reference <module>]
//
// Outcome per phrase: read N seconds | ask | none (no time named → the tool's default window).
// Expected outcome: the phrase's meaning label, except that a request carrying a sampling
// instruction ASKS under these profiles, because neither declares that it executes sampling.
// Verdict (never merged into one accuracy):
//   exact            read the window meant
//   wrong-window     read a window or scope not meant (another length, a dropped part, or a read where it should ask / name no time)
//   silent-default   said nothing although a time was named → the default stood in for the person's words
//   correct-ask      asked, as expected
//   unnecessary-ask  asked although an exact reading existed
//   correct-none     no time named, none read
// WRONG READINGS = wrong-window + silent-default. UNNECESSARY CLARIFICATIONS = unnecessary-ask.
//
// Modes, each adding one layer to the one before:
//   value-only      the reader's first value taken as the window
//   structure       one mention, a lookback ending now, no modifier, not ambiguous; else ask
//   strict          + the leftover scan (signals.mjs · scan): a time-bearing word outside the reading asks
//   strict+agree    + quote agreement (signals.mjs · readLookbackQuote)
//   complete        + the complete-meaning rule (meaning-rule.mjs), tool profile 'declared-from-existing'
//   complete+nouns  the same rule, tool profile 'plus-held-out-nouns' (more declared nouns, so more reads)
//
// Every reader's native output is written to results/raw/, so a later run can re-score without a
// server (--duckling-replay reads Duckling's recorded answers). The host app's own rule is a
// reference row only when its private module is supplied (--reference); it is not part of this folder.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { recognizers, chronoNode, duckling, afEnglish, libraryGrammar } from './adapters.mjs';
import { scan, readLookbackQuote, SCAN_VERSION } from './signals.mjs';
import { unaccounted, MEANING_RULE_VERSION } from './meaning-rule.mjs';

const NOW = new Date('2026-10-27T09:30:00Z');
const args = process.argv.slice(2);
const which = args[0];
if (which !== 'existing' && which !== 'heldout') throw new Error('usage: run.mjs existing|heldout [--duckling-replay] [--reference <module>]');
const replayDuckling = args.includes('--duckling-replay');
const referencePath = args.includes('--reference') ? args[args.indexOf('--reference') + 1] : process.env.HOST_REFERENCE;
const read_ = (f) => JSON.parse(readFileSync(f, 'utf8'));
const profiles = read_('corpus/tool-profiles.json');

const label = (x) => (x === 'ask' || x === 'none' ? x : x.readsSeconds !== undefined ? { reads: x.readsSeconds } : x.readsMinutes !== undefined ? { reads: x.readsMinutes * 60 } : { reads: x.reads * 60 });

function loadCorpus() {
  if (which === 'existing') {
    const rows = read_('corpus/app-corpus.json');
    const m = read_('corpus/meaning.json');
    const sampling = new Set(read_('corpus/sampling.json').texts);
    const overrides = new Map(m.overrides.map((o) => [o.text, o]));
    const out = rows.map((r, i) => {
      const app = typeof r.app === 'string' ? r.app : label(r.app);
      const o = overrides.get(r.text);
      return { id: `E${String(i + 1).padStart(3, '0')}`, text: r.text, source: 'host app corpus', app, meaning: o ? label(o) : app, sampling: sampling.has(r.text) };
    });
    m.additions.forEach((a, i) => out.push({ id: `A${i + 1}`, text: a.text, source: a.source, app: label(a.app), meaning: label(a.meaning), sampling: sampling.has(a.text) }));
    const missing = [...sampling].filter((t) => !out.some((r) => r.text === t));
    if (missing.length) throw new Error('sampling.json names rows not in the corpus: ' + missing.join(' | '));
    return out;
  }
  return read_('corpus/heldout.json').phrases.map((p) => ({ id: p.id, text: p.text, cls: p.class, meaning: label(p.meaning), sampling: p.class === 'sampling-cadence' }));
}
const expectedOf = (item) => (item.sampling ? 'ask' : item.meaning);

const endsNow = (to) => Math.abs(to - NOW.getTime()) < 60_000;
const read = (seconds) => ({ kind: 'read', seconds });
const ask = (why) => ({ kind: 'ask', why });
const NONE = { kind: 'none' };

function valueOnly(parser, entities) {
  const e = entities[0];
  if (e === undefined) return NONE;
  if (e.kind === 'lookback') return read(e.lookbackSeconds);
  if (parser === 'agentfootprint') return e.kind === 'unreadable' ? NONE : ask('parts the app cannot resolve on its own');
  if (e.kind === 'duration' && e.durationSeconds) return read(e.durationSeconds);
  let win = e.window;
  if (e.kind === 'point' && e.at !== undefined) win = e.at <= NOW.getTime() ? { from: e.at, to: NOW.getTime() } : { from: NOW.getTime(), to: e.at };
  if (win === undefined) return NONE;
  if (Number.isFinite(win.from) && Number.isFinite(win.to) && endsNow(win.to) && win.from < win.to) return read((win.to - win.from) / 1000);
  return { kind: 'read', other: true, window: win };
}

function strictRule(text, entities, { leftovers, agree, profile }) {
  if (entities.length === 0) {
    if (leftovers) {
      const left = scan(text, []);
      if (left.length > 0) return ask('time words, no reading: ' + left.map((x) => `${x.text}(${x.cls})`).join(' '));
    }
    return NONE;
  }
  if (entities.length > 1) return ask(`${entities.length} mentions`);
  const e = entities[0];
  if (e.kind !== 'lookback') return ask(`a ${e.kind}, not a lookback`);
  if (e.mods.length > 0) return ask('modifier ' + e.mods.join(','));
  if (e.ambiguous) return ask('ambiguous');
  if (leftovers) {
    const left = scan(text, [e.span]);
    if (left.length > 0) return ask('left: ' + left.map((x) => `${x.text}(${x.cls})`).join(' '));
  }
  if (agree) {
    const quote = text.slice(e.span.start, e.span.end);
    const seconds = readLookbackQuote(quote);
    if (seconds === undefined) return ask(`quote "${quote}" not in the closed grammar`);
    if (Math.abs(seconds - e.lookbackSeconds) > 1) return ask(`quote "${quote}" = ${seconds}s, reader ${e.lookbackSeconds}s`);
  }
  if (profile) {
    const words = unaccounted(text, e.span, profile);
    if (words.length > 0) return ask('unaccounted: ' + words.join(' '));
  }
  return read(e.lookbackSeconds);
}

function verdict(outcome, expected) {
  if (outcome.kind === 'read') {
    if (!outcome.other && typeof expected === 'object' && Math.abs(expected.reads - outcome.seconds) <= 1) return 'exact';
    return 'wrong-window';
  }
  if (outcome.kind === 'none') return expected === 'none' ? 'correct-none' : 'silent-default';
  return expected === 'ask' ? 'correct-ask' : 'unnecessary-ask';
}

const compact = (e) => ({ text: e.text, span: [e.span.start, e.span.end], kind: e.kind, ...(e.lookbackSeconds !== undefined && { lookbackSeconds: e.lookbackSeconds }), ...(e.mods.length && { mods: e.mods }), ...(e.ambiguous && { ambiguous: true }) });

const PARSERS = ['recognizers', 'chrono', 'duckling', 'agentfootprint', 'library-grammar'];
const MODES = ['value-only', 'structure', 'strict', 'strict+agree', 'complete', 'complete+nouns'];
const corpus = loadCorpus();
const duckRecorded = replayDuckling ? new Map(read_(`results/raw/${which}-duckling.json`).map((r) => [r.text, r.native])) : undefined;
const reference = referencePath && existsSync(referencePath) ? await import(referencePath) : undefined;
const raw = Object.fromEntries(PARSERS.map((p) => [p, []]));
const rows = [];

for (const item of corpus) {
  const expected = expectedOf(item);
  const row = { ...item, expected, parsers: {} };
  for (const parser of PARSERS) {
    let entities; let native;
    if (parser === 'recognizers') ({ entities, native } = recognizers(item.text, NOW));
    else if (parser === 'chrono') ({ entities, native } = chronoNode(item.text, NOW));
    else if (parser === 'duckling') ({ entities, raw: native } = await duckling(item.text, NOW, duckRecorded?.get(item.text)));
    else if (parser === 'agentfootprint') ({ entities, native } = afEnglish(item.text));
    else ({ entities, native } = libraryGrammar(item.text));
    raw[parser].push({ id: item.id, text: item.text, native });
    const outcomes = {
      'value-only': valueOnly(parser, entities),
      structure: strictRule(item.text, entities, {}),
      strict: strictRule(item.text, entities, { leftovers: true }),
      'strict+agree': strictRule(item.text, entities, { leftovers: true, agree: true }),
      complete: strictRule(item.text, entities, { leftovers: true, agree: true, profile: profiles['declared-from-existing'] }),
      'complete+nouns': strictRule(item.text, entities, { leftovers: true, agree: true, profile: profiles['plus-held-out-nouns'] }),
    };
    const verdicts = Object.fromEntries(MODES.map((m) => [m, verdict(outcomes[m], expected)]));
    const leftAll = scan(item.text, entities.map((e) => e.span)).filter((x) => x.cls !== 'slot');
    const coverageGap = item.meaning !== 'none' && (entities.length === 0 || leftAll.length > 0);
    row.parsers[parser] = { entities: entities.map(compact), outcomes, verdicts, coverageGap, uncovered: leftAll.map((x) => `${x.text}(${x.cls})`) };
  }
  if (reference) {
    const out = reference.appDecision(item.text);
    row.reference = { outcome: out, verdict: verdict(out, expected), verdictWithLabelsAsWritten: verdict(out, item.meaning), ...(item.app && { verdictVsAppLabel: verdict(out, item.app) }) };
  }
  rows.push(row);
}

// ─── Summaries ──────────────────────────────────────────────────────────────────
const KEYS = ['exact', 'wrong-window', 'silent-default', 'correct-ask', 'unnecessary-ask', 'correct-none'];
const tally = (verdicts) => {
  const t = Object.fromEntries(KEYS.map((k) => [k, 0]));
  for (const v of verdicts) t[v]++;
  return { n: verdicts.length, wrongReadings: t['wrong-window'] + t['silent-default'], unnecessaryClarifications: t['unnecessary-ask'], ...t };
};
const expectedCounts = { reads: rows.filter((r) => typeof r.expected === 'object').length, ask: rows.filter((r) => r.expected === 'ask').length, none: rows.filter((r) => r.expected === 'none').length };
const summary = { set: which, n: rows.length, clock: NOW.toISOString(), expected: expectedCounts, sampling: rows.filter((r) => r.sampling).length, versions: { scan: SCAN_VERSION, meaningRule: MEANING_RULE_VERSION }, parsers: {} };
for (const parser of PARSERS) {
  summary.parsers[parser] = { coverageGaps: rows.filter((r) => r.parsers[parser].coverageGap).length };
  for (const mode of MODES) summary.parsers[parser][mode] = tally(rows.map((r) => r.parsers[parser].verdicts[mode]));
}
if (reference) {
  summary.reference = { vsExpected: tally(rows.map((r) => r.reference.verdict)), vsLabelsAsWritten: tally(rows.map((r) => r.reference.verdictWithLabelsAsWritten)) };
  if (which === 'existing') summary.reference.vsAppLabels = tally(rows.map((r) => r.reference.verdictVsAppLabel));
}
if (which === 'heldout') {
  summary.byClass = {};
  for (const cls of [...new Set(rows.map((r) => r.cls))]) {
    const sub = rows.filter((r) => r.cls === cls);
    summary.byClass[cls] = { n: sub.length };
    for (const parser of PARSERS) summary.byClass[cls][parser] = Object.fromEntries(['strict+agree', 'complete', 'complete+nouns'].map((m) => [m, tally(sub.map((r) => r.parsers[parser].verdicts[m]))]));
    if (reference) summary.byClass[cls].reference = tally(sub.map((r) => r.reference.verdict));
  }
}
mkdirSync('results/raw', { recursive: true });
writeFileSync(`results/${which}-rows.json`, JSON.stringify(rows, null, 1) + '\n');
writeFileSync(`results/${which}-summary.json`, JSON.stringify(summary, null, 1) + '\n');
for (const parser of PARSERS) {
  if (parser === 'duckling' && replayDuckling) continue; // replayed answers are already recorded
  writeFileSync(`results/raw/${which}-${parser}.json`, JSON.stringify(raw[parser]) + '\n');
}

const line = (name, t) => `| ${name} | ${t.wrongReadings} (${t['wrong-window']} + ${t['silent-default']}) | ${t.unnecessaryClarifications} | ${t.exact} | ${t['correct-ask']} | ${t['correct-none']} |`;
const md = [`### ${which === 'existing' ? 'Existing corpus' : 'Held-out set'} (n = ${rows.length}; expected ${expectedCounts.reads} reads, ${expectedCounts.ask} asks, ${expectedCounts.none} no-time; clock ${NOW.toISOString()})`, '',
  '| Reader · mode | Wrong readings (window or scope + silent default) | Unnecessary clarifications | Exact reads | Correct asks | Correct no-time |',
  '|---|---|---|---|---|---|'];
for (const parser of PARSERS) for (const mode of MODES) md.push(line(`${parser} · ${mode}`, summary.parsers[parser][mode]));
if (reference) md.push(line('host app rule (reference)', summary.reference.vsExpected));
md.push('', '| Reader | Coverage gaps (time words its spans miss, or no mention) |', '|---|---|');
for (const parser of PARSERS) md.push(`| ${parser} | ${summary.parsers[parser].coverageGaps} |`);
if (summary.reference?.vsAppLabels) md.push('', `Host app rule against the host app's own labels: ${summary.reference.vsAppLabels.wrongReadings} wrong readings, ${summary.reference.vsAppLabels.unnecessaryClarifications} unnecessary clarifications, of ${summary.reference.vsAppLabels.n}.`);
writeFileSync(`results/${which}-table.md`, md.join('\n') + '\n');
console.log(md.join('\n'));
