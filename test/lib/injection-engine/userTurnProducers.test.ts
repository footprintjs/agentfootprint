/**
 * THE WALK — every producer of a `role: 'user'` message in this tree,
 * classified, with nowhere for a new one to hide (9.86.0).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * 9.84.0 built the authorship registry (`lib/saidByPerson.ts`) and wrote its
 * own count in prose: "FIVE kinds of `role: 'user'` message that nobody said".
 * The registry held four openings. The tree held SEVEN producers of a
 * user-role message that reaches `scope.history`, and the two that were
 * missing are the two that name things a routing rule watches for:
 *
 *   • the budget wrap-up (`stages/wrapUp.ts`) — its sentence contained
 *     "Do not request tools", so a rule written the documented way,
 *     `saidByPerson(ctx).some((m) => m.content.includes('tools'))`, matched on
 *     the library's own instruction; and the window's refusal engine, which
 *     will not let a strategy drop "the current request", could pin that
 *     request on the framework's own frame and let the real one be dropped
 *     underneath it;
 *   • the stepped-skill nudge (`stages/stepNudge.ts`) — its body lists a skill
 *     id and every unrun step's TOOL NAME, which is exactly the text a rule
 *     scanning history is looking for.
 *
 * A count in a comment is a claim; the tree is the fact. So this file WALKS
 * the tree — with the TypeScript compiler's own parser, the way
 * `skill-graph-fence.test.ts` walks the import graph — finds every place a
 * `role: 'user'` object is constructed, and requires each one to be in exactly
 * one of three lists, each entry carrying the reason it is there:
 *
 *   (a) AUTHORED FRAME — this library wrote it in a person's voice, and it is
 *       recognised as such by `isLibraryAuthoredFrame` (an opening from
 *       {@link LIBRARY_AUTHORED_PREFIXES}) or by an `injectedBy` marker. Each
 *       one is also CONSTRUCTED BELOW WITH ITS REAL WRITER and asserted, so a
 *       writer that stops emitting its opening fails here rather than in
 *       production.
 *   (b) PERSON — the content came from a person: the run's request, a
 *       continuation, a stored conversation's own turn.
 *   (c) NEVER IN HISTORY — request-only or transcript-only. It rides one
 *       provider call, or a record of the chat, and is never appended to
 *       `scope.history`, so no later reader can mistake it for anything.
 *
 * A site in none of the three fails with its file and line. That is what turns
 * "five classes" from a claim into a walk.
 *
 * Two things the walk deliberately cannot see, named here rather than left to
 * be noticed: the DELIVERED injection message (`stages/deliver.ts` copies the
 * role off the Injection, so there is no literal to find — it is asserted
 * behaviourally below), and any producer that builds a message from a computed
 * role. Both are covered by assertions instead of by the scan.
 *
 * Test types (Convention 3): contract (the walk itself — every site
 * classified) · unit (each writer's real output is recognised) · functional
 * (the model-facing law over the two new frames) · regression (the rule and
 * the window that the two unregistered frames used to fool).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { isLibraryAuthoredFrame, isSaidByPerson } from '../../../src/index.js';
import { saidByPerson } from '../../../src/injection-engine.js';
import type { Injection, InjectionContext } from '../../../src/injection-engine.js';
import type { LLMMessage } from '../../../src/adapters/types.js';
import { buildDropNotice } from '../../../src/core/agent/window/notice.js';
import { buildSummaryMessage } from '../../../src/core/agent/window/summarize.js';
import { buildCorrectiveTurn } from '../../../src/core/agent/outputEnforcement.js';
import { buildEvidenceCorrection } from '../../../src/core/agent/evidence/gate.js';
import { currentRequestIndexOf } from '../../../src/core/agent/window/currentRequest.js';
import { WRAP_UP_INSTRUCTION, wrapUpStage } from '../../../src/core/agent/stages/wrapUp.js';
import { buildStepNudgeStage } from '../../../src/core/agent/stages/stepNudge.js';
import type { StepPlan } from '../../../src/lib/injection-engine/skillSteps.js';
import { LIBRARY_AUTHORED_PREFIXES } from '../../../src/lib/saidByPerson.js';
import { unprovable, INJECTED_TURN } from '../../helpers/modelFacingClaims.js';

const REPO = resolve(__dirname, '../../..');

// ─── The three lists ─────────────────────────────────────────────────────

type SiteClass = 'authored-frame' | 'person' | 'never-in-history';

interface Site {
  readonly cls: SiteClass;
  /** Why it is in that list. Prose, because the reason is the product. */
  readonly why: string;
}

