/**
 * codeRunnerTool — the tool that turns a {@link CodeRunner} into something an
 * LLM can call, holding ONE session per isolation key.
 *
 * Pattern: Factory over `defineTool` + the 9.7.0 tool-session contract.
 * Role:    the first consumer of `ctx.onTeardown` — and the proof it works.
 * Emits:   nothing directly; the teardown tier reports
 *          `agentfootprint.tools.session_started` / `_reused` / `_closed` /
 *          `_close_failed`.
 *
 * ── The doctrine: summarize prose, compute data ─────────────────────────────
 * A tool that hands the model 40,000 rows has not given it data; it has spent
 * the window. The motivating failure is real and measured: a production request
 * of 879,073 tokens, almost all of it one tool result pasted into the prompt.
 * (Since 9.6.0 that shape at least fails by NAME —
 * `ContextWindowExceededError` — instead of as a vendor 400. This is the other
 * half: not failing better, but not needing to.)
 *
 * With a code runner the model writes an aggregation, the RUNNER holds the
 * rows, and what comes back is the number. Prose gets summarized; data gets
 * computed.
 *
 * ── Why the session must be keyed, and keyed WIDELY ENOUGH ──────────────────
 * The session is the whole value: a code interpreter costs seconds to start and
 * milliseconds to invoke. But a session holds a filesystem, an environment and
 * half-run state, so the thing it is keyed on IS the isolation boundary. A
 * standing agent serving many people from one process, holding one session in a
 * module map, gives person B person A's files.
 *
 * So the key comes from `toolSessionKey(ctx, scope)` — one exported
 * implementation, composing tenant + principal + (session | run). Never a bare
 * `sessionId`: that is caller data, and anyone who can reach the host can put
 * someone else's there.
 *
 * ── Degradation is REFUSED, never silent ────────────────────────────────────
 * Ask for `scope: 'session'` at a door with no session and this throws, naming
 * the door. It does not quietly fall back. Falling back to a WIDER key is the
 * cross-binding bug itself; falling back to a NARROWER one is a silent 30×
 * latency change nobody sees until the bill.
 *
 * @example a session per run, on a local dev machine
 *   const agent = Agent.create({ provider })
 *     .tool(codeRunnerTool({ runner: localCodeRunner() }))
 *     .build();
 *
 * @example a session per hosted conversation, on a real sandbox
 *   const runner = agentCoreCodeRunner({ region, identifier: 'aws.codeinterpreter.v1' });
 *   const agent = Agent.create({ provider })
 *     .tool(codeRunnerTool({ runner, scope: 'session', language: 'python' }))
 *     .build();
 *   // the composition root says when a session is over:
 *   conversation.onClose(() => void agent.closeToolSessions({ sessionId }));
 */

import type { CodeInput, CodeResult, CodeRunner, CodeSession } from '../adapters/types.js';
import { canStageCodeInputs, STAGED_INPUTS_ENV } from '../adapters/types.js';
import type { ToolWants } from '../artifacts/wants.js';
import type { CredentialNeed } from '../identity/types.js';
import type { CheckInDemand } from './checkin.js';
import { defineTool, type Tool, type ToolExecutionContext } from './tools.js';
import { toolSessionKey, type TeardownScope } from './toolSessions.js';

/** The scopes a code session can be held under. `'shutdown'` is not one: it is
 *  when everything goes, not a thing to key a session on. */
export type CodeRunnerToolScope = Extract<TeardownScope, 'call' | 'run' | 'session'>;

