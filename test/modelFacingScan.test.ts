/**
 * THE WALK — every sentence-shaped string literal in `src/`, put to the
 * persistent-lifetime rules, with nowhere for a new one to hide (9.86.0).
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
 *
 * `test/modelFacingSurfaces.test.ts` is a REGISTRY, and it says so itself:
 * "it cannot see a producer nobody registered … only a scan of `src/` for the
 * banned clauses could, and this is not that." That was written as a caveat.
 * It was also a prediction, and it came true twice in one release: the skill
 * gate's refusals and the trace toolpack were both live producers, both
 * matching the checker's own rules, and neither was registered — so nobody
 * was ever going to notice by reading a green suite.
 *
 * This is that scan. It reads every `.ts` file under `src/`, takes the string
 * and template literals long enough to be a sentence, and runs each one
 * through the WHOLE checker — literals and shapes — at its strictest lifetime
 * (`persistent-history`, the one that judges a string re-read on every later
 * call of a turn). Every hit must then be accounted for in the LEDGER below,
 * by entries that name where the string is delivered and how many of the
 * file's flagged literals they cover. A hit in a file nobody has classified
 * fails with the file, the line, the delivery site the parser could see, and
 * the rule it matched.
 *
 * Judging at the strictest lifetime is what makes the ledger worth reading:
 * a rule that stands down on an ephemeral surface would quietly excuse every
 * tool description in the tree, and nobody would ever have to say WHY a
 * particular string is safe. Here somebody does, once, in writing.
 *
 * ── WHY A LEDGER AND NOT A LIST OF EXEMPT FILES ───────────────────────────
 *
 * "This file is fine" is not a fact anybody can check later. What is checkable
 * is WHERE the string is delivered, so every entry names that and nothing
 * else, in one of four kinds:
 *
 *   'registry'         — a producer row in the registry composes this arm and
 *                        the checker read the real output. The judgement lives
 *                        there; this ledger only records that it happened.
 *   'ephemeral'        — model-facing, but recomposed for one request and
 *                        never re-read (a tool description, a system-prompt
 *                        fragment, a side call's own prompt). The rules judge
 *                        `lifetime`, and at THAT lifetime the checker clears
 *                        it — the entry says which surface it is.
 *   'not-model-facing' — no model ever reads it: thrown to the host, logged to
 *                        a console, a conformance assertion, a builder refusal
 *                        raised at configuration time.
 *   'unrepaired'       — model-facing, persistent, and the rule is RIGHT. This
 *                        release did not repair it. The entry says what the
 *                        sentence claims, so the list is a work list rather
 *                        than a pardon.
 *
 * The COUNT is the guard. Without it an entry is a blanket: one file would
 * excuse every future sentence written into it, which is the round-3 escape
 * with a ledger entry on top. With it, a new flagged literal in an already
 * listed file fails exactly as loudly as one in a file nobody listed.
 *
 * ── WHAT A GREEN RUN PROVES, AND WHAT IT DOES NOT ─────────────────────────
 *
 * Proves: every sentence-shaped literal in `src/` that matches a persistent
 * rule has been read by a person, and either the registry judged it, or its
 * delivery was named, or it is on the work list.
 *
 * Does NOT prove: that the library's model-facing text is clean. Four blind
 * spots, named rather than left to be discovered:
 *   • a sentence ASSEMBLED across statements (`lines.push(a); lines.push(b)`,
 *     or a helper that takes its words as arguments) is invisible here — the
 *     scan sees one literal at a time, and only folds a `+` chain that sits in
 *     one expression;
 *   • text that lives in data (skill bodies, prompt files, a consumer's own
 *     tool descriptions) is not in `src/`;
 *   • a literal under 25 characters is not read, so "is live" alone slips
 *     through while the sentence containing it would not;
 *   • the rules are shapes and past wordings, not comprehension. A false
 *     sentence that avoids all of them passes, and a fragment that only looks
 *     false in isolation is flagged here and cleared by the registry, which
 *     reads the producer's REAL composed output.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { unprovable, TOOL_RESULT } from './helpers/modelFacingClaims.js';

const REPO = resolve(__dirname, '..');

/**
 * Shorter than this is a fragment, not a sentence: an id, a key, a format
 * marker. The cut is deliberate and its cost is named in the header.
 */
