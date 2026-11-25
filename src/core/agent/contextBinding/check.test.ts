/**
 * The comparison and its three outcomes, on synthetic requests: refused inside
 * a signed open tool turn, recorded between turns, `unchecked` without a base.
 * Plus a seeded random walk over context edits whose oracle is a plain
 * re-statement of the rule over the requests themselves.
 *
 * Test type: unit / property (seeded).
 */
import { describe, expect, it } from 'vitest';
import type { LLMMessage, LLMResponse, LLMToolSchema } from '../../../provider-contract/types.js';
import { ContextChangedError } from '../../../thinking/contextChange.js';
import {
  checkContextBinding,
  MAX_BASELINES,
  MAX_CONTEXT_CHANGES,
  rememberContextBaseline,
} from './check.js';
import type { ContextBaselineHolder } from './check.js';
import type { RequestContext, SystemPiece } from './composition.js';
import type { CheckedBinding } from './check.js';

const MODEL = 'claude-haiku-5-5';
const BOUND: CheckedBinding = { binding: 'bound', by: 'provider', family: MODEL };
const bindingOf = (model: string) =>
  model === MODEL || model === 'claude-haiku-5-5-20261001'
    ? BOUND
    : model === 'claude-haiku-4-5'
    ? ({ binding: 'unbound', by: 'provider', family: model } as const)
    : model === 'claude-opus-5-5'
    ? ({ binding: 'bound', by: 'provider', family: model } as const)
    : ({ binding: 'unknown', by: 'provider' } as const);
const NAMES = { binding: 'bound', by: 'provider' } as const;

const base: SystemPiece = { source: 'base', rawContent: 'You diagnose.', contentHash: 'b1' };
const skill: SystemPiece = {
  source: 'skill',
  sourceId: 'smb-triage',
  rawContent: 'SMB TRIAGE',
  contentHash: 's1',
};
const tool = (name: string, description = `${name} tool`): LLMToolSchema => ({
  name,
  description,
  inputSchema: { type: 'object' },
});

const user: LLMMessage = { role: 'user', content: 'Why is the finance share slow?' };

function signedAssistant(
  id: string,
  stopReason: 'tool_use' | 'end_turn',
  writer: string = MODEL,
): LLMMessage {
  return {
    role: 'assistant',
    content: stopReason === 'end_turn' ? 'done' : '',
    ...(stopReason === 'tool_use' && {
      toolCalls: [{ id: `call-${id}`, name: 'lookup', args: {} }],
    }),
    thinkingBlocks: [{ type: 'thinking', content: 'reasoning', signature: `sig-${id}` }],
    replay: {
      version: 1,
      protocol: 'anthropic-messages',
      id,
      layout: [{ type: 'thinking', index: 0 }],
      stopReason,
      contentDigest: `digest-${id}`,
      binding: {
        model: writer,
        salt: id,
        system: 's',
        tools: 't',
        messages: 'm',
        priorThinking: [],
      },
    },
  };
}

const result = (id: string): LLMMessage => ({
  role: 'tool',
  content: 'value',
  toolCallId: `call-${id}`,
});

function response(
  id: string,
  stopReason: 'tool_use' | 'end_turn',
  writer: string = MODEL,
): LLMResponse {
  const message = signedAssistant(id, stopReason, writer);
  return {
    content: message.content,
    toolCalls: [],
    usage: { input: 1, output: 1 },
    stopReason,
    replay: message.replay,
  };
}

const request = (over: Partial<RequestContext> = {}): RequestContext => ({
  systemText: (over.systemPieces ?? [base]).map((p) => p.rawContent).join('\n'),
  systemPieces: [base],
  tools: [tool('lookup'), tool('read_skill')],
  wire: [user],
  ...over,
});

function check(holder: ContextBaselineHolder, r: RequestContext) {
  return checkContextBinding(holder, {
    ...r,
    provider: 'anthropic',
    model: MODEL,
    binding: BOUND,
    bindingOf,
  });
}

