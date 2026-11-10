# Standing agent composition

The adjacent `standingAgent.ts` facade wires configuration, lanes, history,
artifact access, turn execution and request dispatch, and owns host shutdown.
Only the facade and this folder import these private modules. There is no index
barrel and no new public door.

Construction keeps the original validation and listener order. Factories return
plain functions; they add no promise boundaries. The pool and both artifact doors
share live state. Closing is read through a callback at the original read sites,
and shutdown reads the lazy reader at close time.

The adjacent lifecycle test covers a reader created after construction. Folder
tests cover their own boundaries; `test/hosting/` retains the transport, identity,
admission, durability, pause, recording and artifact attack regressions.
