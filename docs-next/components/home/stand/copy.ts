/**
 * Everything the STAND film and the sections around it say.
 *
 * Three views change the WORDS only. Positions, order and timing never change
 * between them. Every string in REAL is what the library prints; the test in
 * `docs-next/scripts/test/stand-film.test.mts` runs the worked example against
 * the linked library and fails when one of them drifts.
 */
export type ViewKey = 'product' | 'technical' | 'business';

export const VIEWS: readonly { readonly key: ViewKey; readonly label: string }[] = [
  { key: 'product', label: 'Product' },
  { key: 'technical', label: 'Technical' },
  { key: 'business', label: 'Business' },
];

/** Verbatim library output for the worked example. Pinned by the test above. */
export const REAL = {
  question: 'Has my refund gone through?',
  answer: 'Your refund went through because the bank settled it.',
  finding: `The answer's 'status' claims "completed" but the run's settled fact is status(A-1042) = "pending"`,
  withheld: "The answer was withheld: answer validation 'refund' did not pass (failed).",
  notSure:
    'Not sure — a tool said there is ground it did not check or cannot cover; a tool said nothing matched.',
  consistent:
    "Consistent with the run's record — 2 checks ran and none fired: what came back · names and numbers. This is not a verification.",
  consistentOneCheck:
    "Consistent with the run's record — 1 check ran and did not fire: what came back. This is not a verification.",
  notAssessed: 'Not assessed — no check applied to this answer.',
  ask: 'Which order should I check?',
  invented: 'Not sure — names or numbers in the answer appear in no tool result.',
  accountChecked: 'search_bank says it checked:',
  accountCheckedItem: 'today’s bank file',
  accountNotChecked: 'search_bank says it did not check:',
  accountNotCheckedItem: 'card network reports',
  accountFound: 'search_bank looked for a settlement for this refund and reported no matching results.',
  accountSure: 'Not sure — the record holds 2 reasons this answer may not stand:',
  accountReasonGap: '1 call declared ground it did not check or can never cover.',
  accountReasonEmpty: '1 call declared that nothing matched.',
} as const;

/** What the scripted model answers in each case, so each standing has its own answer. */
export const CASES = {
  contradicted: { order: 'A-1042', status: 'completed', reason: 'the bank settled it' },
  known: { order: 'A-1042', status: 'pending' },
  consistent: 'Your refund on order A-1042 is pending.',
  notAssessed: 'Refunds usually take five days.',
  invented: 'Your refund RF-90417 went through.',
  limit: 'Your refund is pending because the bank asked for more documents.',
} as const;

export interface ChainRow {
  readonly verb: string;
  readonly why: string;
}

export type StandingKey = 'known' | 'consistent' | 'notSure' | 'ask' | 'notAssessed';
export type FieldLabel = readonly [key: string, value: string];

export interface FilmLabels {
  readonly said: string;
  readonly holds: string;
  readonly agrees: string;
  readonly contradicts: string;
  readonly unmarked: string;
  readonly unmarkedSlot: string;
  readonly tracks: readonly [string, string, string, string];
  readonly trackNotes: readonly [string, string, string, string];
  readonly typedLane: string;
  readonly proseLane: string;
  readonly person: string;
  readonly world: string;
  readonly record: string;
  readonly recordHead: string;
  readonly sounded: string;
  readonly toolRows: readonly [FieldLabel, FieldLabel];
  readonly answerRows: readonly [FieldLabel, FieldLabel, FieldLabel];
  readonly glosses: Readonly<Record<StandingKey, string>>;
  /** Show the real API names in the last shot. */
  readonly apis: boolean;
  readonly chain: readonly [ChainRow, ChainRow, ChainRow, ChainRow, ChainRow];
}

export interface Caption {
  readonly h: string;
  readonly s: string;
}

export const CHAPTER_IDS = [
  'ask',
  'ledger',
  'llm',
  'logs',
  'word',
  's',
  't',
  'a',
  'montage',
  'n',
  'named',
  'd',
  'gate',
  'explain',
  'limit',
  'chain',
  'finale',
] as const;
export type ChapterId = (typeof CHAPTER_IDS)[number];

