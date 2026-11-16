# Context package contract

This internal test library owns the four existing ContextFootprint package
contracts. `../check-context-package.mjs` remains the ordinary registry CLI.
`../context-package-contract.mjs` is the fixed, import-only facade; importing it
does no setup, filesystem IO or process execution. This is not a package export.

The facade exports `CONTEXT_PACKAGE_CONTRACT_PROTOCOL` with value
`agentfootprint.context-package-contract.v1`,
`runPairedContextPackageContract(input)`, and the registry CLI's
`runRegistryContextPackageContract()`. The paired entry has no registry fallback.
An installer first binds the NEW fixed facade to its reviewed source tree, then
checks the protocol/callable. Never import the old executable CLI to detect
support. A protocol string alone grants no source approval.

## Fixed paired input

All records have exactly the listed own data properties, ordinary Object
prototypes and no accessors or symbol keys. Strings/arrays are bounded. Unknown
fields and modes refuse. A digest is lowercase SHA256 hex; Git IDs are full
40-character lowercase hex. `ProofRef` is `{id, sha256}`: an identifier and digest
of retained evidence, never code, a fetched URL or a success assertion.
Paths are 1–4096 characters; proof IDs are 1–128 characters matching
`[A-Za-z0-9][A-Za-z0-9._:-]*`; source versions are 1–128 characters.
Probe bodies are 1–65536 UTF8 bytes. A non-null signal is 1–32 uppercase
alphanumeric characters. Exit statuses retain integers from 0 through
4294967295, including Windows statuses; only exit zero with no signal succeeds.

```text
Source = {head, tree, manifestSha256, lockSha256}
ProducerRefs = {source, install, inputs, graph, build} // each is a ProofRef
Input = {
  sourceRoot, ownedWorkRoot, source: Source,
  producerProofRefs: ProducerRefs,
  installSourceRoot: function,
  installPackedConsumer: function,
  verifySource: function
}
```

`sourceRoot` must be this facade's actual owner root. `ownedWorkRoot` is an empty
real task directory outside it. The runner creates/removes only its own child
there; it never removes the supplied parent. Original manifest/lock hashes must
match actual source files. The caller supplies no expected context value,
command, executable, module path, case subset or assertion replacement.

The two install functions receive the following fixed request and return a
code-owned `{receipt, verify}` handle. No function comes from a plan or JSON.

```text
Request = {
  protocol, source: Source, caseId, rootRealPath,
  originalManifestText, originalLockText,
  policy: {omitDev: true, scripts: false, peers: 'strict', offline},
  cache: {family, realPath},
  contextArtifact: null | {path, sha256, sourceVersion},
  probes: [] | FourProbeDescriptors
}
Receipt = {
  protocol, source: Source, caseId, rootRealPath,
  setup: {manifestSha256, lockSha256}, policy, cache,
  installExitCode: 0, contextArtifact,
  proofRefs: {source, install, inputs, graph}
}
```

Cases are exactly `source-online`, `source-offline`, `consumer-online`,
`consumer-offline`, in that order. Each is a new root. Online starts an empty
owned source/consumer family cache; offline uses only that family's populated
cache and admitted local inputs, with actual offline mode. Every root needs its
own temporary lock BEFORE first strict production-only/scripts-off install. No
force, legacy peers, broad override or post-install replacement. The ordinary
registry adapter's old peer relaxation is never paired evidence.

AF validates receipt/request equality, hashes actual setup files and checks
actual installed context records against its original source oracle. The audit driver admits
the richer source/plan/run/archive/member/physical graph and proof references;
this library does not duplicate its parser or materializer. A callback's zero
exit field or shape validation alone is not proof that installation occurred.

## Every command has guards

Commands are only `source-cjs`, `source-pack`, `packed-cjs`, `packed-esm`,
`packed-types`. Their argv, source bodies and expectations belong here.
`source-pack` uses `verifySource`; each inner command uses its install handle's
`verify`. The packed-types guard additionally binds the producer-owned compiler,
its actual bytes/toolchain inputs and original toolchain-lock provenance.

```text
Boundary = {
  protocol, source: Source, caseId, rootRealPath,
  command, phase, execution, probes
}
GuardReceipt = {boundary: Boundary, setup, proofRefs}
```

For producer packing, `caseId` is null, root is the producer, and proofRefs are
ProducerRefs. Inner proofRefs have the same four keys as InstallReceipt.
`phase` is `before-command`, `after-command` or `after-cleanup`. Execution is null
before a command; after it is `{exitCode, signal}` with the actual integer exit
or null and actual signal or null. No command/exit is invented for cleanup:
after-cleanup has `command: null`, `execution: null` and an empty probe set.

A before-guard failure prevents execution. EVERY executed command, including a
failed one, gets an after guard. Guard records must echo the exact boundary;
actual setup hashes remain unchanged. The audit driver verifies all admitted member bytes,
source inputs and the one expected physical engine/Foottrace/context graph.
Preserve a command failure as primary and guard/cleanup failures as secondary.
No missing phase yields completeness. After removing probes, every installed
root gets the closed `after-cleanup` check BEFORE deleting the root.

## Four owned probes

AF renders the original bodies, including escapes, with their actual root:

| ID          | Relative installed-AF path | Present phases    |
| ----------- | -------------------------- | ----------------- |
| runtime-cjs | `.context-smoke.cjs`       | runtime and types |
| runtime-esm | `.context-smoke.mjs`       | runtime and types |
| types-mts   | `.context-types.mts`       | types only        |
| types-cts   | `.context-types.cts`       | types only        |

Descriptors are `{id, relativePath, body, sha256, size, phase}`. Digests cover
rendered UTF8 bytes, not raw template slices. Baselines must be absent; create
exclusively and refuse aliases, collisions, wrong bytes/size, unexpected present
sets or any other file mutation. The audit driver admits only these finite source-owned
additions. Never ignore a wildcard `.context-*`. Remove only files this run
created, including on failure, then verify the restored graph.
Descriptor phase literals are `runtime-and-types` for the runtime pair and
`types-only` for the declaration pair; command boundaries select the exact set.

## Artifact and result scope

The original manifest/lock retain the exact ContextFootprint version, public
registry URL and SHA512 oracle. Every installed root still has exactly one
matching context entry. All source CJS and packed CJS/ESM conflict, legacy-key,
witness/shared-helper/own-JSON assertions and both declaration modes remain.

Packing occurs BEFORE native version staging. The context archive is newly
built SOURCE14.7.2 from the 13/2 inputs, never registry14 bytes or a final15
artifact. Only its two context-consumer roots install it. The audit driver admits the exact
archive/member identity before either install. The later native15 pack and
neutral public-version checks are separate required receipts.

Only a complete four-case result with all actual command/guard/restoration
records may return `complete: true`. Failures carry partial evidence outside
the disposable roots; the audit driver persists it. Unit fake ports prove harness refusal and
ordering only. Real admitted installs and unchanged assertions must run in the
reviewed hosted recipe before compatibility is claimed. A paired pass is not an
unchanged registry CLI pass, ordinary CI clearance or permission to publish.

## Modules and checks

The facade fixes real command IO and its owner root; the private runner composes
that IO with the fixed installation ports. Pure validation/oracle/probe modules
are tested beside their code. Adjacent fixture tests do no real install or full
build; their fake command adapters are unreachable through the paired facade.
Run them with `node --test scripts/context-package-contract/*.test.mjs`.
