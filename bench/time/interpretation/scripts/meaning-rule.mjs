// The complete-meaning rule (a measurement prototype, not product code).
//
// When one lookback is accepted, EVERY word of the person's message must be accounted for by:
//   1. the accepted lookback (with the "the" and the one lead-in preposition it takes in);
//   2. a term the TOOL declares (its subjects, metrics and targets: profile.terms, longest match first);
//   3. a number bound to a declared target — an identifier after it ("node 40", "nodes 1-4",
//      "drives 3 through 5") or a count before it ("two nodes", "a couple of nodes", "half the nodes");
//   4. a preposition whose object is accounted for ("per node", "on node 40", "of memory", "from the last 2 hours");
//   5. a closed, versioned word class: FUNCTION words that cannot restrict a read, the REQUEST FRAME
//      ("show", "please"), OPERATIONS ON THE RESULT ("peak", "average"), a greeting, and a question
//      "when" / "what time" that opens a clause beside the lookback.
// A sampling instruction is accounted only when the tool declares that it executes sampling
// (profile.sampling); the measured profiles declare none. Any word left over is an unresolved
// restriction: the request asks. The rule only adds asks; it never makes a read.
//
// The clause is the WHOLE message. Sentence punctuation does not end it: a restriction can follow
// in the next sentence ("… over the last 2 hours. Only while backups ran.").
import { tokenize } from './signals.mjs';

export const MEANING_RULE_VERSION = '1.0.0';

const set = (s) => new Set(s.trim().split(/\s+/));
/** Grammatical words that cannot narrow what is read. Negations, quantifiers ("each", "every"),
 *  "or", "but", "if", "when", "while", "than" and every temporal preposition are NOT here. */
const FUNCTION = set(`the a an this that these those my our your their its it me i we us you they them
  is are was were be been being am do does did has have had can could will would shall should may might must
  what which who whose how and one ones`);
/** Prepositions: accounted only when their object is accounted for. */
const PREPOSITIONS = set('of on in for at per by from to with across over within during through throughout into between');
const LEAD_INS = set('in over for during within across through throughout');
/** The request frame: words that only ask for the result to be shown. Closed and versioned. */
const REQUEST_FRAME = set('show give get list display tell see check look plot chart graph report pull fetch please thanks thank like hi hello hey');
/** Operations on the rows read, not on what is read. Closed and versioned. */
const RESULT_OPS = set(`peak peaks peaked spike spikes spiked spiking highest lowest busiest quietest average averages avg
  mean median total totals sum trend trends top bottom value values reading readings level levels`);