/** The chapter's letter badge, where it has one. */
export const CHAPTER_LETTER: Partial<Record<ChapterId, string>> = {
  s: 'S',
  t: 'T',
  a: 'A',
  montage: 'A',
  n: 'N',
  named: 'N',
  d: 'D',
  gate: 'D',
  explain: 'D',
};

/**
 * The hand-off at the end of each letter: which line of the chain it says, and
 * which letter it hands to. These are the same words the chain repeats near the end.
 */
export const CHAPTER_NEXT: Partial<Record<ChapterId, { readonly line: number; readonly to?: string }>> = {
  s: { line: 0, to: 'T' },
  t: { line: 1, to: 'A' },
  montage: { line: 2, to: 'N' },
  named: { line: 3, to: 'D' },
  explain: { line: 4 },
};

/** The last shot: what goes in, where it lands, and the notes it leaves. Every API name is real, and the test checks. */
export const UNIVERSE = {
  sources: [
    { name: 'Skills', api: 'defineSkill()', color: '#f97316' },
    { name: 'Steering', api: 'defineSteering()', color: '#a855f7' },
    { name: 'Memory', api: 'defineMemory()', color: '#3b82f6' },
    { name: 'RAG', api: 'defineRAG()', color: '#22c55e' },
    { name: 'Tools', api: 'defineTool()', color: '#eab308' },
    { name: 'Policies', api: 'PermissionPolicy', color: '#06b6d4' },
  ],
  slots: [
    { name: 'system', sub: 'the instructions', color: '#eab308' },
    { name: 'messages', sub: 'the conversation', color: '#22c55e' },
    { name: 'tools', sub: 'what it can call', color: '#a855f7' },
  ],
  notes: [
    { long: 'skill chosen', short: 'skill' },
    { long: 'steering applied', short: 'steer' },
    { long: 'memory fetched', short: 'memory' },
    { long: 'results retrieved', short: 'rag' },
    { long: 'tools bound', short: 'tools' },
    { long: 'model called', short: 'model' },
    { long: 'answer', short: 'answer' },
  ],
} as const;

/** The last sentence of the chain, and what the answer says as it lands on the letters. */
export const STAND_LINE = 'This is how an answer stands.';

export interface ViewCopy {
  readonly hero: { readonly lede: string };
  readonly chain: readonly [ChainRow, ChainRow, ChainRow, ChainRow, ChainRow];
  readonly caps: Readonly<Record<ChapterId, Caption>>;
  readonly labels: FilmLabels;
}

const SHARED_LABELS = {
  apis: false,
  person: 'your user',
  world: 'the world',
  record: 'the record',
  recordHead: 'the record, written as the run happens',
  sounded: 'how sure it sounded',
  typedLane: 'structured answer, with your check',
  proseLane: 'streamed text',
  toolRows: [
    ['order', 'which order'],
    ['status', 'refund status'],
  ],
  answerRows: [
    ['order', 'which order'],
    ['status', 'refund status'],
    ['reason', 'why'],
  ],
  trackNotes: [
    'the answer goes out, with its reason',
    'an invented value, a wrong format, unfinished steps or a bad source',
    'only they can give this value',
    'nothing reaches anyone',
  ],
} as const;

const PRODUCT_CHAIN: FilmLabels['chain'] = [
  { verb: 'State the rules,', why: 'so the run can be held to them.' },
  { verb: 'Trace the run,', why: 'so there is a record the model did not write.' },
  { verb: 'Assess each claim,', why: 'so you can see where it differs from that record.' },
  { verb: 'Name the standing,', why: 'so nobody has to guess how far the answer stands.' },
  { verb: 'Decide what happens,', why: 'because the policy is yours.' },
];
const TECHNICAL_CHAIN: FilmLabels['chain'] = [
  { verb: 'State the rules,', why: 'so a claim has something fixed to be compared with.' },
  { verb: 'Trace the run,', why: 'so the rows exist by construction.' },
  { verb: 'Assess each claim,', why: 'so a contradiction becomes a finding.' },
  { verb: 'Name the standing,', why: 'so the fold gives one word and its reasons.' },
  { verb: 'Decide what happens,', why: 'so the policy lives in your code.' },
];
const BUSINESS_CHAIN: FilmLabels['chain'] = [
  { verb: 'State the rules,', why: 'so nobody can fit them to the answer.' },
  { verb: 'Trace the run,', why: 'so you hold a record the model did not write.' },
  { verb: 'Assess each claim,', why: 'so a wrong value is caught by a comparison.' },
  { verb: 'Name the standing,', why: 'so your team and your customer know how far to rely on it.' },
  { verb: 'Decide what happens,', why: 'because the policy is yours.' },
];

