# 012 — The conversation door: a bidirectional host port

Status: DESIGN (Round A). Nothing here is built; Round B builds exactly this and
nothing beyond it. Names are working names until a release ships them.

## Evidence (field-filed, 2026-08-04)

A production integration deployed an agent that operates the user's browser: the
browser cannot host an inbound endpoint, so it dials out and parks a connection
the agent pushes tool calls down. Their runtime (AgentCore) exposes exactly two
doors into a container — request/response and a bidirectional WebSocket on the
same port — and our `httpHost` owns its private server with no seam, so the
vendor adapter could not be used at all. Their words, kept because they are the
design brief: **"`HostRequest → HostReply` is one exchange, and this door is a
conversation."** They filed three asks; ask 1 (caller-owned server) ships as a
mini-release; ask 3 is this document.

## The anti-bias law, stated before any type

The request port stayed honest because it was designed against local adapters
first and the cloud adapter arrived as wire config. The conversation port gets
the same treatment with a stronger safeguard: it is designed against THREE
consumers at once, none of which may individually shape it —
1. the browser-parked tool channel (the field integration's, hand-rolled today);
2. AG-UI (the standardized agent↔UI protocol — the same channel, with a spec);
3. A2A serving (agent-to-agent tasks over a long-lived exchange).
A decision that only makes sense for one of the three is wrong. AgentCore's
`/ws` specifics (32KB frames, 15-minute idle, `Sec-WebSocket-Protocol` bearer,
header-or-query session affinity) are ADAPTER facts, recorded in the adapter's
own doc the way the container contract already is.

## D1 — a conversation is a session-scoped channel, not a long request

```ts
interface HostConversation {
  readonly sessionId?: string;          // caller data, same trust posture as HostRequest
  readonly headers?: Readonly<Record<string, string>>;
  send(frame: string): void;            // host → far side
  onFrame(cb: (frame: string) => void): Unsubscribe;
  onClose(cb: (reason: ConversationClose) => void): Unsubscribe;
  close(reason?: string): void;
}
type ConversationHandler = (conversation: HostConversation) => void | Promise<void>;
```
Frames are STRINGS at the port (JSON is the consumer's contract, not the
port's); binary is a capability question deferred until a consumer needs it.
`serveConversations(handler)` sits beside `serve(handler)` on hosts that can
carry it — which is exactly what the capability union is for: `'conversation'`
joins `HostCapability` only when a shipped adapter honours it (the 7.14 law).

## D2 — the ceilings are declared, not discovered

A transport that caps frame size or idles out must SAY so:
`conversationLimits?: { maxFrameBytes?: number; idleMs?: number }` on the
adapter. The port neither chunks nor keep-alives — a consumer that needs
chunking implements it above the port (the relay design in the sibling
ecosystem already specifies that pattern); a consumer that needs liveness sends
its own heartbeat frames. The port's job is to make the ceiling VISIBLE so the
layer above can act; hiding a 32KB cap inside auto-chunking would be the
adapter deciding a protocol question for every consumer at once.

## D3 — identity and auth stay out, again

`sessionId` and `headers` arrive as caller data exactly as on `HostRequest`;
bearer-in-subprotocol is an adapter mapping (AgentCore's spelling), never a
port field. Authenticate above the port; the port never proves who is calling.

## D4 — the standing agent's relationship to conversations

`standingAgent` is NOT automatically conversation-aware in Round B. The three
consumers push different things down the channel (tool calls out, UI events in,
A2A task updates both ways); baking one loop into the composer would be
consumer bias. Round B ships the port + the nodeHost upgrade-based adapter +
the AgentCore `/ws` wire; the browser-tool loop, AG-UI framing, and A2A serving
are each their own release, each consuming the same port — three proofs, three
cars, one door.

## D5 — ask 1 is not made redundant

`httpHost({ server })` (the caller-owned server, shipped ahead of this round)
remains the escape hatch for anything the port does not express. A port is a
paved road, not a wall.

## Refused in Round A (recorded so Round B does not re-litigate)

- Auto-chunking / auto-heartbeat at the port (D2's reasoning).
- Binary frames without a consumer (capability minted on evidence only).
- A conversation-aware standingAgent loop in the first release (D4).
- Any port field spelled the way one vendor spells it.

## Round B test list (minimum)

1. Conformance: one ConversationHandler served by the nodeHost upgrade adapter
   AND an in-memory test conversation host — same frames, same close semantics.
2. Session affinity: the sessionId the transport declared reaches the handler;
   a conversation and a request with the same sessionId are the same session's.
3. Declared ceilings surface on the adapter and are absent at the port.
4. close() drains politely both directions; onClose fires exactly once with the
   reason; a closed conversation's send() refuses by name.
5. The vendor-name grep pin extends to the conversation port source.
6. The AgentCore /ws wire: header-or-query affinity, subprotocol bearer mapped
   to headers, ceilings declared { maxFrameBytes: 32768, idleMs: 900000 } — and
   the conformance suite result is real verification (plain WS, no SDK).