/** One accepted signed response to `first`, then `next` checked against it. */
function after(
  first: RequestContext,
  stop: 'tool_use' | 'end_turn',
  next: (wire: LLMMessage[]) => RequestContext,
) {
  const holder: ContextBaselineHolder = {};
  rememberContextBaseline(holder, first, response('r1', stop));
  const wire = [
    ...first.wire,
    signedAssistant('r1', stop),
    ...(stop === 'tool_use' ? [result('r1')] : [{ role: 'user' as const, content: 'And HR?' }]),
  ];
  return check(holder, next(wire));
}

describe('inside a signed open tool turn: refused, by name', () => {
  it.each([
    [
      'a system prompt piece added',
      (w: LLMMessage[]) => request({ wire: w, systemPieces: [base, skill] }),
      [{ slot: 'system-prompt', change: 'added', source: 'skill', id: 'smb-triage' }],
    ],
    [
      'a system prompt piece removed',
      (w: LLMMessage[]) => request({ wire: w, systemPieces: [] }),
      [{ slot: 'system-prompt', change: 'removed', source: 'base' }],
    ],
    [
      'a system prompt piece changed',
      (w: LLMMessage[]) =>
        request({ wire: w, systemPieces: [{ ...base, contentHash: 'b2', rawContent: 'Other.' }] }),
      [{ slot: 'system-prompt', change: 'changed', source: 'base' }],
    ],
    [
      'a tool added',
      (w: LLMMessage[]) =>
        request({ wire: w, tools: [tool('lookup'), tool('read_skill'), tool('share_report')] }),
      [{ slot: 'tools', change: 'added', tool: 'share_report' }],
    ],
    [
      'a tool removed (the wrap-up empties the list)',
      (w: LLMMessage[]) => request({ wire: w, tools: [] }),
      [
        { slot: 'tools', change: 'removed', tool: 'lookup' },
        { slot: 'tools', change: 'removed', tool: 'read_skill' },
      ],
    ],
    [
      'a tool description rebuilt (a skill graph moving read_skill)',
      (w: LLMMessage[]) =>
        request({ wire: w, tools: [tool('lookup'), tool('read_skill', 'menu moved')] }),
      [{ slot: 'tools', change: 'changed', tool: 'read_skill' }],
    ],
    [
      'an earlier message rewritten',
      (w: LLMMessage[]) => request({ wire: [{ role: 'user', content: 'edited' }, ...w.slice(1)] }),
      [{ slot: 'messages', change: 'changed', position: 0, role: 'user' }],
    ],
    [
      'an earlier message dropped (a context window)',
      (w: LLMMessage[]) => request({ wire: w.slice(1) }),
      [{ slot: 'messages', change: 'changed', position: 0, role: 'assistant' }],
    ],
  ])('%s', (_, next, changes) => {
    const outcome = after(request(), 'tool_use', next);
    expect(outcome.refusal).toBeInstanceOf(ContextChangedError);
    expect(outcome.note).toEqual({ check: 'compared', refused: true, ...NAMES, changes });
    expect(outcome.refusal?.changes).toEqual(changes);
  });

  it('names the position of the signed reasoning in the request', () => {
    const outcome = after(request(), 'tool_use', (w) => request({ wire: w, tools: [] }));
    expect(outcome.refusal?.messageIndex).toBe(1);
    expect(outcome.refusal?.retryable).toBe(false);
  });

  it('a reordered tool list is not a change', () => {
    expect(
      after(request(), 'tool_use', (w) =>
        request({ wire: w, tools: [tool('read_skill'), tool('lookup')] }),
      ),
    ).toEqual({});
  });

  it('names at most the cap and counts the rest', () => {
    const many = Array.from({ length: MAX_CONTEXT_CHANGES + 4 }, (_, i) => tool(`t${i}`));
    const outcome = after(request(), 'tool_use', (w) =>
      request({ wire: w, tools: [tool('lookup'), tool('read_skill'), ...many] }),
    );
    expect(outcome.note?.changes).toHaveLength(MAX_CONTEXT_CHANGES);
    expect(outcome.note?.omittedChanges).toBe(4);
    expect(outcome.refusal?.message).toMatch(/; and 4 more\./);
  });

  it('the message is a fixed sentence plus names, never a value', () => {
    const outcome = after(request(), 'tool_use', (w) =>
      request({
        wire: w,
        systemPieces: [base, skill],
        tools: [tool('lookup'), tool('read_skill'), tool('share_report')],
      }),
    );
    expect(outcome.refusal?.message).toBe(
      "Refused before sending: claude-haiku-5-5 binds its reasoning to the context it was written under, and this tool turn changed that context: skill 'smb-triage' was added to the system prompt; tool 'share_report' was added. Keep the system prompt, tool list and earlier messages fixed until the turn ends.",
    );
    expect(outcome.refusal?.message).not.toContain('SMB TRIAGE');
  });
});

