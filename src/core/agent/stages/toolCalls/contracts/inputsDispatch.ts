// ─── The inputs layer's half of dispatch (honesty layer 2) ──────────────
//
// The fills, the note, the rewrites' `changedKeys` and the fail-closed refusal
// live in `../../../arguments/dispatch.ts`, loaded through `import()` only when the
// layer is armed, or when a call's tool declares rules on an agent built
// without it — the optional-family law of docs-next's site budget (the
// `judgeLanded` precedent above), so a plain agent's graph never carries them.

/** The inputs layer's half of dispatch, once loaded. */
export type InputsDispatch = typeof import('../../../arguments/dispatch.js');
