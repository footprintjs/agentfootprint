/**
 * Compile-level contract — every AG-UI event agentfootprint writes is an event of
 * `@ag-ui/core`'s own `Event` union.
 *
 * `src/ag-ui/types.ts` declares the events structurally so nothing in `dist/`
 * imports the optional peer. This file is where that copy is held to the
 * original, by the real compiler (`npm run test:types`, this directory's
 * tsconfig): for EVERY member of `AgUiEvent`, the same value typed with
 * `@ag-ui/core`'s `EventType` enum member must be assignable to the protocol's
 * event of that type. A field added with the wrong type, a required field
 * missed, or a value outside the protocol's union stops this compiling.
 *
 * Two translations are the whole difference, and both are wire-neutral:
 * `type` is a string literal here and an enum member there (the same string on
 * the wire), and arrays here are `readonly`.
 *
 * The `.test.ts` name lets `npm test` run the runtime half too: the protocol
 * version and the event type names are the protocol's own.
 */
import { EventType, PROTOCOL_VERSION, type AGUIEventOf } from '@ag-ui/core';
import { describe, expect, it } from 'vitest';

import { AG_UI_PROTOCOL_VERSION, type AgUiEvent, type AgUiEventType } from '../../src/ag-ui/index';

/** The wire value of `T`, as a mutable structure — what `JSON.parse` would hand back. */
type Wire<T> = T extends readonly (infer U)[]
  ? Wire<U>[]
  : T extends (...args: never[]) => unknown
  ? T
  : T extends object
  ? { -readonly [K in keyof T]: Wire<T[K]> }
  : T;

/** One of ours, typed the way `@ag-ui/core` types its discriminator. */
type AsProtocol<E extends AgUiEvent> = Wire<Omit<E, 'type'>> & {
  type: (typeof EventType)[E['type']];
};

/** `true` when ours is an event of the protocol's union for that type. */
type IsProtocolEvent<E extends AgUiEvent> = AsProtocol<E> extends AGUIEventOf<
  (typeof EventType)[E['type']]
>
  ? true
  : false;

/** Every event type we write → whether it is the protocol's. Each must be `true`. */
type Contract = { [T in AgUiEventType]: IsProtocolEvent<Extract<AgUiEvent, { type: T }>> };

const CONTRACT: Contract = {
  RUN_STARTED: true,
  RUN_FINISHED: true,
  RUN_ERROR: true,
  STEP_STARTED: true,
  STEP_FINISHED: true,
  TEXT_MESSAGE_START: true,
  TEXT_MESSAGE_CONTENT: true,
  TEXT_MESSAGE_END: true,
  TOOL_CALL_START: true,
  TOOL_CALL_ARGS: true,
  TOOL_CALL_END: true,
  TOOL_CALL_RESULT: true,
  REASONING_START: true,
  REASONING_MESSAGE_START: true,
  REASONING_MESSAGE_CONTENT: true,
  REASONING_MESSAGE_END: true,
  REASONING_END: true,
  SUBAGENT_STARTED: true,
  SUBAGENT_FINISHED: true,
  SUBAGENT_ERROR: true,
  CUSTOM: true,
};

describe('AG-UI events — the protocol’s own', () => {
  it('speaks the protocol version @ag-ui/core was generated from', () => {
    expect(AG_UI_PROTOCOL_VERSION).toBe(PROTOCOL_VERSION);
  });

  it('every event type we write is an EventType of the protocol, by its wire value', () => {
    const protocol = new Set<string>(Object.values(EventType));
    for (const type of Object.keys(CONTRACT)) expect(protocol.has(type), type).toBe(true);
  });
});
