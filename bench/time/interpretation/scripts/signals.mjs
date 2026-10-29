// The library-side layers the design proposes, as a measurement prototype (not product code).
//
//   scan(text, spans)      — time-bearing words LEFT OUTSIDE the accepted reading(s), each with a
//                            class (TimeML-style: unit, amount, clock, calendar, relation, event,
//                            negation, approximation, recurrence, comparison, position, slot, scope,
//                            range). Empty = the reading covers every time-bearing word. Any leftover
//                            means: ask.
//   readLookbackQuote(q)   — the closed lookback grammar: re-reads a reader's quote on its own.
//                            undefined = not in the grammar. Used for quote AGREEMENT: a reading is
//                            accepted only when the grammar reads the same length from the same words.
//
// Generic English only, no product nouns. Written before the held-out run; developed on the
// existing corpus (so its numbers there are optimistic; the held-out numbers are the honest ones).

export const SCAN_VERSION = '1.1.0';

const FRACTION_CLASS = '¼½¾⅐-⅞↉';
const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const TOKEN = new RegExp([
  String.raw`\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?`,
  String.raw`\d{1,2}\.\d{1,2}\.\d{2,4}`,
  String.raw`\d{1,4}\/\d{1,2}(?:\/\d{2,4})?`,
  String.raw`\d{1,2}:\d{2}(?::\d{2})?`,
  String.raw`\d+(?:[.,]\d+)?[${FRACTION_CLASS}]?(?:[a-z]+\d*[a-z]*)?`,
  String.raw`[${FRACTION_CLASS}][a-z]*`,
  String.raw`[ap]\.m\.`,
  String.raw`q[1-4]\b`,
  String.raw`[a-z]+(?:['’][a-z]+)*`,
  String.raw`[-–—\/&#~]`,
  String.raw`[,;.!?:()\[\]{}"“”\n]`,
  String.raw`\S`, // every other symbol is kept as a token of its own: an operator such as ">" never vanishes
].join('|'), 'gi');

