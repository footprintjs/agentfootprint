# Negative answers through the running agent

The PR 6 harness measures the actual Agent path: local fixture tools execute,
native results are captured, the model supplies an answer, the checker may request
one correction, and delivery/history/memory keep the accepted result. The
[registration](RULE.md) defines the fixed 784-reply plan and its limits.

All case material and paid output must live **outside this repository**. The bank
schema is checked by `bank.mjs`; `harness.mjs` exports the frozen prompt/schema.
Tests use tiny synthetic examples, not the private held-out questions. Nothing in
this harness publishes a package, merges a PR or enables prose enforcement.

```sh
npm run build
# Freeze only after the bank, fixtures and harness are ready. The yes flag records
# the owner's acceptance of the disclosed AI-authored bank; it is not a default.
node bench/negative/full/run.mjs --mode prepare \
  --bank /private/benchmark/fresh-cases.json --out /private/benchmark/run \
  --accept-ai-bank yes
node bench/negative/full/run.mjs --mode mock \
  --bank /private/benchmark/fresh-cases.json --out /private/benchmark/run
node --env-file=/private/project.env bench/negative/full/run.mjs --mode preflight \
  --bank /private/benchmark/fresh-cases.json --out /private/benchmark/run
# Generation is explicitly selected. It is never the default.
node --env-file=/private/project.env bench/negative/full/run.mjs --mode run \
  --bank /private/benchmark/fresh-cases.json --out /private/benchmark/run
```

Preflight uses Anthropic's free token counter and stops before generation. Its
estimate separates uncached input and a nominal output allowance; it does not
claim to predict corrections, cache hits or the final bill. Each actual request
reserves its maximum cost before sending. Agent calls leave $1.00 for the two
raters. The shared cap is $4.30, including retries and raters.

`manifest.json` freezes every planned reply before any paid answer. The command
checks the bank/code hashes, saves every completed raw artifact, and refuses to
silently rerun a request whose charge may already exist. A crash leaves `run.lock`;
inspect the process and ledger before removing that lock. Unknown charges stay
reserved. A budget stop leaves the plan incomplete, not a reduced successful run.

The independent rater command prepares blind packets, rates them in two isolated
sessions, and produces aggregates plus a private owner-adjudication queue. See
`rate.mjs` for its modes. It reuses the same ledger and refuses incomplete runs.
Truth packets never contain the library's answer or checker verdict. Usefulness
has a separate packet because it must assess what the user actually received.

Rates remain provisional until every required owner decision is supplied. Even
perfect answers cannot satisfy several case-level bounds at the registered sample
sizes; the report states `insufficient-independent-cases`. That does not justify
weakening the gates or treating unmeasured work as verified.