export interface CodeRunnerToolOptions {
  /** The backend. `localCodeRunner()` for a dev loop, `agentCoreCodeRunner(...)`
   *  for a real sandbox — the tool is identical across the swap. */
  readonly runner: CodeRunner;
  /** Tool name the model sees. Default `'run_code'`. */
  readonly name?: string;
  /** Description the model sees. A sensible one is composed from `scope` +
   *  `language` when you do not pass one. */
  readonly description?: string;
  /**
   * How long one session lives. Default `'run'` — a turn's worth of work shares
   * one interpreter, and nothing outlives the turn.
   *
   * `'session'` keeps the interpreter across the turns of one hosted
   * conversation (variables persist, files persist) and REQUIRES a
   * session-bound run plus a composition root that calls
   * `agent.closeToolSessions({ sessionId })`.
   *
   * `'call'` starts and stops per invocation — the safest and the slowest.
   */
  readonly scope?: CodeRunnerToolScope;
  /** Default language for the code the model writes. Default `'python'`. */
  readonly language?: string;
  /** Per-stream ceiling for what reaches the model, in characters. Default 4000.
   *  Anything cut is STATED in the result, never dropped quietly. */
  readonly maxOutputChars?: number;
  /** Per-execution ceiling handed to the runner. */
  readonly timeoutMs?: number;
  /** Demand a human check-in before code runs — `'always'`, or a predicate over
   *  the code string. A pause here does NOT tear the session down. */
  readonly checkIn?: CheckInDemand<{ code: string }>;
  /** A credential this tool needs (declare-and-push). Resolved before execute.
   *  Do NOT cache it past the call: a session outliving a run outlives its token. */
  readonly needs?: CredentialNeed;
  /**
   * Artifact arguments, declared exactly as any other tool declares them
   * (9.26.0): `wants: { dataset: 'dataset/rows' }`.
   *
   * The model passes the `art_…` ref as the argument, the framework resolves
   * it before `execute` under the run's own scope — the same `wants` machinery,
   * with the same teaching refusals for a stale, unknown or wrong-kind ref —
   * and then this tool STAGES the resolved payload into the code session as a
   * file. The data reaches the interpreter without ever entering the context
   * window, which is the whole doctrine this tool exists for, now with an
   * inbound leg to match the outbound one.
   *
   * ── What the model's code reads ─────────────────────────────────────────
   * The staged files are named in the `AF_STAGED_INPUTS` environment variable,
   * a JSON object of `argument name → path`. The composed tool description
   * states it with a one-line example in the tool's language, so a model needs
   * nothing beyond the description to use it.
   *
   * ── Refused rather than degraded ────────────────────────────────────────
   * Declaring `wants` on a runner whose sessions cannot accept staged inputs
   * (`stageInputs` absent — `agentCoreCodeRunner` today) refuses BY NAME at
   * dispatch. Running the code without the data it declared would leave the
   * model reasoning about a file that is not there, which is the exact silent
   * failure this library refuses to ship.
   *
   * Omitted, nothing changes: no schema properties are added, no session is
   * ever asked to stage, and the description is the one earlier releases
   * composed.
   */
  readonly wants?: ToolWants;
}

const DEFAULT_MAX_OUTPUT_CHARS = 4_000;

/**
 * The per-tool session map, riding the `Tool` under a REGISTRY symbol.
 *
 * `Symbol.for`, not a unique symbol: this package ships CJS and ESM, and a tool
 * built through one entry point must be readable through the other. The same
 * move `INNER_RUN_RECORDS` makes for `flowchartAsTool({ keepRecord })` — and
 * deliberately a DIFFERENT symbol, so one tool can carry both (spreading a tool
 * preserves symbol keys, which is why `{...tool, [SYM]: store}` composes).
 *
 * Invisible to the LLM, invisible to `Tool`'s shape, reachable by a test and by
 * whatever inspector comes next.
 */
export const TOOL_SESSIONS: unique symbol = Symbol.for('agentfootprint.tools.sessions');

/** A `Tool` that holds live sessions, keyed by isolation key. */
export interface HoldsToolSessions {
  readonly [TOOL_SESSIONS]: ReadonlyMap<string, CodeSession>;
}

/** Read the live-session map off a candidate, or `undefined` when it holds none. */
export function toolSessionsOf(candidate: unknown): ReadonlyMap<string, CodeSession> | undefined {
  if (candidate === null || typeof candidate !== 'object') return undefined;
  const held = (candidate as Partial<HoldsToolSessions>)[TOOL_SESSIONS];
  return held instanceof Map ? held : undefined;
}