const SENTENCE_MIN_CHARS = 25;

// ─── The ledger ──────────────────────────────────────────────────────────

type Kind = 'registry' | 'ephemeral' | 'not-model-facing' | 'unrepaired';

interface Entry {
  readonly kind: Kind;
  /** How many flagged literals in this file this entry accounts for. */
  readonly count: number;
  /** Where the string is delivered — the fact the classification rests on. */
  readonly why: string;
}

/**
 * Every file holding a literal a persistent rule flags, and what happens to
 * that literal. Counts sum to the file's flagged-literal count.
 */
const LEDGER: Readonly<Record<string, readonly Entry[]>> = {
  // ── judged by the registry: a producer row composes this arm and the
  // checker reads the real output ──
  'src/artifacts/present.ts': [
    {
      kind: 'registry',
      count: 1,
      why: 'the `present` refusal — the registry composes every arm through presentArtifact, and the composed sentence names the call the way the literal alone cannot',
    },
  ],
  'src/artifacts/wants.ts': [
    {
      kind: 'registry',
      count: 1,
      why: 'the `wants` dispatch refusal — the registry composes every arm through resolveToolWants and reads the whole sentence, not this fragment of it',
    },
  ],
  'src/lib/injection-engine/skillToolDescriptors.ts': [
    {
      kind: 'registry',
      count: 5,
      why: "the read_skill DESCRIPTION — the registry composes describeOffer's real output at GRAPH_TOOL_DESCRIPTION, a lifetime the graph's refusal of reactMode 'classic' makes derivable rather than asserted",
    },
    {
      kind: 'ephemeral',
      count: 1,
      why: "list_skills' own description — one request's tools array",
    },
  ],
  'src/maps/engagement/parkCard.ts': [
    {
      kind: 'registry',
      count: 1,
      why: 'the park card — the registry composes every branch at PARK_CARD, a system-prompt fragment the injection engine rebuilds on every pass',
    },
  ],

  // ── model-facing, but composed for ONE request and never re-read ──
  'src/core/agent/presentTool.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: "the `present` tool's description — one request's tools array",
    },
  ],
  'src/core/agent/window/summarize.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: "the summarizer's own system prompt: one side call, whose ANSWER (never this prompt) becomes the compaction frame",
    },
    {
      kind: 'unrepaired',
      count: 1,
      why: 'the retention sentence inside the compaction FRAME, which is a library-authored user turn and stays in `history` — it reports what was folded and anchors it to `this conversation` rather than to the fold',
    },
  ],
  'src/core/codeRunnerTool.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: "the scope-'run' configuration refusal thrown when the tool is served outside an Agent — the host that served it reads it, on the one call it refused",
    },
    {
      kind: 'ephemeral',
      count: 3,
      why: "the code runner's description and its staging clause — one request's tools array, stating the tool's mechanism rather than reporting a call",
    },
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'wiring errors thrown when a session scope or a staging runner is missing',
    },
  ],
  'src/lib/injection-engine/factories/defineRelevanceHint.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: 'a systemPrompt injection the engine rebuilds on every pass',
    },
  ],
  'src/lib/injection-engine/skillSteps.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: "skip_step's description — one request's tools array",
    },
    {
      kind: 'unrepaired',
      count: 3,
      why: "the step-advance suffix appended to a tool result ('Now on step 3 of 5'), the skip-advance sentence beside it, and skip_step's 'no step procedure is active' — persistent surfaces pointing at the moment of reading; correctly flagged, and owned by the steps feature rather than by this packet",
    },
  ],
  'src/lib/trace-toolpack/debugPrompt.ts': [
    {
      kind: 'ephemeral',
      count: 2,
      why: 'the self-explain skill body and its trigger line — system text composed for the debugging request that serves the trace tools',
    },
  ],
  'src/lib/trace-toolpack/traceToolpack.ts': [
    {
      kind: 'ephemeral',
      count: 4,
      why: 'four tool DESCRIPTIONS (find_context_errors, find_in_trace, inspect_tool_call, read_narrative) — they ride the tools array of the request being answered',
    },
    {
      kind: 'unrepaired',
      count: 13,
      why: "thirteen RESULT arms: standing imperatives telling the model to make another call ('Call run_overview …', 'Use trace_node …'), and per-run reports anchored to `this run` with no call named. Correctly flagged; repairing them means re-testing the trace suite around them, which this packet did not do",
    },
  ],
  'src/memory/beats/formatAsNarrative.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: 'the narrative recall header — the same system slot, rebuilt every request',
    },
  ],
  'src/memory/facts/llmFactExtractor.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: "the fact extractor's system prompt — one side call",
    },
  ],
  'src/memory/stages/formatDefault.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: 'the recall header prepended to retrieved memories in the system slot, rebuilt every request',
    },
  ],
  'src/memory/stages/summarize.ts': [
    {
      kind: 'ephemeral',
      count: 1,
      why: "the memory summarizer's system prompt — one side call",
    },
  ],

  // ── model-facing, persistent, correctly flagged, NOT repaired here ──
  'src/artifacts/placement.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: "the placement ticket that replaces an over-long tool result — it teaches routing in the imperative ('Do not retype …') on a surface that keeps the sentence long after the ref is swept",
    },
  ],
  'src/core/agent/evidence/gate.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: 'the evidence-check correction frame — a library-authored user turn that stays in `history`, reports what `this run` read, and tells the model to call the tool that provides a value',
    },
    {
      kind: 'not-model-facing',
      count: 4,
      why: 'the posture-name error thrown at build time, and the refusal/warning sentence handed to the CALLER (it names `posture: assist` and the `shapes` option — nobody but the developer can act on it)',
    },
  ],
  'src/core/agent/outputEnforcement.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: "the schema-check correction frame — a library-authored user turn in `history`, reporting `this run`'s required shape with no attempt of the run named as the one it describes",
    },
  ],
  'src/core/agent/repeatedCall.ts': [
    {
      kind: 'unrepaired',
      count: 2,
      why: "the repeated-call notes appended to a tool result ('has now been called N times this turn') — `now` points at the moment of reading, and the count was true only of the call that produced it",
    },
  ],
  'src/core/agent/stages/toolCalls.ts': [
    {
      kind: 'unrepaired',
      count: 2,
      why: "both permission-denied tool results ('could not be authorized. This will not change during this run') — a per-call refusal anchored to the run rather than to the call it refused",
    },
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'an event payload `detail` and the InvalidAskComponentError thrown to the consumer that raised the ask',
    },
  ],
  'src/core/agent/window/notice.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: "the window DROP NOTICE — a library-authored user turn in `history` that reports what was dropped and anchors the surviving copy to `this run`'s commit log",
    },
  ],
  'src/integrity/empty-lookup/check.ts': [
    {
      kind: 'unrepaired',
      count: 4,
      why: 'integrity finding prose and the ceiling sentence quoted into it — filed on the event channel for a person or a dashboard, and re-served to a debugging model by find_context_errors, where the `right now` / `this run` anchors are read as a report about the call the model is making',
    },
  ],
  'src/integrity/prior-turn-evidence/check.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: 'integrity finding prose, same delivery as its sibling check — a per-turn report anchored to `this run`',
    },
  ],
  'src/integrity/unsupported-argument/check.ts': [
    {
      kind: 'unrepaired',
      count: 2,
      why: "integrity finding prose, same delivery as its sibling check — a per-call report anchored to the frame `this run` holds, and the finding's frame line ('frame this call was assembled from'), which the bare call deictic row catches since 9.86.1",
    },
  ],
  'src/lib/trace-toolpack/lazyToolpack.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: "the stand-in tool result the lazy pack serves for a mounted tool with no evidence this run ('nothing to read for this run') — the module's own comments call it model-visible, and it is read again on every later call of the turn; its sibling ('No completed run is available yet') moved to traceToolNames.ts in 9.94.0 so the delegate tool can serve it without loading the pack",
    },
  ],
  'src/lib/trace-toolpack/traceToolNames.ts': [
    {
      kind: 'unrepaired',
      count: 1,
      why: "the stand-in tool result every trace tool serves before a turn has finished ('No completed run is available yet') — declared beside the reserved names, the two facts the builder needs before the pack loads (9.94.0); model-visible by design, read again on every later call of the turn",
    },
  ],

  // ── the host, the operator or the developer reads these; no model does ──
  'src/adapters/code/local.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'runtime-capability errors thrown to the host',
    },
  ],
  'src/adapters/google/aiPlatform.ts': [
    {
      kind: 'not-model-facing',
      count: 3,
      why: "vendor-failure errors thrown to the host, saying the SDK's own message is withheld, and the long-running-operation timeout thrown to the host ('this call will not report a write')",
    },
  ],
  'src/adapters/hosting/firestoreSessions.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'store errors thrown to the operator, one of them printing the index command to run',
    },
  ],
  'src/adapters/identity/agentcore.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'credential-resolution errors thrown to the host',
    },
  ],
  'src/adapters/identity/azure.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'credential-resolution errors thrown to the host',
    },
  ],
  'src/adapters/identity/google.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'credential-resolution errors thrown to the host',
    },
  ],
  'src/adapters/identity/vault.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'vault configuration errors thrown at wiring time',
    },
  ],
  'src/adapters/llm/MockProvider.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the test double`s exhaustion error, thrown to whoever scripted it',
    },
  ],
  'src/adapters/memory/memoryBank.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'an unsupported-operation rejection returned to the calling code',
    },
  ],
  'src/adapters/memory/sqliteVector.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'a durability error and an unreadable-index error, both thrown at store construction',
    },
  ],
  'src/adapters/observability/githubBugReporter.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a line of the bug-report bundle, written for the person who opens the issue',
    },
  ],
  'src/artifacts/conformance/cases.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a conformance assertion message, read by whoever runs the suite against a store',
    },
  ],
  'src/artifacts/objectStore.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a store error thrown to the host',
    },
  ],
  'src/artifacts/sqliteArtifacts.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'a durability error and an unreadable-store error, both thrown at store construction',
    },
  ],
  'src/cache/portUsage.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the evidence sentence of a cache-metrics Claim — observability output for a person or a dashboard, never a message on any wire',
    },
  ],
  'src/core/Agent.ts': [
    {
      kind: 'not-model-facing',
      count: 7,
      why: 'typed-output, option-validation and forced-tool errors thrown to the caller, plus one console warning about a cached menu',
    },
  ],
  'src/core/agent/AgentBuilder.ts': [
    {
      kind: 'not-model-facing',
      count: 9,
      why: 'build-time refusals thrown when a declared feature cannot be honored, including `.maps()` with nothing mounted',
    },
  ],
  'src/core/agent/stages/route.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a console warning that the run`s answer does not satisfy the output schema',
    },
  ],
  'src/core/agent/stages/routeTurn.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a console warning about a stored cursor that is not in the mounted graph',
    },
  ],
  'src/core/agent/stages/window.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a console warning about a provider that stopped reporting token usage',
    },
  ],
  'src/core/agent/toolDispatch.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: "errors thrown into a tool's own code when it asks inner dispatch for something inner dispatch cannot do",
    },
  ],
  'src/core/agent/window/options.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'window option validation thrown at configuration time',
    },
  ],
  'src/core/checkin.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a check-in configuration error thrown at build time',
    },
  ],
  'src/core/cost.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a budget-option error thrown at configuration time',
    },
  ],
  'src/core/pause.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'resume errors thrown to the host when a checkpoint is answered with the wrong shape',
    },
  ],
  'src/core/runCheckpoint.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a checkpoint-ownership error thrown to the host',
    },
  ],
  'src/core/runbook/recording.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a runbook warning returned to the caller that assembled the recording',
    },
  ],
  'src/core/runbook/report.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a runbook warning about report fields the envelope owns',
    },
  ],
  'src/core/runbook/walk.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a runbook warning returned to the caller that ran the walk',
    },
  ],
  'src/hosting/admission.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'an admission-policy error thrown at configuration time',
    },
  ],
  'src/hosting/conformance/cases.ts': [
    {
      kind: 'not-model-facing',
      count: 3,
      why: 'conformance assertion messages, read by whoever runs the suite against a store',
    },
  ],
  'src/hosting/durability.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a durability error thrown to the host when the session store refuses progress',
    },
  ],
  'src/hosting/errors.ts': [
    {
      kind: 'not-model-facing',
      count: 6,
      why: 'hosting error classes — their messages travel to the host and into HTTP responses, never onto a model`s wire',
    },
  ],
  'src/hosting/httpHost.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a host-wiring error thrown when the server is not listening',
    },
  ],
  'src/hosting/sqliteSessions.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'a durability error and an unreadable-store error, both thrown at store construction',
    },
  ],
  'src/hosting/webSocketConversation.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'socket close reasons sent to the connecting client',
    },
  ],
  'src/lib/bug-report/build.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a line of the bug-report bundle, written for the person who opens the issue',
    },
  ],
  'src/lib/context-bisect/sliceToBacktrackTrace.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the honesty banner of a BacktrackTrace — analysis output rendered for a person or a UI',
    },
  ],
  'src/lib/context-bisect/variableToBacktrackTrace.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the honesty banner of a BacktrackTrace — analysis output rendered for a person or a UI',
    },
  ],
  'src/lib/injection-engine/SkillRegistry.ts': [
    {
      kind: 'not-model-facing',
      count: 3,
      why: 'registry errors thrown as skills are registered',
    },
  ],
  'src/lib/injection-engine/factories/defineInstruction.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a slot-targeting error thrown at definition time',
    },
  ],
  'src/lib/injection-engine/messagesSlotRefusal.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the messages-slot refusal, raised to the consumer that tried to inject a tool-role message',
    },
  ],
  'src/lib/injection-engine/skillBodyDelivery.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a delivery-mode refusal raised at build time',
    },
  ],
  'src/lib/injection-engine/skillGraph.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a graph-declaration error thrown at build time',
    },
  ],
  'src/lib/injection-engine/skillGraphCheckup.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a checkup problem reported to the developer who ran .checkup()',
    },
  ],
  'src/lib/injection-engine/skillVocabulary.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a vocabulary warning reported to the developer wiring the skills',
    },
  ],
  'src/lib/injection-engine/skillsFromDir.ts': [
    {
      kind: 'not-model-facing',
      count: 3,
      why: 'markdown-loading errors thrown at load time, the removed-`viaToolName` refusal among them',
    },
  ],
  'src/lib/recorded-chat/recordedChat.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a fork error thrown to the caller of recordedChat',
    },
  ],
  'src/lib/sqliteUnavailable.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the runtime-capability error thrown when node:sqlite is missing',
    },
  ],
  'src/memory/asRoleRefusal.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a memory-option refusal raised to the developer',
    },
  ],
  'src/memory/define.ts': [
    {
      kind: 'not-model-facing',
      count: 4,
      why: 'defineMemory strategy and type errors thrown at definition time',
    },
  ],
  'src/memory/embedding/loadRelevant.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a store-capability error thrown when the configured store cannot search',
    },
  ],
  'src/rag/indexCorpus.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a flowchart stage label in the corpus-indexing chart — it names a step, and no model reads it',
    },
  ],
  'src/rag/loadDocuments.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a source-combination error thrown at load time',
    },
  ],
  'src/recipes/apply.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a duplicate-registration refusal raised when a recipe is applied',
    },
  ],
  'src/recipes/identifier.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a recipe-id refusal raised at registration',
    },
  ],
  'src/recorders/observability/commentary/artifactPhrases.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a commentary phrase rendered for PEOPLE watching a run',
    },
  ],
  'src/recorders/observability/commentary/commentaryTemplates.ts': [
    {
      kind: 'not-model-facing',
      count: 2,
      why: 'commentary templates rendered for PEOPLE watching a run — a dashboard line, never a message on any wire',
    },
  ],
  'src/tool-providers/skillScopedTools.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a console warning about a skill activated by something other than read_skill',
    },
  ],

  // ── caught by the rows widened in 9.86.1 (future-tense effect verbs, the
  // bare call deictic, the next-call forecast, more copula nouns) ──
  'src/adapters/llm/contextWindow.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the context-window overflow explanation thrown to the host with its three fixes — the provider refused the request before any model read it',
    },
  ],
  'src/adapters/memory/pgVector.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a schema error thrown at store construction (a missing table is refused rather than answered as an empty corpus)',
    },
  ],
  'src/core/agent/skillBrains.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a build-time refusal thrown when a skill brain is declared with no graph to pick it',
    },
  ],
  'src/lib/injection-engine/factories/defineSkill.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the removed-`viaToolName` refusal thrown at skill definition',
    },
  ],
  'src/lib/injection-engine/skillExamples.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: "a graph check-up WARNING handed to the author ('depends on how this graph is MOUNTED') — never on a request",
    },
  ],
  'src/lib/injection-engine/skillNeverRoutes.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'the never-routes check-up warning handed to the author, same delivery as skillExamples',
    },
  ],
  'src/lib/rag/defineRAG.ts': [
    {
      kind: 'not-model-facing',
      count: 1,
      why: 'a build-time refusal thrown when a query rewriter is combined with a server-ranking store',
    },
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
 * The text a literal expression delivers, or `undefined` if the node is not
 * one.
 *
 * Template holes and non-literal operands of a `+` chain become `<expr>`, so
 * the sentence keeps its SHAPE across an interpolation: `${tool}. Use …` still
 * has a clause boundary in front of `Use`, which is the thing being judged.
 * A `+` chain is folded because that is how long sentences are written in this
 * tree, and a rule that spans the seam would otherwise never fire.
 */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  if (ts.isTemplateExpression(node)) {
    return node.templateSpans.reduce(
      (text, span) => `${text}<expr>${span.literal.text}`,
      node.head.text,
    );
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left);
    const right = literalText(node.right);
    if (left === undefined && right === undefined) return undefined;
    return `${left ?? '<expr>'}${right ?? '<expr>'}`;
  }
  return undefined;
}

