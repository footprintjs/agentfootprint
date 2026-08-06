/**
 * 34 — The coworker with the receipts: a runnable check-in demo.
 *
 * "OpenWorker-class agents check in; agentfootprint checks in WITH THE
 * RECEIPTS." This is that idea you can actually run.
 *
 * An AI coworker is handed one job — "draft the weekly status update and post
 * it to the team channel." It gathers the source notes, assembles a real
 * markdown status doc, saves it as a draft (a private, reversible action — no
 * gate), and then reaches for the one consequential, public, hard-to-unsend
 * action: posting to the channel. That tool declares `checkIn: 'always'`, so
 * the run PAUSES before it fires and hands a human the receipts:
 *
 *   WILL DO          — a plain-words claim of what the tool will do
 *   READ             — every piece of context the run consumed
 *   WHAT DROVE THIS  — which of that context drove this pick (ranked, zero LLM)
 *   TRAIL            — a compact run-so-far summary
 *
 * A person answers yes or no. On APPROVE the tool runs. On DECLINE the model
 * SEES the note ("declined by human: …") as the tool result and adapts in the
 * same loop — here it keeps the draft for you instead of posting. Every ask and
 * decision lands in a `CheckInRecorder` as a queryable audit trail.
 *
 * Run it:
 *   npm run example examples/features/34-checkin-coworker.ts               # interactive (a TTY prompts you)
 *   npm run example examples/features/34-checkin-coworker.ts -- --approve  # non-interactive approve
 *   npm run example examples/features/34-checkin-coworker.ts -- --decline  # non-interactive decline (watch it adapt)
 *   npm run example examples/features/34-checkin-coworker.ts -- --decline --note "not this week"
 *   npm run example examples/features/34-checkin-coworker.ts -- --live     # real Claude, only if ANTHROPIC_API_KEY is set
 *
 * The default provider is a deterministic $0 mock, so anyone can run this with
 * zero setup. Swap it for a real model with `--live` and NO other code changes.
 */

import {
  Agent,
  defineTool,
  isCheckInPause,
  checkInApproved,
  checkInDeclined,
  CheckInRecorder,
  type LLMProvider,
  type CheckInRequest,
  type CheckInDecision,
} from '../../src/index.js';
import { isCliEntry, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'features/34-checkin-coworker',
  title: 'The coworker with the receipts',
  group: 'features',
  description:
    'A runnable AI-coworker demo: it drafts a weekly status doc, then pauses for human consent before posting to the team channel. The check-in ask rides an evidence pack (willDo / read / drivers / trail) rendered as readable receipts, and the decision lands in an audit trail.',
  defaultInput: 'Draft the weekly status update and post it to the team channel.',
  providerSlots: ['default'],
  tags: ['feature', 'checkin', 'human-in-the-loop', 'consent', 'pause', 'demo'],
};

/** The one job the coworker is given. */
export const WORK_REQUEST =
  'Draft the weekly status update and post it to the team channel.';

// ─── The raw material: context "files" the coworker was handed ──────────
// In a real app these are docs, a wiki, prior tool output. Here they're
// constants so the demo is deterministic and runs for anyone with zero setup.

const CONTEXT_FILES: Readonly<Record<string, string>> = {
  'standup.md': [
    'Standup notes — week of Jul 21',
    '- Shipped: checkout redesign; export bug fix (#412)',
    '- In progress: billing migration (behind a flag)',
    '- Blocked: settings page waiting on a design review',
  ].join('\n'),
  'metrics.md': [
    'Metrics — week over week',
    '- Signups +12%',
    '- p95 latency 240ms (down from 310ms)',
    '- Error rate 0.4%',
  ].join('\n'),
  'incidents.md': [
    'Incidents',
    '- 1 SEV-3 Tuesday: search timeout, resolved in 40m',
    '- No SEV-1 / SEV-2',
  ].join('\n'),
};

const STATUS_TITLE = 'Weekly Status — week of Jul 21';

/**
 * Assemble the real deliverable — a markdown status doc — from the context.
 * Pure + deterministic: the mock model "produces" this, and it's also what a
 * real model would be asked to write.
 */
export function assembleStatusDoc(): string {
  return [
    `# ${STATUS_TITLE}`,
    '',
    '## Shipped',
    '- Checkout redesign',
    '- Export bug fix (#412)',
    '',
    '## In progress',
    '- Billing migration (behind a flag)',
    '',
    '## Metrics',
    '- Signups +12% WoW',
    '- p95 latency 240ms (down from 310ms)',
    '- Error rate 0.4%',
    '',
    '## Incidents',
    '- 1 SEV-3 (search timeout, resolved in 40m); no SEV-1/2',
    '',
    '## Blockers',
    '- Settings page — waiting on a design review',
  ].join('\n');
}

