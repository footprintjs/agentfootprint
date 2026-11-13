**Mixed** — internal owners extracted from the documented Agent facade.
`runOptions/options.ts` is the **Map** of declared run options;
`conversation/checkpointParts.ts` is the **Fold** of detached checkpoint values.

Each child owns one rule and has its own README and adjacent behavior tests.
`runOptions/options.ts` declares existing run options; `conversation/checkpointParts.ts`
reads detached conversation values. There is no `index.ts` and no import back
to `Agent` or `AgentBuilder`. The public path stays `core/Agent.ts`.

Per-run facts belong to their captured native invocation or component. Static
configuration may be retained; dynamic accessors are never replaced by cached
copies. Extraction preserves validation, async boundaries, event and finalizer
order, optional-key shapes and public documentation.