export const COPY: Readonly<Record<ViewKey, ViewCopy>> = {
  product: {
    hero: {
      lede: 'An agent framework that compares the model’s claims with a record of what actually ran. You choose the checks and decide what happens next.',
    },
    chain: PRODUCT_CHAIN,
    caps: {
      ask: {
        h: 'It sounds sure. What is it standing on?',
        s: 'A customer asks about a refund and gets one confident sentence. Fact, or hunch?',
      },
      ledger: {
        h: 'A careful person keeps a ledger.',
        s: 'Which book they opened, why, and what they found. Now anyone can check the work.',
      },
      llm: {
        h: 'An LLM’s tools are its books. Where is its ledger?',
        s: 'It read two sources, and its answer tells you nothing about them.',
      },
      logs: {
        h: 'Most frameworks log this for you.',
        s: 'Usually in a dashboard, for your team, after the answer has gone. Guardrails can block an answer, but connecting them to this evidence is your job.',
      },
      word: {
        h: 'Turn the checks on, and the answer has to stand.',
        s: 'You choose which checks run. Each one follows the same five steps.',
      },
      s: {
        h: 'State the rules.',
        s: 'Tools mark their facts and say what they searched. You say which answer field reports which fact. All before the model sees anything.',
      },
      t: {
        h: 'Trace the run.',
        s: 'FootprintJS, the engine underneath, writes a note at every step and links it to the notes behind it, so you can walk back from any answer. The model’s words go in as claims, never as evidence.',
      },
      a: {
        h: 'Assess the claims.',
        s: 'Code compares what the model said with what the record holds. No model judges it.',
      },
      montage: {
        h: 'Every check is this same comparison.',
        s: 'Invented values. The wrong time window. An action that never ran. “Not found” stretched past what was searched.',
      },
      n: {
        h: 'Name the standing.',
        s: 'One of five words, with its reason. Not a percentage.',
      },
      named: {
        h: 'Read from the record.',
        s: 'Never from how sure the model sounded. The saved record gives the same standing later.',
      },
      d: {
        h: 'Decide what happens.',
        s: 'Flag it, name the problem back to the model for one more turn, ask the person, or withhold it. A contradiction is never re-asked, because that would invite the model to change the claim, not the facts.',
      },
      gate: {
        h: 'Structured answers wait at the gate.',
        s: 'A structured answer with your check holds back until the checks finish. Streamed text still goes first, and its standing arrives right after, for your app to show.',
      },
      explain: {
        h: 'Your user can see why.',
        s: 'What it checked, what it did not, and who vouches for each line. Written from the record, never by a model.',
      },
      limit: {
        h: 'The record is not the world.',
        s: 'A false sentence built from real values can pass. Honest, here, means a claim stays within its evidence, not that it is true.',
      },
      chain: {
        h: 'Each step makes the next one possible.',
        s: 'Take one away and the answer has less to stand on.',
      },
      finale: {
        h: 'FootprintJS keeps the notes. AgentFootprint holds the model to them.',
        s: 'It holds claims to the record, not to the world.',
      },
    },
    labels: {
      ...SHARED_LABELS,
      chain: PRODUCT_CHAIN,
      said: 'What the model said',
      holds: 'What the record holds',
      agrees: 'agrees',
      contradicts: 'contradicts',
      unmarked: 'not checked',
      unmarkedSlot: 'no tool marked this',
      tracks: ['Flag it', 'One more turn', 'Ask the person', 'Withhold it'],
      glosses: {
        known: 'Known: a check you wrote passed for this answer.',
        consistent: 'Consistent: nothing in the record contradicts it, and nothing proved it either.',
        notSure: 'Not sure: the bank search found nothing and left ground unchecked, so the whole answer is marked.',
        ask: 'Ask: two orders are open, and only the customer can say which.',
        notAssessed: 'Not assessed: no tool ran, so there was nothing to compare it with.',
      },
    },
  },
  technical: {
    hero: {
      lede: 'A TypeScript agent framework. Code compares the model’s claims with a record the runtime wrote, and folds the result into the answer’s standing. Every check is opt-in.',
    },
    chain: TECHNICAL_CHAIN,
    caps: {
      ask: {
        h: 'It sounds sure. What is it standing on?',
        s: 'A model’s confidence is not evidence, and its prose does not cite what it read.',
      },
      ledger: {
        h: 'A careful person keeps a ledger.',
        s: 'Which source, why it was opened, and what came back. Facts are tied to reads, hypotheses are marked.',
      },
      llm: {
        h: 'An LLM’s tools are its books. Where is its ledger?',
        s: 'The tool calls happened. Nothing connects the sentence to them.',
      },
      logs: {
        h: 'Most frameworks trace this for you.',
        s: 'Traces and scorers usually report to a dashboard beside the answer. Guardrails can block, but wiring them to the evidence is your job.',
      },
      word: {
        h: 'Turn the checks on, and the answer has to stand.',
        s: 'Opt-in layers, mounted as flowchart stages. Off means byte-identical runs.',
      },
      s: {
        h: 'State the rules.',
        s: 'describedResult marks facts, coverage declares limits, outputSchema types the answer, and claims joins each field to a fact.',
      },
      t: {
        h: 'Trace the run.',
        s: 'FootprintJS commits each stage’s reads and writes, so the record exists by construction. _findings are stored as claims and never count as support.',
      },
      a: {
        h: 'Assess the claims.',
        s: 'A deterministic comparison over the record. Agreement never counts as proof, and with no reading the field is not compared.',
      },
      montage: {
        h: 'Every check is this same comparison.',
        s: 'namesAndNumbersFromEvidence, period, context.toolCalls and negativeClaims all compare a claim with a recorded fact.',
      },
      n: {
        h: 'Name the standing.',
        s: 'assessAnswer folds committed rows into known, consistent, not sure, ask or not assessed, each with its reasons.',
      },
      named: {
        h: 'Read from the record.',
        s: 'Rows, not events, and never the model’s confidence. The live fold and the saved fold matched byte for byte.',
      },
      d: {
        h: 'Decide what happens.',
        s: 'assist flags, guard gives one revision, askOrAssume pauses, enforce throws. Re-asks are for an invented value, a bad shape with retries on, unfinished steps or a bad citation. A contradiction is never re-asked: that would invite the model to change the claim, not the facts.',
      },
      gate: {
        h: 'Typed answers wait at the gate.',
        s: 'answerValidation holds draft tokens. Prose streams first, and under rails both drafts stream before the throw.',
      },
      explain: {
        h: 'Your user can see why.',
        s: 'accountForAnswer renders fixed templates over the record, and each line names its voucher: person, library, tool, model or app.',
      },
      limit: {
        h: 'The record is not the world.',
        s: 'Tool declarations are trusted inputs. The check measures claims within evidence, not truth, and a false sentence built from real values can pass.',
      },
      chain: {
        h: 'Each step makes the next one possible.',
        s: 'Declare, Record, Compare, Conclude, Act, in the reader’s order. Inside a layer the order is Declare, Verify, Record, Resolve.',
      },
      finale: {
        h: 'FootprintJS keeps the notes. AgentFootprint holds the model to them.',
        s: 'It holds claims to the record, not to the world.',
      },
    },
    labels: {
      ...SHARED_LABELS,
      chain: TECHNICAL_CHAIN,
      apis: true,
      recordHead: 'the record, written by the runtime',
      typedLane: 'typed answer, with validation',
      proseLane: 'streamed prose',
      toolRows: [
        ['order', 'string'],
        ['status', 'facts[].status'],
      ],
      answerRows: [
        ['order', 'string'],
        ['status', 'string'],
        ['reason', 'string'],
      ],
      trackNotes: [
        'the answer goes out, with its reason',
        'invented value, bad shape, unfinished steps or a bad citation',
        'only they can give this value',
        'nothing reaches anyone',
      ],
      said: 'typed answer',
      holds: 'marked facts',
      agrees: 'not-applicable',
      contradicts: 'checked-fail',
      unmarked: 'not in .claims()',
      unmarkedSlot: 'no reading',
      tracks: ['assist', 'guard', 'askOrAssume', 'enforce'],
      glosses: {
        known: 'known: a passed enforcing answerValidation report on a typed answer.',
        consistent: 'consistent: checks ran and none fired. A membership pass refutes and never supports.',
        notSure: 'not sure: search_bank returned absent(), and its reasons are on the standing.',
        ask: 'ask: askOrAssume paused the run before the tool ran.',
        notAssessed: 'not assessed: no tool ran, so no check applied.',
      },
    },
  },
  business: {
    hero: {
      lede: 'Every answer you choose to check shows what it rests on, and your policy decides whether it reaches the customer.',
    },
    chain: BUSINESS_CHAIN,
    caps: {
      ask: {
        h: 'It sounds sure. What is it standing on?',
        s: 'The answer your customer reads looks equally certain whether or not anything supports it.',
      },
      ledger: {
        h: 'A careful person keeps a ledger.',
        s: 'That is how trust is earned: anyone can follow the work and check it.',
      },
      llm: {
        h: 'An LLM’s tools are its books. Where is its ledger?',
        s: 'Your agent read your systems. Nothing shows which of them back what it just said.',
      },
      logs: {
        h: 'The logs are for your team.',
        s: 'Your team can find out later. Your customer has already read the answer.',
      },
      word: {
        h: 'Turn the checks on, and the answer has to stand.',
        s: 'You choose which checks run. Each one puts the same five steps between what the model says and what your customer sees.',
      },
      s: {
        h: 'State the rules.',
        s: 'Agreed before the run, so nobody can fit them to the answer afterwards.',
      },
      t: {
        h: 'Trace the run.',
        s: 'FootprintJS, the engine underneath, keeps a record the model did not write, as the work happens.',
      },
      a: {
        h: 'Assess the claims.',
        s: 'A contradiction is caught by a comparison, not by a second opinion.',
      },
      montage: {
        h: 'Every check is this same comparison.',
        s: 'Each check closes one specific way an answer goes wrong.',
      },
      n: {
        h: 'Name the standing.',
        s: 'A plain word your team and your customer can act on, with the reason beside it.',
      },
      named: {
        h: 'Read from the record.',
        s: 'A confident tone earns nothing. The same record gives the same standing when someone asks later.',
      },
      d: {
        h: 'Decide what happens.',
        s: 'Your policy, per agent. Flag it, let it correct once, ask the customer, or block it. A contradiction is never sent back to the model, because that would only invite a different claim.',
      },
      gate: {
        h: 'Structured answers wait at the gate.',
        s: 'Where an answer must be checked before anyone reads it, use a structured answer with validation. Streamed text reaches the customer first.',
      },
      explain: {
        h: 'Your user can see why.',
        s: 'A plain account of what was checked and what was not, without opening a dashboard.',
      },
      limit: {
        h: 'The record is not the world.',
        s: 'This shows what the answer rests on. It does not prove the answer true, and it is not a compliance claim.',
      },
      chain: {
        h: 'Each step makes the next one possible.',
        s: 'Skip the rules or the record, and the rest has nothing to hold on to.',
      },
      finale: {
        h: 'FootprintJS keeps the notes. AgentFootprint holds the model to them.',
        s: 'It holds claims to the record, not to the world.',
      },
    },
    labels: {
      ...SHARED_LABELS,
      chain: BUSINESS_CHAIN,
      person: 'your customer',
      said: 'The claim',
      holds: 'The evidence',
      agrees: 'agrees',
      contradicts: 'contradicts',
      unmarked: 'not checked',
      unmarkedSlot: 'nothing to compare',
      tracks: ['Flag for review', 'Let it correct once', 'Ask the customer', 'Block it'],
      glosses: {
        known: 'Known: your own rule was applied and held.',
        consistent: 'Consistent: nothing contradicts it, and nothing proves it either.',
        notSure: 'Not sure: someone should look before relying on this.',
        ask: 'Ask: the agent stopped instead of guessing.',
        notAssessed: 'Not assessed: this answer has no support on record either way.',
      },
    },
  },
};

