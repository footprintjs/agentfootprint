# Security policy

## Reporting a vulnerability

**Report privately, through
[GitHub's private vulnerability reporting](https://github.com/footprintjs/agentfootprint/security/advisories/new).**
Not a public issue, not a discussion, not a pull request — a public report is a
working exploit handed to everyone running the library before there is anything
to upgrade to.

You do not need to be certain it is a vulnerability. "This looks wrong and I
can make two tenants share a key" is a good report. If it turns out to be a
declared limitation, that is a useful answer and costs you nothing.

**What to expect.** An acknowledgement within **7 days**, and an assessment —
confirmed, declared limitation, or not reproducible — within **14 days** of
that. If two weeks pass with no reply, the report was not received: say so in a
[public discussion](https://github.com/footprintjs/agentfootprint/discussions)
without any detail of the finding, and it will be chased.

A confirmed finding gets a fix, a released version, and a published advisory
crediting you by whatever name you want to be credited under — or anonymously.
The advisory says what was wrong and which versions were affected, because a
user cannot make a decision about upgrading from a changelog line that says
"hardening".

## Supported versions

Security fixes land on the **latest minor of the current major**, and a patched
release goes out for that line. Earlier majors are not back-patched. If you are
pinned to an older major and cannot move, say so in the report — the fix can
usually be described precisely enough to apply yourself.

## What counts, and why the list is specific

This library's job is to hold one tenant's data apart from another's, and to
make a claim about a run that is actually true. So the findings that matter most
are the ones that break one of those two things:

**Isolation.** Two distinct identities, sessions, or tenants sharing a storage
key or an index. Any mapping — a session id made "safe" for a backend, an
identity flattened into a namespace, a glob built from caller data — that turns
two different inputs into one key. This is the defect class this project has
found in itself most often, so a report of it is taken seriously and reproduced
quickly.

**Scope escape.** An artifact reference resolving for someone who should not be
able to resolve it. Missing, expired, and belonging-to-someone-else are supposed
to be indistinguishable; if you can tell them apart, that is a finding, because
a leaked reference is then a key.

**Ownership.** A stored session accepting a write signed by an identity that
does not own it, or an owner index and a stored conversation disagreeing about
who they belong to.

**Redaction.** A value declared redacted appearing anywhere it should not — a
commit log, an emitted event, an error message, a recorder snapshot.

**Evidence integrity.** Anything that lets a model's own output be laundered
into the evidence corpus and come back out as grounded. A claim the library
presents as checked, that was never checked, is a security problem in a library
whose product is trustworthy claims.

**Injection through a declared surface.** Tool arguments, skill bodies, or
routing rules that reach a place they were never supposed to reach.

## What is not a vulnerability

Stating these plainly so nobody spends a weekend on a report that comes back
"working as designed":

- **A declared provider limitation.** Adapters record the things their backing
  service makes impossible, and the conformance battery reports them as
  `declared` rather than as passes. See [ADAPTER_STATUS.md](docs/ADAPTER_STATUS.md).
  If a declaration is *wrong* — the limitation is not real, or is worse than
  described — that is worth reporting, and it goes here rather than to an
  advisory.
- **Generated code doing what generated code does.** Code the model writes runs
  in a runner **you** supply, under your governance. A local runner stages
  artifact inputs; it is not a sandbox and is not documented as one. If you run
  untrusted generated code without isolation, that is a deployment choice, not a
  library defect. A way to *escape* a sandbox the library does claim to provide
  is, of course, a finding.
- **A model saying something wrong.** Model output being incorrect, biased, or
  manipulable by prompt is not a library vulnerability unless the library's own
  machinery presents it as verified when it was not.
- **Anything requiring an attacker who already has your credentials**, your
  process memory, or write access to your source.

## If you are running a field trial

Adapter trials are welcome and there is
[a form for them](.github/ISSUE_TEMPLATE/adapter_trial.yml). One rule:
**a trial finding that is security-sensitive leaves the public form and comes
here instead.** A trial that passes twelve cases and fails one on ownership
should report the twelve publicly and the one privately — that split is the
right instinct, not an over-reaction.
