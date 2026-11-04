import type { PermissionChecker } from '../../../../../provider-contract/types.js';
import type { CredentialProvider } from '../../../../../identity/types.js';
import type { RequestContext } from '../../../../../identity/requestContext.js';
import type { ToolArgValidationMode } from '../../../../../tools/toolArgsValidation.js';
import type { ResolvedCheckInConfig } from '../../../../checkin.js';
import type { ToolMiddleware } from '../../../middleware/types.js';
import type { AnsweredAsk } from '../../../../../tools/inputRequest.js';
import type { DecisionLedger } from '../../../../consentRequest.js';
import type { AuthorizationRequiredMode } from '../../../../../identity/consent.js';

/** The access dependencies of the existing tool-call stage. */
export interface ToolAccessPort {
  /** Optional permission gate. When present, every tool dispatch
   *  awaits `check({capability: 'tool_call', ...})` BEFORE executing.
   *  Throwing checkers are treated as deny-by-default. */
  readonly permissionChecker?: PermissionChecker;
  /** Optional credential provider (declare-and-push). When present, a tool's
   *  declared `needs` is resolved BEFORE execute and injected as `ctx.credential`;
   *  `ctx.credentials` exposes it for the pull escape hatch. */
  readonly credentialProvider?: CredentialProvider;
  /**
   * The incoming request a call made in `scope` serves — the agent's own run's
   * for its own scopes, the run a composition's link names on a mount, and
   * `undefined` where no run carries one. Every credential call made in that
   * scope (declared `needs`, the pull path, inner `ctx.tools` calls) carries
   * it as `CredentialRequest.request` and nothing else (`bindRequest`), so a
   * request-sourced credential can never serve another run. Absent → no call
   * carries a request.
   */
  readonly currentRequest?: (scope: object) => RequestContext | undefined;
  /** Tool-args validation mode (#9). Default 'enforce': LLM-produced args
   *  are checked against the tool's `inputSchema` BEFORE dispatch; a
   *  mismatch rejects the call with a model-visible retry message.
   *  'warn' emits the event but executes anyway; 'off' skips validation. */
  readonly toolArgValidation?: ToolArgValidationMode;
  /**
   * Check-in config (evidence-carrying human consent). Resolved from the Agent
   * builder (`.checkIn({...})`) — defaults to `standard` evidence + the
   * deterministic lexical scorer, so a tool that declares `checkIn` works even
   * without `.checkIn()`. Undefined only when the handler is built outside an
   * Agent (no check-in). The gate fires ONLY for tools that declared `checkIn`.
   */
  readonly checkIn?: ResolvedCheckInConfig;
  /**
   * The tool-dispatch governance chain (`.toolMiddleware(...)`), in
   * declaration order. Walked AFTER the permission gate — so an existing
   * `PermissionChecker` still decides first and a denial there means no
   * middleware runs at all — and BEFORE arg validation, so validation judges
   * the args that will actually be sent rather than the ones the model
   * proposed. Empty / undefined → not walked, no ledger key, no events.
   */
  readonly toolMiddleware?: readonly ToolMiddleware[];
  /**
   * The typed ask this run's resume answered, or `undefined` — for
   * a fresh run, and for a resume of any other pause kind. An accessor for
   * the reason `currentRun` is one. Read at a `requestInput` raise: the same
   * declaration `id` raised again is a RE-ASK, stamped `repeat` on the
   * awaiting-input shape (`inputRequest.ts` · `repeatOf`).
   *
   * @internal
   */
  readonly answeredAsk?: () => AnsweredAsk | undefined;
  /**
   * Where answered consent requests are spent (`AgentOptions.decisionLedger`),
   * so one decision runs one call. Undefined → this process's ledger, shared by
   * every agent that names none (`processDecisionLedger`).
   */
  readonly decisionLedger?: DecisionLedger;
  /**
   * What to do when a tool's DECLARED credential needs 3LO consent (8.6.0).
   * Default `'pause'`. See `AgentOptions.onAuthorizationRequired`.
   */
  readonly onAuthorizationRequired?: AuthorizationRequiredMode;
  /**
   * Side channel for the `'tell-model'` consent record — the ONLY route the
   * authorization URL takes out of this handler in that mode.
   *
   * It is a callback rather than a scope key on purpose. A tracked write lands
   * in the commit log, which is the snapshot, the narrative and every
   * recording; writing the URL there would rebuild the exact leak 8.6.0
   * removes. This hands it to a private field on the Agent instead, where it
   * lives for the length of the run and leaves only as
   * `CredentialConsentRequiredError`.
   *
   * @internal
   */
  readonly reportConsentOutstanding?: (record: {
    readonly service: string;
    readonly authorizationUrl: string;
    readonly sessionId: string;
    readonly tool: string;
    readonly iteration: number;
  }) => void;
  /**
   * Clears an outstanding consent record for `service` — called whenever a
   * credential for it is successfully ISSUED. Without this, a run that was
   * blocked, resumed, and then succeeded would still raise at the end: the
   * record is about work that has since been done.
   *
   * @internal
   */
  readonly clearConsentOutstanding?: (service: string) => void;
  /**
   * The host's own context for the inputs layer's batch ask
   * (`AgentOptions.argumentAskContext`) — called when an ask is built, its
   * object spread into the ask's `context` beside the library's reserved key
   * (`arguments/ask.ts` · `judgeAskContextHook`). Present only when the agent
   * configured one; read only when an ask is raised.
   */
  readonly argumentAskContext?: () => unknown;
}
