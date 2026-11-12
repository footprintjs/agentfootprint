**Mixed** — bind captured capabilities to the original native runner.
`bindings.ts` is the **Map** of capabilities; `initialize.ts` and `host.ts`
are the **Walker** that wires them to that runner.

`Agent` extends the public `RunnerBase` directly and captures its protected
capabilities in its constructor. `host.ts` attaches the private owner context
under a module-private, non-enumerable Symbol before initialization. A Proxy
forwards that read; no application method or string field name is reserved.
The property is configurable so a reactive Proxy may wrap its read without
violating the non-configurable, non-writable property invariant.

There is no extra executor, lease or run ID. Adjacent scenarios cover native
component binding, transparent Proxies, hidden context, public inheritance
and existing subclass methods/data; they also compile in the public type gate.
