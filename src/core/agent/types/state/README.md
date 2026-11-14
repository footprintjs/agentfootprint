# Internal stage state

These interfaces own disjoint fields of the internal `AgentState` contract.
The facade composes them; stages keep importing the existing facade. The carrier
types contain no executable code and do not import the facade or each other.

| Owner | State carried |
| --- | --- |
| `invocation.ts` | Message, run identity, counters and latest response coordinates |
| `pause.ts` | Outstanding tool, consent, ask and script checkpoints |
| `middleware.ts` | Middleware decisions and message denials |
| `output.ts` | Output attempts, validation and unmet contracts |
| `evidence.ts` | Evidence repair and unsupported-answer records |
| `budget.ts` | Budget counters and wrap-up marker |
| `delivery.ts` | Injection delivery, served requests and receipts |
| `routing.ts` | Cache, skill cursor, route, leases and engagement |
| `records.ts` | Coverage, claims and findings ledgers |
| `scripts.ts` | Script omission count |
| `honesty.ts` | Honesty-layer and argument working state |
| `choice.ts` | Tool-choice record and time line |
| `configuration.ts` | Ontology and resolved run configuration |
| `window.ts` | Window operations and durable folded spans |
| `termination.ts` | Policy halt and reliability failure carriers |
| `response.ts` | Thinking, replay and native-output evidence |

Each property keeps its existing mutability, optionality and type. Comments name
the actual writer, reader and lifetime. The outer mutability contract and
`stoppedEarly` remain on the facade, where its existing `AgentOutput` link resolves.
Tests beside these files compare the flattened contract and erased dependencies;
the runtime suites continue to test execution.
