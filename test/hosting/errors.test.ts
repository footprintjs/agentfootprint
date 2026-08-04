/**
 * hosting errors — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * These messages ARE the feature when something goes wrong: they are the only
 * thing a person on call reads. Each one has to name who refused, say what was
 * and was not done, and not blame the wrong party — so the variants with a
 * detail and the variants without it are both asserted, because the
 * without-detail path is the one that shows up when you know least.
 */

import { describe, expect, it } from 'vitest';

import {
  ConcurrentRunError,
  HostClosedError,
  PauseNotCarriedError,
  UnreadableEnvelopeError,
  requireCapability,
} from '../../src/hosting/index.js';
import type { AgentHost } from '../../src/hosting/index.js';

describe('HostClosedError', () => {
  it('names the adapter and says in-flight work was allowed to finish', () => {
    const err = new HostClosedError('nodeHost');
    expect(err.name).toBe('HostClosedError');
    expect(err.code).toBe('ERR_HOST_CLOSED');
    expect(err.hostName).toBe('nodeHost');
    expect(err.message).toContain("'nodeHost'");
    expect(err.message).toContain('is closed');
    expect(err.message).toContain('allowed to finish');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ConcurrentRunError', () => {
  it('names the session AND the active run when it knows it', () => {
    const err = new ConcurrentRunError('c-1', 'run-42');
    expect(err.code).toBe('ERR_CONCURRENT_RUN');
    expect(err.sessionId).toBe('c-1');
    expect(err.activeRunId).toBe('run-42');
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).toContain("run 'run-42'");
    expect(err.message).toContain("onConcurrentInvoke: 'enqueue'");
  });

  it('still reads correctly when the run has not announced itself yet', () => {
    const err = new ConcurrentRunError('c-1');
    expect(err.activeRunId).toBeUndefined();
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).not.toContain('(run');
    expect(err.message).not.toContain('undefined');
  });
});

describe('PauseNotCarriedError', () => {
  it('names the tool and the session, and does not blame the agent', () => {
    const err = new PauseNotCarriedError('approve_refund', 's-1');
    expect(err.code).toBe('ERR_PAUSE_NOT_CARRIED');
    expect(err.toolName).toBe('approve_refund');
    expect(err.sessionId).toBe('s-1');
    expect(err.message).toContain("'approve_refund'");
    expect(err.message).toContain("session 's-1'");
    expect(err.message).toContain('did not fail');
    expect(err.message).toContain('Nothing was written');
  });

  it('degrades to plain language when it knows neither', () => {
    const err = new PauseNotCarriedError();
    expect(err.toolName).toBeUndefined();
    expect(err.sessionId).toBeUndefined();
    expect(err.message).toContain('a tool');
    expect(err.message).toContain('no session id');
    expect(err.message).not.toContain('undefined');
  });

  it('says the pause was STORED when it was, and where to answer it', () => {
    const err = new PauseNotCarriedError('approve_refund', 'c-1', true);
    expect(err.stored).toBe(true);
    expect(err.message).toContain('did not fail');
    expect(err.message).toContain('IS stored');
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).toContain('decision');
    // The old reason is gone: the envelope CAN carry a pause now.
    expect(err.message).not.toContain('conversation-v1');
  });

  it('says nothing was written when nothing was, without blaming the envelope', () => {
    const err = new PauseNotCarriedError('approve_refund', undefined, false);
    expect(err.stored).toBe(false);
    expect(err.message).toContain('Nothing was written');
    expect(err.message).toContain('no session id');
  });
});