export const NODE_SECTION = {
  kicker: 'Why TypeScript on Node.js',
  title: 'An agent mostly waits on the network. Node.js was built for that.',
  lede: 'JavaScript began in the browser. Node.js took its event loop to the back end, for servers that spend their time waiting on other services. An agent spends its time waiting on models and tools.',
  points: [
    {
      name: 'It waits well',
      text: 'One event loop holds many model and tool calls open, and each stage commits in order with no locks.',
    },
    {
      name: 'It reaches the screen',
      text: 'The same engine runs on the server and in the browser, so the record can reach the person reading the answer.',
    },
    {
      name: 'It captures by itself',
      text: 'Reads and writes are tracked through a JavaScript Proxy, so stages need no annotations to be stitched.',
    },
  ],
  boundary:
    'This is a fit, not a claim that it is the best language. Python stays the usual home for training and data, so your tools and trainers can stay in their own language, over MCP or as sidecars.',
  source: 'https://nodejs.org/en/about',
} as const;

/* ── what you write ───────────────────────────────────────────────────────── */

export interface CodeSample {
  readonly title: string;
  readonly text: string;
  /** Exactly what the test runs, so the page cannot show code that has stopped working. */
  readonly code: string;
  /** Lines holding one of these are the point of the sample. */
  readonly marks: readonly string[];
  readonly outputLabel: string;
  readonly output: string;
}

