# Context package contract

This internal test library owns the four existing ContextFootprint package
contracts. `../check-context-package.mjs` remains the ordinary registry CLI.
`../context-package-contract.mjs` is the fixed, import-only facade; importing it
does no setup, filesystem IO or process execution. This is not a package export.

The facade exports `CONTEXT_PACKAGE_CONTRACT_PROTOCOL` with value
`agentfootprint.context-package-contract.v1`,
`runPairedContextPackageContract(input)`, and the registry CLI's
`runRegistryContextPackageContract()`, plus the native CLI's closed
`runStrictContextPackageContract(argv)` workflow. The paired entry has no registry fallback.
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

The context archive is packed from the actual source manifest and built output,
without version staging or relabelling. Only its two context-consumer roots install
it. The audit driver admits the exact archive/member identity before either install.
This inner archive is removed with the contract's temporary work root. A separate
retained source-candidate pack and neutral public-version checks are required for
downstream reuse; the temporary archive path is not a durable artifact receipt.

Only a complete four-case result with all actual command/guard/restoration
records may return `complete: true`. Failures carry partial evidence outside
the disposable roots; the audit driver persists it. Unit fake ports prove harness refusal and
ordering only. Real admitted installs and unchanged assertions must run in the
reviewed hosted recipe before compatibility is claimed. A paired pass is not an
unchanged registry CLI pass, ordinary CI clearance or permission to publish.

## Modules and checks

`publishedSetup.mjs` is the pure document constructor for the original source
with published FootPrint 14.6.0, Foottrace 2.3.2 and ContextFootprint 0.1.1.
The source version must agree across the source manifest, lock and package.
AgentFootprint declares the engine peer/development range `^14.3.0` and the
Foottrace range `^2.3.2`. FootPrint 14.6.0 declares its own Foottrace peer
range `^2.3.1 || ^3.1.0`, which the contract checks separately. The temporary roots
install the exact cohort versions listed above. Earlier Foottrace versions,
engine 13, the previous cohort's engine 14.0.0, engine prereleases and other
stable engine versions are outside this cohort. ContextFootprint stays exactly
0.1.1; it declares no dependency or peer of its own.
`getPublishedInputs(manifestText, lockText)` admits the exact current declared
ranges and original registry records, retaining their URLs/SRIs and document
hashes. It performs no install, resolution or archive admission. Other cohorts,
selected aliases/duplicates/overrides and malformed records refuse; this is no
general SemVer implementation. Normal strict npm resolution remains mandatory.

`sourceProductionManifest(inputs)` returns a detached temporary projection:
it drops development dependencies, promotes the required engine peer to an
exact production dependency, pins Foottrace/context, and preserves the other
authored production constraints and peers. This explicitly changes the setup
documents, not the original source oracle: the source lock marks the engine
development-only, so blindly omitting development dependencies is insufficient.
`consumerProductionManifest(inputs, artifact)` returns a fixed neutral private
module package with the original archive file URL and exact engine/Foottrace
pins. The artifact version must equal the original source version; IO owns its
hash/member/physical admission. Neither constructor writes or fabricates a lock.
The installer must generate a normal strict temporary lock before the first
production-only/scripts-off install, record both original/setup hashes, and
prove the actual physical dependency graph. The returned `policy` names this
projection; constructor tests alone prove no real install or compatibility.

The facade fixes real command IO and its owner root; the private runner composes
that IO with the fixed installation ports. Pure validation/oracle/probe modules
are tested beside their code. Adjacent fixture tests do no real install or full
build; their fake command adapters are unreachable through the paired facade.
Run them with `node --test scripts/context-package-contract/*.test.mjs`.

## Real published-cohort adapter

`../check-context-package-strict.mjs` is the thin fixed native CLI. It calls only
the owning facade, which binds its source root and paired runner before entering
`publishedDriver.mjs`. Outside callers cannot select an internal module, owner
root or installer; importing the facade still performs no setup or IO. The
private driver admits the three exact registry archives selected by the committed
lock, verifies SHA512
before decoding, and retains every member identity as data. It supplies only
code-owned installers and guards to the existing four-case runner. No JSON
supplies a command, executable, callback, expected result or policy override.

The source-family temporary production projection drops development dependencies
and explicitly promotes the required engine peer into exact production inputs;
the original lock marks that engine as development-only. This projection is
recorded separately from the immutable source documents. Each online family
starts with an empty cache and derives its strict lock before the first
scripts-off production install. Its distinct offline root reuses only that
family's admitted setup and populated cache, with actual offline mode. No
installed tree is copied and no post-install replacement occurs.

The guards join normal/hidden locks, actual package identities, real resolution
paths, complete admitted member sets and one physical Foottrace image. Every
before/after/cleanup boundary rechecks source, producer build/compiler bytes,
setup, archive and graph. Only the exact current source-owned probe descriptors
may be present. Proof references name actual persisted records outside the
runner's disposable roots; failed installs and partial evidence remain failures.

The paired runtime probes additionally run one real mock agent through the
installed public root/providers/observe doors in each native format. The driver
compares their producer versions and resolved entries to independently admitted
source and graph inputs. Registry-control probe bodies remain byte-identical;
the legacy-peer registry adapter is never strict native acceptance. These mock
runs make no provider calls. Context assertions and both declaration probes
remain in place.

CI runs this real gate on both supported Node versions, retaining complete or
partial evidence separately from the durable source candidate. Inert fixture
success is controller proof only. Neither this gate nor a source artifact is
permission to merge, publish or claim all downstream consumers are compatible.

The separate hosted FootPrint peer-floor check installs the same original package
in a fresh consumer with exact FootPrint 14.3.0 and Foottrace 2.3.2. It verifies
the installed pins and runs the existing CJS and ESM public producer probe. The
floor is separate from the strict cohort and its four installation cases.