describe('between turns: recorded, not refused', () => {
  it('a finished turn followed by a changed system prompt', () => {
    const outcome = after(request(), 'end_turn', (w) =>
      request({ wire: w, systemPieces: [base, skill] }),
    );
    expect(outcome.refusal).toBeUndefined();
    expect(outcome.note).toEqual({
      check: 'compared',
      refused: false,
      ...NAMES,
      changes: [{ slot: 'system-prompt', change: 'added', source: 'skill', id: 'smb-triage' }],
    });
  });

  it('a signed turn the wire left out is recorded as a message left out', () => {
    const holder: ContextBaselineHolder = {};
    rememberContextBaseline(holder, request(), response('r1', 'tool_use'));
    const outcome = check(
      holder,
      request({ wire: [user, { role: 'user', content: 'wrap up' }], tools: [] }),
    );
    expect(outcome.refusal).toBeUndefined();
    expect(outcome.note?.changes).toContainEqual({
      slot: 'messages',
      change: 'removed',
      position: 1,
      role: 'assistant',
    });
  });

  it('a signed turn whose reasoning was retired is no longer bound: nothing recorded', () => {
    const holder: ContextBaselineHolder = {};
    rememberContextBaseline(holder, request(), response('r1', 'end_turn'));
    const signed = signedAssistant('r1', 'end_turn');
    const retired: LLMMessage = {
      role: 'assistant',
      content: signed.content,
      replay: { ...signed.replay!, thinkingRetired: true },
    };
    expect(
      check(
        holder,
        request({
          wire: [user, retired, { role: 'user', content: 'next' }],
          systemPieces: [base, skill],
        }),
      ),
    ).toEqual({});
  });
});

/** One signed tool call written by `writer`, then a changed request to `model`. */
function underTarget(
  writer: string,
  model: string,
  binding: CheckedBinding,
  pieces: readonly SystemPiece[] = [base, skill],
) {
  const holder: ContextBaselineHolder = {};
  rememberContextBaseline(holder, request(), response('r1', 'tool_use', writer));
  const wire = [user, signedAssistant('r1', 'tool_use', writer), result('r1')];
  return checkContextBinding(holder, {
    ...request({ wire, systemPieces: pieces }),
    provider: 'anthropic',
    model,
    binding,
    bindingOf,
  });
}

describe('a model whose binding is unknown: sent and recorded, never refused', () => {
  it('the same change inside a signed open tool turn is recorded with binding unknown', () => {
    const outcome = underTarget('team-profile', 'team-profile', {
      binding: 'unknown',
      by: 'provider',
    });
    expect(outcome.refusal).toBeUndefined();
    expect(outcome.note).toEqual({
      check: 'compared',
      refused: false,
      binding: 'unknown',
      by: 'provider',
      changes: [{ slot: 'system-prompt', change: 'added', source: 'skill', id: 'smb-triage' }],
    });
  });

  it('an app statement that failed is said on the row', () => {
    const outcome = underTarget('team-profile', 'team-profile', {
      binding: 'unknown',
      by: 'provider',
      appStatement: 'failed',
    });
    expect(outcome.note).toMatchObject({ refused: false, appStatement: 'failed' });
  });

  it('an app that states the id bound gets the refusal, recorded by app', () => {
    const outcome = underTarget('team-profile', 'team-profile', { binding: 'bound', by: 'app' });
    expect(outcome.refusal).toBeInstanceOf(ContextChangedError);
    expect(outcome.note).toMatchObject({ refused: true, binding: 'bound', by: 'app' });
  });
});

