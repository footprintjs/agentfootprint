/**
 * The refusals of `.aroundTurn()`, one table, one class.
 */

/** Why a wrapper, or a call it made, was refused. */
export type AroundTurnRefusal =
  | 'invalid-wrapper'
  | 'second-wrapper'
  | 'not-proceeded'
  | 'second-proceed'
  | 'late-proceed'
  | 'unknown-change'
  | 'change-on-resume'
  | 'mounted';

const SENTENCES: Readonly<Record<AroundTurnRefusal, (name: string) => string>> = {
  'invalid-wrapper': () =>
    'AgentBuilder.aroundTurn: expected { name, around(turn, proceed) } with a non-empty name.',
  'second-wrapper': (name) =>
    `AgentBuilder.aroundTurn: '${name}' is already declared. An agent has one wrapper; ` +
    'compose your work inside it.',
  'not-proceeded': (name) =>
    `.aroundTurn '${name}' returned without calling proceed(), so no run started. ` +
    'To stop a turn, throw.',
  'second-proceed': (name) =>
    `.aroundTurn '${name}' called proceed() twice. A turn runs once; the first call stands.`,
  'late-proceed': (name) =>
    `.aroundTurn '${name}' called proceed() after it had settled. Await proceed() inside around().`,
  'unknown-change': (name) =>
    `.aroundTurn '${name}' passed proceed() something other than { time }, the one change it takes.`,
  'change-on-resume': (name) =>
    `.aroundTurn '${name}' passed proceed() a change on a resume. A resume keeps the paused ` +
    "turn's clock and caller; call proceed() with nothing.",
  mounted: (name) =>
    `This agent declares .aroundTurn '${name}', and its chart was mounted in another run. A ` +
    'mounted chart has no turn to wrap, so the wrapper could not run. Run the agent itself, or ' +
    'mount one built without a wrapper.',
};

/**
 * A wrapper declared or used against the rules of `.aroundTurn()`. `reason`
 * says which rule; `wrapper` is the name it was declared under.
 */
export class AroundTurnError extends Error {
  readonly code = 'ERR_AROUND_TURN' as const;
  readonly reason: AroundTurnRefusal;
  readonly wrapper: string;

  constructor(reason: AroundTurnRefusal, wrapper: string) {
    super(SENTENCES[reason](wrapper));
    this.name = 'AroundTurnError';
    this.reason = reason;
    this.wrapper = wrapper;
  }
}
