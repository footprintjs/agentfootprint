/**
 * The words on the How it stands page. Every row comes from the tested inventory of the
 * library's checks; a run of the worked example pins the lines the page quotes from the
 * library, in `docs-next/scripts/test/stand-film.test.mts`.
 */
/* ── the section below the film: STAND, letter by letter ───────────────────── */

export type TileEffect = 'standing' | 'word' | 'act';

export interface Tile {
  readonly name: string;
  readonly api?: string;
  readonly effect?: TileEffect;
  readonly product: string;
  readonly technical: string;
  readonly href?: string;
}

export interface Letter {
  readonly letter: 'S' | 'T' | 'A' | 'N' | 'D';
  readonly verb: string;
  /** What the honesty design notes and the Map, Walker, Trace, Fold, Lens canon call this step. */
  readonly design: string;
  readonly line: string;
  readonly tiles: readonly Tile[];
}

const SEMANTIC = '/docs/build/semantic-results';
const SCHEMA = '/docs/build/output-schema';
const GATE = '/docs/build/evidence-gate';
const INTEGRITY = '/docs/monitor/context-integrity';

export const LETTERS: readonly Letter[] = [
  {
    letter: 'S',
    verb: 'State the rules',
    design: 'Declare · Map',
    line: 'Fixed before the run, so they cannot be fitted to the answer.',
    tiles: [
      {
        name: 'Marked facts',
        api: 'describedResult({ facts })',
        product: 'A tool marks the values that matter.',
        technical: 'Typed facts per entity, with provenance, make a contradiction representable.',
        href: SEMANTIC,
      },
      {
        name: 'Declared limits',
        api: 'absent(), coverage()',
        product: 'A tool says what it checked, skipped or did not find.',
        technical: 'Limits are trusted declarations that become reasons on the standing.',
        href: SEMANTIC,
      },
      {
        name: 'What a search covered',
        api: 'Tool.search',
        product: 'One call’s “nothing found” states exactly what it searched.',
        technical: 'Arguments are classified by role, and coverage is composed per call.',
      },
      {
        name: 'Structured answer',
        api: '.outputSchema()',
        product: 'The answer must fit your schema. Retries are your choice.',
        technical: 'No retry by default. { retries: N } adds N teaching turns.',
        href: SCHEMA,
      },
      {
        name: 'Field to fact',
        api: '.claims()',
        product: 'You say which answer field reports which fact.',
        technical: 'Declared, never inferred. It makes the contradiction decidable.',
        href: SCHEMA,
      },
      {
        name: 'Caveat gate in CI',
        api: 'checkSemantics',
        product: 'A check you run in CI fails tools that forgot their caveats.',
        technical: 'Class rules are errors. Overclaim rules warn unless strict or selected.',
        href: SEMANTIC,
      },
    ],
  },
  {
    letter: 'T',
    verb: 'Trace the run',
    design: 'Record · Trace',
    line: 'A record the model did not write, kept by the flowchart as it runs.',
    tiles: [
      {
        name: 'Every step writes a note',
        api: 'FootprintJS stages',
        product: 'Each step’s reads and writes are captured with no annotations.',
        technical: 'TypedScope tracks reads and writes through a Proxy and commits per stage.',
      },
      {
        name: 'The model’s words as claims',
        api: '_findings',
        product: 'Why it called a tool and what it made of the result, filed as claims.',
        technical: 'A model declaration is never support. Silence means those checks do not run.',
      },
      {
        name: '“No check ran” is a state',
        api: 'disposition ledger',
        product: 'Each integrity check says whether it passed, failed or could not run.',
        technical: 'checked-pass, checked-fail, not-applicable and unreachable, per check.',
        href: INTEGRITY,
      },
      {
        name: 'The same verdict later',
        api: 'assessAnswer(recording)',
        product: 'The saved record gives the same standing as the live run.',
        technical: 'One pure fold over committed rows, with no clock, network or model.',
      },
    ],
  },
  {
    letter: 'A',
    verb: 'Assess the claims',
    design: 'Compare · Walker',
    line: 'Code compares. No model judges. It catches what the record can contradict.',
    tiles: [],
  },
  {
    letter: 'N',
    verb: 'Name the standing',
    design: 'Conclude · Fold',
    line: 'One of five words, with its reason. Not a percentage.',
    tiles: [
      {
        name: 'Known',
        effect: 'word',
        product: 'A check you wrote passed for this answer. The library cannot see how your check decided.',
        technical: 'Needs a passed enforcing answerValidation report. Never known from silence.',
      },
      {
        name: 'Consistent',
        effect: 'word',
        product: 'Checks ran and found nothing wrong. The library says this is not a verification.',
        technical: 'unrefuted. A membership pass keeps a reason from firing and supports nothing.',
      },
      {
        name: 'Not sure',
        effect: 'word',
        product: 'A check found a problem, and the reason is shown.',
        technical: 'Each reason names its source: specific calls, the answer or the run.',
      },
      {
        name: 'Ask',
        effect: 'word',
        product: 'The run is waiting on a person.',
        technical: 'Any pause reads ask, from the recording alone.',
      },
      {
        name: 'Not assessed',
        effect: 'word',
        product: 'Nothing could be checked.',
        technical: 'not-applicable. A different state from a clean result.',
      },
    ],
  },
  {
    letter: 'D',
    verb: 'Decide what happens',
    design: 'Act · Lens and your app',
    line: 'Your policy, in your code. Withholding does not undo a tool action already taken.',
    tiles: [
      {
        name: 'Flag',
        api: "posture: 'assist'",
        effect: 'act',
        product: 'The answer goes out, and the problem is recorded.',
        technical: 'The default posture. You learn the rate before you act on it.',
        href: GATE,
      },
      {
        name: 'One more turn',
        api: "posture: 'guard'",
        effect: 'act',
        product: 'Invented values are named back, and the model gets one revision.',
        technical: 'Latched at one per turn. The rewrite is the model’s, and the re-check is code.',
        href: GATE,
      },
      {
        name: 'Refuse',
        api: "posture: 'rails'",
        effect: 'act',
        product: 'After one revision, the run raises an error instead of returning.',
        technical: 'UnsupportedValuesError. It does not suppress streamed draft tokens.',
        href: GATE,
      },
      {
        name: 'Withhold',
        api: "mode: 'enforce'",
        effect: 'act',
        product: 'A structured answer that fails is withheld. Nothing streams.',
        technical: 'AnswerValidationError, or HTTP 422 through a hosting door.',
        href: SCHEMA,
      },
      {
        name: 'Observe first',
        api: "mode: 'observe'",
        effect: 'act',
        product: 'The same checks run and the answer is delivered with its standing.',
        technical: 'A failed report reads not sure with answer-check-failed.',
        href: SCHEMA,
      },
      {
        name: 'Show the person',
        api: 'standingLine',
        effect: 'act',
        product: 'One plain line after the answer, written by the library.',
        technical: 'Prose answers only. On typed answers the standing arrives as data.',
      },
      {
        name: 'Explain this answer',
        api: 'accountForAnswer',
        effect: 'act',
        product: 'What was checked, what was not, and who vouches for each line.',
        technical: 'Fixed versioned templates over the record, never a model.',
      },
    ],
  },
];