export function codeRunnerTool(
  options: CodeRunnerToolOptions,
): Tool<{ code: string }, string> & HoldsToolSessions {
  const name = options.name ?? 'run_code';
  const scope: CodeRunnerToolScope = options.scope ?? 'run';
  const language = options.language ?? 'python';
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

  /**
   * Live sessions by isolation key.
   *
   * A `Map` and not a closure variable, because two keys are two sandboxes: one
   * variable would be exactly the cross-binding this whole feature exists to
   * prevent. Entries are removed by the teardown the tool registers alongside
   * them, so the map cannot outlive what it points at.
   */
  const sessions = new Map<string, CodeSession>();
  /** In-flight starts, so two parallel tool calls under one key open ONE session. */
  const starting = new Map<string, Promise<CodeSession>>();

  const wants = options.wants;
  const wantNames = wants === undefined ? [] : Object.keys(wants);

  const tool = defineTool<{ code: string }, string>({
    name,
    description: options.description ?? describe(scope, language, wants),
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            `${language} source to execute. Print what you want back — stdout is the result. ` +
            'Compute over big data here rather than asking for it to be pasted back to you.',
        },
        // One string property per declared artifact argument. `assertToolWants`
        // requires the property to exist and to be a string — the model passes
        // the TICKET, never the bytes — so composing them here is what makes
        // the declaration usable rather than merely legal.
        ...Object.fromEntries(
          wantNames.map((argName) => [
            argName,
            {
              type: 'string',
              description:
                `The art_… ref of the ${wants?.[argName] ?? 'artifact'} to work on. Its data ` +
                `is written into this session as a file; the path is under '${argName}' in ` +
                `the ${STAGED_INPUTS_ENV} environment variable. Pass the ref, never the data.`,
            },
          ]),
        ),
      },
      required: ['code'],
    },
    ...(options.checkIn !== undefined && { checkIn: options.checkIn }),
    ...(options.needs && { needs: options.needs }),
    ...(wants !== undefined && { wants }),
    execute: async (args, ctx): Promise<string> => {
      const key = requireKey(ctx, scope, name);
      const session = await acquire(key, ctx);
      // Staging happens BEFORE the code runs and after the framework resolved
      // every declared ref — `args[argName]` is the DATA by now, not the
      // ticket. A declared argument the model did not pass is simply not
      // staged: an optional artifact input is the model choosing not to use
      // one, exactly as `resolveToolWants` treats it.
      const stagedNames = await stageDeclaredInputs(session, args, wantNames, name, ctx);
      const result = await session.execute({
        code: args.code,
        language,
        ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
        ...(ctx.signal && { signal: ctx.signal }),
      });
      const minted = await mintProducedFiles(result, ctx);
      return render(result, maxOutputChars, minted, stagedNames, wantNames);
    },
  });

  /** Get the session for `key`, opening one if this is the first call. */
  const acquire = async (key: string, ctx: ToolExecutionContext): Promise<CodeSession> => {
    const live = sessions.get(key);
    if (live) {
      // A reuse re-registers under the SAME (tool, scope, key). The tier keeps
      // the FIRST cleanup — it is the one holding this handle — and treats the
      // repeat as a touch, which is how the idle sweep and the LRU bound learn
      // this session is still in use. Registering only once would make a busy
      // session look as cold as an abandoned one.
      register(key, live, ctx);
      return live;
    }
    // Two parallel tool calls in one iteration must not open two sandboxes.
    const inFlight = starting.get(key);
    if (inFlight) return inFlight;
    const opening = options.runner
      .start({ key, language, ...(ctx.signal && { signal: ctx.signal }) })
      .then((opened) => {
        sessions.set(key, opened);
        register(key, opened, ctx);
        return opened;
      })
      .finally(() => {
        starting.delete(key);
      });
    starting.set(key, opening);
    return opening;
  };

  const register = (key: string, session: CodeSession, ctx: ToolExecutionContext): void => {
    ctx.onTeardown?.(
      async () => {
        // Drop the entry FIRST: if `stop()` throws, the map must not keep
        // handing out a session the runtime has already given up on.
        sessions.delete(key);
        await session.stop();
      },
      { scope, key, runnerId: options.runner.id, label: language },
    );
  };

  // The live map rides the Tool under a registry symbol — see TOOL_SESSIONS.
  return { ...tool, [TOOL_SESSIONS]: sessions };
}