interface Flagged {
  readonly file: string;
  readonly line: number;
  readonly rules: readonly string[];
  /** The delivery site the parser can see — the first fact a reader needs. */
  readonly where: string;
  readonly text: string;
}

/**
 * Where the literal is handed off, read from its ancestors: `throw`, a
 * console call, a `description:` property, a plain return.
 *
 * A HINT for whoever has to classify a new hit, printed in the failure
 * message — never a verdict. `throw` is not proof that no model reads the
 * string (a tool that throws hands its message to the dispatcher, which can
 * put it on a tool result), which is exactly why the ledger asks a person.
 */
function deliverySite(node: ts.Node, sf: ts.SourceFile): string {
  let current: ts.Node | undefined = node.parent;
  for (let depth = 0; current !== undefined && depth < 8; depth += 1) {
    if (ts.isThrowStatement(current)) return 'throw';
    if (ts.isNewExpression(current) && /Error$/.test(current.expression.getText(sf))) {
      return 'new Error';
    }
    if (ts.isCallExpression(current) && /^console\./.test(current.expression.getText(sf))) {
      return 'console';
    }
    if (ts.isPropertyAssignment(current) && current.name.getText(sf) === 'description') {
      return 'description';
    }
    current = current.parent;
  }
  return 'value';
}