/* ── where the model is involved, and what holds each place to the record ─── */

export interface PlaceRow {
  readonly check: string;
  readonly api: string;
  readonly compares: string;
  readonly decides: string;
  readonly then: string;
}

export interface Place {
  readonly id: string;
  readonly step: string;
  readonly name: string;
  readonly what: string;
  readonly intro: string;
  readonly rows: readonly PlaceRow[];
  readonly note?: string;
}

export const PLACES: readonly Place[] = [
  {
    id: 'place-call',
    step: '1',
    name: 'Calling a tool',
    what: 'What the model sends.',
    intro: 'The model picks a tool and fills in its inputs.',
    rows: [
      { check: 'Argument schema', api: 'inputSchema', compares: 'The arguments against the tool’s schema', decides: 'Code', then: 'Rejected, with the reason.' },
      { check: 'Permission policy', api: 'PermissionPolicy', compares: 'The call against your policy', decides: 'Code', then: 'Denied or halted.' },
      { check: 'Check in', api: 'checkIn', compares: 'The call against your rule, then a person', decides: 'Code, then a person', then: 'Pauses for approval.' },
      { check: 'Ask or assume', api: 'askOrAssume', compares: 'A missing value against the tool’s rule', decides: 'Code', then: 'Asks once before anything runs, or fills it in and says so.' },
      { check: 'Where a value came from', api: 'argumentSources', compares: 'The source the model cites against the person’s words or a result', decides: 'Code, when the model declares', then: 'Runs, asks or flags.' },
      { check: 'Made-up tool inputs', api: 'argumentsFrom', compares: 'An ID the model passes against what it was shown', decides: 'Code', then: 'The tool still runs. With the answer layer, the standing reads not sure.' },
    ],
    note: 'Which tool to call stays the model’s choice, and this is the thinnest part. An unknown tool is refused. The rest is recorded.',
  },
  {
    id: 'place-read',
    step: '2',
    name: 'Reading a result',
    what: 'What comes back.',
    intro: 'A tool returns something, and the model decides what it means.',
    rows: [
      { check: 'Declared limits', api: 'absent(), coverage()', compares: 'What the tool says it checked and skipped', decides: 'The tool declares, and code reads it', then: 'A reason on the standing.' },
      { check: 'Empty result', api: '', compares: 'An empty result with nothing declared', decides: 'Code', then: 'A reason on the standing.' },
      { check: 'Time window', api: 'period', compares: 'The period asked against the period held', decides: 'Code', then: 'A reason on the standing.' },
      { check: 'Column types', api: 'resultColumns', compares: 'Rows against the declared columns', decides: 'Code', then: 'Off by default. Warns, or refuses the rows. With the answer layer, the standing reads not sure.' },
      { check: 'Conflicting readings', api: '.findings()', compares: 'Two readings the model stood on for one fact', decides: 'Code, when the model declares', then: 'A reason on the standing.' },
      { check: 'A judge on tool results', api: '.findings({ judge })', compares: 'The result against the model’s proposition', decides: 'A classifier', then: 'Filed apart. It never sets the standing.' },
    ],
  },
  {
    id: 'place-answer',
    step: '3',
    name: 'Giving the answer',
    what: 'What the model claims.',
    intro: 'The model says what it found.',
    rows: [
      { check: 'Answer shape', api: '.outputSchema()', compares: 'The answer against your parser', decides: 'Code', then: 'No retry by default. { retries: N } gives N corrective turns.' },
      { check: 'Invented values', api: '.namesAndNumbersFromEvidence()', compares: 'Long numbers and IDs against tool results. Small numbers are skipped', decides: 'Code', then: 'Flags it, gives one more turn, or refuses, by posture.' },
      { check: 'Contradiction', api: '.claims()', compares: 'A structured field against a fact the tool marked', decides: 'Code', then: 'Delivered, and with the answer layer the standing reads not sure. Withheld when an enforcing check lists it.' },
      { check: 'Did it run at all', api: 'context.toolCalls', compares: 'The answer against the tools that ran', decides: 'Your code', then: 'Through your check.' },
      { check: 'Code shown', api: 'Tool.script', compares: 'Code in the answer against the program submitted', decides: 'Code', then: 'Marked unmatched.' },
      { check: 'Steps left undone', api: 'skill steps', compares: 'The answer against a skill’s declared steps', decides: 'Code', then: 'A reason on the standing.' },
      { check: '“Not found” stretched too far', api: '.negativeClaims()', compares: '“None” against what the search covered', decides: 'Code', then: 'Opt-in and unmeasured. Not recommended yet.' },
      { check: 'Your own rule', api: '.answerValidation()', compares: 'Anything you write', decides: 'Your code', then: 'Enforce withholds. Observe records. The only path to known.' },
    ],
  },
];