describe('who wrote the block decides whether there is anything to check', () => {
  it('a block an unbound model wrote carries nothing to check: no row, no refusal', () => {
    expect(underTarget('claude-haiku-4-5', MODEL, BOUND)).toEqual({});
  });

  it('a block another family wrote meets the model check, not this one: no row, no refusal', () => {
    expect(underTarget('claude-opus-5-5', MODEL, BOUND)).toEqual({});
  });

  it('a block written under another id of the same family is checked', () => {
    const outcome = underTarget('claude-haiku-5-5-20261001', MODEL, BOUND);
    expect(outcome.refusal).toBeInstanceOf(ContextChangedError);
    expect(outcome.refusal?.message).toMatch(/^Refused before sending: claude-haiku-5-5 binds/);
  });

  it('a block with no recorded writer is not checked locally (the adapter does not either)', () => {
    const holder: ContextBaselineHolder = {};
    rememberContextBaseline(holder, request(), response('r1', 'tool_use'));
    const signed = signedAssistant('r1', 'tool_use');
    const { binding: _binding, ...replay } = signed.replay!;
    const wire = [user, { ...signed, replay }, result('r1')];
    expect(check(holder, request({ wire, systemPieces: [base, skill] }))).toEqual({});
  });
});

describe('the library retiring finished-turn thinking is not an edit', () => {
  it('a retired message (new digest, thinkingRetired, no blocks) hashes as the same message', () => {
    const holder: ContextBaselineHolder = {};
    const first = request();
    rememberContextBaseline(holder, first, response('r1', 'end_turn'));
    const ended = signedAssistant('r1', 'end_turn');
    const asked: LLMMessage = { role: 'user', content: 'And HR?' };
    const second = request({ wire: [user, ended, asked] });
    rememberContextBaseline(holder, second, response('r2', 'tool_use'));
    // The adapter retired r1's thinking between the two requests of this turn.
    const { thinkingBlocks: _t, ...rest } = ended;
    const retired: LLMMessage = {
      ...rest,
      replay: { ...ended.replay!, thinkingRetired: true, contentDigest: 'another-digest' },
    };
    const wire = [user, retired, asked, signedAssistant('r2', 'tool_use'), result('r2')];
    expect(check(holder, request({ wire }))).toEqual({});
  });
});

describe('the base is the request behind the newest signed block', () => {
  it('not the conversation first request', () => {
    const holder: ContextBaselineHolder = {};
    // Turn one under [base]; the turn ends signed.
    rememberContextBaseline(holder, request(), response('r1', 'end_turn'));
    const asked: LLMMessage = { role: 'user', content: 'And HR?' };
    const turnTwo = request({
      wire: [user, signedAssistant('r1', 'end_turn'), asked],
      systemPieces: [base, skill],
    });
    // Between turns: recorded against r1's request, not refused.
    expect(check(holder, turnTwo).note).toMatchObject({ refused: false });
    rememberContextBaseline(holder, turnTwo, response('r2', 'tool_use'));
    // Same context as the request r2 was written under: nothing to say. Against
    // the first request it would be a refused skill addition in an open turn.
    const wire = [...turnTwo.wire, signedAssistant('r2', 'tool_use'), result('r2')];
    expect(check(holder, request({ wire, systemPieces: [base, skill] }))).toEqual({});
  });

  it('keeps each response its own base: a newer signed draft left off the wire does not blind it', () => {
    const holder: ContextBaselineHolder = {};
    rememberContextBaseline(holder, request(), response('r1', 'tool_use'));
    const wire = [user, signedAssistant('r1', 'tool_use'), result('r1')];
    // A signed draft (r2) is accepted and then kept off the wire by a revision.
    rememberContextBaseline(holder, request({ wire }), response('r2', 'end_turn'));
    const outcome = check(holder, request({ wire, tools: [] }));
    expect(outcome.note?.check).toBe('compared');
    expect(outcome.refusal).toBeInstanceOf(ContextChangedError);
  });
});

describe('the bases one run keeps are bounded', () => {
  it('the newest MAX_BASELINES responses keep a base; the oldest go first', () => {
    const holder: ContextBaselineHolder = {};
    for (let i = 0; i < MAX_BASELINES + 4; i++)
      rememberContextBaseline(holder, request(), response(`r${i}`, 'tool_use'));
    expect(holder.bases?.size).toBe(MAX_BASELINES);
    expect(holder.bases?.has('r0')).toBe(false);
    expect(holder.latest).toBe(`r${MAX_BASELINES + 3}`);
  });
});