/**
 * Every sentence-shaped literal in `src/` that a persistent-lifetime rule
 * flags.
 *
 * The compiler's parser, not a grep: comments are not literals, so the
 * checker's own quoted examples and every `// "you are in 'alpha'"` note in
 * this tree are invisible here, as they should be.
 */
function flaggedLiterals(): readonly Flagged[] {
  // Parsed ONCE per suite (9.86.1). Every `it` below called this fresh — seven
  // parses of the whole tree — and under CI's v8-instrumented coverage job
  // each took over five seconds, past vitest's default budget, so the release
  // commit went red on `coverage` while the plain `test` jobs and the local
  // gate (which never ran coverage) stayed green. The walk is O(src/) and
  // states its own budget on each test below.
  if (flaggedLiteralsMemo !== undefined) return flaggedLiteralsMemo;
  const found: Flagged[] = [];
  for (const file of sourceFiles(join(REPO, 'src'))) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      const text = literalText(node);
      if (text === undefined) {
        ts.forEachChild(node, visit);
        return;
      }
      // Report the OUTERMOST fold only: a `+` chain is one sentence, not five.
      if (text.length >= SENTENCE_MIN_CHARS) {
        const rules = unprovable(text, TOOL_RESULT);
        if (rules.length > 0) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          found.push({
            file: relative(REPO, file),
            line: line + 1,
            rules: rules.map((rule) => rule.split(' — ')[0] ?? rule),
            where: deliverySite(node, sf),
            text: text.slice(0, 100).replace(/\n/g, ' ⏎ '),
          });
        }
      }
    };
    visit(sf);
  }
  flaggedLiteralsMemo = found;
  return found;
}
let flaggedLiteralsMemo: readonly Flagged[] | undefined;

