// The complete-meaning rule (a measurement prototype, not product code): BOUNDED interpretation.
//
// It does not prove that a request's meaning is complete. It accepts only a closed set of
// RELATIONS between the words it knows, and asks about everything else. When one lookback is
// accepted, every token of the person's message must be accounted for by:
//   1. the accepted lookback (with the "the" and the one lead-in preposition it takes in);
//   2. a term the TOOL declares (profile.terms): a metric, a target or a subject, longest match first;
//   3. a number bound to a declared target — an identifier after it ("node 40", "nodes 1-4") or a
//      count before it ("two nodes", "a couple of nodes", "half the nodes");
//   4. a preposition in a SUPPORTED RELATION with an accounted object:
//        per / on / for / in / across / between + target      ("per node", "on node 40", "in which cluster")
//        from + target or the lookback                        ("from the last 2 hours")
//        of + metric, the lookback, or a target               ("peak of memory", "average of the last 2 hours")
//        by + metric                                          ("top two nodes by memory")
//      Any other pairing — "at CPU peaks", "with CPU spikes", "on CPU spikes" — is not a supported
//      relation, so the preposition is not accounted for, and the request asks;
//   5. a focus particle ("only", "just") directly before a declared term;
//   6. a closed, versioned word class: FUNCTION words that cannot narrow a read, the REQUEST FRAME,
//      a greeting, a question "when" / "what time" opening a clause;
//   7. an OPERATION ON THE RESULT ("peak", "average", "busiest", "top") only where it binds to what is
//      read: followed by "of" + an accounted object, followed by a target ("busiest node", "top two
//      nodes"), or inside a question clause ("when did memory spike", "which one is busiest").
//      "CPU spikes" standing alone, or "at CPU peaks", binds to nothing it can execute, so it asks.
// Every other token asks: a word, an operator (">", "<", "=", "%"), any symbol. A sampling instruction
// would be accounted only for a tool that declares that it executes sampling; no measured profile does.
// The clause is the WHOLE message: sentence punctuation does not end it.
import { tokenize } from './signals.mjs';

export const MEANING_RULE_VERSION = '2.0.0';

const set = (s) => new Set(s.trim().split(/\s+/));
/** Grammatical words that cannot narrow a read. Negations, quantifiers ("each", "every"), "or", "but",
 *  "if", "when", "while", "than" and every preposition are NOT here. */
const FUNCTION = set(`the a an this that these those my our your their its it me i we us you they them
  is are was were be been being am do does did has have had can could will would shall should may might must
  what which who whose how and one ones`);
const DETERMINERS = set('the a an this that these those my our your their its which what');
/** Preposition → the object kinds it may relate in a request this rule can execute. */
const SUPPORTED = {
  per: ['target'], on: ['target'], for: ['target'], in: ['target'], across: ['target'], between: ['target'],
  from: ['target', 'lookback'], of: ['metric', 'lookback', 'target'], by: ['metric'],
};
const LEAD_INS = set('in over for during within across through throughout');
/** The request frame: words that only ask for the result to be shown. Closed and versioned. */
const REQUEST_FRAME = set('show give get list display tell see check look plot chart graph report pull fetch please thanks thank like hi hello hey');
/** Operations on the rows read, accounted only where they bind (step 7). Closed and versioned. */
const RESULT_OPS = set(`peak peaks peaked spike spikes spiked spiking highest lowest busiest quietest average averages avg
  mean median total totals sum trend trends top bottom`);