/* ── what the model is sent ───────────────────────────────────────────────── */

export const TOLD: readonly { readonly setting: string; readonly adds: string; readonly back: string }[] = [
  { setting: '`.answerLayer()`', adds: 'Nothing', back: 'No. The line is added to the delivered answer.' },
  { setting: '`.namesAndNumbersFromEvidence()`', adds: 'Nothing, until guard or rails fires', back: 'Under guard and rails, one repair turn with a recovery instruction.' },
  { setting: '`.outputSchema()`', adds: 'One fixed JSON-format sentence', back: 'Only with `{ retries: N }`.' },
  { setting: '`.claims()`, `.answerValidation()`', adds: 'Nothing beyond that sentence', back: 'Never. Re-asking would invite the model to change the claim, not the facts.' },
  { setting: '`.findings()`', adds: 'A fixed instruction on how to declare, and `_findings` on every tool', back: 'No.' },
];

/* ── when the answer leaves ───────────────────────────────────────────────── */

export const LEAVES: readonly { readonly path: string; readonly when: string; readonly fails: string }[] = [
  { path: 'Structured answer, enforcing check', when: 'After the checks', fails: 'Withheld. Nothing streamed.' },
  { path: 'Structured answer, observing check', when: 'After the checks and the standing', fails: 'Delivered, with its standing.' },
  { path: 'Prose with the answer layer', when: 'Before the standing is worked out', fails: 'Delivered, and the standing arrives right after.' },
  { path: 'Prose with `rails`', when: 'Before the checks finish', fails: 'Both drafts streamed, then `run()` throws.' },
];

/* ── where it stops, and what nobody has measured ─────────────────────────── */

export const STOPS: readonly { readonly name: string; readonly text: string }[] = [
  { name: 'A silent model', text: 'Checks on what the model declares run only when it declares. A model that says nothing reads consistent.' },
  { name: 'Trusted tools', text: 'A tool’s declarations are trusted. A tool that misstates what it searched gets an honest-looking standing.' },
  { name: 'Your own check', text: 'It can call a model, and the library cannot see how it decided. A stub that always passes still reads known.' },
  { name: 'Rewrites', text: 'Under guard or a schema retry the new answer is the model’s. Only the re-check is code.' },
  { name: 'Findings that stay notes', text: 'An empty lookup, evidence from an earlier turn and a tool offered with nothing behind it mark a place to look. They never move the word, which can still read consistent or not assessed.' },
  { name: 'Opt-in', text: 'Almost every check is opt-in, and a tool that marks nothing gets compared with nothing.' },
  { name: 'The world', text: 'A false sentence built from real values can pass. The record is not the world.' },
];

export const UNMEASURED: readonly string[] = [
  'The results on this page come from a scripted model. That shows how the checks behave. It does not show how often a real model trips them.',
  'We have no measured rate for how many wrong answers this catches.',
  'Does serving the record back to the model make it more honest? We cannot say yet. In one ten-run test it made no difference to citing junk records, and answers kept fewer real facts. In a later one, citing junk fell from 7 runs in 10 to between 2 and 5, and answers again kept fewer real facts. Ten runs swing by a run or two.',
  'More honest, or just more silent? The record alone cannot answer that. It needs blind hand labels, and that study has not reported.',
];
