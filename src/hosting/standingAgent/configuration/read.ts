import { type AnswerAccounts, answerAccounts } from '../../answerAccounts.js';
import {
  DEFAULT_ARTIFACT_OPS_PER_SESSION,
  DEFAULT_MAX_ACTIVE_SESSIONS,
  type HostHandle,
  type StandingAgentOptions,
  TURN_ARTIFACTS_TIMEOUT_MS,
} from '../../types.js';
import { type SpendLedger, spendLedger } from '../../admission.js';
import { requestSealing } from '../../requestSealing.js';

export function readConfiguration<TH extends HostHandle>(options: StandingAgentOptions<TH>) {
  const { sessions, host } = options;
  const policy = options.onConcurrentInvoke ?? 'reject';
  const durability = options.durability ?? 'exit';
  const sharedAgent = options.agent;
  const factory = options.agentFactory;
  /** The badge check (9.26.0), or `undefined` — the zero-delta path. */
  const identityOptions = options.identity;
  /** The admission policy (9.26.0), or `undefined`. */
  const admission = options.admission;
  /**
   * The app's sealer for a request's own credential, checked once per run, or
   * `undefined` — no run carries a request, as before. Refused at
   * construction when it is not a function.
   */
  const sealRequest = requestSealing(options.sealRequest, 'standingAgent');
  /**
   * The rolling-window accountant — built ONLY when a policy exists, because
   * with no policy nobody would ever read it and keeping a per-caller map of a
   * server's whole traffic would be a cost nobody asked for.
   */
  const ledger: SpendLedger | undefined = admission !== undefined ? spendLedger() : undefined;
  /**
   * Where ingress decisions go (9.32.0), or `undefined` — the zero-delta path.
   * With no sink nothing is wrapped and the handler uses the host's own reply
   * object, which is what makes this option free for everyone who never asks
   * for it.
   */
  const ingressSink = options.onIngressDecision;

  // ── Refused at construction, before a socket exists ──────────────────
  //
  // Two spellings of one decision: an operator reading `{ agent, agentFactory }`
  // in a config could not know whether their sessions were isolated.
  if (sharedAgent !== undefined && factory !== undefined) {
    throw new Error(
      `[hosting] standingAgent was given both 'agent' and 'agentFactory'. They are two ` +
        `answers to one question — whether sessions SHARE an instance or each get their ` +
        `own — and honouring either would leave the other silently ignored. Pass 'agent' ` +
        `for one shared instance (runs serialized globally, the original shape), or ` +
        `'agentFactory' for one instance per active session (sessions run in parallel).`,
    );
  }
  if (sharedAgent === undefined && factory === undefined) {
    throw new Error(
      `[hosting] standingAgent needs something to answer with: pass 'agent' (one instance ` +
        `shared by every session) or 'agentFactory' (a new instance per active session). ` +
        `Neither was given, so there is nothing to serve.`,
    );
  }
  // Two options TypeScript enforces and plain JavaScript does not. Half-spelled,
  // both fail closed at runtime: an outage for a configuration reason that takes
  // an hour to diagnose from outside. Named here instead, before a socket exists.
  if (
    identityOptions !== undefined &&
    typeof identityOptions.verify !== 'function' &&
    typeof identityOptions.signIn?.identify !== 'function'
  ) {
    throw new Error(
      `[hosting] standingAgent was given 'identity' without a \`verify\` function (or a ` +
        `\`signIn\` source). It is the ` +
        `strategy that turns a caller's bearer token into a proven user, so there is nothing ` +
        `to verify with — and with it half-spelled every request would be refused as ` +
        `unverifiable. Pass identity: { verify: jwksIdentity({ jwksUrl, issuer, audience }` +
        `).verify } — or any IdentityVerifier's verify — or drop the option and read ` +
        `HostRequest.userId as the transport's own claim, exactly as before.`,
    );
  }
  if (admission !== undefined && typeof admission.decide !== 'function') {
    throw new Error(
      `[hosting] standingAgent was given 'admission' without a \`decide\` function. It is the ` +
        `whole policy — one method answering 'allow' | { queue: true } | { refuse: '<why>' } ` +
        `— so a bag without it decides nothing and would throw on the first turn. Pass ` +
        `admission: turnsPerHour({ limit }), or your own { decide }, or drop the option.`,
    );
  }
  // A pool bound with no pool is a caller who believes something untrue about
  // how their process will behave under load. Named rather than ignored.
  if (factory === undefined && options.maxActiveSessions !== undefined) {
    throw new Error(
      `[hosting] standingAgent was given 'maxActiveSessions' without 'agentFactory'. ` +
        `With a single shared 'agent' there is no pool to bound — every session already ` +
        `uses the one instance you passed. Drop it, or switch to 'agentFactory' to get ` +
        `the per-session pool it describes.`,
    );
  }
  // A bound on the artifact hand-over that could never fire is not a bound —
  // and a hand-over that may hold a lane forever is the outage it exists to
  // prevent. Refused here, before a socket exists.
  const turnArtifactsTimeoutMs = options.turnArtifactsTimeoutMs ?? TURN_ARTIFACTS_TIMEOUT_MS;
  if (!Number.isFinite(turnArtifactsTimeoutMs) || turnArtifactsTimeoutMs <= 0) {
    throw new Error(
      `[hosting] standingAgent was given turnArtifactsTimeoutMs: ${String(
        options.turnArtifactsTimeoutMs,
      )}. It is how long a turn's artifact hand-over (reply.turnArtifacts) may hold the ` +
        `reply, so it has to be a positive, finite number of milliseconds — a bound that ` +
        `can never fire would let one host's hung store hold every other session. Drop it ` +
        `for the default (${TURN_ARTIFACTS_TIMEOUT_MS} ms).`,
    );
  }
  // The `answer-account` op (explain-answer): built — and its declarations,
  // ceiling and cache size validated — only when the host opted in, so a bad
  // declaration throws HERE, at boot, and never meets a request. Absent, the
  // op answers the unknown-op refusal and nothing below is ever built.
  const accounts: AnswerAccounts | undefined =
    options.answerAccounts === undefined || options.answerAccounts === false
      ? undefined
      : answerAccounts(options.answerAccounts);
  // How many artifact ops (head / get / answer-account) one session may have
  // in flight at once. A bound that can never be met, or never fire, is
  // refused here; `Infinity` is the explicit "no bound".
  const artifactOpsPerSession = options.artifactOpsPerSession ?? DEFAULT_ARTIFACT_OPS_PER_SESSION;
  if (
    artifactOpsPerSession !== Number.POSITIVE_INFINITY &&
    (!Number.isInteger(artifactOpsPerSession) || artifactOpsPerSession < 1)
  ) {
    throw new Error(
      `[hosting] standingAgent was given artifactOpsPerSession: ${String(
        options.artifactOpsPerSession,
      )}. It is how many artifact operations (artifact-head, artifact-get, ` +
        `answer-account) one session may have in flight at once, so it has to be a ` +
        `positive whole number — or Infinity for no bound. Drop it for the default ` +
        `(${DEFAULT_ARTIFACT_OPS_PER_SESSION}).`,
    );
  }
  /** Session id → artifact ops in flight right now. An entry at zero is removed. */
  const artifactOpsInFlight = new Map<string, number>();
  const maxActiveSessions = options.maxActiveSessions ?? DEFAULT_MAX_ACTIVE_SESSIONS;
  if (factory !== undefined && (!Number.isInteger(maxActiveSessions) || maxActiveSessions < 1)) {
    throw new Error(
      `[hosting] standingAgent was given maxActiveSessions: ${String(
        options.maxActiveSessions,
      )}. ` +
        `It is how many sessions may hold an agent at once, so it has to be a positive ` +
        `integer — a pool that can hold no sessions could never serve one.`,
    );
  }
  return {
    sessions,
    host,
    policy,
    durability,
    sharedAgent,
    factory,
    identityOptions,
    admission,
    sealRequest,
    ledger,
    ingressSink,
    turnArtifactsTimeoutMs,
    accounts,
    artifactOpsPerSession,
    artifactOpsInFlight,
    maxActiveSessions,
  };
}

export type Configuration = ReturnType<typeof readConfiguration>;
