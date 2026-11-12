import { AdmissionRefusedError } from '../../errors.js';
import { type ArtifactWireHandler } from '../artifacts/wire.js';
import { type Configuration } from '../configuration/read.js';
import { type HostReply, type HostRequest } from '../../types.js';
import { type IngressNote, beginIngress } from '../../ingressRecord.js';
import { type LanePool } from '../lanes/pool.js';
import { type SessionHistory } from '../sessions/history.js';
import { type TurnRunner } from '../turn/run.js';
import { type VerifiedIdentity, verifyRequestIdentity } from '../../identityVerification.js';
import { spendKeyFor } from '../../admission.js';

type HandlerOptions = Pick<
  Configuration,
  'identityOptions' | 'admission' | 'ledger' | 'sessions' | 'ingressSink'
> &
  Pick<LanePool, 'laneFor' | 'serialize'> &
  Pick<SessionHistory, 'answerSessionOp'> & {
    readonly answerArtifact: ArtifactWireHandler;
    readonly answerOne: TurnRunner;
  };

export function createRequestHandler({
  identityOptions,
  admission,
  ledger,
  sessions,
  ingressSink,
  laneFor,
  serialize,
  answerSessionOp,
  answerArtifact,
  answerOne,
}: HandlerOptions) {
  let anonymous = 0;
  /**
   * The composer's whole request path — with the reply it is handed already
   * wrapped, when an ingress record is being kept.
   *
   * Split out from {@link handler} for exactly one reason: the record's funnel
   * has to be ONE place. Every exit below ends at a reply terminal, so wrapping
   * the reply once above this function covers all of them — a refusal added
   * later cannot forget to report, because reporting is not something any exit
   * does.
   */
  const answerRequest = async (
    request: HostRequest,
    reply: HostReply,
    note: IngressNote | undefined,
  ): Promise<void> => {
    // ── The badge, before anything else ───────────────────────────────
    // FIRST, and once — so a turn, a claim-ticket redemption and a session
    // read all inherit one answer to "who is this", and a door added later
    // cannot accidentally be the lenient one. With no verifier configured this
    // returns `undefined` without touching the request: every earlier
    // release's behaviour, to the byte.
    let verified: VerifiedIdentity | undefined;
    try {
      verified = await verifyRequestIdentity(
        identityOptions,
        request.headers,
        request.userId,
        request.signInKey,
      );
    } catch (err) {
      reply.fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    // The PROVEN id, on the record — never the claimed one, which is the whole
    // distinction the verifier exists to draw. Nothing is recorded when nobody
    // was proven; absent and "anonymous" are the same fact here.
    note?.identified(verified);
    // The user id that reaches every downstream composition. With a verifier
    // it is the one the TOKEN proved (the request's own claim was already
    // reconciled or refused); without one it is exactly what the transport
    // said, unchanged since 9.12.0.
    const userId = verified?.userId ?? request.userId;
    const identified: HostRequest = userId === request.userId ? request : { ...request, userId };

    // ── Reading history is not a turn either ──────────────────────────
    if (identified.session !== undefined) {
      try {
        await answerSessionOp(identified.session, verified, reply);
      } catch (err) {
        reply.fail(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    // ── A claim-ticket redemption is not a turn ────────────────────────
    // Its presence is the discriminant, exactly as `decision`'s is one line
    // down: a request carrying `artifact` redeems a ref and never starts,
    // queues behind, or is refused as, a run. Read-only against the store, so
    // it deliberately bypasses the lane's serialization — a screen describing
    // a chart while the model is mid-turn must not be refused as a
    // "concurrent run", and must not make the turn wait either.
    if (identified.artifact !== undefined) {
      try {
        await answerArtifact(identified.artifact, identified, verified, reply);
      } catch (err) {
        reply.fail(err instanceof Error ? err : new Error(String(err)));
      }
      return;
    }
    const sessionId = identified.sessionId;
    // A request with no session has nothing to hydrate and nowhere to persist
    // that the caller could ask for again, so it gets its own key and can never
    // collide with anyone. In the pooled shape those requests still SHARE one
    // fallback instance — there is no conversation to isolate — and this unique
    // key is what keeps them from ever refusing each other as a "same session"
    // collision, which they are not.
    const sessionKey =
      sessionId !== undefined ? `session:${sessionId}` : `anonymous:${++anonymous}`;
    try {
      // ── Admission, before a lane is even chosen ────────────────────
      // The cheapest refusal is the one made before any work: no hydrate, no
      // model call, no store write. With no policy this is a single
      // `undefined` check and nothing else runs.
      const spendKey = spendKeyFor(verified);
      let queueAnyway = false;
      if (admission !== undefined && ledger !== undefined) {
        const verdict = await admission.decide({
          ...(verified !== undefined && { identity: verified }),
          ...(sessionId !== undefined && { sessionId }),
          recentSpend: ledger.read(spendKey),
        });
        if (typeof verdict === 'object' && verdict !== null && 'refuse' in verdict) {
          note?.admitted('refuse');
          reply.fail(new AdmissionRefusedError(verdict.refuse, userId));
          return;
        }
        queueAnyway = typeof verdict === 'object' && verdict !== null && 'queue' in verdict;
        // An ALLOW is recorded too. A stream of refusals alone cannot answer
        // "was anybody turned away?" — only a census can, which is the same
        // reason an empty audit bundle is not evidence of an empty door.
        note?.admitted(queueAnyway ? 'queue' : 'allow');
        // Counted at ADMISSION, not at completion: a turn that is running has
        // been spent whether or not it ever answers, and counting on the way
        // out would let a caller hold N runs open under a limit of one.
        //
        // The stated consequence: a request the LANE then refuses as a
        // concurrent run still counts against the window. Deferring the count
        // to the moment a run actually starts would fix that and open a
        // bigger hole — a burst of simultaneous requests would each be decided
        // against a window none of them had joined, and walk straight through
        // the ceiling. A bound that a burst defeats is not a bound.
        ledger.admit(spendKey);
      }
      const lane = laneFor(sessionId);
      await serialize(
        lane,
        sessionKey,
        () => answerOne(lane, sessions, identified, reply, sessionId, verified, spendKey, note),
        queueAnyway,
      );
    } catch (err) {
      reply.fail(err instanceof Error ? err : new Error(String(err)));
    }
  };

  /**
   * What the host calls — {@link answerRequest} with the ingress record's one
   * funnel around it (9.32.0).
   *
   * With no sink configured this is the identity function over the host's own
   * reply: no wrapper object, no bookkeeping, no branch inside any exit path.
   *
   * `settle()` covers the one case a terminal cannot: a request that leaves
   * without ending its reply at all. The composer never does that, and the
   * `finally` is there because "never" is a claim about today's code rather
   * than a guarantee — a census with a hole in it is what this replaces.
   */
  const handler = async (request: HostRequest, hostReply: HostReply): Promise<void> => {
    const note: IngressNote | undefined =
      ingressSink === undefined ? undefined : beginIngress(request, ingressSink);
    const reply = note === undefined ? hostReply : note.watch(hostReply);
    try {
      await answerRequest(request, reply, note);
    } finally {
      note?.settle();
    }
  };
  return handler;
}