/** The concise, channel-appropriate summary the coworker wants to post. */
const POST_MESSAGE =
  'Weekly update — shipped the checkout redesign and export fix (#412); billing ' +
  'migration in progress; signups +12% WoW, p95 240ms, error rate 0.4%; one SEV-3 ' +
  '(search timeout) resolved in 40m. Full status doc saved as a draft.';

// ─── The tools: one safe, one consequential ─────────────────────────────
// A workspace sink lets the demo show what actually got saved / posted.

/** Side-effect sink so the demo can show the concrete outcome. */
export interface Workspace {
  readonly drafts: { title: string; body: string }[];
  readonly posts: { channel: string; message: string }[];
}

function buildTools(ws: Workspace) {
  // Reading internal notes: safe + reversible → no check-in.
  const readContext = defineTool<{ sources: string[] }, string>({
    name: 'read_context',
    description: 'Read this week’s source notes (standup, metrics, incidents)',
    inputSchema: {
      type: 'object',
      properties: { sources: { type: 'array', items: { type: 'string' } } },
      required: ['sources'],
    },
    execute: ({ sources }) =>
      (sources.length ? sources : Object.keys(CONTEXT_FILES))
        .map((s) => CONTEXT_FILES[s])
        .filter((c): c is string => Boolean(c))
        .join('\n\n'),
  });

  // Saving a draft is private + reversible → NO check-in. This is the contrast:
  // the coworker does real work without ever interrupting a human.
  const saveDraft = defineTool<{ title: string; body: string }, string>({
    name: 'save_draft',
    description: 'Save a draft document to the workspace (private, reversible)',
    inputSchema: {
      type: 'object',
      properties: { title: { type: 'string' }, body: { type: 'string' } },
      required: ['title', 'body'],
    },
    execute: ({ title, body }) => {
      ws.drafts.push({ title, body });
      return `saved draft "${title}" (${body.length} chars)`;
    },
  });

  // Posting to a channel is public + consequential + hard to unsend → ALWAYS
  // check in with a human first. `'always'` gates every call; a predicate
  // (e.g. only external channels) would gate selectively.
  const postToChannel = defineTool<{ channel: string; message: string }, string>({
    name: 'post_to_channel',
    description: 'Post a message to a team channel (visible to everyone)',
    inputSchema: {
      type: 'object',
      properties: { channel: { type: 'string' }, message: { type: 'string' } },
      required: ['channel', 'message'],
    },
    checkIn: 'always',
    execute: ({ channel, message }) => {
      ws.posts.push({ channel, message });
      return `posted to ${channel}`;
    },
  });

  return { readContext, saveDraft, postToChannel };
}

// ─── The deterministic mock: a realistic tool sequence ──────────────────
// A scripted stand-in for a real model. It's message-aware (it inspects the
// history), so it behaves identically across a FRESH-agent, cross-process
// resume — exactly what a real provider does. Swap it for `--live` and the
// script disappears; the check-in machinery is unchanged.

function turn(
  content: string,
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [],
): {
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  usage: { input: number; output: number };
  stopReason: string;
} {
  return {
    content,
    toolCalls,
    usage: { input: 120, output: 60 },
    stopReason: toolCalls.length ? 'tool_use' : 'stop',
  };
}

