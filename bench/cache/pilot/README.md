# Findings cache pilot: setup for review, no paid run yet

This kit compares the public Phase A package with the reviewed Phase B package.
Both have the same citation enforcement. It is not a comparison against the old
permissive admission policy. Do not run the paid path before the owner’s external
review of the final kit/manifest and cap tests. The existing approval is Haiku 4.5
only, at most $10 for this one paired synthetic pilot; it is not approval for a
second run, another model, customer data or an automatic retry.

## Frozen experiment

`manifest.json` pins the model snapshot, both archive digests, the complete
installed fixture, the kit/payload digests and the execution order. The candidate
is the unpublished package from Phase B commit `201b07ae`; its package version
still says 10.9.0 because release preparation is separate. The two packages have
different bytes. No package version, public export or runtime API is changed here.

Two small paired cases reuse `../verify-fixture.mjs`’s deterministic inventory:
one live lookup, then a case where a second observation supersedes the first.
Order is baseline lookup → candidate lookup → candidate conflict → baseline
conflict. There is one replicate per case, no warm-up calls. Fixed, equally long
arm labels partition the cache so one group cannot warm the other’s prefix.
They are disclosed experimental context differences, not production identifiers.
The tool/schema/task/limits are otherwise shared. Different model outputs and
history collapse can still change the later prefix; a cache miss is a result.

Five unchanged enforcement modules are SHA-pinned in **both** installs. Before
any paid transport is even constructed, each package runs the same four $0
canaries: valid, unserved, ambiguous and same-batch IDs. A mismatch refuses the
experiment. Recorded standing identity outcomes, refusal counts, extra calls and
literal planted-answer fidelity are reported; they do not certify assertion
truth or semantic correctness in general.
Package/SDK entries load from absolute paths inside the admitted install;
the unverified consumer root’s name and exports cannot redirect module loading.

## The spending cap is admission, not an after-the-fact counter

Every transport call first synchronously appends and `fsync`s a reservation.
It is never refunded, even after successful low usage. Timeout, missing usage,
invalid counts, transport failure or uncertain journal state halt further calls.
Late responses cannot settle a timed-out reservation. The two groups share one
allowance. Existing state cannot be reopened or reset by changing `--out`.
Deadline and cancellation are checked again at actual dispatch. A refusal there
is recorded as not sent, with its reservation retained, rather than uncertain usage.
An incomplete journal has no trustworthy final measurement and is never replayed
as another paid attempt.

| Bound                                     |                     Frozen value |
| ----------------------------------------- | -------------------------------: |
| Approved cap                              |                        $10 total |
| Model                                     | `claude-haiku-4-5-20251001` only |
| Total reservations / per group / per case |                       16 / 8 / 4 |
| Wire request                              |          96,000 UTF-8 JSON bytes |
| Output                                    |    at most 1,024 tokens per call |
| Model-call wait / shared execution window |          45 seconds / 10 minutes |
| Reservation per call                      |     405,120 micro-USD ($0.40512) |
| All 16 reservations                       |   6,481,920 micro-USD ($6.48192) |

The reservation deliberately prices the **entire 200,000-token model window**
at the higher $2/million one-hour-write rate, plus 1,024 output tokens at
$5/million. The request actually permits only default/five-minute cache points,
plain text/custom `lookup` tools and standard capacity. No character/token
estimate or hopeful cache hit shrinks the reservation. The exact integer proof
is in the budget test. No token-counting request or separate paid checker runs.

These are USD API-token bounds under the frozen verified tariff, not a claim to
control other programs, account charges or tax. Recheck the linked official
tariff and model limits at the execution review; if they differ, stop and review
an updated plan. Never silently update prices, model, data or scope. Sources
checked **2026-10-20**: [model/window and prices](https://platform.claude.com/docs/en/models/haiku-4-5/overview),
[cache pricing](https://platform.claude.com/docs/en/about-claude/pricing),
[request/service-tier contract](https://platform.claude.com/docs/en/api/messages/create).
[Token counts are estimates](https://platform.claude.com/docs/en/build-with-claude/token-counting),
which is why they cannot protect this cap.

The SDK gets zero retries and no streaming path. Each reservation constructs a
client with a fixed first-party Messages destination, redirects disabled and a
one-HTTP-attempt allowance. Responses are bounded at 128 KiB. SDK logging is off.
There is no fallback, server tool, thinking budget, credential-bearing transcript
or raw SDK error saved in the report.
Usage accepts only the documented token counts and known standard/global
metadata, with no paid server-tool or thinking counts. Unknown fields, regional
pricing, unexpected tiers or new charge classes halt as unknown; arbitrary
response metadata never enters the durable journal.

## Prepare and rehearse for $0

Use the reviewed baseline/candidate archives (digests in `manifest.json`) and a
fresh fixture directory with this install, scripts disabled:

```sh
npm install --prefix /path/to/pilot-consumer --ignore-scripts --no-audit --no-fund --omit=optional --legacy-peer-deps \
  af-baseline@npm:agentfootprint@10.9.0 \
  af-candidate@file:/path/to/reviewed-phase-b.tgz \
  footprintjs@10.2.1 foottrace@1.6.0 contextfootprint@0.1.1 @anthropic-ai/sdk@0.125.0
npm run build
node bench/cache/pilot/inspect.mjs /path/to/pilot-consumer
node bench/cache/pilot/run.mjs --consumer /path/to/pilot-consumer --out /path/to/new-rehearsal.json
```

`inspect.mjs` prints a proposal; it never changes the accepted manifest. If
the closure/kit/payload differs, investigate and review that difference. Do not
replace an expected digest just to make a test pass. Node 22/24 are supported.
The normal path never imports the live module or looks up an API key. Its usage
is scripted with **zero cache reads**; money/cache-hit measurements are `null`,
and no saving is claimed. Cap reservations in a rehearsal are synthetic, not
dollars spent. Both actual packages and the real wire adapter are still used.

## Paid path, held for review

After final external review, use only the already approved environment-file
loading method from the owner’s handoff. Never read, copy or print that file or
its values. The CLI additionally requires `--execute` and
`--approve-manifest <exact SHA256 of manifest.json>` with the same consumer and
a new private output file. This PR does not run that command or enable CI to do
so. It does not schedule a future call. The live journal’s identity is fixed at
`~/.local/state/agentfootprint/pilots/findings-cache-phase-c-20261020.ndjson`,
irrespective of the checkout, manifest revision or report path. Do not delete
that journal to repeat the pilot.

The report keeps raw input/write/read/output categories, per-run costs, missing
usage, fixed reservations, actual request hashes, synthetic request/response
bodies and policy outcomes. It excludes headers, keys and SDK error text.
Unfinished pairs and unknown usage are not complete cost/savings evidence.
Small sample size, timing, arm partitioning and any fidelity/refusal difference
must accompany any later interpretation; no saving is promised by this setup.

## Free checks

```sh
npx vitest run test/cache/findings-pilot-budget.test.ts test/cache/findings-pilot-runner.test.ts
```

The tests include shared in-flight reservations, failed durable writes, an async
journal refusal, timeout with a late response, unknown/partial usage, request
limits, real SDK fake-network/no-retry behavior and a process exiting at
transport entry. Its durable reservation remains, and reopening is refused.