describe('UnreadableEnvelopeError', () => {
  /**
   * The shape the field hit: a store handed an OBJECT to a service that stored
   * its own host language's `toString()` of it. Not JSON, not recoverable.
   */
  const MANGLED =
    '{format=conversation-v1, data={version=1, runId=run-7, history=[{role=user, ' +
    'content=my card number is 4111 1111 1111 1111}]}, savedAt=1754000000000}';

  it('states the law it exists to enforce, and names the session', () => {
    const err = new UnreadableEnvelopeError(MANGLED, 'c-1');
    expect(err.name).toBe('UnreadableEnvelopeError');
    expect(err.code).toBe('ERR_UNREADABLE_ENVELOPE');
    expect(err.sessionId).toBe('c-1');
    expect(err.message).toContain("session 'c-1'");
    expect(err.message).toContain('different facts');
    expect(err.message).toContain('fresh start');
    expect(err.message).toContain('{ format, data, savedAt }');
  });

  it('quotes a PREFIX for diagnosis and never the conversation', () => {
    const err = new UnreadableEnvelopeError(MANGLED, 'c-1');
    // Enough to recognise the mangling at a glance…
    expect(err.storedPreview).toContain('format=conversation-v1');
    // …and not enough to leak what was being said.
    expect(err.storedPreview).not.toContain('4111 1111 1111 1111');
    expect(err.message).not.toContain('4111 1111 1111 1111');
    expect(err.storedPreview.length).toBeLessThan(MANGLED.length);
    // The reader is told bytes were withheld rather than left to assume the
    // store held exactly this much.
    expect(err.storedPreview).toContain(`${MANGLED.length} chars`);
  });

  it('describes a non-string without dumping it either', () => {
    const err = new UnreadableEnvelopeError([{ blob: 'secret' }]);
    expect(err.storedPreview).toBe('an array of 1 item(s)');
    expect(err.message).not.toContain('secret');
    expect(new UnreadableEnvelopeError(null).storedPreview).toBe('null');
    expect(new UnreadableEnvelopeError(7).storedPreview).toBe('number 7');
    expect(new UnreadableEnvelopeError({ a: 1, b: 2 }).storedPreview).toBe(
      'an object with keys: a, b',
    );
    expect(new UnreadableEnvelopeError({}).storedPreview).toBe('an object with no keys');
  });

  it('reads correctly when the refuser does not know whose session it was', () => {
    const err = new UnreadableEnvelopeError(MANGLED);
    expect(err.sessionId).toBeUndefined();
    expect(err.message).toContain('present but unreadable');
    expect(err.message).not.toContain('undefined');
  });

  it('withSession names the session without editing the error already thrown', () => {
    const anonymous = new UnreadableEnvelopeError(MANGLED);
    const named = anonymous.withSession('c-9');
    expect(named).not.toBe(anonymous);
    expect(named.sessionId).toBe('c-9');
    expect(named.message).toContain("session 'c-9'");
    expect(named.cause).toBe(anonymous);
    // The copy quotes the same prefix — and no more of the blob than the
    // original was allowed to.
    expect(named.storedPreview).toBe(anonymous.storedPreview);
    // The original is untouched: an error already handed to somebody is a fact
    // about a moment.
    expect(anonymous.sessionId).toBeUndefined();
  });

  it('leaves an already-named refusal alone', () => {
    const named = new UnreadableEnvelopeError(MANGLED, 'c-1');
    expect(named.withSession('c-2')).toBe(named);
  });

  it('is still a TypeError, so an existing catch keeps working', () => {
    const err = new UnreadableEnvelopeError(MANGLED, 'c-1');
    expect(err).toBeInstanceOf(TypeError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe('requireCapability', () => {
  const host = (capabilities: readonly ('streaming' | never)[]): AgentHost => ({
    name: 'testHost',
    capabilities,
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  });

  it('is silent when the host has it', () => {
    expect(() => requireCapability(host(['streaming']), 'streaming')).not.toThrow();
  });

  it('names the adapter, what was asked, and what it does have', () => {
    expect(() => requireCapability(host([]), 'streaming')).toThrow(/'testHost'/);
    expect(() => requireCapability(host([]), 'streaming')).toThrow(/It reports: none/);
    expect(() => requireCapability(host([]), 'streaming')).toThrow(/never assumed from its name/);
  });

  it('lists what it does have when the list is non-empty', () => {
    // A host with capabilities, asked for one it lacks: the message has to say
    // what IS there, or the reader is left guessing at the alternative.
    const partial = { ...host(['streaming']), capabilities: ['streaming'] as const };
    expect(() => requireCapability(partial, 'streaming')).not.toThrow();
    const other = { ...host([]), name: 'otherHost', capabilities: [] as const };
    expect(() => requireCapability(other, 'streaming')).toThrow(/'otherHost'/);
  });
});