const QUESTION_OPENERS = set('when what which how who');
const GREETINGS = set('morning afternoon evening');
const QUESTION_AUX = set('did does do is was were are has have had will would can could should might');
const CLAUSE_OPENERS = set('and but so then also');
const NUMBER_WORDS = set('one two three four five six seven eight nine ten eleven twelve twenty thirty forty fifty hundred dozen couple few several half');
const RANGE_LINKS = set('- – — to through thru and ,');
const BREAK = /^[,;.!?:()\[\]{}"“”\n]$/;
const isNumberToken = (w) => /^\d+(?:[.,]\d+)?$/.test(w) || NUMBER_WORDS.has(w);

/** The tokens of `text` the rule cannot account for. `span`: the accepted lookback (char offsets). */
export function unaccounted(text, span, profile) {
  const tokens = tokenize(text);
  const n = tokens.length;
  const w = (i) => tokens[i]?.word ?? '';
  const acc = new Array(n).fill(false);
  const kind = new Array(n).fill(undefined); // 'lookback' | 'metric' | 'target' | 'subject'
  const brk = (i) => i < 0 || i >= n || BREAK.test(tokens[i].text);

  // 0. punctuation and hyphens (an operator or any other symbol is NOT accounted)
  tokens.forEach((t, i) => { if (BREAK.test(t.text) || ['-', '–', '—'].includes(t.word)) acc[i] = true; });
  // 1. the lookback, its "the" and one lead-in
  let first = -1;
  tokens.forEach((t, i) => { if (t.start >= span.start && t.end <= span.end) { acc[i] = true; kind[i] = 'lookback'; if (first < 0) first = i; } });
  if (first >= 0) {
    let i = first - 1;
    if (w(i) === 'the') { acc[i] = true; kind[i] = 'lookback'; i--; }
    if (LEAD_INS.has(w(i))) acc[i] = true;
  }
  // 2. declared terms, longest first, each with its kind
  const declared = [];
  for (const k of ['metrics', 'targets', 'subjects']) for (const term of profile.terms[k] ?? []) declared.push({ words: term.toLowerCase().split(/\s+/), kind: k.slice(0, -1) });
  declared.sort((a, b) => b.words.length - a.words.length);
  for (let i = 0; i < n; i++) {
    if (acc[i]) continue;
    for (const term of declared) {
      if (term.words.every((tw, k) => w(i + k) === tw && !acc[i + k])) {
        for (let k = 0; k < term.words.length; k++) { acc[i + k] = true; kind[i + k] = term.kind; }
        break;
      }
    }
  }
  // 3. numbers bound to a declared target: identifiers after it, counts before it
  for (let i = 0; i < n; i++) {
    if (kind[i] !== 'target') continue;
    let j = i + 1;
    while (['#', 'number', 'no', 'id'].includes(w(j))) { acc[j] = true; kind[j] = 'target'; j++; }
    while (j < n && /^\d/.test(w(j))) {
      acc[j] = true; kind[j] = 'target';
      if (RANGE_LINKS.has(w(j + 1)) && /^\d/.test(w(j + 2))) { acc[j + 1] = true; j += 2; } else break;
    }
    let k = i - 1;
    if (w(k) === 'the') k--;
    if (w(k) === 'of') k--;
    if (isNumberToken(w(k))) {
      acc[k] = true; kind[k] = 'target';
      for (let m = k + 1; m < i; m++) if (['the', 'of'].includes(w(m))) { acc[m] = true; kind[m] = 'target'; }
      if (w(k - 1) === 'a') { acc[k - 1] = true; kind[k - 1] = 'target'; }
    }
  }
  // 4. a preposition in a supported relation with an accounted object
  for (let i = 0; i < n; i++) {
    if (acc[i] || !Object.prototype.hasOwnProperty.call(SUPPORTED, w(i))) continue;
    let j = i + 1;
    const focus = (k) => ['only', 'just'].includes(w(k)) && ['metric', 'target', 'subject'].includes(kind[k + 1]);
    while (DETERMINERS.has(w(j)) || focus(j)) j++;
    if (j < n && acc[j] && kind[j] !== undefined && SUPPORTED[w(i)].includes(kind[j])) {
      acc[i] = true;
      for (let m = i + 1; m < j; m++) acc[m] = true;
    }
  }
  // 5. a focus particle directly before a declared term ("only node 8", "just CPU")
  for (let i = 0; i < n; i++) if (!acc[i] && ['only', 'just'].includes(w(i)) && ['metric', 'target', 'subject'].includes(kind[i + 1])) acc[i] = true;
  // 6. closed classes
  const opens = (k) => k === 0 || brk(k - 1) || CLAUSE_OPENERS.has(w(k - 1));
  for (let i = 0; i < n; i++) {
    if (acc[i]) continue;
    const word = w(i);
    if (FUNCTION.has(word) || REQUEST_FRAME.has(word)) acc[i] = true;
    else if (word === 'good' && GREETINGS.has(w(i + 1)) && (i === 0 || brk(i - 1)) && brk(i + 2)) acc[i] = acc[i + 1] = true;
    else if (word === 'when' && opens(i) && (QUESTION_AUX.has(w(i + 1)) || /['’]s$/i.test(tokens[i].text))) acc[i] = true;
    else if (word === 'time' && w(i - 1) === 'what' && QUESTION_AUX.has(w(i + 1))) acc[i] = true;
  }
  // 7. an operation on the result, only where it binds to what is read
  const inQuestionClause = (i) => {
    let k = i - 1;
    while (k >= 0 && !BREAK.test(tokens[k].text)) k--;
    let s = k + 1; // the clause's first token
    if (CLAUSE_OPENERS.has(w(s))) s++;
    if (['in', 'at', 'for', 'on'].includes(w(s)) && QUESTION_OPENERS.has(w(s + 1))) s++;
    return QUESTION_OPENERS.has(w(s)) && acc[s];
  };
  for (let i = 0; i < n; i++) {
    if (acc[i] || !RESULT_OPS.has(w(i))) continue;
    let j = i + 1;
    while (DETERMINERS.has(w(j)) || isNumberToken(w(j))) j++;
    const ofObject = w(i + 1) === 'of' && acc[i + 1];
    const onTarget = kind[j] === 'target';
    if (ofObject || onTarget || inQuestionClause(i)) acc[i] = true;
  }
  if (profile.sampling !== 'none' && profile.sampling !== undefined) throw new Error('no measured profile declares sampling');
  return tokens.filter((_, i) => !acc[i]).map((t) => t.text);
}