/**
 * Derive the isolation key, or REFUSE by name.
 *
 * The three refusals are the security surface of this tool, so each says what
 * is missing, why it matters, and the one-line fix. None of them degrades
 * quietly: a fallback to a wider key is the cross-binding bug, and a fallback
 * to a narrower one silently multiplies latency and cost.
 */
function requireKey(ctx: ToolExecutionContext, scope: CodeRunnerToolScope, name: string): string {
  const supported = ctx.teardownScopes;
  if (supported !== undefined && !supported.includes(scope)) {
    throw new Error(
      `${name}: this tool holds a '${scope}'-scoped code session, and the door it is running ` +
        `behind honours ${supported.length === 0 ? 'no teardown scopes' : supported.join(', ')}. ` +
        'A session nothing will ever close is a sandbox left running. Either run this tool ' +
        `inside an Agent, or build it with scope: '${supported[0] ?? 'call'}'.`,
    );
  }
  const key = toolSessionKey(ctx, scope);
  if (key) return key;
  if (scope === 'session') {
    throw new Error(
      `${name}: scope 'session' needs a hosting session, and this run has no sessionId. ` +
        'Pass one — `agent.run({ message, sessionId })`, which `standingAgent` does from ' +
        "`HostRequest.sessionId` — or build this tool with scope: 'run'. It is not silently " +
        'narrowed, because a session-scoped interpreter and a run-scoped one differ by about ' +
        '30x in start-up cost, and by everything in what persists between turns.',
    );
  }
  throw new Error(
    `${name}: scope 'run' needs a run, and this call has no runId — it is being served ` +
      'outside an Agent (over `mcpServe`, or from a script). A served call is one call, not a ' +
      "turn, so nothing would ever end the session. Build this tool with scope: 'call' for " +
      'that door.',
  );
}

/** The description the model reads when the caller did not write one. */
function describe(scope: CodeRunnerToolScope, language: string, wants?: ToolWants): string {
  const persistence =
    scope === 'call'
      ? 'Each call runs in a fresh environment — nothing carries over, so include everything you need.'
      : scope === 'run'
      ? 'State persists across calls within this turn: variables and files you create stay available.'
      : 'State persists across the whole conversation: variables and files you create stay available in later turns.';
  return (
    `Execute ${language} code and return its output. ${persistence} ` +
    'Use this to COMPUTE over data rather than asking for the data itself — fetch, filter, ' +
    'aggregate and print the answer, so a large result never has to travel through this ' +
    'conversation. Print what you want to see; stdout is what you get back.' +
    stagingClause(language, wants)
  );
}

/**
 * The staging half of the description — added ONLY when the tool declares
 * artifact arguments, so a tool without them reads exactly as it always did.
 *
 * It names the mechanism rather than the paths, because the paths do not exist
 * until the session does: one environment variable, one JSON object, and a
 * one-line example in this tool's own language. A model that reads this needs
 * nothing else to use a staged file.
 */
function stagingClause(language: string, wants: ToolWants | undefined): string {
  if (wants === undefined) return '';
  const names = Object.keys(wants);
  const first = names[0] ?? 'input';
  const example = language.toLowerCase().startsWith('py')
    ? `import json, os; path = json.loads(os.environ['${STAGED_INPUTS_ENV}'])['${first}']`
    : `const path = JSON.parse(process.env.${STAGED_INPUTS_ENV})['${first}']`;
  return (
    ` Pass artifact refs as ${names.map((n) => `'${n}'`).join(', ')} and their data is written ` +
    `into this session as files BEFORE your code runs — never paste the data into the code. ` +
    `The file paths are in the ${STAGED_INPUTS_ENV} environment variable, a JSON object keyed ` +
    `by argument name: ${example}. Open that path and read it.`
  );
}

