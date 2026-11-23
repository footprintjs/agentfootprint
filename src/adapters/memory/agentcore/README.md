# AgentCore memory adapter

Sealed implementation behind `../agentcore.ts`. Only that facade and this folder
import these modules; the public memory door re-exports the facade.

| Module | One job |
| --- | --- |
| `contract.ts` | Entry-semantic client, options, payload union and service ceilings |
| `store.ts` | Existing MemoryStore lifecycle, CAS ordering and write funnel |
| `identity.ts` | Injective identity addressing and length refusals |
| `namespace.ts` | Scope admission, namespace rendering and record containment |
| `storedEntry.ts` | Blob decoding and the present-but-unreadable refusal |
| `sdkClient.ts` | Optional SDK loading and the four command translations |
| `eventPayload.ts` | Detached projection, closed-choice admission, encoding and byte bounds |

The existing native memory-write stage owns the effect. This folder adds no
chart, retry wrapper, timer, recorder or persistent projection holder. An actual
nonexpired write captures its canonical JSON entry before the unbound selector
sees a separate detached entry. The client receives another owned entry and a
captured choice. Unsupported conversational forwarding is refused after the
existing CAS read and before CreateEvent. An omitted selector keeps the old body.

The blob remains the sole persisted MemoryEntry. Source-event deletion, local
entry expiry and derived-record retention are separate lifetimes. SKIP is a
current-write extraction request, not deletion of earlier records. An SDK send
acknowledgement proves event acceptance, not completed extraction or the number
of wire attempts under the SDK's unchanged retry policy.

Whole helpers/types and the SDK mapping were moved from the former oversized
file (file-size steps 1–3); the store facade holds wiring and its lifecycle.
`agentCoreScope` moves the existing addressing bodies into the identity owner.
Behavior changes are limited to the approved optional event projection and the
adapter-specific forget documentation. No oversized source file remains here.

Behavior tests remain at `test/adapters/memory/agentcore*.test.ts`; the payload
and native-record suites exercise this sealed implementation through its facade.
`test/adapters/aws/awsCommandPin.ts` points to the SDK owner, and the model-facing
instruction classification points to the store's existing host-only refusal.