/** The walk reads every file under `src/`; its budget is stated, not the default. */
const WALK_BUDGET = { timeout: 60_000 };

// ─── The checks ──────────────────────────────────────────────────────────

describe('every model-facing-shaped literal in src/ is accounted for', () => {
  it(
    'fails on a flagged literal in a file nobody classified, naming file, line and rule',
    WALK_BUDGET,
    () => {
      // The failure message IS the fix instruction: repair the sentence, or
      // add the file to the LEDGER above with where the string is delivered.
      const unclassified = flaggedLiterals()
        .filter(({ file }) => LEDGER[file] === undefined)
        .map(
          ({ file, line, where, rules, text }) =>
            `${file}:${line} (${where}) ${rules.join(' + ')} :: ${text}`,
        );
      expect(unclassified).toEqual([]);
    },
  );

  it(
    'fails on a NEW flagged literal inside a file that is already listed — the count is the guard',
    WALK_BUDGET,
    () => {
      const perFile = new Map<string, Flagged[]>();
      for (const hit of flaggedLiterals()) {
        perFile.set(hit.file, [...(perFile.get(hit.file) ?? []), hit]);
      }
      const drift: string[] = [];
      for (const [file, hits] of perFile) {
        const listed = (LEDGER[file] ?? []).reduce((sum, entry) => sum + entry.count, 0);
        if (hits.length !== listed) {
          drift.push(
            `${file}: ${hits.length} flagged literal(s) at line(s) ` +
              `${hits.map((hit) => hit.line).join(', ')}, ${listed} accounted for in the ledger`,
          );
        }
      }
      expect(drift).toEqual([]);
    },
  );

  it('fails on a ledger entry whose file has been cleaned up or moved', WALK_BUDGET, () => {
    // A pardon nobody needs any more is a pardon waiting to cover something
    // else: the file gets rewritten, the entry stays, and the next sentence
    // written into it is excused by an argument about a string that is gone.
    const flaggedFiles = new Set(flaggedLiterals().map((hit) => hit.file));
    const stale = Object.keys(LEDGER).filter((file) => !flaggedFiles.has(file));
    expect(stale).toEqual([]);
  });

  it('every ledger entry carries a delivery argument, and counts something', () => {
    const thin: string[] = [];
    for (const [file, entries] of Object.entries(LEDGER)) {
      for (const entry of entries) {
        if (entry.count < 1) thin.push(`${file}: an entry accounting for nothing`);
        if (entry.why.trim().length === 0) thin.push(`${file}: an entry with no reason`);
      }
    }
    expect(thin).toEqual([]);
  });

  it(
    'the ledger reports its own arithmetic — the work list is a number a run produced, not one a report copied',
    WALK_BUDGET,
    () => {
      // 9.86.0 fix pass. The changelog said the `unrepaired` bucket held THIRTY
      // literals; the ledger held thirty-three, and the wrong number travelled
      // from one report into the next because nothing in the tree computed it.
      // This is the computation. When the bucket changes, the failure prints the
      // numbers to quote — which is the whole argument of the release the ledger
      // belongs to.
      const byKind = new Map<Kind, { entries: number; literals: number }>();
      let files = 0;
      for (const entries of Object.values(LEDGER)) {
        files += 1;
        for (const entry of entries) {
          const row = byKind.get(entry.kind) ?? { entries: 0, literals: 0 };
          byKind.set(entry.kind, {
            entries: row.entries + 1,
            literals: row.literals + entry.count,
          });
        }
      }
      const literalsOf = (kind: Kind): number => byKind.get(kind)?.literals ?? 0;
      const total = [...byKind.values()].reduce((sum, row) => sum + row.literals, 0);
      expect({
        files,
        total,
        registry: literalsOf('registry'),
        ephemeral: literalsOf('ephemeral'),
        unrepaired: literalsOf('unrepaired'),
        notModelFacing: literalsOf('not-model-facing'),
        unrepairedEntries: byKind.get('unrepaired')?.entries ?? 0,
      }).toEqual({
        // 9.86.1: the rows widened to the grammar they claim flagged sixteen more
        // literals — one repaired into the registry's own anchor
        // (`COVERAGE_NOTE`), one integrity frame line added to the work list, and
        // fourteen host-facing errors and check-up warnings classified.
        // 9.88.0: a SERVED_GAPS sentence arrived and then LEFT again inside one
        // release. It was flagged as reader-facing prose printed beside a
        // rebuilt request; the sixth review round reduced every gap sentence to
        // fields, meaning and what to do, and the reduced sentences are short
        // enough that none of them trips the grammar any more. Net zero, and the
        // census is back where 9.86.1 left it.
        // 9.94.0: one literal MOVED, none added — 'No completed run is available
        // yet' left lazyToolpack.ts for traceToolNames.ts so the delegate tool
        // can serve it without loading the pack. Same total; one more file and
        // one more unrepaired entry, because the ledger is per file.
        files: 92,
        total: 178,
        registry: 8,
        ephemeral: 18,
        unrepaired: 34,
        notModelFacing: 118,
        unrepairedEntries: 14,
      });
      // And the ledger's own total is the number of literals the scan flagged —
      // the two halves of the same census, which is what makes the bucket a work
      // list rather than an estimate.
      expect(total).toBe(flaggedLiterals().length);
    },
  );

  it(
    'the scan is actually reading source — the walk fails loudly if it stops finding anything',
    WALK_BUDGET,
    () => {
      // Every assertion above passes vacuously if `flaggedLiterals()` returns
      // nothing (a moved `src/`, a parser change, a rule list that silently
      // emptied). This is the one row that goes red instead.
      expect(flaggedLiterals().length).toBeGreaterThan(20);
    },
  );
});
