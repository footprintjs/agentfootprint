# Flaky test records

## Turn-artifact hand-over timing

Status: fix prepared in the signal-based hosting-test PR; awaiting review and merge.
Keep this entry until the fix is merged. No test is skipped or quarantined.

- Observed in the [FootPrint consumer audit](https://github.com/footprintjs/footPrint/actions/runs/39288974493/job/118184685210):
  `test/hosting/turn-artifacts-round2.test.ts`, “Alice hangs up mid-drain”,
  expected `ok` but received `undefined`. The candidate run had one failure;
  the published baseline passed.
- Cause: a fixed 50 ms delay could abort the provider before an answer existed,
  rather than aborting the intended artifact drain. Holding the mock provider
  through that delay reproduces the same failed assertion deterministically.
  This scenario does not attach the control recorder changed by FootPrint #110.
- Fix in this PR: `hangingStore.entered` signals the actual matching put before
  aborting. A provider gate verifies that answering and draining are different
  boundaries. Sibling late-upload, retirement and interval tests also wait for
  their own operation or event, rather than guessing that a delay was enough.
- Genuine timeout and late-operation assertions remain. Signal waits have
  explicit ceilings, and periodic timers are cleaned up even on assertion failure.
- Run the regression suite with
  `npx vitest run test/hosting/turn-artifacts-round2.test.ts`.

The recorded failure is a test scheduling defect, not evidence of a runtime
regression. Any new failure still needs its own diagnosis.