/**
 * Stage every declared artifact argument the model actually passed.
 *
 * ── Refused rather than degraded ────────────────────────────────────────────
 * A runner whose sessions cannot stage refuses BY NAME, naming both the runner
 * and the tool. Running the code anyway would leave the model reading a file
 * that is not there — an error it would try to debug, in a session that never
 * had the data, for a reason nothing in the conversation could reveal.
 *
 * @returns the argument names that were staged, for the result's own preamble.
 */
async function stageDeclaredInputs(
  session: CodeSession,
  args: Record<string, unknown>,
  wantNames: readonly string[],
  toolName: string,
  ctx: ToolExecutionContext,
): Promise<readonly string[]> {
  if (wantNames.length === 0) return [];
  const inputs: CodeInput[] = [];
  for (const argName of wantNames) {
    const resolved = args[argName];
    // Absent = the model chose not to pass this one. Nothing to stage, and
    // nothing to complain about: `resolveToolWants` treats an absent optional
    // argument the same way.
    if (resolved === undefined) continue;
    const meta = ctx.wanted?.[argName];
    inputs.push({
      // The manifest KEY is the argument name the model spoke — which is what
      // the description told it to look up. The FILE gets an extension derived
      // from the artifact's own stated media type, so an interpreter's loader
      // sees something familiar; the two are separate fields precisely so they
      // cannot drift.
      name: argName,
      fileName: fileNameFor(argName, meta?.mediaType),
      data: bytesOf(resolved),
      ...(meta?.mediaType !== undefined && { mediaType: meta.mediaType }),
    });
  }
  if (inputs.length === 0) return [];
  if (!canStageCodeInputs(session)) {
    throw new Error(
      `${toolName}: this tool declares artifact arguments (${wantNames.join(', ')}), and the ` +
        `code runner behind it cannot put data into its own session — its CodeSession has no ` +
        `stageInputs. The code would run against files that are not there, so it is not run. ` +
        `Use a runner that stages (localCodeRunner does), or drop \`wants\` and have the model ` +
        `fetch the data inside the code.`,
    );
  }
  const landed = await session.stageInputs(inputs);
  // Keyed back by the ARGUMENT name the model spoke, which is what the
  // manifest promises and what the description told it to look up.
  return landed.map((entry) => entry.name);
}

/** `dataset` + `text/csv` → `dataset.csv`. The extension comes from the meta's
 *  own stated media type, never sniffed — and an unknown type gets no
 *  extension rather than a guessed one. */
function fileNameFor(argName: string, mediaType: string | undefined): string {
  const ext = mediaType === undefined ? undefined : EXT_BY_MEDIA_TYPE[mediaType.toLowerCase()];
  return ext === undefined ? argName : `${argName}.${ext}`;
}

/** The reverse of MEDIA_TYPE_BY_EXT, for the types a staged payload plausibly
 *  carries. Absent means "no extension", which is honest. */