const STANDING_SAMPLE = `import { Agent, absent, defineTool } from 'agentfootprint';

const searchBank = defineTool({
  name: 'search_bank',
  description: 'Search bank settlements',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    absent({
      what: 'a settlement for this refund',
      checked: ['today’s bank file'],
      notChecked: ['card network reports'],
    }),
});

const agent = Agent.create({ provider, model })
  .tool(searchBank)
  .answerLayer({ standingLine: true })
  .build();`;

const FIELD_SAMPLE = `import { Agent, defineTool, describedResult } from 'agentfootprint';

const getRefund = defineTool({
  name: 'get_refund',
  description: 'Refund status for an order',
  inputSchema: { type: 'object', properties: {} },
  execute: () =>
    describedResult({
      facts: [{ entity: 'A-1042', status: 'pending' }],
      provenance: {
        source: 'refund-ledger',
        measuredAt: '2026-01-15T12:00:00Z',
      },
    }),
});

const agent = Agent.create({ provider, model })
  .tool(getRefund)
  .outputSchema(refundAnswer)
  .claims({ status: { entity: 'A-1042', field: 'status' } })
  .answerValidation({
    id: 'refund',
    version: '1',
    mode: 'enforce',
    agentChecks: ['claims'],
    validate: yourOwnCheck,
  })
  .build();`;