/**
 * Every file that constructs a `role: 'user'` object, with one entry per
 * construction site IN SOURCE ORDER.
 *
 * The count is load-bearing: a new site in a file that is already listed
 * fails just as loudly as a site in a file that is not, which is the failure
 * this file exists to produce. Line numbers are deliberately NOT written down
 * — they move for reasons that have nothing to do with authorship — but a
 * failure prints them.
 */
const SITES: Readonly<Record<string, readonly Site[]>> = {
  // ── (a) authored frames — the library writing in a person's voice ──
  'src/core/agent/window/notice.ts': [
    { cls: 'authored-frame', why: 'the drop notice — opens with DROP_NOTICE_PREFIX' },
  ],
  'src/core/agent/window/summarize.ts': [
    { cls: 'authored-frame', why: 'the compaction frame — opens with COMPACTED_FRAME_PREFIX' },
    {
      cls: 'never-in-history',
      why:
        "the summarizer's own request: one provider call rendering the folded span. Its " +
        'answer becomes the frame above; this message is never appended anywhere.',
    },
  ],
  'src/core/agent/outputEnforcement.ts': [
    {
      cls: 'authored-frame',
      why:
        'the schema-check correction — opens with SCHEMA_CHECK_FRAME_PREFIX, then quotes ' +
        "the validator's error as data",
    },
  ],
  'src/core/agent/evidence/gate.ts': [
    {
      cls: 'authored-frame',
      why:
        'the evidence-check correction — opens with EVIDENCE_CHECK_FRAME_PREFIX, then ' +
        "quotes the model's own flagged values as data",
    },
  ],
  'src/core/agent/stages/wrapUp.ts': [
    {
      cls: 'authored-frame',
      why:
        'the out-of-budget wrap-up instruction (WRAP_UP_INSTRUCTION) — opens with ' +
        'WRAP_UP_FRAME_PREFIX since 9.86.0. Registered because it lands in `scope.history` ' +
        'and is re-read on every later call of the turn.',
    },
  ],
  'src/core/agent/stages/stepNudge.ts': [
    {
      cls: 'authored-frame',
      why:
        'the stepped-skill nudge — its content is `nudgeTeachingMessage`, which opens ' +
        'with STEP_NUDGE_FRAME_PREFIX since 9.86.0. Registered because it names a skill id ' +
        'and every unrun step`s tool name, in `scope.history`.',
    },
  ],

  // ── (b) person — the content came from somebody ──
  'src/core/agent/stages/seed.ts': [
    { cls: 'person', why: "the run's request: the message `agent.run({ message })` was given" },
  ],
  'src/core/Agent.ts': [
    {
      cls: 'person',
      why:
        'the continuation: the words a caller passes to `.continue(…, { appendMessage })`, ' +
        'appended to the restored conversation as the next thing the person said',
    },
  ],
  'src/core/agent/stages/prepareFinal.ts': [
    {
      cls: 'person',
      why:
        'the memory turn: the run`s own `userMessage` paired with the answer, written to ' +
        '`scope.newMessages` for the memory writer — a record of what the person said, not a ' +
        'new message, and never appended to `history`',
    },
  ],
  'src/core/agent/buildMessageApiChart.ts': [
    { cls: 'person', why: "the one-shot chart's seed: `args.message`, as given" },
  ],
  'src/core/agent/buildAgentMessageApiChart.ts': [
    { cls: 'person', why: "the message-API agent chart's seed: `args.message`, as given" },
  ],
  'src/core/LLMCall.ts': [
    {
      cls: 'person',
      why:
        "the caller's `userMessage`, wrapped as a one-entry list for the messages slot to " +
        'engineer. LLMCall keeps no `history`.',
    },
  ],
  'src/hosting/conformance/run.ts': [
    {
      cls: 'person',
      why:
        'a conformance fixture: the user turn of a STORED conversation, built to exercise ' +
        'a checkpoint store. Never produced by a run.',
    },
  ],

  // ── (c) never in history — request-only or transcript-only ──
  'src/core/agent/stages/callLLM.ts': [
    {
      cls: 'never-in-history',
      why:
        'the staged-refs nudge: appended to `wireMessages` for ONE request and recomposed ' +
        'from scratch each iteration. `scope.history` is deliberately untouched, which is ' +
        'why it needs no frame.',
    },
  ],
  'src/core/agent/stages/reliabilityExecution.ts': [
    {
      cls: 'never-in-history',
      why: "the retry feedback line, carried `ephemeral: true` on one attempt's request",
    },
  ],
  'src/core/agent/stages/routeTurn.ts': [
    {
      cls: 'never-in-history',
      why:
        "the router's own classification call: the person's message quoted into a side " +
        'request whose only answer is a menu id',
    },
  ],
  'src/lib/injection-engine/constrainedEnumPick.ts': [
    { cls: 'never-in-history', why: 'the constrained-pick request — one provider call' },
  ],
  'src/lib/injection-engine/llmClassifier.ts': [
    { cls: 'never-in-history', why: 'the classifier request — one provider call' },
  ],
  'src/core-flow/Parallel.ts': [
    { cls: 'never-in-history', why: "the merge call's request over the branches' outputs" },
  ],
  'src/memory/stages/summarize.ts': [
    { cls: 'never-in-history', why: 'the memory summarizer request — one provider call' },
  ],
  'src/memory/facts/llmFactExtractor.ts': [
    { cls: 'never-in-history', why: 'the fact-extraction request — one provider call' },
  ],
  'src/memory/beats/llmExtractor.ts': [
    { cls: 'never-in-history', why: 'the beat-extraction request — one provider call' },
  ],
  'src/lib/recorded-chat/recordedChat.ts': [
    {
      cls: 'never-in-history',
      why:
        'a transcript row `{ role, text }` — the recorded-chat record of a turn, not a ' +
        'wire message (no `content` field at all)',
    },
    { cls: 'never-in-history', why: 'the same transcript row, rebuilt for a forked session' },
  ],

  // Provider adapters: they translate an LLMMessage the agent already owns
  // into the vendor's own request shape. Nothing they build is ever read back
  // into `history` — the direction is one-way, onto the wire.
  'src/adapters/llm/AnthropicProvider.ts': [
    { cls: 'never-in-history', why: 'wire translation: a text turn in the vendor shape' },
    { cls: 'never-in-history', why: 'wire translation: a tool-result turn in the vendor shape' },
  ],
  'src/adapters/llm/BrowserAnthropicProvider.ts': [
    { cls: 'never-in-history', why: 'wire translation: a text turn in the vendor shape' },
    { cls: 'never-in-history', why: 'wire translation: a tool-result turn in the vendor shape' },
  ],
  'src/adapters/llm/BedrockProvider.ts': [
    { cls: 'never-in-history', why: 'wire translation: a text turn in the vendor shape' },
    { cls: 'never-in-history', why: 'wire translation: a tool-result turn in the vendor shape' },
  ],
  'src/adapters/llm/GeminiProvider.ts': [
    { cls: 'never-in-history', why: 'wire translation: a text turn in the vendor shape' },
    { cls: 'never-in-history', why: 'wire translation: a tool-result turn in the vendor shape' },
  ],
  'src/adapters/llm/OpenAIProvider.ts': [
    { cls: 'never-in-history', why: 'wire translation: a text turn in the vendor shape' },
  ],
  'src/adapters/llm/BrowserOpenAIProvider.ts': [
    { cls: 'never-in-history', why: 'wire translation: a text turn in the vendor shape' },
  ],
};

