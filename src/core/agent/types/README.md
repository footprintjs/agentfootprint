**Support** — erased Agent contract declarations; runtime owners choose what the model sees.

# Agent contracts

This library owns the Agent's type declarations. `../types.ts` keeps the existing
import path. It publishes the public declarations and assembles the internal
stage state; every import from this folder enters through that facade.

## Responsibilities before the split

The original 2,545-line file combines public creation options, input/output,
recording options, per-run configuration and the internal state shared by stages.
`AgentOptions` has 49 members and `AgentState` has 143. Imports reach the provider,
context, memory, recording, tool, security and other lower layers. Inline type
imports also reach individual core stages. All dependencies are erased types;
the split must add no runtime import, export, object or execution path.

## Owners and boundaries

| Contract | Owner and rule |
| --- | --- |
| Public creation options | The original `AgentOptions` interface; retain its own member declarations and documentation. |
| Observer and write provenance options | `observation.ts`; use the engine's declared vocabulary. |
| Artifact and recording options | `artifacts.ts`; preserve the existing store and placement forms. |
| Per-run configuration | `configuration.ts`; keep the resolver's exact input and result. |
| Run input and output | `input.ts`; preserve conversation, identity and clock declarations. |
| External evidence provider | `grounds.ts`; preserve the synchronous external-ground contract. |
| Internal stage carriers | `state/`; disjoint domains compose the original `AgentState` interface. |

State carriers remain in core's layer. They must not move Agent-specific state
into lower-layer feature libraries, import the facade back, or add sibling cycles.
Every moved member keeps its complete type, modifiers, comments and blank lines.
Only relative type-import specifiers change to reach the same declaration.

## Completion boundary

This covers whole-declaration extraction and internal state composition. The
public `AgentOptions` declaration remains intact: replacing its own members with
inherited members changes TypeScript module augmentation, including through the
public root export. A narrowed duplicate property is refused by the original
interface and accepted by an inherited version. Keeping the declaration also
keeps its public property documentation without a second alias or documentation
copy. Its remaining size needs an explicit named owner ruling before this file
can be counted complete under the shared size rule. No size limit may be raised.

Tests beside these owners protect public augmentation, type erasure and the
existing paths. Hosted compilation, declaration generation and the existing
runtime suites remain the full gates; no golden or public door changes belong
to this split.