export const CODE_SECTION: {
  readonly kicker: string;
  readonly title: string;
  readonly lede: string;
  readonly samples: readonly CodeSample[];
} = {
  kicker: 'What you write',
  title: 'A full agent framework. The checks are a few lines.',
  lede: 'You build the agent in AgentFootprint, so it replaces your agent loop. It is not an add-on for another framework. Your tools can stay where they are, over MCP.',
  samples: [
    {
      title: 'Give every answer its standing',
      text: 'One builder call, and it adds nothing to the prompt. A tool that says what it searched gives the standing more to go on.',
      code: STANDING_SAMPLE,
      marks: ['absent({', '.answerLayer('],
      outputLabel: 'The person reads',
      output: `${REAL.answer}\n\n---\n\n${REAL.notSure}`,
    },
    {
      title: 'Hold a field to a fact',
      text: 'The tool marks the fact, and you say which answer field reports it. A contradiction is withheld before anything streams.',
      code: FIELD_SAMPLE,
      marks: ['describedResult({', '.claims(', 'agentChecks:'],
      outputLabel: 'When the answer says “completed”, run() throws',
      output: REAL.withheld,
    },
  ],
};

/* ── the questions a first-timer asks ─────────────────────────────────────── */

/** `code` in backticks. Each answer stops where what we can show stops. */
export const QUESTIONS: {
  readonly title: string;
  readonly items: readonly { readonly q: string; readonly a: string }[];
} = {
  title: 'Questions',
  items: [
    {
      q: 'Can I keep my framework?',
      a: 'You move to this one. AgentFootprint runs the agent loop, so it replaces your current one. Your tools can stay where they are, over MCP.',
    },
    {
      q: 'How much do I change per tool?',
      a: 'Nothing, to start. To hold a field to a fact, that tool marks the fact with `describedResult({ facts })`, and the agent adds `.outputSchema()` and `.claims()`.',
    },
    {
      q: 'What happens by default on a contradiction?',
      a: 'With `.claims()` alone, the answer is delivered, the contradiction is recorded and the standing stays not assessed. List it in an enforcing check and the answer is withheld.',
    },
    {
      q: 'Does it stop a wrong answer in streamed chat?',
      a: 'Only a structured answer with a check is held back before anything streams. Streamed text reaches the person first, and its standing arrives right after, for your app to show.',
    },
    {
      q: 'What share of wrong answers does it catch?',
      a: 'We have no measured rate. It catches what the record can contradict, and a false sentence built from real values can pass.',
    },
    {
      q: 'Would it satisfy legal or audit?',
      a: 'We make no compliance claim. The record shows what ran and what was available. It does not prove correctness or compliance by itself.',
    },
    {
      q: 'Why two packages?',
      a: 'AgentFootprint is built on FootprintJS, which keeps the record and installs with it. Its sibling `hcifootprint` gives agents a typed map of an app’s real capabilities while the signed-in user stays in control.',
    },
    {
      q: 'Why TypeScript on Node.js?',
      a: 'An agent mostly waits on the network, and Node.js was built for back-end work that waits. The same engine runs in the browser, so the record can reach the person reading the answer. This is a fit, not a claim that it is the best language.',
    },
  ],
};