const EXT_BY_MEDIA_TYPE: Readonly<Record<string, string>> = {
  'application/json': 'json',
  'text/csv': 'csv',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/html': 'html',
  'image/svg+xml': 'svg',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

/**
 * The resolved payload as bytes for the file.
 *
 * Strings and binary are written verbatim; anything else is JSON, which is
 * what the store measured and digested it as. A value JSON cannot carry never
 * got into the store in the first place — `canonicalPayloadBytes` refuses it
 * at `put` — so there is no lossy branch here to hide.
 */
function bytesOf(resolved: unknown): string | Uint8Array {
  if (typeof resolved === 'string' || resolved instanceof Uint8Array) return resolved;
  return JSON.stringify(resolved) ?? 'null';
}

// ── Mint-on-output (9.22.0): the store behind `CodeResult.artifacts` ────────
//
// When a store is attached, every file the run handed back IN-BAND
// (`artifact.data` — see `CodeResult`) is checked into the artifact store
// under the run's own scope, and the rendered line names the ref, so the
// model can route the file — pass it to a `wants`-tool, `present` it —
// instead of asking for its contents. Entries without `data` stay
// described-only: minting needs bytes, and a described file whose bytes never
// left the sandbox is a fact, not a failure. Zero-cost: no store, or no
// in-band files, and not one line here runs.
//
// STAGING-IN ARRIVED IN 9.26.0, through the door 9.22.0 said it was waiting
// for. The note here used to read: "pushing a resolved artifact payload
// through `execute` would mean inlining megabytes into an argv (`python3 -c …`
// has OS argument limits) in language-specific quoting — declared input refs
// wait for a session file-write verb on the port." That verb is
// `CodeSession.stageInputs` (optional, feature-detected, absent on backends
// that cannot write into their own session), and `wants` on this tool is what
// uses it. Data now flows BOTH ways without entering the window: refs in as
// staged files, produced files out as refs.

/** `report.csv` → `file/csv`; extensionless → `file`. The kind vocabulary a
 *  code-produced file is minted under — derived from the producer's OWN
 *  stated name, deterministically, never sniffed from content. */
function kindOfFile(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return ext.length > 0 ? `file/${ext}` : 'file';
}

/** The honest well-known-extension table. Unknown extensions fall back on
 *  what the payload's own JS shape proves: text for a string, opaque bytes
 *  for a Uint8Array. */
const MEDIA_TYPE_BY_EXT: Readonly<Record<string, string>> = {
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
};

function mediaTypeOfFile(name: string, data: string | Uint8Array): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return (
    MEDIA_TYPE_BY_EXT[ext] ?? (typeof data === 'string' ? 'text/plain' : 'application/octet-stream')
  );
}

/** What one entry's mint came to — a ref, or the stated failure. */
type FileMintOutcome = { readonly ref: string } | { readonly failed: string };

/**
 * The refs this call's declared artifact INPUTS resolved to — the parents of
 * anything the code produced from them.
 *
 * The framework already redeemed them (that is what `ctx.wanted` is), so the
 * lineage is a FACT it holds, not an inference: every file this execution
 * handed back was computed in a session whose only declared inputs were these.
 * Stamping them automatically is what makes the derive step of the claim-check
 * journey actually carry lineage — a consumer folding `head()` over
 * `parentRefs` walks from the chart back to the dataset without the tool
 * author having to remember.
 *
 * Deduplicated, because two arguments may legitimately name one artifact and
 * an object store's metadata budget counts every ref.
 */
function parentRefsOf(ctx: ToolExecutionContext): readonly string[] {
  const wanted = ctx.wanted;
  if (wanted === undefined) return [];
  return [...new Set(Object.values(wanted).map((meta) => meta.ref))];
}

/**
 * Mint every in-band file into the store. Per-entry failures are CONTAINED
 * and stated in the rendered line (the code ran; a full store must not turn
 * its success into a throw) — the store's own `artifacts.refused` event has
 * already put the reason on the record.
 *
 * Lineage rides every mint: the resolved input refs go on as `parentRefs`,
 * validated at mint like any other derivation fact. That validation is why
 * this is not silently degraded to "drop the parents if they no longer
 * resolve" — a parent that expired mid-call means the lineage this artifact
 * would claim is not true, and a claim-check store that mints an unprovable
 * derivation is exactly the lie `UnknownParentRefError` exists to refuse. The
 * refusal lands per entry, stated in the line the model reads.
 */