/** The scripted coworker: gather → draft → post (pause) → adapt-or-finish. */
export function coworkerScript(): LLMProvider {
  return {
    name: 'mock',
    complete: async (req) => {
      const toolResults = req.messages.filter((m) => m.role === 'tool');
      const done = new Set(toolResults.map((m) => m.toolName));
      const saveCount = toolResults.filter((m) => m.toolName === 'save_draft').length;
      const declined = toolResults.some((m) =>
        (m.content ?? '').toLowerCase().startsWith('declined by human'),
      );

      // 1) Gather the source notes.
      if (!done.has('read_context')) {
        return turn("Let me gather this week's updates from standup, metrics, and incidents.", [
          {
            id: 'c1',
            name: 'read_context',
            args: { sources: ['standup.md', 'metrics.md', 'incidents.md'] },
          },
        ]);
      }
      // 2) Assemble the deliverable and save a draft — no check-in (reversible).
      if (saveCount === 0) {
        return turn('Notes in hand. Assembling the weekly status doc and saving a draft.', [
          { id: 'c2', name: 'save_draft', args: { title: STATUS_TITLE, body: assembleStatusDoc() } },
        ]);
      }
      // 3) Post it to the team channel — consequential, so THIS trips the check-in.
      if (!done.has('post_to_channel')) {
        return turn('Draft saved. Posting the weekly update to #team-updates for the team.', [
          {
            id: 'c3',
            name: 'post_to_channel',
            args: { channel: '#team-updates', message: POST_MESSAGE },
          },
        ]);
      }
      // 4) The human declined the post → adapt: keep the draft, do NOT post.
      if (declined && saveCount < 2) {
        return turn(
          "Understood — I won't post it. Keeping the reviewed draft so you can post it yourself.",
          [
            {
              id: 'c4',
              name: 'save_draft',
              args: { title: `${STATUS_TITLE} (held for review)`, body: assembleStatusDoc() },
            },
          ],
        );
      }
      // 5) Wrap up.
      return turn(
        declined
          ? 'Draft is saved and ready for your review — I did not post anything.'
          : 'Posted the weekly update to #team-updates. Anything else?',
      );
    },
  };
}

// ─── Build the coworker ─────────────────────────────────────────────────

/**
 * The agent factory — one source of truth for the chart. Both the run and any
 * cross-process resume build a FRESH agent from this; only the JSON checkpoint
 * (and the decision) cross the boundary.
 */
export function buildCoworker(ws: Workspace, provider?: LLMProvider) {
  const { readContext, saveDraft, postToChannel } = buildTools(ws);
  return Agent.create({ provider: provider ?? coworkerScript(), model: 'mock' })
    .system(
      'You are a diligent teammate who ships the weekly status update. ' +
        'First gather the source notes, then assemble a clear markdown status doc. ' +
        'Save a draft before you post anything. ' +
        'Never post to a public channel without a human sign-off.',
    )
    .tool(readContext)
    .tool(saveDraft)
    .tool(postToChannel)
    // Configure the evidence pack. 'standard' (the default) fills all four
    // fields; 'minimal' ships only `willDo`; or pass your own assembler/scorer.
    .checkIn({ evidence: 'standard' })
    .maxIterations(8)
    .build();
}

// ─── The receipts renderer: THIS is the product ─────────────────────────
// Plain words, aligned columns, readable. Returns a string so it's testable
// and pipe-safe. Color is opt-in (a TTY without NO_COLOR); off otherwise.

const CONTENT_W = 68;

function ansi(on: boolean) {
  const wrap = (code: string) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return {
    dim: wrap('2'),
    bold: wrap('1'),
    cyan: wrap('36'),
    green: wrap('32'),
    red: wrap('31'),
    yellow: wrap('33'),
  };
}

/** Wrap `text` to `width`, hanging every wrapped line under `indent` spaces. */
function wrapUnder(text: string, indent: number, width = CONTENT_W): string[] {
  const pad = ' '.repeat(indent);
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const cand = line ? `${line} ${w}` : w;
    if (cand.length + indent > width && line) {
      lines.push(line);
      line = w;
    } else {
      line = cand;
    }
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : pad + l));
}

/** A `LABEL   value` row, wrapping the value under the label column. */
function field(label: string, value: string, c: ReturnType<typeof ansi>): string {
  const LABEL_W = 10;
  const head = c.dim(label.padEnd(LABEL_W));
  const [first, ...rest] = wrapUnder(value, LABEL_W);
  return [head + first, ...rest].join('\n');
}

function rule(title: string, c: ReturnType<typeof ansi>): string {
  const dash = '─';
  const label = title ? ` ${title} ` : '';
  const fill = dash.repeat(Math.max(0, CONTENT_W - label.length - 2));
  return c.dim(`${dash}${label}${fill}${dash}`);
}