describe('no recorded base: unchecked', () => {
  it('unchecked is said once per response, not on every call', () => {
    const holder: ContextBaselineHolder = {};
    const wire = [user, signedAssistant('earlier', 'tool_use'), result('earlier')];
    expect(check(holder, request({ wire })).note?.check).toBe('unchecked');
    expect(check(holder, request({ wire }))).toEqual({});
  });

  it('a continued conversation records unchecked and refuses nothing', () => {
    const wire = [
      user,
      signedAssistant('from-an-earlier-run', 'tool_use'),
      result('from-an-earlier-run'),
    ];
    const outcome = check({}, request({ wire, systemPieces: [base, skill] }));
    expect(outcome).toEqual({
      note: { check: 'unchecked', refused: false, ...NAMES, changes: [] },
    });
  });

  it('no signed reasoning anywhere: nothing to check, nothing recorded', () => {
    expect(check({}, request({ systemPieces: [base, skill] }))).toEqual({});
  });

  it('an unsigned response leaves the earlier baseline in place', () => {
    const holder: ContextBaselineHolder = {};
    rememberContextBaseline(holder, request(), response('r1', 'tool_use'));
    const held = holder.current;
    rememberContextBaseline(holder, request(), {
      content: '',
      toolCalls: [],
      usage: { input: 1, output: 1 },
      stopReason: 'tool_use',
    });
    expect(holder.current).toBe(held);
  });
});

describe('seeded random walk: refused exactly when an open signed turn sees a change', () => {
  /** mulberry32 — a fixed seed makes every run the same walk. */
  function random(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const PIECES = [
    base,
    skill,
    {
      source: 'instructions',
      sourceId: 'after-lookup',
      rawContent: 'I',
      contentHash: 'i1',
    } as SystemPiece,
  ];
  const TOOLS = [
    tool('lookup'),
    tool('read_skill'),
    tool('share_report'),
    tool('read_skill', 'moved'),
  ];

  it('holds over 500 walks', () => {
    const next = random(20261125);
    for (let walk = 0; walk < 500; walk++) {
      const holder: ContextBaselineHolder = {};
      let current = request();
      let wire: LLMMessage[] = [user];
      let sentUnder: RequestContext | undefined;
      let open = false;
      for (let step = 0; step < 6; step++) {
        // An edit, or none.
        const roll = next();
        let systemPieces = current.systemPieces;
        let tools = current.tools;
        if (roll < 0.2)
          systemPieces = [...systemPieces, PIECES[Math.floor(next() * PIECES.length)]];
        else if (roll < 0.35 && systemPieces.length > 0) systemPieces = systemPieces.slice(1);
        else if (roll < 0.55) {
          const pick = TOOLS[Math.floor(next() * TOOLS.length)];
          tools = [...tools.filter((t) => t.name !== pick.name), pick];
        }
        current = request({ wire, systemPieces, tools });
        const outcome = check(holder, current);
        // The oracle: the rule, restated over the requests themselves.
        const changed =
          sentUnder !== undefined &&
          (JSON.stringify(sentUnder.systemPieces) !== JSON.stringify(current.systemPieces) ||
            JSON.stringify([...sentUnder.tools].sort((a, b) => a.name.localeCompare(b.name))) !==
              JSON.stringify([...current.tools].sort((a, b) => a.name.localeCompare(b.name))));
        expect(outcome.refusal !== undefined).toBe(open && changed);
        expect(outcome.note !== undefined).toBe(changed);
        if (outcome.refusal !== undefined) break;
        // The model answers: a signed tool call, or a signed end of turn.
        const stop = next() < 0.6 ? 'tool_use' : 'end_turn';
        const id = `w${walk}s${step}`;
        rememberContextBaseline(holder, current, response(id, stop));
        sentUnder = current;
        open = stop === 'tool_use';
        wire = [
          ...wire,
          signedAssistant(id, stop),
          stop === 'tool_use' ? result(id) : { role: 'user', content: `q${step}` },
        ];
      }
    }
  });
});
