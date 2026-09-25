/**
 * "Show me" — the leaf values behind an account's pointers, allow-listed.
 *
 * The server hands `{ account, shown }` to a reader who may not be an engineer,
 * so what leaves is decided HERE, by one list: a pointer whose event type and
 * path are on `SHOW_ME_ALLOW_LIST` shows its leaf; anything else says
 * `not-shown-here`. The deny list (`DENIED_SEGMENTS`) wins over the allow-list if
 * a future pointer ever names one: injection bodies (skill bodies, app
 * prompts), tool arguments, tool results (only a derived `{ rows, at }` count
 * leaves), a decision's `why` (it can carry a person's note), `resumeInput`,
 * every state key but `turnNumber` and `userMessage`, history content, and any
 * event of another run.
 *
 * Bounds: a leaf over 2,048 serialized characters is `too-large`; the whole map
 * stops at 64 KB — no later pointer adds a key; one `#more` entry says the rest
 * is withheld as `too-large`.
 */

import { eventBelongsToRun } from '../../bridge/eventMeta.js';
import { pointerKey } from './render.js';
import type {
  AnswerAccount,
  AnswerAccountDeclarations,
  AnswerAccountShownLeaf,
  AccountFact,
  RecordPointer,
  Sentence,
} from './types.js';
import { isRecord } from './view.js';

export const MAX_LEAF_CHARS = 2048;
export const MAX_SHOWN_BYTES = 64 * 1024;

/**
 * The one key added when the map reaches `MAX_SHOWN_BYTES`: every pointer with
 * no key of its own is then withheld as `too-large`. Never a `pointerKey` (those
 * start with a pointer kind), so it cannot collide with one.
 */
export const SHOWN_MORE_KEY = '#more';
const SENTINEL_BYTES = JSON.stringify({ [SHOWN_MORE_KEY]: { withheld: 'too-large' } }).length + 2;

const PREFIX = 'agentfootprint.';

/** Brace sets expand: `/{a,b}/*` → `/a/*`, `/b/*`. `*` matches one array index. */
function expand(pattern: string): string[] {
  const m = /\{([^}]+)\}/.exec(pattern);
  if (!m) return [pattern];
  return (m[1] ?? '').split(',').flatMap((alt) => expand(pattern.replace(m[0], alt)));
}

const list = (...patterns: string[]): readonly string[] => patterns.flatMap(expand);

/**
 * Event type (without the `agentfootprint.` prefix) → the payload leaves "show me" may show.
 * A call id (`toolCallId`) is an identity the account's facts carry, never content.
 */
export const SHOW_ME_ALLOW_LIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'agent.run_configured': list(
    '/llm/model',
    '/skillGraph/{routing,continuity,scorer}',
    '/evidenceGate',
    '/window',
  ),
  'agent.turn_start': list('/userPrompt'),
  'agent.turn_end': list('/finalContent'),
  'middleware.decision': list('/{middleware,moment,outcome,changed,toolName,toolCallId}'),
  'permission.check': list('/{target,result,policyRuleId}'),
  'checkin.decision': list('/{approved,toolName,toolCallId}'),
  'skill.turn_routed': list(
    '/{by,from,to,scorer,decisive}',
    '/scores/*/{id,score}',
    '/policy/{nearTieMargin,menuSize,floor}',
    // R3-S2: the matched words of the PERSON's own message (≤ 80 chars) and the decider's model.
    '/witness/text',
    '/decider/model',
  ),
  'skill.graph_declared': list('/nodes/*/{id,title}'),
  'skill.rejected': list('/requestedId'),
  'context.injected': list('/{slot,source,sourceId}'),
  'context.slot_composed': list('/{slot,iteration}'),
  'tools.absent': list(
    '/{toolName,toolCallId,lookedFor,tryInstead}',
    '/{checked,notChecked,cannotCover}/*/{what,why,short,kind}',
    '/tryInsteadTool/tool',
  ),
  'tools.coverage_declared': list(
    '/{toolName,toolCallId}',
    '/{checked,notChecked,cannotCover}/*/{what,why,short,kind}',
  ),
  'stream.tool_start': list('/{toolName,toolCallId}'),
  'stream.tool_end': list(
    '/{toolCallId,status,error,notExecuted}',
    '/notDispatched/pausedCall/{toolCallId,toolName}',
    '#emptiness',
  ),
  'findings.declared': list('/{toolName,toolCallId,basis,expect}'),
  'agent.evidence_checked': list(
    '/{posture,candidates,lookedUp,action,afterRevision,evidenceTruncated}',
    '/unsupported/*/value',
  ),
});