/** Render one check-in ask as readable receipts. */
export function renderReceipts(req: CheckInRequest, opts: { color?: boolean } = {}): string {
  const c = ansi(opts.color ?? false);
  const ev = req.evidence;
  const out: string[] = [];

  out.push(rule('CHECK-IN', c));
  out.push('The coworker wants to run a ' + c.bold('consequential') + ' tool. Approve it?');
  out.push('');
  out.push(field('TOOL', c.bold(req.tool), c));
  if (req.intent) out.push(field('INTENT', c.dim(req.intent), c));
  out.push('');
  out.push(field('WILL DO', ev.willDo, c));

  if (ev.read && ev.read.length) {
    out.push('');
    out.push(c.dim('READ  ') + c.dim('(context the run consumed)'));
    for (const f of ev.read) {
      // First line: 2 gutter + 8 channel + 1 space = 11 cols before the summary.
      const [first, ...rest] = wrapUnder(f.summary, 11);
      out.push('  ' + c.cyan(f.channel.padEnd(8)) + ' ' + first);
      for (const r of rest) out.push(r);
    }
  }

  if (ev.drivers && ev.drivers.length) {
    out.push('');
    out.push(c.dim('WHAT DROVE THIS  ') + c.dim('(ranked; zero-LLM lexical scorer)'));
    ev.drivers.slice(0, 3).forEach((d, i) => {
      const head = `  ${i + 1}. ` + c.cyan(d.channel.padEnd(8)) + ' ' + c.yellow(d.score.toFixed(2)) + '  ';
      const [first, ...rest] = wrapUnder(d.text, head.replace(/\x1b\[[0-9;]*m/g, '').length);
      out.push(head + first);
      for (const r of rest) out.push(r);
    });
  }

  if (ev.trail) {
    out.push('');
    out.push(field('TRAIL', ev.trail.summary, c));
    const ran = ev.trail.toolCalls.map((t) => `${t.name} ${t.ok ? '✓' : '✗'}`).join(' · ');
    if (ran) out.push(' '.repeat(10) + c.dim(ran));
  }

  out.push(rule('', c));
  return out.join('\n');
}

/** Render the outcome after the human decides. */
export function renderOutcome(o: DemoOutcome, opts: { color?: boolean } = {}): string {
  const c = ansi(opts.color ?? false);
  const out: string[] = [];
  const d = o.decision;
  if (d?.approved) {
    out.push(c.green('✓ APPROVED') + c.dim(` by ${d.by}${d.note ? ` — "${d.note}"` : ''}`));
    const posted = o.workspace.posts[o.workspace.posts.length - 1];
    if (posted) out.push(c.dim(`  posted to ${posted.channel}`));
  } else if (d) {
    out.push(c.red('✗ DECLINED') + c.dim(` by ${d.by}${d.note ? ` — "${d.note}"` : ''}`));
    out.push(c.dim('  nothing was posted; the coworker adapted in-loop'));
  }
  out.push('');
  out.push(field('COWORKER', o.finalText, c));
  out.push('');
  out.push(c.dim('drafts saved: ') + o.workspace.drafts.map((x) => `"${x.title}"`).join(', '));
  out.push(c.dim('posts made:   ') + (o.workspace.posts.length ? o.workspace.posts.map((x) => x.channel).join(', ') : '(none)'));
  return out.join('\n');
}

/** Render the CheckInRecorder audit trail — asks + decisions with by/at/note. */
export function renderAudit(audit: CheckInRecorder, opts: { color?: boolean } = {}): string {
  const c = ansi(opts.color ?? false);
  const s = audit.getStats();
  const out: string[] = [];
  out.push(rule('AUDIT TRAIL (CheckInRecorder)', c));
  out.push(
    `  ${c.dim('asks')} ${s.requested}   ${c.green('approved')} ${s.approved}   ` +
      `${c.red('declined')} ${s.declined}   ${c.dim('pending')} ${s.pending}`,
  );
  for (const dec of audit.getDecisions()) {
    const verdict = dec.approved ? c.green('approved') : c.red('declined');
    out.push(
      `  · ${dec.toolName}  ${verdict}  ${c.dim(`by ${dec.by}`)}` +
        (dec.note ? c.dim(`  "${dec.note}"`) : ''),
    );
  }
  out.push(rule('', c));
  return out.join('\n');
}

// ─── The driver: run to the check-in, decide, finish ────────────────────

export interface DemoOutcome {
  /** True when the run paused for a check-in (the scripted flow always does). */
  readonly paused: boolean;
  /** The typed ask surfaced at the pause. */
  readonly request?: CheckInRequest;
  /** The decision the `decide` callback returned. */
  readonly decision?: CheckInDecision;
  /** The coworker's final message. */
  readonly finalText: string;
  /** What actually got saved / posted. */
  readonly workspace: Workspace;
  /** The captured audit trail. */
  readonly audit: CheckInRecorder;
}

/**
 * Run the coworker until the check-in, ask the caller's `decide` callback for a
 * verdict, then resume and finish. Tests pass a fixed decision; the CLI passes
 * an interactive prompt. Same machinery either way.
 */
export async function runDemo(opts: {
  readonly decide: (req: CheckInRequest) => CheckInDecision | Promise<CheckInDecision>;
  readonly provider?: LLMProvider;
}): Promise<DemoOutcome> {
  const ws: Workspace = { drafts: [], posts: [] };
  const audit = new CheckInRecorder();
  const agent = buildCoworker(ws, opts.provider);
  agent.attach(audit);

  const outcome = await agent.run({ message: WORK_REQUEST });
  if (!isCheckInPause(outcome)) {
    // The scripted flow always checks in; a real model might not.
    const finalText = typeof outcome === 'string' ? outcome : JSON.stringify(outcome);
    return { paused: false, finalText, workspace: ws, audit };
  }

  const request = outcome.checkIn;
  const decision = await opts.decide(request);
  const final = await agent.resume(outcome.checkpoint, decision);
  return {
    paused: true,
    request,
    decision,
    finalText: typeof final === 'string' ? final : JSON.stringify(final),
    workspace: ws,
    audit,
  };
}

// ─── CLI entry ──────────────────────────────────────────────────────────

interface Flags {
  approve: boolean;
  decline: boolean;
  note?: string;
  by: string;
  live: boolean;
  color: boolean;
}

function parseFlags(argv: string[]): Flags {
  const has = (f: string) => argv.includes(f);
  const val = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const noColor = has('--no-color') || Boolean(process.env.NO_COLOR);
  return {
    approve: has('--approve'),
    decline: has('--decline'),
    note: val('--note'),
    by: val('--by') ?? 'alice@ops',
    live: has('--live'),
    color: !noColor && Boolean(process.stdout.isTTY),
  };
}

/** Ask a person on stdin. Returns approve/decline; blank line = approve. */
async function promptHuman(flags: Flags): Promise<CheckInDecision> {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question('\nApprove this post? [Y]es / [n]o (add a reason): ')).trim();
    const decline = /^n/i.test(ans);
    if (decline) {
      const reason = ans.replace(/^n(o)?\b[\s:,-]*/i, '').trim() || undefined;
      return checkInDeclined({ by: flags.by, note: reason ?? 'declined at the console' });
    }
    return checkInApproved({ by: flags.by, ...(flags.note && { note: flags.note }) });
  } finally {
    rl.close();
  }
}