async function mintProducedFiles(
  result: CodeResult,
  ctx: ToolExecutionContext,
): Promise<ReadonlyMap<string, FileMintOutcome>> {
  const outcomes = new Map<string, FileMintOutcome>();
  if (!ctx.hasArtifacts) return outcomes;
  const parentRefs = parentRefsOf(ctx);
  for (const artifact of result.artifacts ?? []) {
    if (artifact.data === undefined) continue;
    try {
      const meta = await ctx.artifacts.put({
        kind: kindOfFile(artifact.name),
        mediaType: artifact.mediaType ?? mediaTypeOfFile(artifact.name, artifact.data),
        data: artifact.data,
        label: artifact.name,
        // Absent when this call resolved no refs — an empty list would read
        // as "derived from nothing", which is a different statement from
        // "nothing said where this came from".
        ...(parentRefs.length > 0 && { parentRefs }),
      });
      outcomes.set(artifact.name, { ref: meta.ref });
    } catch (err) {
      outcomes.set(artifact.name, {
        failed: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}

/**
 * Render a `CodeResult` for the model.
 *
 * TRUNCATION IS ALWAYS STATED. A slice the model cannot see is a silent
 * success: it goes on to reason over a fragment of a table believing it has the
 * table. The marker is deliberately plain text in the result body, not
 * metadata, because the result body is the only channel the model reads.
 */
function render(
  result: CodeResult,
  maxOutputChars: number,
  minted?: ReadonlyMap<string, FileMintOutcome>,
  staged: readonly string[] = [],
  declared: readonly string[] = [],
): string {
  const parts: string[] = [];
  // What was put IN, stated before what came out. A model whose code failed to
  // find a file needs to know the file was staged and under which name — the
  // alternative is debugging an absence that never happened.
  if (staged.length > 0) {
    parts.push(
      `[staged into this session before your code ran: ${staged.join(', ')} — ` +
        `paths are in ${STAGED_INPUTS_ENV}]`,
    );
  } else if (declared.length > 0) {
    // The OTHER half of the same law, and the one an absent statement makes
    // expensive: this tool declares artifact arguments, the model passed
    // none, so the session holds no staged data and the manifest variable is
    // not set at all. Optional inputs are legitimate (a call that needs no
    // stored data is a real call), but a model whose code just failed on a
    // missing environment variable would otherwise debug an absence nothing
    // in the conversation explains.
    parts.push(
      `[no artifact inputs were passed on this call, so nothing was staged and ` +
        `${STAGED_INPUTS_ENV} is not set. To work on stored data, pass its art_… ref as ` +
        `${declared.map((n) => `'${n}'`).join(' / ')}.]`,
    );
  }
  const stdout = clip(result.stdout, maxOutputChars, result.truncated?.stdout === true);
  const stderr = clip(result.stderr, maxOutputChars, result.truncated?.stderr === true);
  if (stdout.text.length > 0) parts.push(stdout.text);
  if (stderr.text.length > 0) parts.push(`stderr:\n${stderr.text}`);
  if (!result.ok) {
    parts.push(
      `[exit ${result.exitCode ?? 'non-zero'}] the code did not complete successfully — read ` +
        'stderr above and fix it.',
    );
  }
  for (const artifact of result.artifacts ?? []) {
    const outcome = minted?.get(artifact.name);
    // A ref the RUNNER already stamped is honored; one this tool minted wins
    // freshness (both name the same bytes when both exist).
    const ref = outcome !== undefined && 'ref' in outcome ? outcome.ref : artifact.ref;
    parts.push(
      `[artifact: ${artifact.name}, ${artifact.bytes} bytes${
        artifact.uri ? `, ${artifact.uri}` : ''
      }${
        ref !== undefined
          ? `, stored as ${ref} (${kindOfFile(artifact.name)}) — route this ref: pass it to a ` +
            `tool that wants it, or present it`
          : ''
      }${
        outcome !== undefined && 'failed' in outcome
          ? `, artifact-store mint failed: ${outcome.failed}`
          : ''
      }]`,
    );
  }
  if (parts.length === 0) {
    // "Nothing was printed" and "this returned nothing" are different facts and
    // only one of them tells the model what to do next.
    parts.push('(the code ran and printed nothing — print the value you want returned)');
  }
  return parts.join('\n');
}

/** Clip to the tool's ceiling, and SAY SO — including a cut the runner made. */
function clip(text: string, max: number, alreadyCutUpstream: boolean): { text: string } {
  const cutHere = text.length > max;
  const shown = cutHere ? text.slice(0, max) : text;
  if (!cutHere && !alreadyCutUpstream) return { text: shown };
  const of = cutHere ? text.length : undefined;
  return {
    text:
      `${shown}\n[truncated: showing ${shown.length}${of !== undefined ? ` of ${of}` : ''} ` +
      'characters. Re-run printing a summary, a slice, or an aggregate instead of the whole ' +
      'value.]',
  };
}