const set = (s) => new Set(s.trim().split(/\s+/));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const BREAK = /^[,;.!?:()\[\]{}"“”\n]$/;
const HARD_BREAK = /^[;.!?:\n]$/;

const UNITS = set('minute minutes hour hours day days week weeks fortnight fortnights month months year years decade decades seconds timeframe timeframes period periods');
const UNITS_AFTER_NUMBER = set('second sec secs s min mins m h hr hrs d w wk wks mo mos y yr yrs');
const COMPACT = new RegExp(String.raw`^(?:\d+(?:[.,]\d+)?[${FRACTION_CLASS}]?|[${FRACTION_CLASS}])(?:s|secs?|m|mins?|h|hrs?|d|w|wks?|mo|mos|y|yrs?)(?:\d+(?:s|secs?|m|mins?)?)?$`, 'i');
const CLOCK_OR_DATE = /^(?:\d{4}-\d|\d{1,2}\.\d{1,2}\.\d{2,4}$|\d{1,2}\/\d{1,2}|\d{1,2}:\d{2}|\d{1,2}(?:am|pm)$)/i;
const NUMBER = new RegExp(String.raw`^(?:\d+(?:[.,]\d+)?[${FRACTION_CLASS}]?|[${FRACTION_CLASS}])$`);
const NUMBER_WORDS = set(`one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen
  seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand dozen couple few several
  half halves quarter quarters third thirds`);
const CALENDAR = set(`today yesterday tonight tomorrow overnight morning mornings afternoon afternoons evening evenings night
  nights weekend weekends weekday weekdays weeknight weeknights daily hourly weekly monthly nightly yearly annually quarterly
  ytd mtd wtd q1 q2 q3 q4 monday tuesday wednesday thursday friday saturday sunday mondays tuesdays wednesdays thursdays
  fridays saturdays sundays tue tues thu thur thurs fri january february march april june july august september october
  november december noon midnight o'clock o’clock oclock`);
const CALENDAR_IF_NAMED = set('may mon wed sat sun jan feb mar apr jun jul aug sep sept oct nov dec');
const MONTH_AFTER = set('in during since until till before after last this next early mid late of from through by');
const YEAR_AFTER = set('in during since until till before after through throughout from by of');
const GREETED = set('morning afternoon evening night');
/** The present: a request for the current state ("right now", "currently"), shape 'current' — never "no time". */
const PRESENT = set('now currently current presently');
const RELATIONS = set('ago since until till til before after prior preceding previous earlier later next upcoming coming ending starting beginning recently lately past');
const POSITION = set('last first final early late mid middle beginning start end rest latest recent most');
const EVENTS = set('while whilst when whenever once unless provided upon');
const NEGATIONS = set(`not no never nor neither none without excluding exclude excludes excluded except excepting outside beyond
  besides minus barring ignore ignores ignoring skip skips skipping omit omits omitting disregard disregarding leaving leave`);
const NEGATION_PHRASES = { other: 'than', rather: 'than', instead: 'of', apart: 'from', aside: 'from' };
const ANYTHING_BUT = set('anything all everything nothing');
const APPROX = set('about approximately approx roughly around nearly almost circa perhaps maybe probably possibly ish');
const RECURRENCE = set('each every per');
const RECURRENCE_SKIP = set('- – a an other single');
const TWICE = set('twice thrice');
const COMPARISON = set('compared compare comparing versus vs');
const LEAD_INS = set('in over for during within across through throughout');
const SLOT_ADVERBS = set('just only even also merely simply solely exactly right');
const CLOCK_TRIGGERS = set('at from until till til since before after around by');
const QUESTION_AUX = set('did does do is was were are has have had will would can could should might');
const CLAUSE_OPENERS = set('and but so then also');
const RUNNING = set('running active ongoing happening enabled');
const PAST_BE = set('was were is are');
const HYPHENS = set('- –');
/** A number right after one of these is an amount or a time, never an identifier. */
const NOT_A_NAME = set(`the last past next first every each per about around approx approximately roughly over for of and or to a
  an than within in during across through throughout at from until till since before after by between under nearly almost
  some only just least most on with this that these those into onto upon as is was were are be been being it its any all no
  more less then final previous`);
const PLAIN_NUMBER = /^\d+(?:[.,]\d+)?$/;

function approxIdiom(w, before, after) {
  if (w === 'least' || w === 'most') return before === 'at';
  if (w === 'so' || w === 'take') return before === 'or';
  if (w === 'give') return after === 'or';
  if (['more', 'less', 'fewer', 'longer', 'shorter'].includes(w)) return before === 'or' || before === 'little' || after === 'than';
  if (w === 'bit') return before === 'a' || before === 'little';
  return ['minimum', 'maximum', 'max', 'upwards'].includes(w);
}

export function tokenize(text) {
  return [...text.matchAll(TOKEN)].map((m) => ({
    start: m.index, end: m.index + m[0].length, text: m[0],
    word: m[0].toLowerCase().replace(/['’]s$/, ''),
  }));
}

const isNum = (t) => t !== undefined && (NUMBER.test(t.word) || NUMBER_WORDS.has(t.word));
const isDigits = (t) => t !== undefined && /^\d/.test(t.word);

/** Every time-bearing word outside `spans` (accepted readings, char offsets, end exclusive), classed. */
export function scan(text, spans = []) {
  const tokens = tokenize(text);
  const n = tokens.length;
  const cls = new Array(n).fill(undefined);
  const covered = new Array(n).fill(false);
  const absorbed = new Array(n).fill(false); // the "the" and lead-in a reading takes in
  const w = (i) => tokens[i]?.word ?? '';
  const brk = (i) => i < 0 || i >= n || BREAK.test(tokens[i].text);

  // 1. Each accepted reading, with the "the" and ONE lead-in before it (the SIGNAL that places the question inside it).
  const slots = [];
  for (const span of spans) {
    const first = tokens.findIndex((t) => t.start >= span.start);
    let last = -1;
    tokens.forEach((t, i) => { if (t.start >= span.start && t.end <= span.end) { covered[i] = true; last = i; } });
    if (first < 0 || last < 0) continue;
    let i = first - 1;
    if (w(i) === 'the') { covered[i] = absorbed[i] = true; i--; }
    let leadIn = false;
    if (LEAD_INS.has(w(i))) { covered[i] = absorbed[i] = true; i--; leadIn = true; }
    slots.push({ before: i, leadIn, after: last + 1 });
  }
  const unitAt = (i) => {
    const t = tokens[i];
    if (t === undefined) return false;
    if (UNITS.has(t.word) || COMPACT.test(t.word)) return true;
    if (UNITS_AFTER_NUMBER.has(t.word)) { let j = i - 1; while (HYPHENS.has(w(j))) j--; return isNum(tokens[j]); }
    return false;
  };
  // A plain number right after a noun names a thing ("node 8", "version 9.7"); a date or clock token never does.
  const identifier = (i) => tokens[i] !== undefined && PLAIN_NUMBER.test(w(i)) && i > 0 && /^[a-z]/.test(w(i - 1))
    && !NOT_A_NAME.has(w(i - 1)) && !RELATIONS.has(w(i - 1)) && !CLOCK_TRIGGERS.has(w(i - 1));
  // Within k content tokens either side, in the same clause (commas and hyphens crossed, hard breaks not).
  const near = (i, k, test) => {
    for (const step of [-1, 1]) {
      for (let j = i + step, seen = 0; j >= 0 && j < n && seen < k; j += step) {
        if (HARD_BREAK.test(tokens[j].text)) break;
        if (BREAK.test(tokens[j].text) || HYPHENS.has(w(j))) continue;
        if (test(j)) return true;
        seen++;
      }
    }
    return false;
  };
  // Within k tokens after, before any break (hyphens crossed).
  const after = (i, k, test) => {
    for (let j = i + 1, seen = 0; j < n && seen < k; j++) {
      if (BREAK.test(tokens[j].text)) return false;
      if (HYPHENS.has(w(j))) continue;
      if (test(j)) return true;
      seen++;
    }
    return false;
  };

  // 2. Words that count on their own.
  for (let i = 0; i < n; i++) {
    const t = tokens[i];
    const word = t.word;
    const prev = w(i - 1);
    if (BREAK.test(t.text) || identifier(i)) continue;
    if (COMPACT.test(word) || CLOCK_OR_DATE.test(word)) { cls[i] = 'amount-or-clock'; continue; }
    if (/^(19|20)\d\d$/.test(word)) { if (YEAR_AFTER.has(prev)) cls[i] = 'calendar'; continue; }
    if (unitAt(i)) { cls[i] = 'unit'; continue; }
    if (['am', 'pm', 'a.m.', 'p.m.'].includes(word) && isDigits(tokens[i - 1])) { cls[i] = 'clock'; continue; }
    if (CALENDAR.has(word)) { if (!(GREETED.has(word) && prev === 'good')) cls[i] = 'calendar'; continue; }
    if (CALENDAR_IF_NAMED.has(word)) {
      const named = /^[A-Z]/.test(t.text) && i > 0 && !/^[.!?\n]$/.test(tokens[i - 1].text);
      if (named || isDigits(tokens[i - 1]) || isDigits(tokens[i + 1]) || (word === 'may' && MONTH_AFTER.has(prev))) cls[i] = 'calendar';
      continue;
    }
    if (PRESENT.has(word)) { cls[i] = 'present'; continue; }
    if (RELATIONS.has(word)) { cls[i] = 'relation'; continue; }
    if (EVENTS.has(word)) { cls[i] = 'event'; continue; }
    if (COMPARISON.has(word)) { cls[i] = 'comparison'; continue; }
  }
  // 3. Words that count by their phrase.
  for (let i = 0; i < n; i++) {
    if (cls[i] !== undefined || BREAK.test(tokens[i].text)) continue;
    const word = w(i);
    const prev = w(i - 1);
    const next = w(i + 1);
    // amounts beside a unit (in or out of the reading): "few days", "half an hour", "and a half"
    if (isNum(tokens[i]) && !identifier(i) && near(i, 3, unitAt)) cls[i] = 'amount';
    // bare clock numbers: "at 8", "from 2 to 4", "between 8 and 9"
    if (cls[i] === undefined && /^\d{1,2}$/.test(word) && Number(word) <= 24 && !unitAt(i + 1) && !identifier(i)) {
      const firstSide = CLOCK_TRIGGERS.has(prev) || (prev === 'between' && ['and', 'to', '-', '–'].includes(next));
      const secondSide = ['to', '-', '–', 'and', 'till', 'until'].includes(prev) && /^\d{1,2}$/.test(w(i - 2))
        && (CLOCK_TRIGGERS.has(w(i - 3)) || w(i - 3) === 'between');
      if (firstSide || secondSide) cls[i] = 'clock';
    }
    if (word === 'between' && /^\d/.test(next)) cls[i] = 'relation';
    if (word === 'from' && /^\d/.test(next) && !identifier(i + 1)) cls[i] = 'relation';
    if (word === 'last' && after(i, 2, (j) => unitAt(j) || isNum(tokens[j]) || cls[j] === 'calendar')) cls[i] = 'relation';
    if (POSITION.has(word) && word !== 'last' && after(i, 3, (j) => unitAt(j) || (isNum(tokens[j]) && !identifier(j)) || cls[j] === 'calendar')) cls[i] = 'position';
    // recurrence: "each hour", "every 5 minutes", "per day", "every other minute", "twice a day", "on the hour"
    if (RECURRENCE.has(word) || TWICE.has(word)) {
      let j = i + 1;
      while (j < n && (isNum(tokens[j]) || RECURRENCE_SKIP.has(w(j)))) j++;
      if (j < n && (unitAt(j) || ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'].includes(w(j)) || cls[j] === 'calendar')) cls[i] = 'recurrence';
    }
    if (word === 'on' && next === 'the' && w(i + 2) === 'hour') cls[i] = 'recurrence';
    // conditions and events by their phrase
    if (word === 'if' && (prev === 'only' || after(i, 4, (j) => PAST_BE.has(w(j))))) cls[i] = 'event';
    if (word === 'with' && after(i, 4, (j) => RUNNING.has(w(j)))) cls[i] = 'event';
    if (word === 'which' && ['in', 'during'].includes(prev)) cls[i] = 'event';
    if ((word === 'long' || word === 'soon') && prev === 'as' && next === 'as') cls[i] = 'event';
    if (word === 'time' && (next === 'of' || prev === 'what' || next === 'when')) cls[i] = 'event';
    if (word === 'leading' && next === 'up') cls[i] = 'event';
    if (word === 'moment' && prev === 'the' && ['at', 'for'].includes(w(i - 2))) cls[i] = 'present';
    if (word === 'present' && prev === 'at') cls[i] = 'present';
    if (word === 'latest' && cls[i] === undefined && !covered[i]) cls[i] = 'present';
    if (word === 'during' && !covered[i]) cls[i] = 'event';
    if (word === 'through' && !covered[i] && !(isDigits(tokens[i - 1]) && isDigits(tokens[i + 1]))) cls[i] = 'relation';
    // negation and complement count when they govern a time outside the reading (the slot check takes the adjacent case)
    const negation = NEGATIONS.has(word) || (own(NEGATION_PHRASES, word) && next === NEGATION_PHRASES[word]) || (word === 'but' && ANYTHING_BUT.has(prev));
    if (negation && after(i, 4, (j) => !covered[j] && (cls[j] !== undefined || unitAt(j) || POSITION.has(w(j)) || ['half', 'quarter', 'rest'].includes(w(j))))) cls[i] = 'negation';
    // approximations, in their idiom, right beside a time or the reading
    if (cls[i] === undefined && (APPROX.has(word) || approxIdiom(word, prev, next))) {
      if (near(i, 2, (j) => unitAt(j) || (cls[j] !== undefined && cls[j] !== 'approximation') || (covered[j] && !absorbed[j]))) cls[i] = 'approximation';
    }
  }

  // 4. The two slots around each reading are allow-lists.
  for (const { before, leadIn, after: a } of slots) {
    if (leadIn) {
      let j = before;
      while (SLOT_ADVERBS.has(w(j))) j--;
      const negated = NEGATIONS.has(w(j)) || own(NEGATION_PHRASES, w(j))
        || (['than', 'from', 'of', 'but'].includes(w(j)) && ['other', 'rather', 'apart', 'aside', 'instead', 'anything', 'all', 'everything', 'nothing'].includes(w(j - 1)));
      if (negated && cls[j] === undefined) cls[j] = 'negation';
    } else if (!brk(before) && cls[before] === undefined && !covered[before]) {
      cls[before] = 'slot';
    }
    if (w(a) === 'of' && !covered[a]) cls[a] = 'scope';
    if (['or', 'to', 'and', '-', '–'].includes(w(a)) && !covered[a] && (isNum(tokens[a + 1]) || w(a + 1) === 'a' || unitAt(a + 1))) cls[a] = 'range';
  }
  // 5. A question "when" / "what time" opening a clause, beside a reading, asks for a time INSIDE it.
  if (spans.length > 0) {
    const opens = (k) => k === 0 || brk(k - 1) || CLAUSE_OPENERS.has(w(k - 1));
    for (let i = 0; i < n; i++) {
      if (w(i) === 'when' && opens(i) && (QUESTION_AUX.has(w(i + 1)) || /['’]s$/i.test(tokens[i].text))) cls[i] = undefined;
      if (w(i) === 'time' && w(i - 1) === 'what' && QUESTION_AUX.has(w(i + 1)) && (opens(i - 1) || (w(i - 2) === 'at' && opens(i - 2)))) cls[i] = undefined;
    }
  }
  return tokens.map((t, i) => ({ start: t.start, end: t.end, text: t.text, cls: cls[i], covered: covered[i] }))
    .filter((t) => t.cls !== undefined && !t.covered)
    .map(({ start, end, text: tx, cls: c }) => ({ start, end, text: tx, cls: c }));
}

// ─── The closed lookback grammar (quote agreement) ─────────────────────────────

const UNIT_SECONDS = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
  d: 86400, day: 86400, days: 86400,
  w: 604800, wk: 604800, wks: 604800, week: 604800, weeks: 604800,
  fortnight: 1209600, fortnights: 1209600,
};
const ONES = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** An exact amount in digits or words ("2", "2.5", "1½", "twenty four", "a hundred"), or undefined. */
function amountOf(words) {
  const s = words.join(' ');
  const m = new RegExp(String.raw`^(\d+(?:\.\d+)?)([${FRACTION_CLASS}])?$`).exec(s);
  if (m) return m[2] === undefined ? Number(m[1]) : own(FRACTIONS, m[2]) ? Number(m[1]) + FRACTIONS[m[2]] : undefined;
  if (words.length === 1 && own(FRACTIONS, s)) return FRACTIONS[s];
  if (s === 'a' || s === 'an' || s === 'one') return 1;
  if (s === 'a hundred' || s === 'one hundred' || s === 'hundred') return 100;
  if (words.length === 1 && own(ONES, s)) return ONES[s];
  if (words.length === 1 && own(TENS, s)) return TENS[s];
  if (words.length === 2 && own(TENS, words[0]) && own(ONES, words[1]) && ONES[words[1]] < 10) return TENS[words[0]] + ONES[words[1]];
  return undefined;
}
const unitSeconds = (u) => (own(UNIT_SECONDS, u) ? UNIT_SECONDS[u] : undefined);

/** Seconds of "[the] last|past|trailing|latest|most recent <exact amount> <unit> …", or undefined (not in the grammar). */
export function readLookbackQuote(quote) {
  let s = quote.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^the /, '');
  const head = /^(last|past|trailing|latest|most recent) /.exec(s);
  if (!head) return undefined;
  s = s.slice(head[0].length);
  // compact: 2h, 45m, 3d, 1h30, 1.5h, 1½h
  let m = new RegExp(String.raw`^(\d+(?:\.\d+)?[${FRACTION_CLASS}]?)\s?(s|secs?|m|mins?|h|hrs?|d|w|wks?)(?:\s?(\d+)\s?(m|mins?|minutes?)?)?$`).exec(s);
  if (m) {
    const a = amountOf([m[1]]);
    if (a === undefined) return undefined;
    if (m[3] !== undefined && !m[2].startsWith('h')) return undefined;
    return a * UNIT_SECONDS[m[2]] + (m[3] !== undefined ? Number(m[3]) * 60 : 0);
  }
  m = /^(\d+):(\d{2}) (hours?|hrs?)$/.exec(s); // "1:30 hours"
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  const words = s.split(' ');
  if (words.length === 1 && words[0].length > 2 && unitSeconds(words[0]) !== undefined) return unitSeconds(words[0]); // "last hour"
  m = /^([a-z]+) and a (half|quarter)$/.exec(s); // "last hour and a half"
  if (m && unitSeconds(m[1]) !== undefined) return unitSeconds(m[1]) * (m[2] === 'half' ? 1.5 : 1.25);
  m = /^half (?:a |an )?([a-z]+)$/.exec(s); // "last half an hour", "last half hour"
  if (m && unitSeconds(m[1]) !== undefined) return unitSeconds(m[1]) / 2;
  m = /^(?:a |one )?quarter (?:of an? )?([a-z]+)$/.exec(s);
  if (m && unitSeconds(m[1]) !== undefined) return unitSeconds(m[1]) / 4;
  m = /^three quarters (?:of an? )?([a-z]+)$/.exec(s);
  if (m && unitSeconds(m[1]) !== undefined) return (unitSeconds(m[1]) * 3) / 4;
  m = /^(.+) and a (half|quarter) ([a-z]+)$/.exec(s); // "one and a half hours"
  if (m && unitSeconds(m[3]) !== undefined) {
    const a = amountOf(m[1].split(' '));
    return a === undefined ? undefined : (a + (m[2] === 'half' ? 0.5 : 0.25)) * unitSeconds(m[3]);
  }
  m = /^(.+?) ([a-z]+)(?: and)? (\d+) ([a-z]+)$/.exec(s); // "1 hour 30 minutes", "2 hours and 30 minutes"
  if (m && unitSeconds(m[2]) !== undefined && unitSeconds(m[4]) !== undefined && unitSeconds(m[4]) < unitSeconds(m[2])) {
    const a = amountOf(m[1].split(' '));
    return a === undefined ? undefined : a * unitSeconds(m[2]) + Number(m[3]) * unitSeconds(m[4]);
  }
  const unit = unitSeconds(words[words.length - 1]); // "2 hours", "two hours", "twenty four hours", "2.5 hours"
  if (unit !== undefined && words.length >= 2) {
    const a = amountOf(words.slice(0, -1));
    if (a !== undefined && a > 0) return a * unit;
  }
  return undefined;
}