const GREETINGS = set('morning afternoon evening');
const QUESTION_AUX = set('did does do is was were are has have had will would can could should might');
const CLAUSE_OPENERS = set('and but so then also');
const NUMBER_WORDS = set('one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred dozen couple few several half');
const RANGE_LINKS = set('- – — to through thru and ,');
const BREAK = /^[,;.!?:()\[\]{}"“”\n]$/;
const isNumberToken = (w) => /^\d+(?:[.,]\d+)?$/.test(w) || NUMBER_WORDS.has(w);

/** The words of `text` the rule cannot account for. `span`: the accepted lookback (char offsets). */
export function unaccounted(text, span, profile) {
  const tokens = tokenize(text);
  const n = tokens.length;
  const w = (i) => tokens[i]?.word ?? '';
  const acc = new Array(n).fill(false);
  const target = new Array(n).fill(false);
  const brk = (i) => i < 0 || i >= n || BREAK.test(tokens[i].text);

  // 0. punctuation and hyphens
  tokens.forEach((t, i) => { if (BREAK.test(t.text) || ['-', '–', '—', '/'].includes(t.word)) acc[i] = true; });
  // 1. the lookback, its "the" and one lead-in
  let first = -1;
  tokens.forEach((t, i) => { if (t.start >= span.start && t.end <= span.end) { acc[i] = true; if (first < 0) first = i; } });
  if (first >= 0) {
    let i = first - 1;
    if (w(i) === 'the') acc[i--] = true;
    if (LEAD_INS.has(w(i))) acc[i] = true;
  }
  // 2. declared terms, longest first (multi-word terms like "write ops")
  const terms = [...(profile.terms.metrics ?? []), ...(profile.terms.subjects ?? []), ...(profile.terms.targets ?? [])]
    .map((term) => ({ words: term.toLowerCase().split(/\s+/), isTarget: (profile.terms.targets ?? []).includes(term) }))
    .sort((a, b) => b.words.length - a.words.length);
  for (let i = 0; i < n; i++) {
    if (acc[i]) continue;
    for (const term of terms) {
      if (term.words.every((tw, k) => w(i + k) === tw && !acc[i + k])) {
        for (let k = 0; k < term.words.length; k++) { acc[i + k] = true; if (term.isTarget) target[i + k] = true; }
        break;
      }
    }
  }
  // 3. numbers bound to a declared target: identifiers after it, counts before it
  for (let i = 0; i < n; i++) {
    if (!target[i]) continue;
    let j = i + 1;
    while (['#', 'number', 'no', 'id'].includes(w(j))) acc[j++] = true;
    while (j < n && /^\d/.test(w(j))) {
      acc[j] = true;
      if (RANGE_LINKS.has(w(j + 1)) && /^\d/.test(w(j + 2))) { acc[j + 1] = true; j += 2; } else break;
    }
    // counts before: "two nodes", "a couple of nodes", "half the nodes", "5 nodes"
    let k = i - 1;
    if (w(k) === 'the') k--;
    if (w(k) === 'of') k--;
    if (isNumberToken(w(k))) {
      acc[k] = true;
      for (let m = k + 1; m < i; m++) acc[m] = acc[m] || ['the', 'of'].includes(w(m));
      if (w(k - 1) === 'a') acc[k - 1] = true;
    }
  }
  // 4. prepositions whose object is accounted for (to a fixed point)
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (acc[i] || !PREPOSITIONS.has(w(i))) continue;
      let j = i + 1;
      while (['the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'our', 'your', 'their', 'its', 'which', 'what'].includes(w(j))) j++;
      if (j < n && acc[j] && !BREAK.test(tokens[j].text)) {
        acc[i] = true;
        for (let m = i + 1; m < j; m++) acc[m] = true;
        changed = true;
      }
    }
  }
  // 4b. a focus particle right before an accounted declared term ("only node 8", "just CPU")
  for (let i = 0; i < n; i++) if (!acc[i] && ['only', 'just'].includes(w(i)) && acc[i + 1] && !BREAK.test(tokens[i + 1]?.text ?? '') && !FUNCTION.has(w(i + 1))) acc[i] = true;
  // 5. closed classes
  const opens = (k) => k === 0 || brk(k - 1) || CLAUSE_OPENERS.has(w(k - 1));
  for (let i = 0; i < n; i++) {
    if (acc[i]) continue;
    const word = w(i);
    if (FUNCTION.has(word) || REQUEST_FRAME.has(word) || RESULT_OPS.has(word)) acc[i] = true;
    else if (word === 'good' && GREETINGS.has(w(i + 1)) && (i === 0 || brk(i - 1)) && brk(i + 2)) acc[i] = acc[i + 1] = true;
    else if (word === 'when' && opens(i) && (QUESTION_AUX.has(w(i + 1)) || /['’]s$/i.test(tokens[i].text))) acc[i] = true;
    else if (word === 'time' && w(i - 1) === 'what' && QUESTION_AUX.has(w(i + 1))) acc[i] = true;
  }
  // a sampling instruction would be accounted here, only for a tool that declares it executes sampling
  if (profile.sampling !== 'none' && profile.sampling !== undefined) throw new Error('no measured profile declares sampling');
  return tokens.filter((_, i) => !acc[i]).map((t) => t.text);
}