/** Derived leaves any event of the run may show. */
// The conversation id is NOT shown: in an `open` door it is the conversation's only key, and an
// account is what people share (a PDF, a pasted link). The run id is a per-run name, not a key.
const ANY_EVENT = ['#meta/runId'];
/** The two state keys the account reads for a sentence (R3-S2 adds `userMessage`). */
export const SHOWN_STATE_KEYS: readonly string[] = ['turnNumber', 'userMessage'];
const HISTORY_PATHS = ['/toolName', '/toolCallId', '#emptiness'];

/** Leaves that are never shown, whatever list names them — per event type. */
const DENIED: Readonly<Record<string, readonly string[]>> = {
  'context.injected': ['rawContent', 'contentSummary', 'reason'],
  'stream.tool_start': ['args'],
  'stream.tool_end': ['result', 'modelResult'],
  'middleware.decision': ['why'],
  'pause.resume': ['resumeInput'],
};

const segments = (path: string): string[] =>
  path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));

const shape = (path: string): string =>
  path.startsWith('#')
    ? path
    : `/${segments(path)
        .map((s) => (/^\d+$/.test(s) ? '*' : s))
        .join('/')}`;

/**
 * Is this pointer's leaf one the allow-list admits (and the deny list does not
 * refuse)? The DENY list is asked FIRST and wins: a future edit that puts a
 * denied leaf on the allow-list still shows nothing (`allowList` is a parameter
 * only so a test can pin exactly that).
 */
export function isShowable(
  p: RecordPointer,
  allowList: Readonly<Record<string, readonly string[]>> = SHOW_ME_ALLOW_LIST,
): boolean {
  switch (p.kind) {
    case 'event': {
      const type = p.type.startsWith(PREFIX) ? p.type.slice(PREFIX.length) : p.type;
      const denied = DENIED[type] ?? [];
      if (!p.path.startsWith('#') && denied.includes(segments(p.path)[0] ?? '')) return false;
      if (ANY_EVENT.includes(p.path)) return true;
      return (allowList[type] ?? []).includes(shape(p.path));
    }
    case 'state':
      return SHOWN_STATE_KEYS.includes(p.key) && p.path === '';
    case 'history':
      return HISTORY_PATHS.includes(p.path);
    case 'declaration':
      return true;
  }
}

function resolvePointer(value: unknown, path: string): unknown {
  let cur = value;
  for (const seg of segments(path)) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isRecord(cur)) cur = cur[seg];
    else return undefined;
  }
  return cur;
}

function leaf(value: unknown): AnswerAccountShownLeaf {
  if (value === undefined) return { withheld: 'not-found' };
  if (value !== null && typeof value === 'object') return { withheld: 'not-shown-here' };
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean' &&
    value !== null
  ) {
    return { withheld: 'not-shown-here' };
  }
  if (JSON.stringify(value).length > MAX_LEAF_CHARS) return { withheld: 'too-large' };
  return { value };
}

function declarationValue(declarations: AnswerAccountDeclarations, field: string): unknown {
  const [head, ...rest] = field.split('.');
  if (head === 'skills' && rest.length >= 2)
    return declarations.skills?.[rest.slice(0, -1).join('.')]?.label;
  if (head === 'tools' && rest.length >= 2)
    return declarations.tools?.[rest.slice(0, -1).join('.')]?.rowsAt;
  if (head === 'routing') return declarations.routing?.appDecides;
  return undefined;
}

/** Every pointer the account uses, in first-use order. */
export function accountPointers(account: AnswerAccount): RecordPointer[] {
  const out: RecordPointer[] = [];
  const fromSentence = (s: Sentence | undefined) => {
    if (s === undefined) return;
    out.push(...s.pointers);
  };
  const fromFact = (f: AccountFact<unknown>) => out.push(...f.pointers);
  fromFact(account.run);
  fromFact(account.question);
  fromFact(account.answer);
  for (const row of account.rows) {
    fromSentence(row.heading);
    row.lines.forEach(fromSentence);
    fromSentence(row.more);
  }
  account.signals.forEach((s) => fromSentence(s.sentence));
  account.unreachable.forEach((u) => fromSentence(u.sentence));
  fromSentence(account.summary.sentence);
  const f = account.facts;
  [
    f.routing.configured,
    f.routing.verdict,
    f.routing.scores,
    f.routing.delivered,
    f.evidence,
    f.limitsBlock,
  ].forEach((x) => fromFact(x as AccountFact<unknown>));
  f.calls.forEach((c) => out.push(...c.pointers));
  f.inView.forEach((c) => out.push(...c.pointers));
  return out;
}