/** Resolve a provider for `--live` (real Claude) — presence-check the key only. */
async function resolveProvider(flags: Flags): Promise<LLMProvider | undefined> {
  if (!flags.live) return undefined;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('--live needs ANTHROPIC_API_KEY in the environment; falling back to the mock.\n');
    return undefined;
  }
  // Lazy import so the default mock path never loads the vendor SDK.
  const { anthropic } = await import('../../src/doors/providers.js');
  console.log('--live: using the real Claude provider.\n');
  return anthropic({ defaultModel: 'claude-sonnet-4-5-20250929' });
}

if (isCliEntry(import.meta.url)) {
  (async () => {
    const flags = parseFlags(process.argv.slice(2));
    const c = ansi(flags.color);
    const provider = await resolveProvider(flags);

    console.log(c.bold('agentfootprint') + c.dim(' · the coworker with the receipts'));
    console.log(c.dim('work request: ') + WORK_REQUEST + '\n');

    // How the human decides: an explicit flag, or the console when it's a TTY,
    // or a safe default (approve) for a non-interactive pipe so this stays
    // runnable headless with zero setup.
    const decide = async (req: CheckInRequest): Promise<CheckInDecision> => {
      console.log(renderReceipts(req, { color: flags.color }));
      if (flags.decline) return checkInDeclined({ by: flags.by, note: flags.note ?? 'not this week' });
      if (flags.approve) return checkInApproved({ by: flags.by, ...(flags.note && { note: flags.note }) });
      if (process.stdin.isTTY) return promptHuman(flags);
      console.log(c.dim('\n(no TTY and no --approve/--decline flag → auto-approving)'));
      return checkInApproved({ by: flags.by, note: 'auto-approved (non-interactive)' });
    };

    const outcome = await runDemo({ decide, provider });
    if (!outcome.paused) {
      console.log(c.yellow('Finished without a check-in.'));
      console.log(field('COWORKER', outcome.finalText, c));
      return;
    }
    console.log('\n' + renderOutcome(outcome, { color: flags.color }));
    console.log('\n' + renderAudit(outcome.audit, { color: flags.color }));
  })().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
