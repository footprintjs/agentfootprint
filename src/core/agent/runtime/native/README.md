**Mixed** — wire captured capabilities to the original native runner.
`bindings.ts` is the **Map** of capabilities; `initialize.ts` and `host.ts`
are the **Walker** that wires them to that runner.

host.ts retains public identity as own data and passes captured native capabilities to the internal owners. It creates no executor, lease or run ID of its own. The original native component binding scenario is adjacent.

Private owner context lives in a module-owned WeakMap keyed by that same runner. The plain internal lookup reserves no application instance method or field name. Adjacent subclass scenarios also compile in the public type-regression gate, preserving existing application methods and data while native turns run.