/* ── the four stages below the film ───────────────────────────────────────── */

export interface Stage {
  /** The id of the heading this stage opens. Must exist in the DOM. */
  readonly id: string;
  readonly step: string;
  readonly name: string;
  /** The name on the thin bar. */
  readonly short: string;
  /** The developer action sequence for this stage. */
  readonly what: string;
  /** Real public APIs that implement the sequence. */
  readonly apis: readonly string[];
  /** APIs that ship but still carry a beta stability marker. */
  readonly betaApis?: readonly string[];
}

export const STAGES: readonly Stage[] = [
  {
    id: 'build',
    step: '01',
    name: 'Build',
    short: 'Build',
    what: 'declare → attach → build',
    apis: ['defineTool()', 'defineSkill()', 'defineSkillMap()', '.skillGraph()'],
  },
  {
    id: 'debug',
    step: '02',
    name: 'Debug',
    short: 'Debug',
    what: 'view → localize → rerun',
    apis: ['traceDebugAgent()', 'localizeContextBug()', 'rerunWithoutSources()'],
    betaApis: ['localizeContextBug()', 'rerunWithoutSources()'],
  },
  {
    id: 'production',
    step: '03',
    name: 'Run in production',
    short: 'Run',
    what: 'serve → persist → survive → govern',
    apis: ['standingAgent()', 'sqliteSessions()', 'withRetry()', 'PermissionPolicy.fromRoles()'],
  },
  {
    id: 'monitor',
    step: '04',
    name: 'Monitor',
    short: 'Monitor',
    what: 'watch → export → archive → learn',
    apis: ['.on()', '.enable.observability()', 'persistRecording()', 'contextLedger()'],
  },
];