function emptinessLeaf(
  account: AnswerAccount,
  declarations: AnswerAccountDeclarations,
  toolCallId: unknown,
  where: 'event' | 'history',
): AnswerAccountShownLeaf {
  const call =
    where === 'event'
      ? account.facts.calls.find((c) => c.toolCallId === toolCallId)
      : account.facts.inView.find((c) => c.toolCallId === toolCallId);
  if (call === undefined || call.rows === undefined) return { withheld: 'not-shown-here' };
  const rowsAt =
    call.emptinessSource === 'app' ? declarations.tools?.[call.toolName]?.rowsAt : undefined;
  const base =
    where === 'history'
      ? '/content'
      : 'view' in call && call.view !== undefined && call.view !== 'result'
      ? '/modelResult'
      : '/result';
  return { rows: call.rows, at: rowsAt !== undefined ? `${base}/${rowsAt}` : base };
}

/**
 * The leaf map for an account's pointers — one entry per distinct pointer, keyed
 * by `pointerKey`. `recording` is the same recording the account was built from.
 */
export function showLeaves(
  account: AnswerAccount,
  recording: { readonly events?: unknown; readonly snapshot?: unknown },
  declarations: AnswerAccountDeclarations = {},
): Record<string, AnswerAccountShownLeaf> {
  const events = Array.isArray(recording.events) ? recording.events : [];
  const snapshot = isRecord(recording.snapshot) ? recording.snapshot : {};
  const state = isRecord(snapshot.sharedState) ? snapshot.sharedState : {};
  const history = Array.isArray(state.history) ? state.history : [];
  const run = account.run.value;
  const shown: Record<string, AnswerAccountShownLeaf> = {};
  let bytes = 0;
  // The run's session, read from the recording itself (the account never carries it): it
  // decides whether an event that names no run is this run's.
  const configured = events.find(
    (e: unknown) =>
      isRecord(e) &&
      e.type === `${PREFIX}agent.run_configured` &&
      isRecord(e.meta) &&
      e.meta.runId === run?.runId,
  ) as { meta: Record<string, unknown> } | undefined;
  const session =
    typeof configured?.meta.sessionId === 'string' ? configured.meta.sessionId : undefined;
  for (const p of accountPointers(account)) {
    const key = pointerKey(p);
    if (key in shown) continue;
    let out: AnswerAccountShownLeaf;
    if (!isShowable(p)) {
      out = { withheld: 'not-shown-here' };
    } else if (p.kind === 'event') {
      const event: unknown = events[p.index];
      if (!isRecord(event) || event.type !== p.type || !isRecord(event.payload)) {
        out = { withheld: 'not-found' };
      } else {
        const meta = isRecord(event.meta) ? event.meta : {};
        const own =
          run === null ||
          eventBelongsToRun(
            {
              ...(typeof meta.runId === 'string' && { runId: meta.runId }),
              ...(typeof meta.sessionId === 'string' && { sessionId: meta.sessionId }),
            },
            {
              runId: run.runId,
              ...(session !== undefined && { sessionId: session }),
            } as Parameters<typeof eventBelongsToRun>[1],
          );
        if (!own) out = { withheld: 'foreign' };
        else if (p.path === '#emptiness')
          out = emptinessLeaf(account, declarations, event.payload.toolCallId, 'event');
        else if (p.path.startsWith('#meta/')) out = leaf(meta[p.path.slice('#meta/'.length)]);
        else out = leaf(resolvePointer(event.payload, p.path));
      }
    } else if (p.kind === 'state') {
      out = leaf(state[p.key]);
    } else if (p.kind === 'history') {
      const message: unknown = history[p.index];
      out = !isRecord(message)
        ? { withheld: 'not-found' }
        : p.path === '#emptiness'
        ? emptinessLeaf(account, declarations, message.toolCallId, 'history')
        : leaf(resolvePointer(message, p.path));
    } else {
      out = leaf(declarationValue(declarations, p.field));
    }
    const size = JSON.stringify(key).length + JSON.stringify(out).length + 2;
    if (bytes + size > MAX_SHOWN_BYTES - SENTINEL_BYTES) {
      // Past the cap nothing more is added — one sentinel says the rest is withheld.
      shown[SHOWN_MORE_KEY] = { withheld: 'too-large' };
      break;
    }
    bytes += size;
    shown[key] = out;
  }
  return shown;
}