// ─── The scan ────────────────────────────────────────────────────────────

/** Every `.ts` file under `src/`, in a stable order. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * Every CONSTRUCTION of an object with `role: 'user'`, as `file:line`.
 *
 * The compiler's parser, not a grep: a `role: 'user' | 'assistant'` TYPE
 * member is a PropertySignature and is not a producer, and a comment quoting
 * the string is not a producer either. Both are all over this tree, and a
 * regex walk would drown the list in them.
 */
function userMessageSites(): Array<{ file: string; line: number }> {
  const found: Array<{ file: string; line: number }> = [];
  for (const file of sourceFiles(join(REPO, 'src'))) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(sf) === 'role') {
        const init = node.initializer;
        const literal = ts.isStringLiteral(init)
          ? init.text
          : ts.isAsExpression(init) && ts.isStringLiteral(init.expression)
          ? init.expression.text
          : undefined;
        if (literal === 'user') {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          found.push({ file: relative(REPO, file), line: line + 1 });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

// ─── Contract: the walk ──────────────────────────────────────────────────

describe("every `role: 'user'` producer in src/ is classified", () => {
  it('fails on a producer in a file nobody classified, naming its file and line', () => {
    // The failure message IS the fix instruction: add the site to one of the
    // three lists in this file, with the reason it belongs there.
    const unclassified = userMessageSites()
      .filter(({ file }) => SITES[file] === undefined)
      .map((s) => `${s.file}:${s.line}`);
    expect(unclassified).toEqual([]);
  });

  it('fails on a NEW producer inside a file that is already listed — the count is the guard', () => {
    const perFile = new Map<string, number[]>();
    for (const { file, line } of userMessageSites()) {
      perFile.set(file, [...(perFile.get(file) ?? []), line]);
    }
    const drift: string[] = [];
    for (const [file, lines] of perFile) {
      const listed = SITES[file]?.length ?? 0;
      if (lines.length !== listed) {
        drift.push(
          `${file}: ${lines.length} site(s) at line(s) ${lines.join(', ')}, ${listed} listed`,
        );
      }
    }
    for (const file of Object.keys(SITES)) {
      if (!perFile.has(file)) {
        drift.push(`${file}: listed, but constructs no user message any more`);
      }
    }
    expect(drift).toEqual([]);
  });

  it('every classification carries a reason', () => {
    const reasonless = Object.entries(SITES).flatMap(([file, sites]) =>
      sites.filter((s) => s.why.trim().length < 20).map((_s, i) => `${file}[${i}]`),
    );
    expect(reasonless).toEqual([]);
  });

  it('the authored-frame list and the prefix registry are the same size, less the delivered class', () => {
    const framed = Object.values(SITES)
      .flat()
      .filter((s) => s.cls === 'authored-frame');
    // Six openings, six construction sites that carry one. The seventh
    // library-authored class — a DELIVERED injection message — has no literal
    // to find (deliver.ts copies the role off the Injection) and is asserted
    // by its marker below instead.
    expect(framed).toHaveLength(LIBRARY_AUTHORED_PREFIXES.length);
    expect(LIBRARY_AUTHORED_PREFIXES).toHaveLength(6);
  });

  it('the registry cannot be extended at runtime by a consumer', () => {
    // Typed `readonly` and, since 9.86.0, frozen: a consumer holds the same
    // array every reader in this library holds.
    expect(Object.isFrozen(LIBRARY_AUTHORED_PREFIXES)).toBe(true);
    expect(() => (LIBRARY_AUTHORED_PREFIXES as string[]).push('[mine')).toThrow();
    expect(LIBRARY_AUTHORED_PREFIXES).toHaveLength(6);
  });
});

// ─── Unit: each writer's REAL output is recognised ────────────────────────

/** A scope stand-in: the two stages read and write plain keys and emit. */
function fakeScope(over: Record<string, unknown>): TypedScopeLike {
  return { $emit: () => {}, ...over } as unknown as TypedScopeLike;
}
type TypedScopeLike = Parameters<typeof wrapUpStage>[0];

const PLAN: StepPlan = {
  skillId: 'refund',
  steps: [
    { tool: 'lookup', note: 'find the order first' },
    { tool: 'charge', note: 'refund the charge' },
  ],
  toolNames: new Set(['lookup', 'charge']),
  onSkip: 'advance',
};

/** The wrap-up message, as the real stage appends it. */
function wrapUpMessage(): LLMMessage {
  const scope = fakeScope({ iteration: 3, history: [{ role: 'user', content: 'audit it' }] });
  wrapUpStage(scope);
  const history = (scope as unknown as { history: LLMMessage[] }).history;
  return history[history.length - 1]!;
}

/** The nudge message, as the real stage appends it. */
function nudgeMessage(): LLMMessage {
  const scope = fakeScope({
    iteration: 2,
    history: [{ role: 'user', content: 'refund order A-1' }],
    stepPointer: [{ skillId: 'refund', step: 1, total: 2, skipped: [] }],
    llmLatestContent: 'I have stopped here.',
  });
  buildStepNudgeStage(() => PLAN)(scope);
  const history = (scope as unknown as { history: LLMMessage[] }).history;
  return history[history.length - 1]!;
}

describe('the two frames registered in 9.86.0, built by their real writers', () => {
  it('the wrap-up instruction the stage appends is library-authored, not a person’s', () => {
    const msg = wrapUpMessage();
    expect(msg.role).toBe('user');
    expect(msg.content).toBe(WRAP_UP_INSTRUCTION);
    expect(isLibraryAuthoredFrame(msg)).toBe(true);
    expect(isSaidByPerson(msg)).toBe(false);
  });

  it('the step nudge the stage appends is library-authored, not a person’s', () => {
    const msg = nudgeMessage();
    expect(msg.role).toBe('user');
    // It really does name the things a rule watches for — that is the point.
    expect(msg.content).toContain('refund');
    expect(msg.content).toContain('lookup');
    expect(isLibraryAuthoredFrame(msg)).toBe(true);
    expect(isSaidByPerson(msg)).toBe(false);
  });

  it('the four frames registered in 9.84.0 are still recognised by their real writers', () => {
    const notice = buildDropNotice({
      droppedMessageCount: 2,
      iteration: 4,
      strategy: 'slidingWindow',
    });
    const compacted = buildSummaryMessage('they asked about a refund', {
      foldedMessageCount: 3,
      iteration: 4,
      model: 'test-summarizer',
      retain: 'conversation',
    });
    const schema = buildCorrectiveTurn(
      '{ oops',
      { stage: 'schema-validate', error: 'bad' },
      {
        attempt: 1,
        totalAttempts: 2,
      },
    )[1];
    const evidence = buildEvidenceCorrection('A-9 ships tuesday', [
      { value: 'A-9', shape: 'identifier' },
    ])[1];
    for (const msg of [notice, compacted, schema, evidence]) {
      expect(isLibraryAuthoredFrame(msg)).toBe(true);
      expect(isSaidByPerson(msg)).toBe(false);
    }
  });

  it('a person’s ordinary message is still theirs — the registry is a filter, not a mute', () => {
    const said: LLMMessage = { role: 'user', content: 'can you refund order A-1 with lookup?' };
    expect(isLibraryAuthoredFrame(said)).toBe(false);
    expect(isSaidByPerson(said)).toBe(true);
  });
});

// ─── Functional: the model-facing law over the two new frames ─────────────
//
// The surface constant lives in the checker's own helper since 9.86.0, so the
// registry and this suite judge these frames at the SAME lifetime — a second
// copy of a lifetime is a second answer waiting to disagree.

describe('what the model reads on those two calls survives being re-read', () => {
  it('the wrap-up instruction makes no unprovable claim', () => {
    expect(unprovable(WRAP_UP_INSTRUCTION, INJECTED_TURN)).toEqual([]);
  });

  it('the nudge makes no unprovable claim', () => {
    expect(unprovable(nudgeMessage().content, INJECTED_TURN)).toEqual([]);
  });

  it('the wrap-up states the budget and the wire in the PAST, about one call', () => {
    // The words that made it a forecast are gone: a standing instruction about
    // what to request, and a present-tense claim about a turn. What is left is
    // a report of the call the frame was written for, which stays true when a
    // schema retry or an evidence recheck re-reads it two calls later.
    expect(WRAP_UP_INSTRUCTION).not.toMatch(/Do not request tools/);
    expect(WRAP_UP_INSTRUCTION).not.toMatch(/this turn/);
    expect(WRAP_UP_INSTRUCTION).toContain('was exhausted before this call');
    expect(WRAP_UP_INSTRUCTION).toContain('no tools were offered on it');
  });

  it('the nudge states the unrun steps in the PAST, and asks as what the call was for', () => {
    const content = nudgeMessage().content;
    expect(content).not.toMatch(/have not run|has not run/);
    expect(content).not.toMatch(/Finish them/);
    expect(content).toContain('had not run when the answer above was given');
    expect(content).toContain('This call was for running them');
  });
});

// ─── Regression: the rule, and the window, these two used to fool ─────────

function contextOver(history: readonly LLMMessage[], userMessage: string): InjectionContext {
  return {
    iteration: 7,
    userMessage,
    history: history as InjectionContext['history'],
    activatedInjectionIds: [],
  };
}

describe('a rule reading history no longer fires on the wrap-up or the nudge', () => {
  const said: LLMMessage = { role: 'user', content: 'where is my refund?' };
  const history = (): LLMMessage[] => [
    said,
    { role: 'assistant', content: 'Checking.' },
    nudgeMessage(),
    { role: 'assistant', content: 'Sorry — stopping again.' },
    wrapUpMessage(),
  ];

  it('saidByPerson returns the person’s message and neither frame', () => {
    expect(saidByPerson(contextOver(history(), said.content))).toEqual([said]);
  });

  it('a rule watching for a step’s tool name matched the nudge before it was framed', () => {
    // The hole, pinned as behaviour: the naive predicate reads history raw and
    // fires on the library's own bookkeeping; the same rule through
    // saidByPerson does not. Nobody in this conversation typed 'lookup'.
    const naive: Injection = {
      id: 'naive',
      flavor: 'skill',
      trigger: {
        kind: 'rule',
        activeWhen: (ctx) =>
          ctx.history.some((m) => m.role === 'user' && m.content.includes('lookup')),
      },
      inject: { systemPrompt: 'order-lookup skill' },
    };
    const fixed: Injection = {
      ...naive,
      id: 'fixed',
      trigger: {
        kind: 'rule',
        activeWhen: (ctx) => saidByPerson(ctx).some((m) => m.content.includes('lookup')),
      },
    };
    const ctx = contextOver(history(), said.content);
    expect(said.content).not.toContain('lookup');
    expect(naive.trigger.kind === 'rule' && naive.trigger.activeWhen(ctx)).toBe(true);
    expect(fixed.trigger.kind === 'rule' && fixed.trigger.activeWhen(ctx)).toBe(false);
  });

  it('the window will not anchor its refusal on the wrap-up frame', () => {
    // Before the frame was registered, the LAST user-role message in this
    // window was the wrap-up instruction, so the one message no strategy may
    // drop would have been the framework's own — and the real request,
    // sitting above it, became droppable.
    const window = history();
    expect(currentRequestIndexOf(window)).toBe(0);
    expect(window[currentRequestIndexOf(window)]).toBe(window[0]);
  });

  it('a window of nothing but our own frames has no request to protect', () => {
    expect(currentRequestIndexOf([nudgeMessage(), wrapUpMessage()])).toBe(-1);
  });
});

// ─── Contract: the class the scan cannot see ─────────────────────────────

describe('the delivered injection message — the class with no literal to find', () => {
  it('is excluded by its marker rather than by an opening', () => {
    // `deliver.ts` copies the role off the Injection, so no `role: 'user'`
    // literal exists to walk. `isSaidByPerson` excludes it on `injectedBy`,
    // which is the half of the rule the prefix registry does not carry.
    const delivered = {
      role: 'user',
      content: 'PS: run lookup before you answer.',
      injectedBy: { injectionId: 'premium-nudge', flavor: 'context' },
    } as unknown as LLMMessage;
    expect(isLibraryAuthoredFrame(delivered)).toBe(false);
    expect(isSaidByPerson(delivered)).toBe(false);
  });
});
