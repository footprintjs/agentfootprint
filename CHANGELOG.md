# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [9.117.0] - 2026-09-26

### Added

- **A sign-in cookie never reaches a handler, and a socket closes when its sign-in ends.** Build `nodeHost`/`httpHost` with `signIn: { identity }` and the transport strips the sign-in cookie (`__Host-Http-af-signin`) from every header bag it hands onward and passes its SHA-256 key instead (`HostRequest.signInKey`, `HostConversation.signInKey`). `IdentityVerificationOptions` gains `signIn` (a `SignInSource`; `verify` may then be left out) and `tokenHeader`; `verifyRequestIdentity` takes the key as a fourth argument. A token and a sign-in on one request are refused as the new `IdentityFailureClass` `'two-credentials'`; an ended sign-in is `'expired'`; a sign-in store that cannot answer is 503. The conversation door verifies each handshake before the 101, re-checks a sign-in before every inbound frame, and closes the socket (1008) when it ends. New from `agentfootprint/hosting`: `readSignIn`, `withoutCredentials`, `signInKeyOf`, `signInSource`, the `SignIn`/`SignInStore`/`SignInSource` ports, `SIGN_IN_COOKIE`. Unset, both doors behave exactly as before. The ingress record now carries `identityFailure` on refusals the host itself answered, too. `IdentityVerificationOptions` itself is unchanged for 9.26 code (`verify` stays required); a door that takes sign-ins only is a `SignInOnlyIdentity`, and every door accepts either as a `DoorIdentity`. A host built with `signIn` refuses to boot with the browser rules off (`allowedOrigins: 'any'`, `requireJsonContentType: false`, `allowedHosts: 'any'`, or no `allowedHosts` on a non-loopback bind). `withoutCredentials(headers, { also })` removes the deployment's own token header too, and knows the common proxy and platform token headers and `sec-websocket-protocol`. Frames waiting on the sign-in re-check count against `maxPendingBytes` (1009 past it).

- **Sign in with a Windows password against plain Active Directory — PENDING INDEPENDENT REVIEW: do not rely on it in production until it has been reviewed.** `IDENTITY_STRATEGY=directory-password` (with `IDENTITY_LDAP_URL`, `IDENTITY_LDAP_CA_FILE`, `IDENTITY_LDAP_DOMAIN`, `IDENTITY_LDAP_NETBIOS_DOMAIN`, `IDENTITY_LDAP_BASE_DN`, the AD lockout threshold and window, and optionally `IDENTITY_LDAP_REQUIRED_GROUP`) puts a username-and-password sign-in door in front of Active Directory over LDAPS (`directoryPasswords` and `ldapDirectory`, from `agentfootprint/security`; `ldapts` is an optional peer). `ldap://` is refused; the certificate chain and host name are checked, and the boot refuses a CA file that holds no CA certificate or a base DN that does not parse. An empty password, or one holding a control character, never reaches the directory; `CORP\alice` and `alice@corp.example` are accepted for the configured domain. After the bind, RFC 4532 Who-am-I decides who signed in and exactly one entry is found for that account — the id is its `objectGUID` — so a renamed account whose explicit UPN collides with a colleague's name can never be given the colleague's conversations. A required group is checked with nested membership. Every wrong credential gets one answer (AD's sub-code is logged server-side) and a directory that is down answers 503. Attempt limits come from AD's own lockout policy: a third of the threshold per ACCOUNT (`alice`, `ALICE` and `alice@corp.example` share one budget, through the new `PasswordChecker.budgetKey`), counted as attempts start, and reset only a full window after the LAST failure, as AD resets its own counter; a bind that timed out after it was sent stays counted (`PasswordCheckUnreachableError` marks the only attempts given back). A third because an account whose UPN prefix differs from its `sAMAccountName` has two logon names; this reduces the lockout risk and cannot rule it out. A threshold of 1 or 2 refuses to boot unless `IDENTITY_LDAP_ACCEPT_LOW_THRESHOLD=yes`, whose banner says the door cannot protect those accounts. The banner says that a password bind bypasses the company's MFA. Do not rely on it in production until an outside security review is done.

- **Choose how callers prove who they are from config, and refuse an app's own token posing as a person.** `identityFromConfig(identityConfigFromEnv(process.env), { production })` (from `agentfootprint/security`) judges a deployment's `IDENTITY_*` settings once at boot and returns `{ strategy, identity, banner }` for `standingAgent`. Production must name its strategy, even `open`; an unknown strategy or key, keys set with no strategy, a missing required key and a discovery document that names the wrong thing each refuse to boot with an `IdentityConfigError` naming the key, while an unreachable identity provider starts the app, says so in the banner, and answers 503 until it is back. The strategies are `open`, `oidc-token`, `local-password`, `directory-password` and `proxy-token` (each described in its own entry); a setting a later release reads is named and refused as "not in this release", never ignored. `oidcIdentity` is the `oidc-token` verifier: everything `jwksIdentity` checks, plus OpenID discovery, AD FS's `access_token_issuer`, a required id claim with no `sub` default, and the person test — the required scope, no app-only shape (`idtyp: app`, `oid` equal to `sub`, roles without a scope), and a listed client (`azp` / `appid` / `cid` / `client_id`). `IdentityFailureClass` gains `'not-a-user-token'`, `'wrong-client'` and `'roles-unknown'` (Entra group overage is refused, never read as "no roles"): a consumer's exhaustive `switch` over that union must add the three words. Hardened before release: `IDENTITY_ALLOWED_CLIENTS=any` is refused in production (every listed client must have service accounts turned off — on Keycloak and Okta a service account's token carries your scope); discovery never follows a redirect, and an `http` key set is refused in production; clock tolerance is at most 300 s; a caller's 503 is a fixed sentence (the reason goes to the server log); after an outage boot a later misconfigured answer is retried, not final; a setting containing a control character and a lower-case `identity_*` name are refused; `oidcIdentity` refuses `HS*` algorithms; a hosting platform's `IDENTITY_ENDPOINT` / `IDENTITY_HEADER` are skipped by `identityConfigFromEnv`.

- **Browser sign-in through your identity provider — PENDING INDEPENDENT REVIEW: do not rely on it in production until it has been reviewed.** `oidc-token` can now sign people in through the browser with the OpenID Connect authorization-code flow (`oidcSignIn`, from `agentfootprint/security`, over `openid-client` as an optional peer): set `IDENTITY_PUBLIC_URL`, `IDENTITY_CLIENT_ID` and one client credential (`IDENTITY_CLIENT_KEY_FILE` for `private_key_jwt`, preferred, or `IDENTITY_CLIENT_SECRET_FILE`) plus `IDENTITY_SCOPE`, and `identityFromConfig` returns a sign-in door in `redirect` mode. `GET /auth/login` checks `returnTo` (never off the public origin), makes `state`, `nonce` and a PKCE verifier (`IDENTITY_PKCE=off` only for AD FS 2016), and seals them into a per-attempt `SameSite=Lax` cookie — nothing is written on the server (`IDENTITY_COOKIE_KEY_FILE` shares the sealing key across replicas). `GET /auth/callback` opens the transaction and matches `state`, clears it whatever happens, exchanges the code, checks the ID token, reads the person from an ACCESS token for this API through the strategy's own `verify` (so a browser sign-in and a bearer token give the same id), and answers a 303 with `Referrer-Policy: no-referrer`; failures carry a reason code, never the IdP's words. `IDENTITY_RESOURCE` is sent as AD FS's `resource`; sign-out answers the IdP's end-session URL. `IDENTITY_AUDIENCE` equal to `IDENTITY_CLIENT_ID` now refuses to boot. So does a sign-in that could never work — `openid-client` not installed, a client key that is not RSA or EC P-256, a discovery document without an authorization or token endpoint, or PKCE required and `S256` not offered (`RedirectSignIn.ready()`, `OidcSignInSetupError`); an IdP that is merely unreachable at boot is not a refusal, and run-time failures are logged by class once per change. An IdP that advertises RFC 9207 must put `iss` on the callback. One browser holds at most three pending sign-in attempts (a login expires the older ones), and `returnTo` is kept only up to 512 bytes and never names the door itself, so no page can stack enough cookies to make the app answer 431. Built and tested against a fake identity provider, a real headless browser and a Keycloak rehearsal; do not rely on it in production until an outside security review is done.

- **Behind an authenticating proxy: `proxy-token`.** `IDENTITY_STRATEGY=proxy-token` verifies the token a company login proxy (oauth2-proxy, `mod_auth_openidc`, Pomerium) forwards on every request, instead of trusting the proxy's word for who the person is. The proxy must forward an ACCESS token for this API (`IDENTITY_PROXY_TOKEN=access-token`; `id-token` is refused, because an ID token's audience is the proxy's own client and it carries no scope), in the header `IDENTITY_PROXY_HEADER` names (default `authorization`; otherwise a custom `x-…` header — `cookie`, other standard headers and `x-forwarded-user` are refused). `IDENTITY_PUBLIC_URL` is the origin alone. There is no discovery: `IDENTITY_JWKS_URL` (https, never fetched through a redirect) and a literal `IDENTITY_ISSUER`. The person test and the client check run as for `oidc-token` (`IDENTITY_ALLOWED_CLIENTS` names the proxy's client). It refuses to start without the host's door guard lists, since the proxy's cookie rides along on forged cross-site requests, and the banner says the app port must be reachable only from the proxy: a person with their own valid token could otherwise skip what the proxy enforces beyond identity. `identityFromConfig` reports mode `'proxy'`.

- **A browser sign-in door, and `local-password` for development.** `signInDoor` (from `agentfootprint/hosting`) serves `GET /auth/config`, `GET /auth/me`, `POST /auth/login` and `POST /auth/logout`. The browser holds only an `HttpOnly` `__Host-Http-af-signin` cookie (`Secure; SameSite=Strict; Path=/`, 8 hours; `af-signin` without `Secure` on a plain-http localhost URL, development only); the server keeps the sign-in by the cookie value's SHA-256 in a `SignInStore` — `memorySignIns()` is bounded (10 000 live sign-ins; a full store refuses a new one) and per process, and the banner says so. A login runs the door guard unconditionally, reads JSON only, answers a bad body with a fixed sentence, refuses an empty password before any check, gives every wrong credential one answer after a minimum time, grows a delay per name before refusing it (429) and a delay per address that never refuses, and ends a sign-in already present. A password holding a control character is refused before any check. Sign-ins end after 8 hours or 60 idle minutes; logout closes the sign-in's open sockets. `IDENTITY_STRATEGY=local-password` (refused in production) builds all of it from `IDENTITY_PUBLIC_URL` and `IDENTITY_LOCAL_USERS` — scrypt-hashed entries only, made with `hashPassword` from `agentfootprint/security` — and `identityFromConfig` now returns `mode`, `signInDoor` and `hostSignIn`. A key only another strategy reads is refused by name, never ignored. A public URL with a path is refused: the door runs at the origin's root. Attempts are counted when they start, under the key the password checker names (`PasswordChecker.budgetKey`), and a name's counter resets a full window after its LAST attempt: one check per name is in flight at a time, at most 4 checks run door-wide (32 wait, then 503 with `Retry-After`), so a parallel burst gets no more guesses than the per-name budget. The per-name budget refuses; the per-address budget only delays (a proxy must not let a stranger lock everybody out), IPv6 is counted per /64, and `trustedProxies` takes IPs and CIDR ranges (a typo is refused). Each account keeps at most 10 live sign-ins, expired rows (and, with `idleMinutes`, idle ones) are swept, and a full store refuses a new sign-in (503) instead of ending someone else's. scrypt costs are capped at 256 MiB per check and p ≤ 4, every entry of a list must share one cost, and names are Unicode-NFC-normalised. `IDENTITY_SIGN_IN_HOURS` is at most 168.

### Changed

- **`jwksIdentity` refuses a token with no `exp`.** A correctly signed token without an expiry used to verify and never expire, because `jose` checks `exp` only when a token carries one. It is now refused as `unverifiable`. For a custom `backend` that skips the clock checks, the library now also refuses an expired token (`expired`) and a not-yet-valid one (`not-yet-valid`), with the same clock tolerance. A token that never expires is a credential that can never be revoked by time, which is why this closes it.

  Migration: a deployment whose tokens carry no `exp` stops verifying them after the upgrade (the caller gets `unverifiable`). Configure the identity provider to issue an `exp` on every access token before upgrading; there is deliberately no option to accept tokens without one. A custom `backend` needs no change — the clock checks now run for it too, with the same `clockToleranceSeconds`.

- **`jwksIdentity` reads a roles STRING as one role.** A roles claim holding `"Not app-users"` used to be split on spaces into `Not` and `app-users`, so a group name could satisfy a check for a role it does not name. A single string is now one role, taken as given — no longer trimmed, so `" admin "` is the role `" admin "` (an array still gives one role per entry). `rolesClaim` also takes a path, `['realm_access', 'roles']`, for nested roles.

  Migration: if your roles claim really is ONE space-delimited string (for example an OAuth `scope` read as roles), pass `jwksIdentity({ rolesFormat: 'space-delimited' })` to keep the old split. A roles claim that is an array, or a single role name, needs no change. A role check that relied on surrounding spaces being trimmed must compare the exact string the token carries.

### Security

- **One agent serving many people: a resume belongs to the person whose run it resumes, and self-explain reads only the asking conversation.** These fixes apply to `standingAgent({ agent })` (one agent, many sessions), to pooled agents, and to direct hosts. There is also one new door.

  - **`Agent.resume` knows who the run is for, and a run has one identity.** A resume used to inherit the identity of whatever the instance ran last. That identity was what `checkpoint()` stored, what every event's `EventMeta.principal` carried and what a tool's `ctx.identity` saw. On a shared agent, bob's resume failed with `ERR_SESSION_OWNERSHIP_CONFLICT` after his approved tool had already run. At an open door, an ownerless session was moved under another person's principal. On a pooled agent, an owner whose instance was evicted between the pause and the resume was locked out.
    - A resume now takes the identity the paused run's caller named, read from the checkpoint. An identity the library derived (a session's, or the per-run default) is never promoted to a person, and one a caller named is never dropped.
    - One run, one identity, fail closed. A resume that names an identity must name exactly the one the run's memory namespace and credentials are restored with, because a resume never re-seeds them. Otherwise it is refused before anything runs, with `ResumeIdentityConflictError` (`ERR_SESSION_OWNERSHIP_CONFLICT`). That includes a different person, an ownerless pause (one that named nobody) resumed by a named person, and a checkpoint whose own fields disagree. The ownerless case may later be relaxed behind an explicit opt-in, never by default.
    - A resume that names no session takes the session the paused run recorded in its own state (`runSessionId`, now written on every session-bound run, and `null` on a named run with no session). A checkpoint written before that key existed is never filed as sessionless: its session is recovered from the session rung, or from the named identity's `conversationId`.
    - An identity that is not one (a field that is not a string, or no field at all) is refused with a `TypeError` when the run begins, not at a resume that could never succeed.
    - A checkpoint names who it is for, but it is not proof. A host that lets checkpoints leave its trust boundary must sign them, or keep them server-side, and pass the identity it verified.
  - **Self-explain keeps evidence per conversation.** `.selfExplain()` used to serve "the previous completed run" of the INSTANCE. On a shared agent, bob's why-question was answered from alice's snapshot and narrative, her message text included.
    - Evidence is now kept under the conversation each turn ran for, in key spaces no client string can enter: a session's key is namespaced, whatever its id.
    - A request `standingAgent` serves without a session, signed in or not, is its own conversation, keyed by a random UUID that no later request can name. Those one-shot conversations are kept on their own small shelf, so a flood of them never evicts a session's evidence. Only a direct, unhosted run with no session shares the no-session key. The composer's own lane and latch keys are namespaced the same way, so a session id spelled like one of them is just a session.
    - A tool's retained inner runs (`flowchartAsTool` / `runbookAsTool` with `keepRecord: true`) are keyed by run and call id. They are served only to the conversation whose runs made them, including a run that paused or failed.
  - **New: `handle.artifactsForRequest(request)`.** The handle `standingAgent` returns can now hand a host the artifact store bound to the scope a redemption by the same caller would read. This covers paths that are not a turn, such as a read by ref before the run or filing from an app-owned route.
    - It runs the redemption door's own verifier, session-id check, ownership rule and scope composer, and never builds or evicts an instance.
    - "The caller" means what the door knows: the person the token proves, or at a door with no verifier, the session id and the claimed user.
    - It answers `{ bound: true, artifacts }` or a reason: `'unverified'` (including a repeated `authorization` header), `'unavailable'` (the identity provider is down), `'no-session'`, `'invalid-session'`, `'not-found'` or `'no-store'`.
    - The verbs count against `artifactOpsPerSession`. A call started after the binding's instance is retired, or after the host closes, is refused with `RequestArtifactsRevokedError`.

  ```ts
  const STATUS: Record<string, number> = { unverified: 401, unavailable: 503, 'invalid-session': 400 };
  const scoped = await handle.artifactsForRequest({ sessionId, headers: req.headers });
  if (!scoped.bound) return res.status(STATUS[scoped.reason] ?? 404).end();
  const payload = await scoped.artifacts.get(ref); // null: missing, expired or not yours
  ```

- **An Error inside an event, a recording or a tool result no longer writes its custom properties, its `toJSON` output or its stack (such as an axios error's `Authorization` header) to any sink, stream or stored recording. A read at the artifact door no longer evicts anyone's instance.**

  - **One wire rule for Errors.** A tool that returned or passed along an error from a client library could put that error in an event payload, a recording and the tool-result text. `JSON.stringify` wrote the error's own enumerable properties, or, for a real `AxiosError`, what its `toJSON` returns: its request config (headers included) and its stack. For an axios error that includes the `Authorization` header. It was written to the NDJSON file, the audit export, CloudWatch / AgentCore, X-Ray metadata, OpenTelemetry attribute text, the console default, the browser stream (`toSSE`), the recording artifact and file sink, the bug-report bundle, and the tool-result message the model reads and `history` keeps. Every Error is now written as `{ name, message, code? }` plus a bounded `cause` chain, and nothing else.
    - The rule reads the raw value, so an Error's `toJSON` never pre-empts it, and an Error that a `toJSON` returns is rendered too.
    - "An Error" means `Error.isError`, `instanceof Error` or Node's `util.types.isNativeError`, so a Proxy around an Error and an Error from another realm are rendered on every supported runtime, and a spoofed `Symbol.toStringTag` is not an Error.
    - The detached path renders the same way before it copies an event, including Errors inside a Map or Set, so both delivery paths write the same bytes.
    - A value that holds no Error serializes exactly as before.
    - A test refuses any new direct `JSON.stringify` in these modules.
    - Measured cost on a 553 KB event: 2× the time of a plain `JSON.stringify` on the sync path (0.92 ms vs 0.46 ms), and 1.6× the time of a plain copy on the detached path (`bench/wire-json.mjs`).
  - **Redemptions never build or evict a pooled instance.** At a door with no verifier, anybody naming made-up session ids in `artifact-head` / `artifact-get` / `answer-account` (or `handle.artifactsForRequest`) built one pooled instance per id. Each one evicted the least recently used idle session and closed its tool sessions as `'evicted'`. The door now answers from the session's live instance. A session with no live instance and no stored conversation gets the usual not-found. A session whose instance was evicted is answered by one reader instance held outside the pool, which never counts toward `maxActiveSessions`.

## [9.116.1] - 2026-09-25

### Changed

- **Agents that don't use `.findings()` no longer bundle its answer-text
  scanner.** The scanner that strips `_findings` notes from the answer and the
  token stream (`findings/answerText.ts`) is now loaded on first use, only
  when `.findings()` is on — the way the findings judge already loads. A browser
  or edge bundle of a plain agent is about 3 KB gzip smaller. Behaviour is
  unchanged for findings agents.

## [9.116.0] - 2026-09-25

### Added

- **The `answer-account` wire op — "Explain this answer", served.** `standingAgent({ answerAccounts })` opts a host in; a request `{ op: 'answer-account', ref }` (the ref of an answer's recording) then returns `{ account, shown }` — the `AnswerAccount` computed on the server and the allow-listed leaf values behind its "show me" pointers, keyed by the new `answerAccountPointerKey(pointer)` from `agentfootprint/observe`. The browser never downloads a recording to explain an answer; the whole reply is at most 192 KB. The op is a branch of the `artifact-get` redemption, so it takes the same door guard, the same ownership check before any lane, and never waits behind a run. It checks the record silently BEFORE its cache, so a swept or expired recording answers "not available" even when its account is cached; every failure is the one `ERR_ARTIFACT_NOT_FOUND` except a recording over the host's ceiling (`maxRecordingBytes`, default 16 MiB), refused as `RecordingTooLargeForAccountError` (`ERR_RECORDING_TOO_LARGE_FOR_ACCOUNT`, 413) before any of it is read. Concurrent requests for one answer share one computation; results are cached per (scope, ref, template-set version, declarations digest), failures never. A miss leaves exactly one `artifacts.resolved` fact on the record, a hit none. The app's `declarations` are validated when `standingAgent` is called and are never taken from a request. Measured on a 5.3 MB field recording: parse ≈ 6 ms, account + show-me under 1 ms warm.

- **`accountForAnswer` — explain one answer from its recording, in plain words, with who vouches for every line.** `accountForAnswer(recording, declarations?, { runId? })` (from `agentfootprint/observe`) returns an `AnswerAccount`: seven rows — You asked · It understood · It checked · It did not check · It found · How sure · Anything wrong — and a one-line summary. Every line is filled from the run's record by a fixed, versioned template (never a model), carries its template `id@version`, and is vouched by its weakest input: the person, the library's own record, a tool's declaration, the model's declaration, or the app (data the app declares when the report is made, like a skill's plain label or where a wrapper result keeps its rows). A missing fact prints "not recorded" or "cannot be told", never a guess; a claim that something did NOT happen needs the record to prove it. The account reads only its own run's events (keyed on the agentfootprint run id, never `snapshot.runId`), proves "in front of the model" by the answering iteration's context witness (earlier answers only), and runs three checks — the decided skill reached the model; a tool said it did not check whether the thing asked about exists; an empty result that did not declare what it searched — listing a check it could not run as unreachable. Pure and bounded: no clock, network or model; the same inputs give the same bytes; at most 128 KB. The hosting op that serves it (and its allow-listed "show me" leaves) ships separately.

- **A coverage item can say itself in plain words, and say whether it is about existence — on the record, never in the model's request.** Any item in `absent()` / `coverage()` (or a hand-built envelope's `checked` / `not_checked` / `cannot_cover`) may carry `short` — a short plain form of `what`: at most 80 characters of one line of plain visible text (no control, line/paragraph-separator or invisible format characters such as bidi overrides and zero-width spaces), never longer than `what` — and, on a not-checked or cannot-cover item, `kind`: `'existence'` (whether the thing asked about exists at all) or `'scope'` (outside what the tool reaches). `tools.absent`, `tools.coverage_declared` and `sharedState.coverageDeclared` carry them; the model does not — the framework removes both from a recognized envelope object (an absence, or a ledger and everything it wraps) before the model or any `onToolResult` rule reads it, on every dispatch path; the tool's `resultCeiling` and column check measure that served value; and under result placement both `tool_end` channels carry the one ticket. So the request is byte-identical to the same run without them. Not stripped, because they are not recognized envelope objects: a result returned as JSON text (an `mcpClient` result in its default text mode), an `af_absent` with an empty `checked`, and an absence inside your own domain object. `mcpServe` passes the tool's answer on unchanged by design — a client's model there reads the fields unless that client is an agentfootprint agent reading structured results. Neither field is evidence for the names-and-numbers check: never put the caller's arguments in `short`. `absent()` and `coverage()` refuse a bad value where it is written (`kind` on `checked` included); an envelope built elsewhere is read, never repaired — a bad value is dropped with one dev-mode warning per tool per process, and `null` counts as not declared. A tool that declares neither records exactly the bytes it did before.

- **`evidence_checked.lookedUp` says how many of the answer's values were actually looked up.** `candidates` also counts values the person's message, the conversation or the app's own instructions already held — those are exempt and never looked up — so "looked up `candidates` values" overclaimed. `lookedUp` (also on `EvidenceVerdict`) is the values found plus the values not found, before the reported list is cut at 12, and the OpenTelemetry adapter exports it as `agentfootprint.evidence.looked_up`. Every `evidence_checked` carries it from this release; the event exists only when `.namesAndNumbersFromEvidence()` is armed, so an agent without it gains no byte.

- **A skill can carry a plain name for a person: `defineSkill({ title })`.** "array estate report" for `array-inventory` — at most 60 characters of one line of plain visible text, not the id. It rides `agentfootprint.skill.graph_declared` as `nodes[].title` so a report can name the skill in plain words; that event is fired by an agent with a skill graph, so a titled skill added with `.skill()` alone records no title. The model's request, the activation menu and a graph's drawn `label` are unchanged. A skill without a title records exactly what it did before.

### Changed

- **`tool_end.modelResult` also appears when the framework removed the record-only coverage fields.** It used to mean "a rule made what the model read differ from `result`" (an `onToolResult` link or the result cap). A call whose tool declares a coverage item's `short` or `kind` is now served without them, so its `tool_end` carries the tool's envelope as `result` and what the model read as `modelResult` — the envelope rides the record twice, about 4 KB more for a typical absence and as much as the wrapped payload for a ledger around a large result, in the recording and in any exporter that ships `modelResult` (the OpenTelemetry adapter exports what the model read, as before). Under result placement a difference that is only this removal counts as one value: both channels carry the one ticket and nothing is stamped. A call whose tool declares neither gets no stamp and no new byte.

### Deprecated

- **`agentfootprint.risk.flagged` is deprecated: nothing ever emitted it.** The
  event (and its `RiskFlaggedPayload`) was the output of `RiskDetector`, which
  has no caller, so a listener on it — say, for `prompt_injection` — heard
  silence that looked exactly like "no risk found". Both go in 10.0.0. To screen
  content, refuse in a `PermissionChecker`, a `.reliability({ preCheck })` rule or
  a `.messageMiddleware(...)`, and listen to the events those already emit
  (`permission.halt`, `reliability.*`, `middleware.decision`).

### Security

- **One session can no longer crowd the artifact door: a per-session in-flight bound, answered 429.** `artifact-head`, `artifact-get` and `answer-account` are lane-free — they never wait behind a run — and turn admission (`admission: { decide }`) does not see them, so until now one session could keep the event loop every session shares busy with payload reads and parses. They now count together against `standingAgent({ artifactOpsPerSession })` (default `DEFAULT_ARTIFACT_OPS_PER_SESSION`, 8): a request over it is refused with `ArtifactOpsBusyError` (`ERR_ARTIFACT_OPS_BUSY`, 429) while every other session is served, and the same request succeeds once one of that session's own requests has finished. It is counted AFTER the ownership check, so a stranger cannot spend another session's slots; `Infinity` switches it off. A screen that redraws many panes at once should redeem them a few at a time, or raise the bound.

## [9.115.1] - 2026-09-25

_Internal changes only — nothing a user of the library can see._

## [9.115.0] - 2026-09-25

### Added

- **Door-guard options and exports: `allowedOrigins`, `allowedHosts`, `requireJsonContentType`, `doorGuard()`, `checkSessionId()`, `AgentHost.onRefusal`.**

  - `allowedOrigins`, `allowedHosts` and `requireJsonContentType` on `httpHost`, `nodeHost` and the hosted-runtime adapters (`CrossSiteOptions`). Unset `allowedOrigins` means the door's own host (the `Host` header or an `X-Forwarded-Host` entry; a portless `Host` is read under `X-Forwarded-Proto` when a proxy sends it). `'any'` turns a rule off by name. `requireJsonContentType: false` is the escape hatch for a non-browser integration that cannot send the header. `allowedOrigins: ['null']`, `['*']` and `allowedHosts: []` are refused at construction.
  - `maxBodyBytes` on `nodeHost`, defaulting to 1 MiB (`DEFAULT_NODE_MAX_BODY_BYTES`), the hosted adapters' own default.
  - `doorGuard({ name, bindHost?, ...rules })`, `checkSessionId()` and `MAX_SESSION_ID_LENGTH` on `agentfootprint/hosting`. A route of your own beside the door (a sign-in route on `onUnhandled`) arrives untouched, so it can keep the same rule: `doorGuard(...).check(req)` returns the refusal with its `status`, or `undefined`.
  - `AgentHost.onRefusal(listener)` (optional port member, plus `HostRefusal`). A host reports each request it refused before any handler saw it; every `httpHost` implements it, and `standingAgent` subscribes whenever `onIngressDecision` is set, so those refusals reach the ingress record (`door: 'request' | 'conversation'`, `outcome: 'cross-site-refused'`, or `'refused'` for a session id), classes only.
  - The four refusal classes `UnsupportedMediaTypeError`, `OriginNotAllowedError` (with `rule`), `HostNotAllowedError` (with `rule`) and `InvalidSessionIdError` (with `reason`), each carrying its HTTP `status`, and `OriginRefusalRule`.

- **The OpenTelemetry export carries what an evaluation tool reads.** `otelObservability` is the channel trace-scoring platforms consume, and it carried none of the structure this library records — and less tool I/O than a standard GenAI tracer. Everything below is additive; everything that is content sits behind a switch that is off by default.

  - **`gen_ai.conversation.id`** on the agent, chat and tool spans of a session-bound run (`run(input, { sessionId })`, `standingAgent`) — written as the session id's **SHA-256** by default. At a door with no verifier the session id is the handle to the conversation, so the digest (it groups a backend's session view exactly as the id would) is the default, and `conversationId: 'raw'` is the opt-in for doors that verify who may open a conversation. A run without a session gets none — never the runId.
  - **`gen_ai.evaluation.result`** — every `agentfootprint.eval.score` becomes the GenAI conventions' evaluation event (`gen_ai.evaluation.name`, `.score.value`, `.score.label`), carried as a SPAN event (the spec's own reference emitter logs it; this adapter speaks the Tracer API only). It lands on the span it evaluates — a named tool call or iteration while that span is open, else a short `agentfootprint.evaluation` span under the turn. The run a score NAMES wins over the run it was emitted from, and a score is **parented to a run only when its own meta places it in that run's session**: run ids are sequential names, so a score that cannot show it belongs — every `agent.emit` after the run — rides an unparented span of its own (a new trace, never a child of whatever span is active) that names the ref. A score for a run past the 32-closed-turn window is exported unparented AND reported through `onError`; a score with no `metricId` is reported. `EvalScorePayload` gains optional `label` (a vocabulary word, exported by default) and `explanation` (content: `captureContent` only, omitted over `maxContentChars`). The late path is best effort; the durable home for after-the-run scores is a score record.
  - **The library's own structure, content-free**, on the `explainability` switch: `agentfootprint.tools.absent` / `agentfootprint.tools.coverage_declared` (a count per list; the suggested tool's name only when the exporter has seen that tool run — otherwise a flag, never author text), `agentfootprint.agent.evidence_checked` (the verdict and an unsupported count; the values under `captureContent`), `agentfootprint.findings.standing` (ids and the standing — an id the model wrote that names no result is a flag, never the text — capped at 32 events per turn with one summary, since a real SDK evicts a span's OLDEST events past 128; a count per standing on the agent span), and the checker accounting — exported only when a row is actionable (a check filed findings, or a registered check filed nothing while the run did work) as a short span under the turn; `checkAccounting: 'all'` exports every row.
  - **`captureToolContent`** (default off) — `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` on the tool span of a call that ran and returned. Arguments: the proposal, serialized when `tool_start` arrives (a tool that writes into its arguments cannot change what leaves), with every key an `onToolCall` rule changed or the tool's `redact` policy hides shown as `'REDACTED'` — withheld, since a rule can add a value (a server-side key) the model never saw. Result: what the model read, after every `onToolResult` scrub. A failed or refused call exports no content; a `codeRunnerTool`'s arguments (its generated program) are never exported. Objects only in the spec attributes (its schema is an object: the string `"123"` is never exported as `123`); any other value rides `agentfootprint.tool.<args|result>.content`. A value over `maxContentChars` (default 65,536) is omitted and its size stated, never cut — one oversized attribute can fail an export batch and take other runs' spans with it. The `captureContent` prompt and answer get the same ceiling.
  - **Every exported string outside the content switches is capped** at 256 characters and every list at 20 items (plus one marker saying how many more), in one funnel — a caller-sized session id or a model-written id cannot size an attribute; a cut never splits a surrogate pair. Span names carry a tool or model name at most 64 characters.

  A trace with no content switch, no session and none of the new events is byte-identical to the previous release — and so is a DEFAULT real agent run, whose checker accounting is healthy and exports nothing. Both are pinned by `test/observability-providers/otel-byte-identity.test.ts` against references generated on the untouched previous tree, with no span filtered out; a `captureContent` trace is pinned the same way.

  **Named for follow-up, not built here:**
  - `gen_ai.task.input` / `gen_ai.task.output` (the `captureContent` prompt and answer) are AgentCore's attribute names, not in the current GenAI registry; the spec's own shape (`gen_ai.input.messages` / `gen_ai.output.messages`) is a separate change.
  - An optional OTel Logs emitter for `gen_ai.evaluation.result`, the spec's own carrier.
  - `integrity.context_error` findings are not mapped: the accounting span says how many findings a check filed, not what they were.
  - Durable late-score parenting: a session-carrying scoring door (`agent.score({ runId, sessionId }, …)`, which stamps `meta.sessionId` so the digest check can verify and parent the score) and the run's root span context persisted with the run, so a later score — past the window or in another process — can be emitted with a remote parent.
  - `principal.id` / `tenant.id` are exported raw by default (now capped); a `'digest' | 'raw'` option like `conversationId` belongs to the identity program.
  - Argument key names (`agentfootprint.tool.args.keys`) are model text when the model invents a key: export only the keys the tool's `inputSchema` declares, and count the rest.
  - Tool-argument VALUES a rule set, for OTel only, would need a strategy-to-engine capability (a sink declaring it wants them); until then they are withheld everywhere and only their key names travel.
  - The session digest hashes the id's UTF-8 bytes, where a lone surrogate becomes U+FFFD: two ids that differ only in a lone surrogate share a digest. Library-minted ids are UUIDs; noted, not handled.

- **`stream.tool_end` says what a CONFIGURED RULE did.** Three optional fields, each absent unless a rule acted, so an agent with no rule records exactly the bytes it did before (pinned for the no-rule paths: a call that ran, an unknown tool name, an args rejection under the default validation, a throwing credential provider, a plain `absent()`):

  - `modelResult` — what the model read, when an `onToolResult` rule or the cap made it differ from `result`; all five dispatch paths.
  - `changedArgKeys` — the NAMES of the keys an `onToolCall` rule changed or the tool's `redact` policy hides. Never values (a rule can add a server-side value the model never saw, and an event reaches every sink), taken before the tool runs.
  - `notExecuted` — a permission policy or an `onToolCall` rule refused the call. Its absence proves nothing: a call that could not run with no rule involved says so with `error: true`, a settled bracket with `notDispatched`, and a resumed leg's bracket carries neither.

  `changedArgKeys` / `notExecuted` ride the batch dispatch path only. `flowchartAsTool({ redact })` and `runbookAsTool({ redact })` now govern the call's arguments too — a key the policy names is withheld wherever the arguments are shown, as the tool's result always was. `tools.code_run` names the tool the model called (for a `codeRunnerTool` re-exposed under another schema name, its registered name; identical whenever the two agree).

- **`HostReply.turnArtifacts` — a host files its own per-turn artifacts where `artifact-get` will look, without composing a scope.** A host that files something for a turn (a story, the person's own clicks) had no way to learn the scope `standingAgent` composed for the request, so it re-derived one. `{ conversationId: sessionId }` is right at an open door and wrong at a signed-in one: with an identity verifier configured, the redemption door composes `{ conversationId, principal: <verified user> }` (plus a stored conversation's tenant), so every ticket such a host filed answered `ERR_ARTIFACT_NOT_FOUND` for every signed-in user. Now a host that implements the optional hook is handed the serving agent's store, already bound to the scope the artifact door redeems under for the same caller: both doors compose it with one function from the same inputs. The value is `TurnArtifacts`: `{ bound: true, artifacts }` (the five `ctx.artifacts` verbs, none taking a scope) or `{ bound: false, reason: 'no-session' | 'no-store' }` — an anonymous request is told there is nothing to bind rather than handed an invented scope.

  - **Awaited, inside the turn, and bounded.** The composer calls the hook once per turn and awaits it (`void | Promise<void>`) while the session's lane is held, then ends the reply with `complete` or `awaiting`. The hook and every operation it started must settle within the new `turnArtifactsTimeoutMs` option (default `TURN_ARTIFACTS_TIMEOUT_MS`, 5 s — the `TOOL_TEARDOWN_TIMEOUT_MS` precedent, since both sit on the shutdown path) and before the request's own `signal` aborts. Whichever ends the wait, the binding is revoked, nothing in flight is cancelled, the cause is reported and the terminal delivered — so one host's hung store can hold neither every other session (`{ agent }`), nor a pooled lane past `maxActiveSessions`, nor `close()`. If the store is slower than the ceiling, a reply that carries a ticket goes out without it; the artifact is still filed when the write lands. A non-positive or non-finite value is refused at construction.
  - **Live only for its turn.** A verb called after the hand-over ended rejects with the new `TurnArtifactsExpiredError` (`ERR_TURN_ARTIFACTS_EXPIRED`) — a rejection already handled, so a floating late call cannot crash the process; an awaiting caller still gets it.
  - **Never decides the reply, never silent.** A hook that throws, an operation that fails (awaited or not), the bound, the abort and a late call are each put on the serving agent's stream as the new event `agentfootprint.artifacts.hand_over_failed { cause: 'hook' | 'operation' | 'timeout' | 'abort' | 'expired', op?, errorClass?, errorCode? }` — class only, stamped with the session — and the first of them on the ingress record's new optional `IngressRecord.turnArtifactsFailure` (same shape). The answer or the question is delivered regardless.
  - Each filing is stamped `origin: { runId }` with the run the turn executed (none for a turn that ran none — a partial answer to an input request, or its cancellation; a paused turn's run files no recording, so its run id joins to none) and lands on the serving agent as `agentfootprint.artifacts.minted` with no `tool` field and meta naming the session and run it was filed for.
  - Where it does NOT meet the run's own recording, stated: at an unverified door, a conversation that carries an identity of its own (an app-seeded tenant, or a user an earlier turn claimed) while the request names nobody, and a pause that named nobody resumed by a claimed user, put the recording where no redemption by that caller looks; the hand-over follows the door. Pinned as known edges, not changed here.

  A host that does not implement the hook is served as before — same replies, the same event sequence, no extra snapshot. `TurnArtifacts`, `TurnArtifactsExpiredError` and `TURN_ARTIFACTS_TIMEOUT_MS` are exported from `agentfootprint/hosting`.

### Changed

- **`ArtifactMintedPayload.tool` and `ArtifactExpiredPayload.tool` are optional**, as they already were at run time: the run's own recording mint and now a host's filing carry no tool (the precedent `resolved` / `refused` already set). A reader that assumed a string was already reading `undefined` for those events. The commentary line for a tool-less mint now names the app ("The app itself (not a tool) checked …") instead of printing an empty tool name and claiming the model was handed the ticket.

- **A detached observability sink receives a snapshot of each event, never the live object.** `enable.observability({ detach })` schedules the sink's work for later — after the tool that emitted a `tool_start` has run — and it used to hand the driver the event itself, so a tool that wrote a header into its own arguments, or code that mutated a result after `tool_end`, reached the sink as if the event had carried it. The event is now copied with `structuredClone` when it is scheduled (footprintjs's deferred-observer law, default capture `'clone'`): about 2 µs for a typical event, 30 µs for a 120 KB `iteration_end`. This applies to EVERY detached sink — file, CloudWatch, AgentCore, the audit export — not only OTel. A value that cannot be copied (a method, a live handle) is replaced by `'[not cloneable]'` AT THE LEAF, the rest of the payload intact, so a tool result holding one method keeps its data on a detached sink as it does on the synchronous path; the degradation is reported once per event type through the strategy's `onError`, and a live reference is never delivered. The synchronous path is unchanged.

  Named for follow-up, not fixed here: on the pre-existing SYNCHRONOUS path, an `Error`'s custom own properties reach envelope-serializing sinks — `JSON.stringify` of an event carrying an axios-style error writes its `config.headers.authorization` to the NDJSON file and the audit export (the detached path's clone drops them).

- **What the door guard changes for an existing deployment.**

  - **A POST without `content-type: application/json` now gets 415.** That includes `curl -d '{...}'` without `-H 'content-type: application/json'` (curl sends a form encoding), a Node `fetch` with a string body and no headers (it sends `text/plain`), and any `application/*+json` or `text/json` client. JSON clients are unchanged.
  - **A browser page on another origin now gets 403** until its origin is in `allowedOrigins`, from the hosting doors and from `mcpServe` over HTTP. So does any browser request through a proxy that rewrites `Host` without adding `X-Forwarded-Host`: nginx's own default `proxy_set_header Host $proxy_host`, and a Vite or webpack dev proxy with `changeOrigin: true`. Keep the client's `Host` (`proxy_set_header Host $host`) or add `X-Forwarded-Host`, and forward `Origin` and `Sec-Fetch-*` unchanged.
  - **A wrong `X-Forwarded-Proto` fails safe but locks out browser POSTs.** A portless `Host` is read under the scheme the proxy names, so an inner nginx behind a TLS load balancer that sends its own `$scheme` (`http`) for an `https://` page makes every browser POST and handshake get 403. Forward the outer proto from the inner hop, or list the page's origin in `allowedOrigins`.
  - **A loopback-bound host now refuses every `Host` but the loopback names** (421) unless `allowedHosts` is set. The common case this refuses is a same-box reverse proxy that forwards the public name in `Host` (nginx `proxy_set_header Host $host` in front of a `127.0.0.1` bind): set `allowedHosts` to the public name(s) the proxy forwards. The 421 says the list was defaulted and names this fix. A hosts-file alias for a loopback address needs the same.
  - **A session id that is empty, over 400 characters, or not visible ASCII now gets 400** at both doors. An id with a space or a non-ASCII letter was accepted before, so a conversation stored under one can no longer be reached through the door. The id is caller data: a client re-mints a visible-ASCII id and starts a new conversation. To keep the history, copy it outside the door — `hydrate(oldId)` from the store, `persist` under an ASCII id (a UUID, or `encodeURIComponent(oldId)`, which is reversible) — and switch the client to the new id; the old row leaves with the store's retention sweep. Ids from `browserSessionId()` or `crypto.randomUUID()` need nothing.
  - **`nodeHost` now refuses a body over 1 MiB (413)** unless `maxBodyBytes` says otherwise.
  - **New boot `console.warn` lines.** A host on a non-loopback bind with `allowedHosts` unset (`mcpServe` over HTTP too) prints one warning at boot, once per host name per process, naming the rebinding risk and the option; a door serving with both browser rules off prints one too. A test suite that fails on an unexpected `console.warn` will see them; set `allowedHosts` (or `'any'`) to silence the first. This is a deliberately staged default: this release warns rather than refuses, so existing deployments keep starting. The library never redirects a short host name to a canonical one; list every name in `allowedHosts`.
  - **`agentCoreRuntimeHost`, `agentCoreA2AHost` and `foundryResponsesHost` keep the browser rules off unless you set them, on a non-loopback bind.** Only the platform's front door reaches their port there, and it demands a credential no page holds; which headers it forwards is unverified, so a default rule could refuse the platform's own traffic. They print one boot line when the rules are off. On a loopback bind (a laptop, which no platform fronts) they keep every default of a plain host. The session-id bound applies to them.
  - **`IngressDoor` gained `'request'` and `'conversation'`, and `IngressOutcome` gained `'cross-site-refused'`.** A `switch` over either that claims to be exhaustive stops compiling until it handles them.

- **What changes for existing OpenTelemetry and audit users.**

  - Session-bound traces now carry `gen_ai.conversation.id` (the digest) on their agent, chat and tool spans. They are not byte-identical to the previous release; that attribute is the only delta, and it is pinned as such.
  - `agentCoreEvaluationSpans` turns `captureToolContent` on — AgentCore's tool-parameter and tool-selection scorers read the call's arguments. Its users now also export each call's arguments (changed keys withheld) and the result the model read, omitted over the ceiling. `captureToolContent: false` opts out.
  - `auditExport()` bounds the new content fields in its default `payloadMode: 'bounded'`: an evaluation's `explanation` becomes `'[N chars]'`, and `tool_end`'s `modelResult` is reduced like `result`.
  - `stream.tool_end` payloads grow only when a rule acted, so envelope-serializing sinks (`file`, CloudWatch, AgentCore) see `modelResult` — the post-rule value, beside the `result` they already carried — and argument key NAMES, never argument values.

### Fixed

- **A binding drops a caller-supplied `origin` on every path.** `origin` is not on the capability's input type, but a JavaScript caller could pass one, and it survived whenever the binding had no origin of its own to stamp. This is a behaviour change of the PUBLIC `bindArtifacts`: a binding created WITHOUT an `origin` option now drops an input's own `origin` — including the one `recordingPutInput(…, { runId })` or a chart-walk helper puts there — instead of passing it through. Pass `bindArtifacts(store, scope, { origin })` to stamp one. No change for tools, whose binding always had one.

### Security

- **The artifact door no longer lets a caller write into somebody else's record.** Its facts are stamped with the session the request NAMED, so the door now checks first: a `ref` that is not a claim ticket (`isArtifactRef`) is refused by the wire readers (`readArtifactWireOp`, `400 ERR_INVALID_WIRE_OP`, never echoing the text) and by the composer; and at a door with an identity verifier, a session the caller cannot open (the turn door's own `mayOpenSession` rule; for a first turn still in flight, only the caller it serves) answers the one `ERR_ARTIFACT_NOT_FOUND` with nothing emitted and no pooled lane built — a stranger could otherwise inject text into another signed-in person's live recording, or flood it until its own events were evicted. At a door with no verifier the session id remains the key, by law.

- **The hosting door refuses cross-site requests, DNS rebinding and malformed session ids before any handler runs, in every identity mode.** A door with no verifier on a company network was open to any web page its users opened. Reproduced over a real socket against the previous release: a `text/plain` POST carrying a JSON body and a foreign `Origin` (what `fetch(url, { mode: 'no-cors', method: 'POST', body })` sends, with no preflight) ran a turn, and the model was called. A request whose `Host` and `Origin` both named an attacker's re-pointed domain was served. A WebSocket handshake from a foreign `Origin` got `101`. A 1,000,000-character `sessionId` was served and rode every span of the turn. Every door `httpHost` serves (`nodeHost` included) now checks:

  - A request that changes something (any method but GET, HEAD or OPTIONS) must say `content-type: application/json`. Anything else, including no content type, is refused with `UnsupportedMediaTypeError` (415). The refused body is never parsed. When it is small (at most 1 MiB, arriving within 2 s) it is drained first, so a client still uploading reads the 415 instead of a connection reset. On a socket the host owns, `Expect: 100-continue` gets the 415, never a `100`. `application/json` is not a CORS-safelisted type under the Fetch standard, so a page must get a preflight to send it across origins, and this host never approves one. That is the property RFC 10017 §6.1.3.3.2 asks of a custom request header, so no second mandatory header is added.
  - A browser `Origin` the door does not allow is refused with `OriginNotAllowedError` (403), on requests and on WebSocket handshakes, before the `101`. `Origin: null` is always refused. A request the browser marked `Sec-Fetch-Site: cross-site` is refused unless its Origin is listed in `allowedOrigins`, and so is a handshake with `Sec-Fetch-Site` but no `Origin`; both catch an `Origin` a proxy stripped. A request with neither is a script or a server and is not judged by these rules.
  - A `Host` the door was not configured for is refused with `HostNotAllowedError` (421, RFC 9110 §15.5.20). This is the DNS-rebinding defence, and it reads the `Host` header only, never `X-Forwarded-Host`. A host bound to a loopback address (`127.0.0.1`, `::1` in any spelling, `localhost`) answers `localhost`, `127.0.0.1` and `[::1]` only unless `allowedHosts` says otherwise; its 421 says the list was defaulted. Health probes are never judged.
  - A session id must be 1 to `MAX_SESSION_ID_LENGTH` (400) characters of visible ASCII (`!` to `~`), or it is refused with `InvalidSessionIdError` (400) at both doors, whichever body field, header, cookie or query parameter the dialect read it from. That closes the empty id (every caller that sent `""` shared one conversation), controls, line separators, bidi overrides, zero-width characters and lone surrogates, and one id read as latin1 from a header and as UTF-8 from a body is no longer two conversations. The refusal states the length, never the id.

  Every refusal names the rule and the option, never what the caller sent, and is recorded in the ingress record. Design note: `docs/design/2026-09-door-hardening.md`.

- **`mcpServe` over HTTP validates `Origin`, `Host` and the JSON content type before any tool runs.** The MCP transport specification requires servers to validate `Origin` on every connection to prevent DNS rebinding, and nothing did: the MCP SDK's own protection is off by default, so a page that re-pointed its name at a `127.0.0.1`-bound server could call tools and read the results. The HTTP transport now uses the same door guard, answered in the SDK's JSON-RPC error shape, with `allowedOrigins` and `allowedHosts` on `McpHttpServeTransport`. A loopback `host` answers the loopback names only, as the SDK's own `createMcpExpressApp` does. The library owns the JSON rule too, rather than trusting whichever SDK version is installed. Native MCP clients send no `Origin` and are unaffected.

- **A fact produced for one session or one run no longer enters another's recording.** On `standingAgent({ agent })`, where every session shares one agent, a screen redeeming a ref (`artifact-head` / `artifact-get`, deliberately never queued behind a run) while another person's run was in flight put its `artifacts.resolved` / `refused` event — ref, kind, bytes — into THAT person's recording (the `recordings` dial), which they could redeem, and into that run's self-explain evidence; so did a tool's `ctx.artifacts.put` that was not awaited and landed during a later run, which was also stamped with the LATER run's session and principal. Door facts now carry the session they were produced for, a fact emitted through an artifact binding carries the run the binding was made in (captured when it was built, not read from whichever run is live), and a run's recording and self-explain event tail keep only what belongs to them — one rule, `eventBelongsToRun`: an event that names a run belongs to that run; one of no run, to runs of its session (or, naming none, to whatever run is in flight — a consumer's own `agent.emit`, exactly as before). Redemptions stay lane-free; delivery to every other listener is unchanged.

## [9.114.2] - 2026-09-25

### Changed

- **The npm package no longer ships the contributor map or the full changelog, and
  `npx agentfootprint-setup` no longer writes a `CLAUDE.md` into your project.**
  The setup used to copy the library's own contributor file — a ~93 KB map of its
  internals — into your project root, where Claude Code loaded it into every
  session (~23k tokens) whatever the task. It now installs only the
  `agentfootprint` skill, which loads when the task is about agentfootprint. If an
  earlier setup left that `CLAUDE.md` in your project and you did not edit it, you
  can delete it. The package now ships `CAPABILITIES.md` — the "it may already
  exist" index of what the library does, keyed by what you would call each
  feature — and leaves `CLAUDE.md` and the 1.4 MB `CHANGELOG.md` out of the
  tarball; release notes are on each GitHub release.

### Fixed

- **`.findings()` notes no longer reach the user through the token stream, or
  from prose and code blocks.** 9.114.1 took the model's `_findings` off the
  answer `run()` returns, but two paths still showed it. The streamed tokens
  (`agentfootprint.stream.token`) were the model's raw output, sent before the
  key was taken off, so a chat UI rendering the stream showed the notes; and
  only an answer that was entirely one JSON object was cleaned, so notes
  written in a code block or in the prose — for example a JSON block at the
  end of a prose answer — stayed in the answer. Both now go through one
  step, shared by the stream and the answer: every JSON object in the answer
  loses its own `_findings` member — the whole answer, one in a code block,
  one in the prose, one in a list — and nothing else changes. A code block or
  a paragraph that held only the notes goes whole, fences included; an object
  emptied anywhere else stays `{}`, so a list or a line of code keeps its
  shape. The notes found anywhere are filed as standings, as before. Under
  `.findings()` each streamed token is what can be shown so far — a piece
  that ends part way through the key is held back until the key is read —
  and the answer turn's tokens join to exactly the answer `run()` returns
  (unless an output rule, such as `.messageMiddleware()`, rewrites it
  afterwards); a token is skipped when a piece shows nothing yet, so
  `tokenIndex` can skip numbers;
  `stream.llm_end` carries the same text. CallLLM's commit, and history for
  a turn that calls tools, keep what the model sent; the Route decider then
  commits the peeled answer as `llmLatestContent`, the answer the run
  records. Two visible changes: an answer the model wrote
  as JSON keeps its own spelling (9.114.1 parsed it and wrote it back out:
  compact JSON as `JSON.stringify` writes it is byte for byte what 9.114.1
  returned; indentation, number format, `\u` escapes, key order and repeated
  keys are now kept as the model wrote them), and a JSON list answer whose
  items carry `_findings` now loses it too, the list staying JSON (9.114.1
  returned lists untouched). Text that stops being JSON part way — a stray
  quote or a raw line break inside the notes — is returned as the model
  wrote it, less any complete notes before the break. Notes written one
  closing brace short still go, and the text after them is kept; notes a
  cut-off stream leaves unfinished stay hidden, with `{}` left where they
  began when they shared a line and their object held nothing else. An answer
  that held nothing but notes is now empty (a bare JSON object of notes stays
  `{}`). An agent without `.findings()` streams and answers exactly as
  before.

## [9.114.1] - 2026-09-25

### Fixed

- **`.findings()` without `.outputSchema()` no longer hands the caller the
  model's `_findings` notes, and the answer's standings are filed.** The
  instruction `.findings()` serves tells the model it may put the last batch's
  standings in a top-level `_findings.previous` on a JSON answer, with or
  without an output schema. Only the agent built with `.outputSchema()` took
  that key back off. On every other armed agent — a plain one, or one with
  `.messageMiddleware()`, a stepped skill or `.namesAndNumbersFromEvidence()` —
  a model that followed the instruction had its raw `"_findings": {…}`
  returned by `agent.run()`, where the end user saw it, and the standings it
  declared were never filed: `agent.findings()` had no row for the last batch
  of tool results. Every one of those agents now takes the key off with the
  same single step the output-schema agent uses: the returned answer, the
  committed record and `turn_end` carry the answer without the key, and the
  standings are filed with `declaredOn: 'answer'`. The step runs after the
  output middleware and before the step check and the evidence gate, so they
  judge the answer the caller receives (a value only the key carried is no
  longer flagged as an unsupported claim), and a re-ask — a step nudge or an
  evidence revision — quotes the answer as the model sent it. A prose answer,
  or a JSON answer without the key, is returned byte for byte as before, and
  an agent without `.findings()` is unchanged. Streamed tokens
  (`agentfootprint.stream.token`) are still the model's raw output, sent
  before the step runs: a UI that renders them shows `_findings` if the model
  writes it, so render the returned answer instead (the findings README,
  "The answer's standings").

## [9.114.0] - 2026-09-24

### Added

- **`absence` on a `requestInput` declaration
  (`InputRequestDeclaration.absence`)** — a lookup that searched, found
  nothing, and then asks the person about the miss can now say what it looked
  at: pass the envelope `absent()` returns, as in `requestInput({ id,
  question, fields, absence: absent({ what, checked }) })`. Until now a lookup
  that paused left no record of the miss it was asking about — no
  `agentfootprint.tools.absent` event and no `coverageDeclared` row, because
  both are filed when a tool RETURNS its result, and a pause returns nothing.
  The library now files them when the request is raised, before the run
  pauses: the same event payload and the same row, byte for byte, that the
  same `absent(…)` files when a tool returns it; and when the tool declares
  `argumentsFrom` under `noticeEmptyLookups`, the empty-lookup check reads the
  miss too. Nothing that judges a SERVED result applies at the raise, because
  nothing is served for the paused call: not the tool's `resultCeiling`, not
  the column-type contract, not the evidence corpus. The paused call is
  answered by the person, not delivered an `'absent'` status, so an
  `onToolStatus` route keyed on `'absent'` does not fire for it. The rows are
  filed once — nothing on resume reads the field. It is not part of the
  pending question (`awaitingInput`) or of what the model is served for the
  paused call, so the question states the miss only if your `question` says
  so; under `.limitsTravelWithTheAnswer()` the final answer's limits block
  carries it, as it does a returned miss. A value the absence recognizer
  cannot read is refused when `requestInput` is called (`InputRequestError`,
  naming `absent()`), and the call errors instead of pausing; `absence: null`
  is the field omitted. An envelope built by hand whose lists cannot be read
  (such as `checked: [null]`) errors the call at the raise with the same
  message the value would give if returned: the run goes on, nothing pauses
  and nothing is filed. A lookup reached through another tool
  (`ctx.tools.call`, a runbook procedure, a `flowchartAsTool` stage) pauses
  that outer call, so its miss is filed under the outer tool and call id. A
  lookup a person approved before it ran (a `checkIn`, an approved middleware
  `ask`, granted interactive consent) cannot pause at all — its raise is
  refused as an error, as before, and its miss is not filed. A request without
  `absence` records exactly what it did before, and a malformed hand-raised
  one (`pauseHere`/`askHuman`) leaves the committed record it always left,
  whether or not it carries `absence` (its error text can differ where 9.113.0
  stopped first at the then-unknown key).

## [9.113.0] - 2026-09-23

### Added

- **`LLMMessage.notDispatched`** — an optional field on a `role: 'tool'`
  message that answers a call which never ran:
  `{ pausedCall: { toolCallId, toolName } }`, the call in the same batch the
  run paused on. The library writes it on the results described under Fixed
  below and removes it before any request is sent, the same way it removes
  `injectedBy`; it is absent on every other message. Read it when your own
  code needs to know whether a call in the history really ran — never the
  sentence beside it.
- **`notDispatched` on `agentfootprint.stream.tool_start` and
  `agentfootprint.stream.tool_end`** (`Payloads.ToolStartPayload`,
  `Payloads.ToolEndPayload`) — the same fact, the same shape, typed off
  `LLMMessage.notDispatched`, on both halves of the bracket of a call that
  never ran; absent on every other bracket. One definition, one writer, two
  carriers: the history message and its bracket. The settled `tool_end`
  carries no `error`: `error` says a call failed, and this one did not — the
  library decided not to run it, as it does for a call a permission policy
  denies, whose `tool_end` carries no `error` either. So code that counts
  successes or failures from `tool_end` reads `notDispatched` first; a bracket
  that carries it is neither:
  `agent.on('agentfootprint.stream.tool_end', (e) => { if (e.payload.notDispatched) return; … })`.
- **Commentary key `stream.tool_start.notDispatched`** — "Chatbot did not call
  the `fetch_invoices` tool. The LLM asked for it together with
  `collect_input`, and the run paused at `collect_input` before reaching it."
  A new key, so every override of `stream.tool_start` keeps applying to the
  calls it was written for; the settled call's `tool_end` gets no line.
- **OpenTelemetry span event `agentfootprint.tool.not_dispatched`** —
  reserved for a settled call: the `otelObservability` adapter records it on
  the active span, with `gen_ai.tool.name`, `gen_ai.tool.call.id`,
  `agentfootprint.tool.paused_call.id` and `agentfootprint.tool.paused_call.name`,
  instead of opening an `execute_tool` span for a call that never ran. No run
  records it yet: the adapter opens a trace on `agent.turn_start`, a resumed
  leg emits none, and a settled call only ever rides a resumed leg. The names
  are fixed now so they do not change on the day resumed legs are traced.
- **`absent({ tryInsteadTool })` names the tool a suggestion points at, as
  data, beside the `tryInstead` sentence.** A suggestion to try another tool
  used to live only inside prose ("Widen the window, or check
  cluster_inventory for the collected cluster names."), so a reader that
  wanted to know WHICH tool was suggested could only find out by parsing the
  sentence, which this library never does. `tryInsteadTool: { tool, why? }`
  carries the name as data, and the envelope renders it under its OWN key,
  right after the sentence
  (`"try_instead_tool":{"tool":"cluster_inventory","why":"it lists the collected cluster names"}`
  — the author's words; the library composes no sentence for it).
  `try_instead` stays a string: every reader typed against `ToolAbsence`
  keeps reading exactly what it read, and a reader that quotes the suggestion
  as printed keeps the sentence when the tool is named beside it. The two are
  independent — either, both, or neither. `absent()` refuses a malformed tool
  where it is typed (no `tool`, a `why` that says nothing, an unknown key so a
  misspelt `why` cannot vanish, a list) and records the name as declared:
  never looked up (a provider may serve it on a later iteration), and held to
  no charset of its own — which names a provider accepts stays
  `core/tools.ts` · `assertValidToolName`'s question, and `absent()` asks its
  dev-mode warning, as `defineTool` does. One tool per absence, because every
  suggestion on record names at most one other tool. The evidence gate grounds
  `tool` and `why` as it grounds the sentence, and the dataset projection
  guard keeps `try_instead_tool` among the declarations an adapter may not
  change. New type `TryInsteadTool`. The rule and the example live in
  `src/core/agent/coverage/README.md` ("A suggestion to try another tool is
  typed, never parsed out of prose"). Nothing JOINS the name yet: the reader
  that would match it against the run's calls (`source-not-consulted`) is the
  second half of the typed vocabulary; this release carries and renders it.
- **`agentfootprint.tools.absent` carries the suggestion — `tryInstead` (the
  sentence) and `tryInsteadTool` (the tool), each as declared.** Before this
  release neither was on the event: the suggestion rode only inside the raw
  tool result (`agentfootprint.stream.tool_end`'s `result`, the tool turn in
  history), where a reader had to recognize the envelope again to find it.
  Both keys are additive and default-omitted. `readCoverageResult` lifts them
  onto `CoverageFacts`, read by the rules `absent()` mints by: an envelope
  minted elsewhere whose suggestion those rules refuse is still an absence;
  that suggestion is simply not read. Neither reaches `coverageDeclared` or
  the block `.limitsTravelWithTheAnswer()` appends — a suggestion is advice
  about a call not yet made, not ground the answer stands on.
- **A ruled-out standing whose only witness is an absence gets a row beside
  it; the model's word is never rewritten** (`.findings()`). "Nothing was
  found" is not "ruled out". When the model declares `ruled-out` on a result
  that the tool returned as an absence AND the model was served as one — an
  `absent()` envelope, bare or bounded by `coverage()`, which the dispatch
  door records (the delivered status `'absent'`, the `tools.absent` event, a
  `coverageDeclared` row) and which reached the model as returned — the
  library files an `unsettled-by-absence` row (`UnsettledByAbsenceRow`,
  exported from the package root) immediately after the model's standing,
  keyed to its `toolCallId`. The row carries what the served envelope said it
  did not check (`notChecked`, `cannotCover`) and its `try_instead` byte for
  byte (`tryInstead`, never parsed) — the sentence only: the typed
  `try_instead_tool` (above) is not copied, because nothing in this release
  reads a typed tool off the row. The model's own row is byte for byte what
  9.112.2 filed, and it is served exactly as declared. The next call is also
  served a new section, `unsettled by absence (read off the record):`, with
  one head line per current row and one line per part of the envelope. Once
  the ruled-out result is collapsed to a ticket on the wire, that section is
  where the envelope's boundary still reaches the model. The row is stored
  because what it is read from does not last: the door's rows are per run and
  the served result can be evicted from the window. The ledger's fold keeps
  the last row per result while that result's current standing is still
  `ruled-out`; a ruled-out id leaves the offer, so in practice a row is served
  for the rest of the run and on every continued turn. It is filed at both
  moments that file standings (a call's `_findings.previous` and a JSON
  answer's), on both chart shapes, and the checkpoint carries it (its door
  admits the kind on resume). **Nothing is inferred, and nothing the model was
  not served is quoted:** whether the tool returned an absence is the door's
  call alone, so an envelope a tool returned as TEXT (an MCP server's default
  text mode; `mcpClient({ resultMode: 'structured' | 'structured-or-json' })`
  delivers it as an object) files nothing, as do a zero-row array, a bare
  wrapper such as `{ hba_count: 0, hbas: [] }` and prose. The door records a
  return before the after-tool chain, the tool's own ceiling and placement
  act, so a result an after-tool rule denied, a ceiling's refusal, a placed
  ticket and a summary file nothing, and an after-tool scrub is honored: the
  row's words come from the served result alone. An `open`, `noise` or `fact`
  standing files nothing, and neither does a ruling-out on a call the batch
  settlement answered (see Fixed): that call never reached the door, and a
  standing that names it is `unknownId`; a malformed list or item never
  reaches the row and never fails the run; a framework note joined after the
  envelope (a stepped skill's step boundary) hides nothing. **Not built in
  this release:** the design's second witness, a declared-empty result (a
  top-level zero-row array, `readLookupResult`'s one law). No door records
  that reading per call, and reading the served string would count a text
  `'[]'` the law declines; a `.findings()`-gated door record of it is what
  earns it. **Who is affected:** only an agent with `.findings()` whose model
  rules out a result it was served as an absence. No event and no instruction
  line ship with the row (no reader in this release), and the door's key is
  read only for such a ruling-out, so a run whose model rules out no such
  result records the bytes it always did; the 21 byte-identity references are
  unchanged. The committed ledger now also carries a tool's own words on this
  row, so a redaction policy that hides tool output by key must cover
  `findingsLedger`. The piece's stated ceiling,
  `FINDINGS_PIECE_LIMITS.pieceChars`, rises from 98,304 to 114,688 chars for
  the sixth capped section (the every-cap test in `serve.test.ts` measures the
  largest piece against it).

### Changed

- **A plain object in `tryInstead` is refused, and pointed at
  `tryInsteadTool`.** It is the typed form `{ tool, why? }` written into the
  sentence's slot; 9.112.2 dropped it without a word, and with it the tool
  the author named. It is the ONE value the sentence slot refuses. Every other
  value that is not a string still reads as no suggestion, as in 9.112.2 —
  `null`, `false` from `tryInstead: cond && '…'`, a number, `NaN`, a list, a
  Date — because `absent()` runs inside a tool's `execute`, where a refusal
  reaches the model as that call's error result instead of the absence. The
  declared type has always been `string`, so a typed caller reaches the
  refusal only through a cast or a value typed `any` (a `JSON.parse` result,
  an untyped row), which is assignable to `string` without one.
- **Docs site budget re-baselined.** The static export measured 672.17 MB
  across 7,249 files on the release commit, over the 672.00 MB ceiling with
  one file of room; the ceilings rise ~2% over that measurement to 686 MB and
  7,400 files, with the reason recorded beside the numbers in
  `docs-next/scripts/check-site-budget.mjs · OUTPUT_LIMITS`. The API reference
  is regenerated for this release (two new pages: `TryInsteadTool`,
  `UnsettledByAbsenceRow`).

### Fixed

- **When a batch of tool calls pauses, the calls after the pause now get a
  result.** A model can ask for several tools in one turn, and the agent runs
  them in order. When one of them paused the run — a middleware `ask`, a
  tool's `checkIn`, a credential consent, or a tool that called `pauseHere`,
  `askHuman` or `requestInput` — the calls after it in that batch never ran.
  On resume the library answered the paused call and nothing else: the next
  request to the model still carried the later calls, with no result for them
  (a shape providers such as Anthropic reject), no `tool_start` / `tool_end`
  was emitted for them, and the resumed `iteration_end` counted one call.
  **Who is affected:** any agent whose model batches tool calls and that can
  pause part-way through a batch. A pause on the LAST call of a batch, or on a
  batch of one, was never affected and records exactly what 9.112.2 recorded.
  **What happens now:** every resume path settles each call after the paused
  one without running it. Its result is one fixed sentence the library writes
  — "Tool 'fetch_invoices' was not executed on that call: the run paused on
  call 'c2' to 'collect_input', earlier in the same batch, and resumed without
  executing the calls that followed it in that batch." — past tense, about
  that call only, and telling the model nothing about what to do next:
  whether to ask for the call again is the model's decision. Each
  settled call gets its own `tool_start` and `tool_end` (`durationMs: 0` and
  no `error` — it produced no result, and it did not fail), and the resumed
  `iteration_end.toolCallCount` counts every call that leg closed: the paused
  call plus each settled one (a batch of three paused on the middle call
  reports 2; on the first, 3). The next request carries one result for every
  call. Nothing is run on resume, because a resumed call has no way to pause
  again. A settled call never returned, so it is not in `toolResults` or
  `lastToolResult`, and no `on-tool-return` trigger or skill-graph route fires
  on it. It never ran, so its message carries `notDispatched` (see Added), and
  the readers that ask whether a call ran, or whether a message is a tool's
  result, read that marker: the `sequence` a
  `PermissionChecker` is given (and `PolicyHaltError.sequence`) leaves it out,
  so a policy such as "verify the identity before any transfer" is not
  satisfied by a verification that never happened — and it pairs each marker
  with the one call it answers by that call's place in the history, not by id
  alone, so when a later call that really runs reuses the settled call's id
  (the library's own fallback ids are minted per provider instance and start
  again in a new process) the settled call does not come back and the call
  that ran is not dropped; the empty-lookup check (`noticeEmptyLookups`) takes
  no producer text from it, so a value that only the sentence carries files no
  advisory, and a declared ground that was only ever settled reads as
  `unreachable`; a check-in's evidence `trail` does not list it among the
  calls already completed; the window's
  last-tool-result pin, its drop notice and `WindowRecord.droppedObservations`
  do not take the sentence for that tool's result, so the tool's real earlier
  result stays pinned; the dangling-reference check does not count it as a
  re-fetched ground; under `.findings()` it is never offered to the model as a
  result it may judge, never resolved as one (a model that names its id anyway
  is recorded as written, `unknownId: true`), never counted undeclared, never
  collapsed to a ticket, never listed in `WindowRecord.droppedStandings`, and
  never ranked into its turn's standing — a batch whose results the model
  judged all noise still reads as noise to `WindowStrategyInput.standingOf`
  and the window's fact pin; and the trace toolpack's `inspect_tool_call`
  reports the call as not dispatched, with no arguments, duration or inside —
  and when a provider reused the id for a later call that ran, it reads that
  call's step, outcome and duration off its own bracket, never the
  settlement's. Its two brackets carry the same `notDispatched` (see Added),
  and every reader of the event stream in the library reads it rather than taking a 0 ms
  bracket for a call that ran: causal memory files no tool record for it; the
  audit chain keeps the field on both records; the OpenTelemetry and X-Ray
  adapters open no span or subsegment for it — though neither traces a
  resumed leg today (a trace opens on `agent.turn_start`, which a resume does
  not emit), and a settled call only ever rides one, so in practice they see
  none of it; the live status line, the chat-bubble status and the live tool
  tracker never show it as running, returned or failed; the commentary says
  it was not called; a route hop never names it as the tool that drove it;
  the step graph draws no tool step for it, a boundary's `toolCalls` rollup
  does not count it, and the next step shows the last real result; the
  thinking trace adds no beat for it; and the bug-report transcript keeps the
  field on its step. The checkpoint is unchanged — the calls are read from
  the conversation history — so a checkpoint saved by an earlier version
  settles the same way when it is resumed on this one. An agent that set
  `anthropic({ parallelToolCalls: false })` only to avoid this on pause and
  resume no longer needs to.
  **Still open:** a permission `halt` part-way through a batch, and a paused
  turn continued after `abandonPause()`, still leave the later calls without a
  result; and a hosted input request that is cancelled answers them with
  `input_cancelled` rather than this sentence. Five readers of the history
  still treat the settled sentence as a tool's result: the evidence corpus
  (read by the evidence gate and, under `.findings()`, by the contingent rows
  filed at dispatch) and the prior-turn evidence count built from it, the
  heuristic memory extractor (which stores it as a "Tool result" beat), the
  compaction summary's input, and the messages slot's context records, which
  tag it `source: 'tool-result'` without the marker — so `context.injected`
  and the views built on it count it as a tool's result. A viewer that reads
  only a bracket's `error` shows a settled call as a success: the Lens
  (`agentfootprint-lens`) does today, marking its `tool_end` `ok` and
  describing it as returned in 0 ms, until it reads `notDispatched` on both
  halves of the bracket. And under `.findings()`, a settled call's own
  `_findings` is recorded only in part: the standings it declared are filed,
  its basis row is not.
- **`inspect_tool_call` reads a reused id's outcome and duration off its
  latest call.** A provider may reuse a tool-call id across turns — the
  library's own fallback ids start again in each provider instance. The trace
  toolpack answered with the LATEST call's result for the id but took the
  outcome and the duration from the FIRST `tool_end`, so an id whose first
  call succeeded and whose second failed read `outcome: ok` beside the
  failure's result. Both now come off the LAST `tool_end` for the id — the
  call the result line shows. **Who is affected:** anyone reading
  `inspect_tool_call` on a run whose provider reused an id; a run whose ids
  are unique reads exactly as before. The step line still names the first
  step that ran under the id.

### Unchanged, pinned

- The sentence form is byte-identical: the envelope the model reads, both
  requests' messages, the committed tool turn, the `coverageDeclared` rows and
  the appended block all match a reference generated on the 9.112.2 tree
  before any source edit
  (`test/core/agent/fixtures/absent-try-instead-sentence.reference.json`,
  pinned by `test/core/agent/coverage-try-instead.test.ts`). That fixture is
  the pin for absences: the references in `test/core/tools/reference/` are
  unchanged, but none of them contains an absence. The one change a
  sentence-form absence sees is the new `tryInstead` key, last on its
  `tools.absent` event — so a stored recording of a sentence-form absence (a
  lens fixture, a saved event stream) gains that key when it is regenerated
  against 9.113.0. `ToolAbsence.try_instead` stays exactly
  `string | undefined`, pinned at compile time by
  `test/type-regressions/AbsenceSuggestion.assignability.test.ts`.
- A `tryInstead` that is neither a string nor a plain object (`false`,
  `true`, `0`, `42`, `NaN`, `['a']`, a list of sentences, a Date) runs as it
  did on 9.112.2, byte for byte: status `absent`, one `tools.absent` event, and
  the same envelope the model reads — pinned against a second reference
  generated on the same 9.112.2 tree
  (`test/core/agent/fixtures/absent-try-instead-not-a-sentence.reference.json`).

### Not shipped — waiting for its reader

- `notChecked[].kind` and `subject` (the design's
  `notChecked: [{ kind: 'existence' | 'window' | …, subject?, why }]`).
  Nothing in this release branches on them; the reader that would earn them
  — the assessment's `existence-not-checked` join of an EXISTENCE claim to
  `notChecked[].kind === 'existence'` — does not exist yet. The coverage
  README records the shape, why it waits, and what lands with it.
- **The typed provenance tier waits for its reader.** The integrity assertion
  README records the tier the honest-answer design proposes for assertion
  rows (`claimed | answered | given | observed | checked | judged`, rendered
  by one writer into the `provenance` string as `<tier>:<source>`) and why it
  is not shipped: no code in this release reads a tier. It ships with the
  minimum-strength rule that would read it.

## [9.112.2] - 2026-09-22

### Fixed

- **Input message middleware now applies on a continued turn, not only on the
  first one.** On `run({ message, continueFrom })` — and so on `followUp()` and
  on every stored session behind `standingAgent` — the chain RAN on every turn;
  its output was discarded before the wire and the stored history. The turn's
  history was built from the caller's RAW message before the `'input'` chain
  ran, so the model was sent, and the conversation stored, the original text,
  while the ledger row and `userMessage` (and so
  `checkpoint().originalInput.message`) held the rewrite. A rewrite that adds
  context never reached the model, and a scrub (a PII or redaction middleware)
  ran, recorded its change, and protected nothing on every turn after the
  first. **Who is affected:** any app with an `'input'` message rule —
  `.act({ input: [...] })` or `.messageMiddleware(...)` — that continues a
  conversation through `continueFrom`, `followUp()` or `standingAgent`. First
  turns were always correct.
  **What happens now:** the turn's user entry is the message the chain let
  through, on every turn — the same string the record names. The stored
  history (`checkpoint().history`) therefore holds the rewritten user turn,
  matching `checkpoint().originalInput.message`; that is what the record
  always claimed. A conversation stored before this release still holds the
  raw text for those earlier turns, and continuing it does not rewrite them.
  A refusal on a continued turn now commits the content as it stood when it
  was refused, as a first turn already did. Unchanged: `resumeOnError` adds
  no user entry, a continued turn with no middleware carries byte-identical
  history, and pause/resume (`agent.resume`) never runs the input chain.

### Docs — the ledger row is not the only copy of the pre-scrub text

- The middleware page ("Read this before you scrub secrets") and the
  `ledger.ts` header said the `'input'` ledger row was the only copy of the
  pre-scrub text in the run, and that footprintjs redaction over the key
  removed it. Neither was true for an `Agent`. The original is also in the
  run's input as passed (the `run.entry` payload every flow recorder
  receives), in a crash checkpoint's `originalInput`, and in a refused turn's
  history entry; the ledger row itself is copied into every snapshot,
  narrative and recording surface, and into a paused run's checkpoint
  (`RunnerPauseOutcome.checkpoint` — its `sharedState` and `executionTree`),
  which `standingAgent` stores for a paused session as a `flowchart-v1`
  envelope under every durability, the default `'exit'` included; and an
  `Agent` exposes no footprintjs redaction policy. The page and the middleware
  README now list each surface and what an app must redact itself — for the
  stored pause, by wrapping the `persist` of the store passed as `sessions`.
  The page's `'after-tool'` paragraph and the `MiddlewareDecision.before` doc
  made the same "only copy" claim about a refused tool result; `agentfootprint.stream.tool_end` reports that result by
  design, and both now say so.

### Known — found in review, not fixed here

- **A refused turn's content reaches the next turn.** `deny` on the `'input'`
  phase commits the content as it stood when refused into `history`.
  `checkpoint()` after the refusal carries it, and `followUp()` — or a
  `standingAgent` session under `durability: 'async'` or `'sync'` (any mode
  except the default `'exit'`) — sends it to the model on the next turn. The
  default `durability: 'exit'` does not. This predates
  9.112.2 and holds for a first turn and a continued one alike.
- **The two checkpoints disagree about `originalInput`.** A crash checkpoint
  (`RunCheckpointError.checkpoint`) stores the message as passed, before the
  chain; `checkpoint()` stores the chain's verdict (`userMessage`).
  `resumeOnError` runs the chain again on `originalInput.message`, so resuming
  from `checkpoint()` applies a rewrite twice — a prefix doubles in
  `userMessage` and the ledger while `history` and the wire keep it once — and
  a stored crash checkpoint holds the pre-scrub text. An idempotent scrub
  resumes correctly from either.

## [9.112.1] - 2026-09-22

### Fixed

- **A near-tie no longer clings to an incumbent the scorer put out.**
  `decideTier2` kept the incumbent on ANY near-tie, even when the scorer had
  scored that incumbent at or below the declared floor and the tie was between
  two new candidates — so an ambiguous new topic silently stayed on a skill the
  scorer said the message did not match. It now offers the tied cluster as a
  `menu` in exactly that case — the same mid-conversation menu an `unmatched`
  turn already produced, so staying is still offered as an explicit choice; the
  model decides in-band instead of the policy deciding silently. Unchanged: an incumbent the scorer never scored
  (unknown, not out) still stays, and a scorer with no floor (the embedding
  default) still stays on a contentless follow-up.
- **`validateIntentScores` refuses a candidate scored twice.** It stored rows
  in a map, so a duplicate id silently replaced the earlier score (last row
  wins, in whatever order the scorer iterated). A repeated id is now refused by
  name beside the existing missing / foreign refusals.

## [9.112.0] - 2026-09-18

### Added — bringing your own taxonomy: SKOS in, our map out

- `fromSkos(input, join)` on `agentfootprint/ontology` reads a customer's SKOS concept scheme —
  JSON-LD, already parsed (`@graph`, a flat array or one node; full IRIs, the `skos:` prefix, or
  bare keys under the document's `@context`) — and returns an `OntologySpec` for `defineOntology`,
  which stays the one shape everything reads. No inference: a concept's id is the last IRI
  segment (lower-cased, `-`/space → `_`), its meaning `skos:definition` else `scopeNote` else the
  prefLabel, its aliases every `altLabel`/`hiddenLabel` in the asked language (`join.language`,
  default `'en'`) plus the prefLabel; `broader`/`narrower` → one `is-a` edge per pair, `related`
  → `related` once per pair; the scheme node's last segment and `dcterms:modified` /
  `owl:versionInfo` / `schema:version` give id and version unless the join names them. What SKOS
  cannot say — which source holds a term, which tool reads it, coverage, units — the host binds by
  hand (`SkosJoin.sources` + `bind`); an unbound term has no sources, the honest state. Every
  refusal is one `SkosError` with a `code` (`ERR_SKOS_…`), the IRI(s) and what was expected: no
  label in the language, two concepts collapsing to one id, a relation to a concept the document
  does not hold, a `broader` cycle, a missing id or version, a `bind` key the scheme does not hold.
- `readSkos(input, { language })` — the pure parse (concepts sorted by id, edges sorted, the
  scheme's identity), for a host that wants to look before it joins.
- `toSkos(spec)` — the reverse walk to JSON-LD, with unit, sources, via, coverage and any other
  relation in a `footprint:` namespace declared in the `@context`; `readSkos(toSkos(spec))` gives
  the spec's terms and edges back (pinned). An export, not a serving: the model still reads
  `ontologyPiece`.
- Nothing in the existing ontology moved: `define.ts`, `serve.ts`, `instruction.ts`, `score.ts`
  and `types.ts` are untouched, and `test/ontology/fromSkos.test.ts` pins the hash and served text
  of the reference spec to the literals captured before this release. Out of scope by ruling: a
  Turtle parser, OWL, serving the map in SKOS vocabulary (bench first).

## [9.111.0] - 2026-09-18

### Added — the story's ask and return beats carry the tool call id

- `agentThinkingTrace()` stamps `toolCallId` on every `ask` and `return` beat (`AttStep`), the same
  id every findings-ledger row about that call carries — so a reader can join a story beat to the
  call's declared basis and standing without guessing by tool name or order. Absent only on a
  trace recorded before the field existed. Nothing else on the trace moves.

## [9.110.0] - 2026-09-18

### Added — no towers on unverified lemmas: contingent values on the record, and cache reads as a cost

- **`ContingentRow`** (with `ContingentCarrier`) on the findings ledger: a value the model USED —
  in its final answer, or as an argument of a later tool call — that came only from results the
  model itself declared `open`, `noise` or `ruled-out`. Declared standings joined to the evidence
  corpus's provenance, nothing inferred, no judge: the last standing per result is current
  (`foldLedger`), an undeclared carrier or one `fact` carrier means the value stands, a value the
  corpus lists more than eight carriers for is not judged, and which tokens are values is the
  gate's own rule; nothing is judged from a corpus whose token ceiling was hit (a fact carrier
  past the cut is invisible — the flag under which the gate already downgrades itself); the
  carriers are the current turn's, so a turn-1 result declared noise whose value is used in
  turn 2 of a continued conversation is not contingent and gets no mark. One row per VALUE per
  moment (two spellings of one value share a canonical form), through `recordFindings`; the row
  holds the normalized value (cut at 120 chars with the cut stated) and every carrier with its
  standing. Two moments: the answer, after the evidence gate's verdict (`declaredOn: 'answer'`),
  and dispatch — in the tool-calls stage, after the call's basis row and before it runs
  (`declaredOn: { toolCallId }`); every standing in the batch's `_findings.previous` is filed
  before the check, so a standing declared on this call or on a sibling call of the same batch
  governs this call's arguments. Detection only.
- **`agentfootprint.findings.contingent`** — the fifth findings event: the moment, the dispatching
  call's id, the carrier count, the distinct standings and the value's length; never the value.
  119 → 120 typed events.
- **Served back** in the ledger piece under the heading `contingent (read off the record):`
  after the four buckets — named as the library's join, so the piece's header ("what the model
  itself declared") stays true — one line per row (`tool:c2 used fc1/7 from tool:c1
  (ruled-out)`), capped like a bucket; `servedAt` rebuilds it. The instruction gains one line (`FINDINGS_CONTINGENT_LINE`, `findingsInstructionFor`)
  under BOTH `.findings()` and `.namesAndNumbersFromEvidence()`, composed at `build` — a
  `.findings()`-only agent is never told a sentence its run cannot keep.
- **`EvidenceCorpus.carriers`** — `value → the tool_result ids of this turn's results that carried
  it` (at most `MAX_CARRIERS` = 8, then `truncated`), written by the same walk that stamps the
  turn; **`EvidenceVerdict.grounded`** — the candidates a result did carry, each with the
  spellings it was looked up under, exempt values left out.
- **`AgentState.totalCacheReadTokens`** — `usage.cacheRead` summed beside `totalInputTokens`,
  written only once a provider reported one (the mock never does; the key is absent, not zero);
  crosses the grouped chart's boundary under the same condition.
- **`bench/findings-shuffle.mjs`** — every armed condition also arms the evidence gate at
  `'assist'` (no wire byte moves); three columns read off the record: `contingent` (rows per run —
  the tower rate a hosted run measures), `cache-read` and `cached %` (summed off `llm_end`,
  `—` when nothing reported cache reads); a mock-only fifth condition `ledger+tower` whose scripted
  answer quotes a value from a result it declared noise, so the column is proved to read 1 there
  and 0 on the clean rows.
- Reference `agent-findings-contingent` generated alone — the one reference with both doors; the
  twenty others untouched.

### Fixed — an answer's glued-unit number is met under the spelling the result carried

- A candidate the extractor read off a glued-unit token (`1007us` → the value `1007`) is now
  looked up under BOTH spellings (`extract.ts · candidateForms`: the value's forms plus the
  token's), so an answer's `1007us` is grounded by a text result carrying `1007us`. The INDEX is
  not widened: a result carrying `latency 2024ms` still does not ground an answer's prose year
  `2024`, and an answer spelling the reading bare with the unit apart (`1,007 us`) asks for
  `1007` alone. Pinned in `evidence-extractor.test.ts`: (a) result `1007us`, answer `1007us` →
  grounded; (b) result `latency 2024ms`, answer `in 2024 we migrated` → flagged; the bare
  spelling flagged; a reading nothing served flagged.
- The checkpoint door (`validateCheckpoint`) accepts every row kind the one writer files: it
  named `basis`, `standing` and `conflict` only, so a checkpoint of a run with `.findings({ judge })`
  — carrying `judgment` / `judgment-error` rows since 9.104.0 — was refused on resume; the new
  `contingent` rows would have been too. Each arm checks the fields its reader consumes.

## [9.109.1] - 2026-09-17

### Fixed — the score's word rules, after the first scored arm

- `scoreAbsence` no longer counts `declar…` as a map word: a host's own answer footer says
  "declared by the tools that produced it", which counted the host's boilerplate as the model
  citing the map. The map words are `ontology` and its forms and `map`/`maps`.
- A declared id or alias now also meets its plural (`vmkernel_log` meets "vmkernel logs",
  `change_record` meets "change records"): a plural is a form of the declared word, not another
  word. Still whole-word, still declared strings only.

## [9.109.0] - 2026-09-17

### Added — the score: how a "no data" answer is measured, by declared strings, with no judge

- **`scoreAbsence(spec, turn, expected)` / `summarizeAbsence(scores)`** on `agentfootprint/ontology`
  (`AbsenceTurn`, `AbsenceExpectation`, `AbsenceScore`, `AbsenceSummary`). The design page's first
  number for "the answer names the source" was a regex over prose; this is the rule that replaces
  it. Off the record and the declaration only: did the answer name the expected gap (a term's or
  source's id or declared alias, whole-word, `_` as a space), did it name a declared neighbour (a
  holding source, a reading tool, a term one relation away — `undefined` when the map declares
  none), the tool-call and `unsupportedValues` counts, and the map words it used on the person.
  An expectation naming a gap the map does not declare is refused. `k` of `n` per check in the
  summary, over the turns that had the check.
- **`OntologySource.aliases`** — a source may declare the other names people use for it
  (`['Cohesity']` for `influx_cohesity`), served beside its meaning
  (`<id> — <meaning> · aliases: …`) and validated like a node's: no repeats, at most 16, never
  another declared id of either kind. A source without them serves the bytes it always did; the
  twenty byte-identity references are untouched.

## [9.108.0] - 2026-09-17

### Added — the map meets the skills: which skill declares the tool that reads a term

- **`AgentState.ontology.tools`** — at build, beside the `via` registry check, the agent reads the
  registry's own `toolDeclaringSkills` for every tool the map names and writes tool → skill ids on
  the record, present only when some `via` name is a skill's (a map naming only static `.tool()`
  registrations writes the 9.106.0 record). The served piece prints the join beside the tool —
  `via vm_backup_status [skill: backup-check]`, `[skills: a, b]` when shared — under one new
  header sentence stating the convention; `ONTOLOGY_INSTRUCTION` v3 adds: where a tool is named
  with the skill that declares it, that skill id is what `read_skill` takes. Nothing inferred:
  the registry is the one owner of the fact and the piece quotes it.
- **`OntologyJoin`** (`agentfootprint/ontology`) — `ontologyPiece(spec, { tools?, hiddenSkillIds? })`.
  The hidden-skill law every model-facing sentence applies (`hiddenSkillIds`, the roster's
  sole-owner rule) applies at compose time, never to the record: a hidden skill's id is omitted,
  a tool every declaring skill of which is hidden is omitted whole, a static tool is never
  filtered. `servedAt` rebuilds from the record's `tools` and the epoch's `hiddenSkillIds`, so the
  receipt agrees byte for byte under a role that sees less (pinned end to end). Reference
  `agent-ontology` regenerated alone (its one tool is static, so the join is absent and only the
  header sentence and the instruction moved); the nineteen others untouched.

## [9.107.0] - 2026-09-17

### Changed — the ontology's ask is a named value, and its wording no longer makes the model cite the map

- **`.ontology(map, { ask })`** — `ask: 'use-the-map' | 'none'` (`OntologyAsk`, on
  `agentfootprint/ontology`; the option form is `Agent.create({ ontology, ontologyAsk })`,
  refused without the map). `'use-the-map'` is the default and what `.ontology(map)` always
  did: the versioned always-on `ONTOLOGY_INSTRUCTION`. `'none'` serves the same piece on every
  call and registers no ask of the library's — for an application that writes its own through
  `.instruction()`. The findings ledger's `answerAsk` grammar: a named value, never a boolean.
  The record, the receipt and the served view show which ask ran (the `ontology` injection
  present or absent).
- **`ONTOLOGY_INSTRUCTION` v2** — the map is more than the "no data" moment, and the ask now
  says so: read the question in the map's terms and aliases; where a term is held, the tool
  named beside it is where to look; a relation is the way from a term already held to the term
  needed; an unmet need is answered with the source, tool or neighbouring term the map declares,
  as a proposal; never a value off a definition. New last line: speak to the person of sources,
  tools and terms — never of the map, the ontology or a declaration. Under v1 the first host's
  measured run had the model telling the person "the ontology says" in five of eight answers
  (`docs/design/2026-09-ontology.md` § Measured). The byte-identity reference `agent-ontology`
  regenerated alone; the nineteen others untouched.

## [9.106.0] - 2026-09-17

### Added — the ontology: a declared map of what exists and where, never a way to fetch it

- **`agentfootprint/ontology`** — a new door (the seventeenth): `defineOntology(spec)`
  takes an `OntologySpec` — `nodes` (an `OntologyNode` per term: `meaning`,
  `unit`, `aliases`, and the `sources` that hold it, each an
  `OntologyNodeSource` with the registered tools that read it from there
  (`via`) and the author's `coverage` sentence), `sources` (an
  `OntologySource` per place data is held: `meaning`, `coverage`,
  `configured` — a boolean the author wrote, or absent, which means unknown
  and is never assumed) and `edges` (an `OntologyEdge`: `from`, `to`, the
  author's `relation` word, `meaning`) — and returns an `Ontology`:
  validated, detached, deep-frozen, with a `hash`. Every fault is refused
  by name (an id that is not identifier-safe, an edge to a node nobody
  declared, a node held by a source nobody declared, an empty or over-long
  text, a repeated alias / `via` / edge, a count past `ONTOLOGY_LIMITS`). A
  node with no source is legal: known, nowhere collected here.
  `ontologyHash` fingerprints the five declared fields through the
  receipt's own `stableJson` (key-order independent; edge order is part of
  the identity).
- **`.ontology(map)`** (`AgentOptions.ontology`, `AgentBuilder.ontology`;
  once per agent, the option form goes through the same door). At
  `.build()` every `via` tool name is checked against the agent's tool
  registry — a name no registry carries is refused, naming the ontology,
  the tool, the node and the source. At run `seed` writes the whole map
  ONCE as the run constant `AgentState.ontology` (`OntologyRecord`: `id`,
  `version`, `hash`, `spec`), so the wire, the rebuild and a lens need
  nothing but the record.
- **The served piece.** Every model call is served ONE request-only system
  piece composed by the pure `ontologyPiece` (`OntologyPiece`, `source:
  'ontology'` — a new `ContextSource`): a constant header quoting the
  context contract's `domainDefinitions`, `limitations` and `evidenceRefs`
  meanings, then `nodes:`, `sources:`, `held by:`, `relations:` and `known,
  not held here:` — every line the declaration's, nodes and sources sorted
  by id, edges in declaration order, `ONTOLOGY_PIECE_LIMITS` lines per
  section with the overflow stated, an empty section omitted, no per-call
  byte (an unchanged map reuses the cached system prefix). Joined after the
  recovery piece and before the findings piece — injections → recovery →
  ontology → findings, fixed — never as an injection; hashed on the receipt
  and rebuilt byte-equal by `servedAt` in both chart shapes (the grouped
  chart crosses the key into `sf-llm-call` under the arm).
- **The ask.** `ONTOLOGY_INSTRUCTION` (`ONTOLOGY_INSTRUCTION_ID`), an
  always-on instruction the `outputSchema()` way: say which declared
  source, tool or neighbouring node the map names for a need the results
  did not meet — as a proposal, never as a claim that data exists there;
  never invent a value from the map; report a node listed as known but not
  held here as declared. Judged by `unprovable` in the model-facing
  inventory, beside the piece.
- **`agentfootprint.ontology.served`** `{ iteration, id, version, hash,
  nodes, sources, edges }` — once per call that served the piece;
  identities and numbers only. A new domain, `ontology`, with its
  wildcard: 26 → 27 domains, 118 → 119 events.
- **The law.** The library never decides that a node "has no data": absence
  is the model's or the tool's to report; the map only lets the model SAY
  where a need would be met. Nothing is executed or fetched through it;
  nothing is inferred from it. An agent without `.ontology()` is
  byte-identical to one built before the map existed — no key, no piece,
  no instruction, no event (the 19 byte-identity references untouched; one
  new reference `agent-ontology`). What the map is measured on — tool calls
  before the honest answer on questions whose data is not collected, and
  whether that answer names the source — is a bench on the first host after
  the release, not here (`docs/design/2026-09-ontology.md`).

## [9.105.0] - 2026-09-17

### Added — tool choice by classifier: a second reading beside the model's call, and a narrowing dial

- **`.toolChoice({ classifier, serve, alwaysServe })`** (`AgentOptions.toolChoice`,
  `AgentBuilder.toolChoice`). At every model call the tools slot asks the
  classifier ONE `choice` question — id `TOOL_CHOICE_QUESTION` (`'tool'`),
  criteria the tools about to be served by name with their own descriptions
  (the merged wire minus the always-served doors), state the user's message
  plus the active skill id — and files a `ToolChoiceRow` under
  `AgentState.toolChoices` BEFORE the call: `offered`, `ranked` (the
  provider's distribution as sent, highest first, an unscored tool absent —
  never padded, never renormalised), `chosen` (the provider's own pick,
  absent when it named nothing offered), `confidence`, `usage`, `latencyMs`,
  `served` (the names the slot committed) and `narrowed`. After the reply
  `callLLM` files a `ToolChoiceOutcomeRow`: `called` (the model's tool calls
  in order, empty on an answer), `firstAgrees` (`chosen === called[0]`,
  absent when either is absent) and `miss` (the names called outside a
  narrowed served list). A failed classifier call is a `ToolChoiceErrorRow`
  (status, message, latency) and the full set is served — fail open, never
  fail narrow. The model's call is the emission; the pick is a second
  reading marked `source: 'classifier'`, never substituted, never merged.
- **Advisory by default** (`serve: 'all'`): the wire is byte for byte the
  unarmed agent's — every request equal, every receipt equal; the record
  gains the rows and nothing else.
- **The narrowing dial** (`serve: { top: N }`): the slot commits the
  classifier's top-N plus the doors — `read_skill`, `list_skills`,
  `skip_step`, `present` (`ALWAYS_SERVED_TOOLS`) and the app's `alwaysServe`
  — in the merged wire's order, at the ONE decoration site, so
  `dynamicToolSchemas`, the receipt's `tools.schemaHashes` and
  `servedAt(k).tools.schemas` are the narrowed list by construction (no new
  `SERVED_GAPS` kind; `toolsInjections` follows the served set). The full
  wire is served with the reason on the row (`narrowedSkipped`:
  `NarrowSkipReason`) when the classifier failed or scored fewer than N
  (`unavailable`), fewer than N + 1 candidates were offered (`too-few`), the
  previous call's outcome carried a miss (`after-miss`) or the call is the
  out-of-budget wrap-up (`wrap-up`). A miss — the model naming a
  narrowed-away tool — is recorded on the outcome row and answered by the
  dispatcher's off-wire path exactly as before (`tools.answered_off_wire`);
  the next call serves the full wire. `reactMode: 'classic'` is refused at
  build (the `.findings()` precedent).
- **Three events**, `agentfootprint.tool_choice.picked` (`chosen`,
  `confidence`, `offered` and `served` as counts, `narrowed`,
  `narrowedSkipped`, `latencyMs`, tokens), `agentfootprint.tool_choice.outcome`
  (`called`, `firstAgrees`, `missed`) and `agentfootprint.tool_choice.failed`
  (`status`, `latencyMs`) — identities, enums, numbers and a boolean only
  (payloads `ToolChoicePickedPayload`, `ToolChoiceOutcomePayload`,
  `ToolChoiceFailedPayload`); 115 → 118 typed events, 25 → 26 domains.
- **Root exports**: `ToolChoiceRow`, `ToolChoiceErrorRow`,
  `ToolChoiceOutcomeRow`, `ToolChoiceEntry`, `ToolChoiceLedger`,
  `ToolChoiceScore`, `NarrowSkipReason`, `TOOL_CHOICE_QUESTION`,
  `ALWAYS_SERVED_TOOLS`. The asker (`src/core/agent/toolChoice/pick.ts`) is
  loaded through `import()` by the slot and is deliberately not exported.
- **`npm run bench:tool-choice`** — the mock provider, one skill of eight
  tools, six scripted steps, a scripted classifier ranking the right tool
  first / second / a wrong pair, under `advisory` and `top-2`: `first-agrees`,
  `misses`, `extra-calls`, `tools-slot-bytes` (from the receipt's
  `requestMeasurement`), `pick-tokens`, `pick-latency-ms`; the cost line
  first; exits non-zero if the unarmed twin's tools-slot bytes move or an
  advisory row's differ from the twin's. On 2026-09-17: 1745 bytes unarmed
  and on every advisory row, 743 under `top-2` with a right ranking, 1172
  under a wrong pair (three misses, the full wire on the call after each,
  zero extra calls).
- Byte identity: the 18 unarmed references untouched; one new reference
  `agent-tool-choice` (`test/core/tools/byte-identity.test.ts`), generated
  alone. Design: `docs/design/2026-09-scored-choice.md` § Step 4; README:
  `src/core/agent/toolChoice/README.md`.

## [9.104.0] - 2026-09-17

### Added — a calibrated judge beside the model's own standings

- **`agentfootprint/classify`** — a new door for a classifier that SCORES
  declared candidates instead of generating text: the `Classifier` port
  (`{ name; classify(request, signal?) }`), the request shapes (`choice` over
  declared options, `noul` as a probability, `score` on a declared scale),
  the answer shapes (the pick, its confidence and the WHOLE distribution),
  `ClassifierError` (`status?`, `retryable`), and two adapters —
  `typesafe()` (TypeSafe "System One", model `jev-latest`; key from
  `TYPESAFE_API_KEY` or `apiKey`, refused at construction when missing; one
  `fetch`, no SDK; exponential backoff on 429/529 up to `maxRetries`;
  `latencyMs` measured around the whole call; the wire mapped field for
  field, probabilities never renormalised, the key never in an error) and
  `mockClassifier(script)` for tests and the bench (every request on
  `calls`). Verified 2026-09-17 by one real call; the suite maps that probe
  against a stubbed `fetch` and never calls the hosted classifier.
- **`.findings({ judge })`** — a SECOND SOURCE on the findings ledger. After
  every tool result lands and before the next model call, the judge is
  asked what the RESULT is worth for the proposition the model declared on
  the call, or for the user's question when none was declared (never why
  the tool was called), and its answer is filed as a `JudgmentRow` beside
  the model's own `StandingRow`: `source: 'judge'`, the judge's name and
  the provider's model string, `against: 'proposition' | 'question'`, the
  standing, the distribution, the confidence, `testsSubject`, usage,
  latency, `clipped` when the result was cut at 4000 characters, the
  iteration. A failed call is a `JudgmentErrorRow` (status, the provider's
  message, latency) — never a guessed standing — and the run continues.
  `foldLedger` gains `judgments` (last wins) and leaves `standingOf` the
  model's; nothing is served from a judgment in this release (policy A —
  the design page names B–D and leaves them to the bench). The probe's
  disagreement — the model said `ruled-out`, the judge said `noise` at
  0.69 — is the first recorded fact of the second source. Root exports
  `JudgmentRow` / `JudgmentErrorRow`; `agent.findings()` returns the rows
  as before.
- **Events** `agentfootprint.findings.judged` (`toolCallId`, `toolName`,
  `iteration`, `against`, `standing`, `confidence`, `latencyMs`,
  `inputTokens?`, `outputTokens?`) and `agentfootprint.findings.judge_failed`
  (`toolCallId`, `toolName`, `iteration`, `status?`, `latencyMs`) —
  identities, enums and numbers, never the state; and
  `agentfootprint.findings.standing` gains `agrees?: boolean`, the model's
  standing against the judge's current judgment of the same result, present
  exactly when a judgment row exists (the judge files before the model call
  that declares, so the standing event is where both readings exist). 115
  typed events across 25 domains.
- Only a result the tool PRODUCED is judged: a permission denial, a halt, a
  fail-closed refusal or a declined check-in files no judgment row and
  spends no classifier call — a denial text is not a tool result.
- `typesafe()` refuses a reply without the provider's `model` string or an
  answer whose numeric field (`confidence`, `score`, `noul`) is missing or
  not a finite number, as a `ClassifierError` — never `'unknown'` or `NaN`
  on the record; a per-attempt `timeout` ends the call after one attempt,
  not retryable.
- **`classifierScorer(classifier)`** on `agentfootprint/skill-graph` — an
  `EntryScorer` whose ranking IS the provider's distribution (the scored
  choice, design step 2): one `choice` question over the entry candidates
  with `{ id: description }` as criteria, `score` and `relevance` both the
  probability as sent (a candidate the provider did not score is absent
  from the ranking, never a padded 0), `chosen` the provider's own pick,
  `scorer: 'classifier:<model>'`. A provider failure returns `scorer:
'classifier:unavailable'` with an empty ranking and no `chosen`, and the
  existing cold-start entry pick takes over — never a guess.
- **Bench** `bench/findings-shuffle.mjs`: `AF_SHUFFLE_JUDGE=mock|typesafe`
  arms every armed condition with a judge and adds `judge-accuracy`,
  `judge-agrees`, `judge-tokens` and `judge-latency-ms`, with the classifier
  calls stated on the cost line before the first is made; the mock judge
  scripts the planted truth at a fixed confidence and the smoke laws pin
  it. Unset, the bench prints the 9.103.0 table byte for byte.
- Byte identity: the 17 references pass untouched; `agent-findings-judge`
  is the one new reference, generated alone with a scripted judge — its
  delta over `agent-findings` is the two judgment rows and the declared
  proposition, and nothing under `served.*`.

## [9.103.0] - 2026-09-17

### Added — an answer-turn ask on the served ledger piece, as a dial

- `findings({ answerAsk: 'quote-facts' })` appends a second model-facing ask
  to the served ledger piece — `FINDINGS_ANSWER_ASK`, its last section after
  a blank line — telling the model HOW to answer from it: answer from the
  `facts` lines and copy each value as written; an `evidenceRefs` or
  `nextSteps` result is unsettled, say so; a `{"collapsed":true,…}` ticket
  carries no data (judged noise or ruled out, or its fact already listed),
  do not draw on it; an undeclared result is
  served in full and may be used; never invent a value. It says what the
  model may do and promises nothing (judged by `unprovable` at the strictest
  lifetime, registered in the model-facing inventory), and it is a constant,
  so the piece's cache law holds with it. The default is `'none'` and the
  dial is BENCH-GATED like `'ledger-only'`: it ships so
  `bench/findings-shuffle.mjs`'s new fourth condition, `ledger+ask`, can
  score it on a real model on `facts-in-answer` against `ledger-and-facts` —
  the design page's fourth run measured one fact value in twelve restated
  when the piece is served, and asked for this instruction variant next. On
  the mock that row equals `ledger-and-facts` to the digit (the scripted
  model ignores prose; the header says so). The dial rides the
  `findingsServe` thread exactly — `Agent.ts` to seed and to call-llm,
  value-conditionally — and lands on the record as the run constant
  `AgentState.findingsAnswerAsk`, written ONLY under `'quote-facts'`, so an
  armed agent on the default commits the key set it committed in 9.102.0,
  every unarmed agent is byte-identical, and `servedAt` re-appends the ask
  from the record by construction. A bad value is refused at build at either
  door. Pinned: `findings/serve.test.ts` (the ask appended only under the
  dial, exact bytes, absent by default, never alone), `findings-served.test.ts`
  (both chart shapes end the served system text with the ask; without the
  dial byte-identical), `findings-declarations.test.ts` (the option, the run
  constant only when armed and on, the refusal), `receipt-conformance.test.ts`
  (the rebuild byte-equal under the dial); all 18 byte-identity references
  pass untouched.

### Measured — the ask on two hosted models (`bench/findings-shuffle.mjs`, noise 4 at the end of the order, 1,000-token payloads, ten runs per condition)

- Claude Sonnet 5: facts in the answer 0.883 with the ledger alone → 0.950 with the ask (1.000 without the ledger); noise cited 0.100 with either → 0.300 without the ledger; drift 0.70 → 0.40.
- Claude Haiku 4.5: facts 0.983 → 1.000 with the ask; noise cited 0.000 (0.100 without the ledger); drift 0.30 → 0.20.
- Collapsing facts too (`serve: 'ledger-only'`) was the worst row on both models and stays bench-gated. Full tables: docs/design/2026-09-findings-ledger-real-model.md.

## [9.102.0] - 2026-09-17

### Added — a declared fact stays in the window; noise leaves first

- The window reads the findings ledger. On an agent with `.findings()` and a
  window strategy, a turn whose tool result the model declared a `fact` is
  HELD beyond `keepRecentTurns` — newest first, up to `keepLedgerFacts`
  (default 4; `false` or `0` for no hold) — and the refusal is on the record
  by name: `WindowRefusalReason` gains `'ledger-fact'`. It is a bounded hold
  in the refusal engine, the content-aware sibling of the last-tool-result
  pin (`ledgerFactPinsOf` beside `toolResultPinsOf`, admitted by the same
  ceiling-spender in `planRemoval`), so `slidingWindow`, `tokenBudget`,
  `summarizeOldest` and a consumer-written strategy all inherit it through
  `planRemoval` — no new strategy file, none of the three shipped ones changed
  a byte, the contiguous span, the drop ladder and the meter's single-seam
  rebase untouched. 'Noise first' follows with no second mechanism: noise,
  ruled-out, open and undeclared turns are unpinned and leave oldest-first as
  they always did, and a judged noise turn that outlives a fact is already a
  ticket on the wire. Why: the served piece restored a declared fact to the
  answer turn, but under a window the fact's RESULT still left by recency —
  the refusal engine saw a declared fact and a declared noise result as the
  same bytes. By the model's claim only: a turn is the removal unit and its
  standing is its most valuable result's (`fact > open > undeclared >
ruled-out > noise`); a result the model never named is undeclared and is not
  held; the library reads no result's text to decide otherwise.
- A fact hold never exists without its ceiling and its stand-down. The
  ceiling is spent newest first and a held turn already inside
  `keepRecentTurns` spends no slot (the free-pin law); the turns it turned away
  are `yielded` on the record; nothing at or before the current request is
  pinnable. The stand-down is the pin's: when the two previous visits removed
  nothing and named only pins, the fact pins release for one visit and the
  record says so. It reads BOTH pin names (`'last-tool-result'` and/or
  `'ledger-fact'`), because a turn held by both pins is reported under the
  recency pin's name — a fact stand-down reading only its own would never see
  that turn blocking, and the two pins would alternate under each other's
  name with the window never shrinking (derived, pinned by test, never
  shipped). The recency pin's own stand-down reads only its own name, so its
  9.57.0 rule is unchanged.
- The record says what was held and whose standing left. `WindowRecord`
  gains two optional keys, present only on an armed agent and filed by the
  STAGE so a consumer-written strategy's record carries them too:
  `ledgerFacts` (the `WindowObservations` shape — `pinned`, `yielded`,
  `limit` = `keepLedgerFacts`, `standDown: true` on the visit it released)
  and `droppedStandings` (`{ toolCallId, standing? }` for every tool result
  that left; `standing` absent is undeclared, never a verdict the library
  inferred). `WindowStrategyInput.standingOf?` hands a strategy a turn's
  declared standing, bound by the stage from ONE read of the ledger and
  absent on an unarmed agent — a strategy never reads scope for it; it is for
  ordering or reporting among what the engine left removable, never for
  inferring. What the model is TOLD about a drop is unchanged: the notice
  names tools and counts, never a standing, never the model's own line.
- `keepLedgerFacts` is live: `.findings({ keepLedgerFacts })` and
  `Agent.create({ keepLedgerFacts })` (the `.findings()` door wins when both
  are given), resolved once at build and validated there — a negative or
  non-integer value is refused, never mid-run. Without `.findings()` the
  option is accepted and does nothing (the keepLastToolResults-without-a-window
  precedent). Exported from the root: `LedgerFactPin` (the candidate a hold is
  built from: `toolCallIds`, `toolName`, `turnIndex`, `messageIndex`, `chars`),
  beside the widened `WindowRefusalReason` and the `WindowRecord` additions.
- Measured (`npm run bench:findings`, mock provider, 30 tool calls, a planted
  fact every third, a sliding window keeping 6 turns): the results of 2 of 10
  planted facts reached the answer turn verbatim by recency alone, 6 under the
  default ceiling and 8 under a ceiling of 6, while the piece carried 9 of 10
  on every armed row (the last batch is undeclared by the no-outputSchema law)
  and the noise share of tool-result bytes on the wire stayed at the collapsed
  level; every noise result left on every armed row, so the hold changed WHICH
  facts left, not whether noise did. The design page has the print and its
  reading; no real-model number exists yet.

### Unchanged — an agent without `.findings()` plans, records and sends the bytes it did before

- The hold, the ledger read, `standingOf`, `ledgerFacts` and `droppedStandings`
  are all gated on the door: an unarmed window stage never reads
  `findingsLedger` (pinned by a getter counting reads), hands its strategy the
  exact input it always did, files the exact record it always did, and sends
  the same request bytes — even when the model emits `_findings` on its own.
  The 16 byte-identity references under `test/core/tools/reference/` pass
  untouched; ONE new reference, `agent-findings-window`, was generated alone,
  with what it holds read back from its bytes on the test file's header.
- `keepLedgerFacts: false` plans exactly as the unarmed window (the bench
  checks it: same facts verbatim, same tool messages, same receipt count, no
  fact held), so the hold is an addition to the plan, never a rewrite of it.

### Added — the ids the model may name are in the schema; the proposition before the call; a bench that can measure

- The offer. On a hosted model the ask "by its tool_result id" produced
  standings named by ORDINAL (`"0"`, `"1"`), recorded honestly as `unknownId`
  and settling nothing (`docs/design/2026-09-findings-ledger-real-model.md`).
  So from the second call on, the reserved `_findings` property on every
  served schema binds the ids the model may name: `previous[].toolCallId`
  carries `enum: <the tool results on the wire with no standing yet, newest
first, at most 32>` and says "one of the ids listed; a result not listed
  cannot be named here"; a clipped list states the cap. The list is what the
  model can still READ: a result with no standing, a `fact` (stood on in the
  piece, served verbatim under the default mode) and an `open` result (served
  verbatim, carrying what would settle it) stay listed, so a later call can
  REVISE a standing — `open` → `fact` when a call settles it, `fact` →
  `ruled-out` when a conflict resolves; the fold's last-wins law is reachable
  through the enum. A result the model declared `noise` or `ruled-out` leaves
  the list: it is a ticket on the wire under every serve mode and the piece
  carries a count or one line, so there is nothing left to re-judge (a wrong
  `ruled-out` is answered by a new call). The instruction asks the model to
  name a result again only to change its standing. An evicted result is not
  on the list, and the first call — with nothing to name — serves the base
  property by reference, byte-identical to 9.101.0. ONE owner of the two sets
  (`findings/offer.ts`: `offeredResultIds` for the enum, `undeclaredIds` for
  the piece's `undeclared:` line — the honest absence, a subset of the offer),
  computed at the Tools mount, where the served history and the ledger meet
  (the slot is an isolated subflow), under the same arm that decorates; bound
  at the ONE decoration site and committed with the tool list, so
  `servedAt(k).tools.schemas` holds exactly what was offered and
  `receipt.tools.schemaHashes` moves when the offer does. The law holds at
  the schema AND at the row: the offer is what the model may COPY, never what
  the library resolves — an id outside it still files as written, `unknownId:
true`, never mapped to a position or a tool name — and every id INSIDE it
  resolves, because a standing is identified against the same served history
  the offer was read from (`findings/offer.ts · knownResults`: the served
  `role: 'tool'` messages plus the previous batch), so an id copied from the
  offer files with its tool name whichever batch the result came from (the
  first cut resolved against the last batch only, and an offered older id
  filed as `unknownId` — caught in review, never released). The instruction
  asks the JSON answer, which has no schema to bind, for the id exactly as
  the schema listed it.
- Named, not measured: from the second call on, an armed agent's tool schemas
  vary per call (the enum), so a `'tools'` cache breakpoint cannot hit on such
  a run and, on a prefix-cached wire, every breakpoint after it misses with
  it — the system piece already moved the block on every declaring call
  (step 3's recorded cost); the offer moves the tools prefix ahead of it. No
  bench in the tree counts cache tokens; the lever not taken (the offer in
  the request-only system piece, below the tools breakpoint — prose, which is
  what failed on the real model) is on the design page.
- The proposition. `FindingsDeclaration` gains `proposition?: string` (what
  the call tests; the schema recommends it when `basis` is `'exploratory'`)
  and `predicts?: string` (what the result should show if it holds), declared
  on the call before its result exists; both land on the `BasisRow`, each cut
  at 240 chars with the cut stated in the text. `FindingsDeclaredPayload`
  gains `hasProposition?: true` — a flag, never the text. The served piece
  quotes the judged call's own proposition on `open` and `ruled-out` lines
  (`… — tested: <proposition>`), never on a fact line; `predicts` is
  record-only.
- The shuffle bench can measure (`bench/findings-shuffle.mjs`): `NOISE_AT`
  (end / start / spread), `NOISE_SIZE` (about 250 / 1000 / 4000 tokens of
  padding per noise record), noise values within 5% of a fact and never equal,
  a `standing-accuracy` column (the share of the actor's standings on known
  ids that agree with the planted truth — the harness knows the truth, so no
  judge), and `--matrix` (24 cells for one model per invocation, the cost line
  printed before the first call). Default mode prints the pre-packet numbers
  to the digit and the mock smoke stays green. No hosted run was made in
  this release; the real-model page holds the pre-offer tables and names the
  number that must move.

### Changed — `.findings()` refuses `reactMode: 'classic'`

- The offer needs the tools slot recomposed every call, so `.findings()` is
  REFUSED at build under `reactMode: 'classic'` — through both doors
  (`.findings()` and `Agent.create({ findings })`), the `selfExplain` twin:
  classic selects the Tools branch on turn 1 only, so an armed classic agent
  would have served the offer-less base on every call and filed every
  standing as `unknownId`, the number this packet exists to move silently
  stuck at zero. 9.101.x accepted the combination and degraded it silently;
  the message names the fix. `'dynamic'` (the default) and `'dynamic-grouped'`
  are unchanged.

### Fixed — the choice seam's enum fence read the decorated schema

- Since 9.101.0, `withoutFindingsArgument` recognised the library's
  decoration by REFERENCE only (`properties._findings ===
FINDINGS_ARGUMENT_SCHEMA`), and the reference never holds on the live path:
  the served list `callLLM` reads is the committed `dynamicToolSchemas`, a
  `structuredClone` of what the slot planted. So the choice seam's enum fence
  (`declaredEnumValuesOf(withoutFindingsArgument(schema))`, the
  `unsupported-argument` check) judged the model's argument values against a
  schema that still carried `_findings`, and a value equal to one of the
  findings vocabulary words — `direct`, `exploratory`, `low`, `medium`,
  `high`, `fact`, `open`, `noise`, `ruled-out` — was excused as a declared
  enum value the model was entitled to. The decoration is recognised by its
  versioned marker now (the first sentence of the reserved property's
  description), so the frozen base, an offer copy and a committed clone of
  either are all peeled, and an author's own `_findings` is still read as
  written. An armed agent may therefore file an `unsupported-argument`
  finding it previously suppressed. Its unit test had passed because it
  handed the function the live reference; `test/core/agent/findings/
reserved.test.ts` now pins the clone.

### Unchanged — the unarmed agent, and the two armed references regenerated alone

- An agent without `.findings()` maps no new key on the Tools mount, reads
  neither `history` nor `findingsLedger` there, and serves and records the
  bytes it did before: the 16 unarmed byte-identity references pass
  untouched. `agent-findings` and `agent-findings-window` were regenerated
  each alone (the rest copied aside and `cmp`-equal after) and their delta is
  on the test file's header: the enum on every epoch after the first, a
  `dynamicToolSchemas` write on each such epoch where an unchanged list used
  to be an empty commit, the two new properties and the instruction's two new
  lines, and the sizes that follow; regenerated once more, each alone, in the
  second review for the revisable offer (a declared fact stays listed) and
  the instruction's revised line. No message, ticket, ledger row, window
  record or gap moved.

## [9.101.1] - 2026-09-16

### Fixed — the docs site's export-file ceiling

- 9.101.0 never reached npm: its publish workflow stopped at the docs site's
  performance budget (`docs-next/scripts/check-site-budget.mjs`), where the
  generated API-reference routes for the findings ledger's new exports took the
  static export past the file-count ceiling. The ceiling is raised to the
  measured count plus the same thin headroom; no byte ceiling moved. The library
  is byte-identical to 9.101.0; the entry below is what ships.

## [9.101.0] - 2026-09-16

### Added — the model's own findings, on the record, at zero extra calls

- `.findings()` on the agent builder (`AgentBuilder.findings`) — every
  SERVED tool schema gains one reserved optional argument, `_findings`
  (`RESERVED_ARGUMENT`): the model declares a `basis` for each call before
  the result exists (`direct` when it expects the answer, `exploratory` when
  it is looking; optional `expect`: `low` / `medium` / `high`) and, on its
  next tool call or as a top-level `_findings.previous` on a JSON answer,
  the STANDING of each earlier tool result by its tool_result id — `fact`
  with the assertions it stands on, `open` with what would settle it,
  `ruled-out` with one line, `noise` with nothing. The library peels the
  argument off before the tool, the middleware chain, the argument
  validator, the permission gate and every pause carrier see the call, files
  the rows through ONE writer as an append-only `AgentState.findingsLedger`
  (`basis` / `standing` / `conflict` rows — a conflict is `conflictsOf`'s
  fact about two stood-on readings that disagree, witnesses by identity),
  and leaves the assistant turn in history verbatim. Read it back with
  `Agent.findings()` (detached; `undefined` when unarmed or when the model
  declared nothing — never an empty array standing in for "no findings").
  Why: a long tool loop serves every result back in full on every call and
  what the model already judged is nowhere but in its head; asking a second
  model would cost a call per result and put a second voice on the record.
  Nothing is inferred (a call with no declaration files no row; a result
  nobody names has no standing — undeclared, never `open`); what the answer
  turn is then SERVED from the record is the next block; and the always-on
  `findings-ledger` instruction is a system piece hashed on every receipt,
  so a reworded ask is a different hash a bench can name. `keepLedgerFacts`
  is accepted now so no public name changes later and is inert until
  standing-aware eviction lands.
- Two typed events — `agentfootprint.findings.declared` (one per basis row)
  and `agentfootprint.findings.standing` (one per standing row) — carry
  identities, enums and counts only; assertion values, `settles` and `line`
  live in the committed key under whatever redaction the run configured.
- The checkpoint carries `findingsLedger` only when present, and
  `continueFrom` re-seeds it, so a continued conversation never reports its
  earlier declarations as undeclared. `validateCheckpoint` checks each row's
  shape per kind — shape only, never the values.
- A registry tool that declares its own `_findings` property is refused at
  build, naming the tool, and only when `.findings()` is armed; a provider-
  or MCP-ingested schema that carries the name is left undecorated (the
  author's property wins, recorded by the committed schema itself), and a
  call to that tool is not peeled — the value runs as the author's argument
  and files no row.
- The answer that stands is the peeled JSON; a re-ask (`output-retry`,
  `step-nudge`, `evidence-recheck`) quotes the emission — the string the
  provider returned — into the conversation, never the peeled form. A policy
  halt hands the app the peeled args (`PolicyHaltError.proposed.args`), the
  same carrier law every pause carrier follows.
- Exported from the root: `RESERVED_ARGUMENT` and the row types
  (`FindingsLedger`, `FindingsRow`, `BasisRow`, `StandingRow`,
  `ConflictRow`, `ConflictWitness`, `FindingsDeclaration`, `Basis`,
  `Expect`, `Standing`).

### Added — served from the ledger

- The answer turn reads the ledger. Once the model has declared at least one
  standing, every later call on an armed agent is served a request-only
  system piece composed from the folded ledger — `source: 'findings'` on the
  receipt's `system.pieces` and on `servedAt(snapshot, k).system.pieces` —
  headed by the context contract's own field meanings and holding `facts`,
  `limitations`, `evidenceRefs` and `nextSteps`, each bucket marked "declared
  by the model" and quoting the declaration (a conflict names both witnesses
  and no verdict; a ruled-out branch is its one line), then `noise` as a count
  and `undeclared` for the results nobody named — the honest absence, never
  `open`. Bounded, every overflow stated, an empty bucket omitted. On the
  wire, and only on the wire, a tool result the model judged `noise` or
  `ruled-out` is served as a ticket, `{"collapsed":true,"standing":…,
"toolCallId":…}`, in place of its content; `open` and undeclared results
  stay verbatim; nothing is dropped or reordered, and `toolName` /
  `toolCallId` are untouched, so the tool_use/tool_result pair stays
  wire-valid. `history` never changes — the window stage stays its only
  writer — and `servedAt` rebuilds the piece and the collapse with the same
  functions in the same order, so `receiptAt(k)` agrees by construction on
  an armed run with a collapsed entry; no new served gap, `withheld`
  untouched. Why a piece and a ticket rather than a rewritten history: the
  record must keep the emission, and a judged result's bytes should not be
  read again at full size on every call after the model said what it was.
- `.findings({ serve })` chooses how much of the pile stays:
  `'ledger-and-facts'` (the default — facts, open and undeclared results
  verbatim beside the piece; noise and ruled-out as tickets) or
  `'ledger-only'` (fact results as tickets too; the model answers from the
  piece, its own paraphrase). The second is BENCH-GATED: shipped so
  `bench/findings-shuffle.mjs` can measure it on a real model, not a
  recommendation, and never a default until that run shows the answer does
  not drift when the same evidence arrives in a different order. The run
  constant `findingsServe` is committed on every armed run so a served view
  knows which dial produced the wire.
- The piece carries no per-call byte — it is a function of the folded
  ledger and the wire's tool ids and nothing else — because it joins the ONE
  system block the cache marker covers (`systemPromptCachePolicy` is
  `'always'` by default, and the Anthropic adapters mark the whole joined
  system prompt as one block). A re-ask is served the same system bytes and
  the same system hash as the call before it. What that does NOT save: a
  model that declares on every call moves the ledger on every call, so from
  the first standing on each such call writes a new system cache entry and
  reads none, and on Anthropic's wire the message breakpoints behind it miss
  too. The feature's claim is wire bytes, not cache reads; no bench in the
  tree counts cache tokens yet, and the design page names the trade.
- Measured (`npm run bench:findings`, mock provider, 20 tool calls, a
  planted fact every 3rd): the piece carries all 6 planted facts at the
  answer turn on every armed row — including under a sliding window that had
  evicted 4 of them — and 13 of the 14 noise results are tickets, the noise
  share of tool-result bytes on the wire falling from 93.5% to 15.2% with no
  window; the fourteenth is the last batch's, undeclared by the
  no-outputSchema law and served in full. The design page has the printed
  table and its reading; no real-model number exists yet.
- Grounding is unchanged: the evidence gate keeps indexing raw history, so a
  faithful ledger fact grounds through the result it cites and an invented
  value is flagged. The choice seam no longer credits the whole system prompt
  while a request-only piece is joined, so a subject id invented in a `fact`
  assertion cannot excuse an argument equal to it; an unarmed agent takes the
  branch it always did. The grouped chart carries `findingsLedger` across the
  call-llm boundary, so both chart shapes serve byte-equal text.

### Unchanged — an agent without `.findings()` records the bytes it recorded before

- Every decoration, peel, write, piece and event is gated on the door. The
  15 byte-identity references under `test/core/tools/reference/` were run on
  this tree first and pass untouched; ONE new reference, `agent-findings`,
  was generated alone — and regenerated alone for the served piece, its
  delta (the run constant, the piece on one receipt, nothing else) on the
  test file's header. `npm run bench:findings` runs each configuration
  unarmed, armed with the mock declaring, and armed with the mock declaring
  NOTHING, and exits non-zero if any of the six baseline columns moves under
  that silent arm — they do not: an armed agent whose model declares no
  standing is served the bytes it always was, plus the instruction.
- The name was proved before it shipped: `_findings` survives every
  provider's `inputSchema` mapping byte-for-byte, `required` untouched —
  Anthropic, OpenAI, Gemini, Bedrock, Ollama, Foundry (hosted and local) and
  both browser providers (`test/adapters/reservedArgumentSurvives.test.ts`).

## [9.100.0] - 2026-09-16

### Added — the delivered answer names its shape guarantee

- `AgentState.answerGuarantee` — written by the Route decider on the turn
  it picks `final`: `'tool-forced'` (the provider was forced by name to
  answer through the output schema's synthetic tool, so the shape held on
  the wire), `'checked'` (generated as text, parsed by the output schema
  after), or `'none'` (no output schema, free text). A fact about HOW the
  answer was obtained, beside `answerValidation`, which is about its
  content. Why: three different strengths of "the answer has a shape"
  existed and the record could not say which applied; a lens showing the
  Answer stop now can. Borrowed from constrained decoding, where the shape
  holds by construction — that word joins the vocabulary when a provider
  that constrains its own decoding ships.

### Changed — artifact bytes are encoded with footprintjs's own encoder

- `canonicalPayloadBytes` — the one place every artifact store turns a JSON
  payload into bytes — uses footprintjs 9.26.0's `stringifySnapshot`: the
  same bytes `JSON.stringify` produces, with its own stack. A recording of
  a long linear run (about ten thousand stages) nests one level per stage
  and the engine's recursive encoder threw; such a recording could not be
  minted. Byte-identical for everything that could be minted before, so
  digests and `bytes` do not change. The file store's envelope already held
  the payload as encoded text, so it needed nothing. footprintjs `^9.26.0`.

## [9.99.0] - 2026-09-16

### Added — the story knows which stage each beat came from

- `AttTrace.at` (`agentThinkingTrace(...).getTrace()`): index-aligned with
  `steps`, `at[i]` is the `runtimeStageId` of the emit that produced
  `steps[i]`; the prompt step carries `''` (it names no stage). Recorded at
  emit time, never inferred. Why: a debug tool that keeps ONE cursor across
  its lenses (agentfootprint-lens `useSharedCursor`) can now place a story
  beat on the run's own axes and move the cursor from a beat — the beat →
  stage map was the one link that was not data. Steps are byte-identical;
  a trace read by an older consumer ignores the new field.

## [9.98.1] - 2026-09-15

### Added — the answer is a milestone

- `STAGE_IDS.PREPARE_FINAL` (`'prepare-final'`, the final branch's first stage
  on the agent charts) and the final branch's MOUNT (`SUBFLOW_IDS.FINAL`,
  the twin-row precedent of `tool-calls` / `SUBFLOW_IDS.TOOL_CALLS`) join the
  `MILESTONES` table as `{ kind: 'decision', label: 'Answer' }`; all three
  chart shapes (static, dynamic, message-API) declare
  `milestone:decision` / `milestone-label:Answer` there, so the parent axis
  stops on the answer without drilling and the drilled log stops on the
  stage. Until now a scrub could stop on every turn, slot, tool call
  and routing decision but never on the answer itself — and since 9.95.0
  that stage is also where `.answerValidation()` checks the answer and
  delivers or withholds it. One row, no new vocabulary: the seven steps a
  context walkthrough narrates (question · scope · reference · prepare ·
  model · finding · answer) are milestones the record already carries, plus
  this one. The fifteen byte-identity references move by exactly one path —
  `tags` on the final mount's bundle — verified line by line (every other
  line identical; delta on record in the test header).

## [9.98.0] - 2026-09-15

### Added

- `withDatasetArtifacts(tool, adapter)` and `stageDatasetArtifacts` publish
  producer-declared datasets through the existing scoped artifact store. Local,
  HTTP-backed and structured MCP tools share source lineage, unavailable receipts
  and retention checks. Storage is configured by the host; a frontend is optional.
  Includes a chatbot-only example that calculates from the same ref on a later
  turn. This handles materialized results, not streaming or remote dataset handles.
- MCP clients can opt into `resultMode: 'structured'` or `'structured-or-json'`
  before dataset adaptation. Structured data survives without text conversion;
  the fallback accepts only one declared JSON-object text block. Default text
  decoding is unchanged, and tool errors remain failures.
- `receipt.requestMeasurement` records JSON character and UTF-8 byte sizes for
  the initial prepared canonical request and its separately serialized slots,
  including complete tool schemas. Unsupported or cyclic values report an
  unavailable measurement without failing the call. Internal work limits report
  `measurement-limit` at more than 100,000 visited values, 64 nested containers,
  or 4,000,000 string/key UTF-16 code units while copying or serialized JSON
  characters; they never truncate or reject provider input. Older receipts may
  lack the field. Existing advisory counters are unchanged; these sizes do not
  represent tokens, later retries or provider HTTP payloads. The measurement
  records no request content; `RequestMeasurement` and `RequestJsonSize` are public types.

### Changed

- Reuse ContextFootprint's pure assertion comparison and Claim-face helpers.
  Existing assertion keys, witness identity, diagnostic checks and answer-delivery
  policies remain unchanged. Use the published exact `contextfootprint: "0.1.1"`
  runtime dependency; remove the temporary vendored archive and bundle used before
  that registry release. Clean online installs and cached offline installs are
  checked through source and packed consumers.

### Fixed

- Dataset projections preserve original absence, coverage, clarification and
  semantic declarations, including recognized tool-effect status/effects.
  `withDatasetArtifacts` refuses removed, changed or unreadable declarations;
  optional paired `checkSemantics` fixtures apply the same check at build time.
  This checks declaration preservation, not factual truth, never infers absence
  from empty data, and leaves `requestInput` pauses unchanged.
- `read_skill` describes each visible skill once when the turn-start menu and
  the catalog or reachability lists overlap. Later memberships retain the skill
  id; candidate ordering, supplied relevance, cursor, visibility and admission
  remain unchanged. The default menu hint and tool wording no longer claim an
  offline scorer necessarily ranked the menu. No routing option is required.
- Upgrade the shared comparison to ContextFootprint 0.1.1. Distinct JSON data
  with an own `__proto__` property now produces the expected conflict, including
  nested objects and known Claim payloads. Legacy recording keys and original
  witnesses remain unchanged. Pre-call and post-call integration tests exercise
  the shared implementation. Both release paths now require the packed dependency
  check before publishing.

## [9.97.0] - 2026-09-13

### Added

- `requestInput()` pauses a collection tool with typed missing fields and a
  runtime-stamped `awaiting_input` state. Partial replies retain accepted values
  without model calls; complete replies resume the same tool boundary and skill
  position through normal result validation, redaction and placement.
- Hosted typed replies and explicit cancellation preserve session ownership and
  conversation history. `session-pending` reloads the pending question without
  exposing the execution checkpoint. Application defaults remain app-owned.

### Fixed

- Hosted cancellation releases the paused session's run resources without
  executing remaining tools. Run terminals preserve other paused sessions, and
  teardown events retain the actual registration's run and session identity.
- Keep documentation within existing browser and export budgets: load only the
  syntax grammars used by interactive code blocks and prepare SkillGraph demo
  data on the server while retaining its interactive browser view.

## [9.96.1] - 2026-09-13

### Fixed

- Restore publication within the existing documentation site budget: keep image
  originals outside the static export and prune duplicate internal error pages
  only when both public 404 copies match. Public documentation remains available.
- Includes the evidence recovery option and request-only correction behavior from
  9.96.0, whose npm publication was blocked by that site budget.

## [9.96.0] - 2026-09-13

### Added

- Optional `recoveryInstruction` on `.namesAndNumbersFromEvidence()` supplies
  bounded text or a synchronous callback for the existing evidence repair.
  Applications can ask for missing context without suggesting invented values.

### Changed

- Evidence repair is delivered as request-only system context, with the rejected
  draft quoted as untrusted data, instead of synthetic conversation turns.
  Token checks, postures and the one-revision limit remain unchanged. This is
  lexical checking, not proof of question interpretation or claim semantics.

## [9.95.0] - 2026-09-12

### Added

- Opt-in `.answerValidation()` checks schema-parsed JSON against host-owned
  evidence before final answer delivery. Enforce mode refuses failed or
  unverified checks; observe mode records them without refusing. Scoped,
  read-only artifact resolution has per-validation read, byte and time limits.
  Reports separate actual checks from unavailable evidence and artifact reads.
- Configured agents withhold draft tokens and deliver the checked canonical
  value consistently through `run`, `runTyped`, final events and memory.
  Output fallback and coverage suffix combinations are explicitly refused in
  this version; automatic repair and free-text entailment are outside scope.

## [9.94.4] - 2026-09-12

### Documentation

- Propose optional answer validation against referenced evidence in
  [proposal 013](docs/proposals/013-answer-validation.md), with executable tests
  of current claim-checking and output-enforcement boundaries. This is a
  feature request; it introduces no runtime API or validation guarantee.

## [9.94.3] - 2026-09-12

### Fixed — two behaviours that moved with footprintjs 9.22.0+ and 9.24.0, found by running the suite on them

The lockfile had held footprintjs at 9.21.1, so nothing here had run on the
9.22–9.23 line. Running the suite on the 9.24.0 build found two defects on
OUR side; both are fixed so that agentfootprint is correct on every
footprintjs the range admits (`^9.21.1`).

- **`skill.step_advanced` named the step AFTER the one that completed** on
  footprintjs ≥ 9.22.0 (and `skip_step`'s pointer moved one too far). The
  step boundary read `pointerOf(scope.stepPointer)` — since 9.22.0 an array
  element read through the scope is a handle that reads LIVE by path — then
  replaced the pointer and only then emitted `ptr.step`, which by then was
  the new value. It reads the pointer as a VALUE now
  (`scope.$getValue('stepPointer')`, the committed object, which never
  changes once replaced). Three `skill-steps` tests were red on 9.22.0,
  9.22.1, 9.23.0 and 9.23.3 (bisected); green on all of them now.
- **A phantom skill churn switched caching off.** `detectSkillChurn`
  counted every slot that was not `undefined`. The parent writes
  `skillHistory` with `undefined` for "no skill yet"; footprintjs < 9.24.0
  round-tripped that array through JSON on the scope write, so the gate saw
  `null`, counted it as a third skill, and took the `skip-caching` branch on
  the first turn after two real skills — every run with two skills read in
  sequence lost its cache markers from iteration 4. The gate counts only
  strings now. One byte-identity reference (`agent-shared-tool-reference`)
  had recorded the phantom (`cacheMarkers: []` at the iteration-4
  merge-back) and is regenerated with the delta on record in the test
  header; it is green on both the lockfile's 9.21.1 and on 9.24.0, so what
  it pins is the gate, not the substrate. Pinned:
  `test/cache/CacheGateDecider.test.ts` ("a `null` slot is no skill too").

### Changed — the suite runs on the footprintjs consumers get

- The dev pin moves to footprintjs `^9.24.0` (the lockfile had held 9.21.1
  since 9.85; the peer range stays `^9.21.1`, and the two fixes above make
  this library correct across it). 10,541 tests green on 9.24.0.

### Tests — recorded-not-built entry 10, the quantifier half, for its three named clauses

- `gap-sentences.test.ts`: `no-fold-base`'s "reads as empty rather than as
  unknown" walks the catalogue's whole field list (a reading table; a field
  the table cannot read fails by name — the list also names `epoch`, never
  touched before); `cache-transform`'s "that gap is the stronger claim" is
  measured for every (gap, shared field) pairing that occurs beside it on
  every fixture view, intact and damaged, against that gap's own claim (an
  unmeasured kind fails by name; "stronger" is _may be short_, ≤ — on a fresh
  run with its base stripped the rebuild recovers everything);
  `forced-tool-schema`'s "the tool list is complete" runs on both chart
  shapes. The design page marks the three built; the general statement — a
  clause not named there has its quantifier read by a person — stands.

## [9.94.2] - 2026-09-12

### Fixed

- **The docs site now runs the lens it documents, on ONE footprintjs.** Docs
  only — nothing under `src/` moved. `docs-next/package.json` had pinned
  `agentfootprint-lens ^0.31.1`, `footprint-explainable-ui ^0.28.0` and
  `footprintjs ^9.10.0` since the 9.x door renames — twenty lens releases
  behind — so the site's live demos had never shown the Served tab, the
  Served graph, Bookmarks or the tag picker (lens 0.47–0.52), and every demo
  bundle carried TWO footprintjs engines: the root's 9.21.1 (the library's
  peer, reached through `agentfootprint: file:..`) beside docs-next's own
  9.10.0, because two node_modules directories are two module paths whatever
  the two versions say. Two engines is not only bytes: a trace the library
  writes with one and the lens reads with the other shares no class, symbol
  or WeakMap. Pins now: lens `^0.52.2`, explainable-ui `^0.38.0` (the lens's
  peer range wants `>=0.28.0 <1.0.0`; ≥0.34 lights the replay chart),
  footprintjs `^9.21.1` — the root's own range. Matching ranges cannot merge
  two directories, and a `file:` link to the root's copy is refused by npm
  (it runs the published package's `prepare` script), so the one-engine rule
  is `next.config.mjs` · `footprintjsAliases`: every browser request for
  `footprintjs` or one of its doors is pointed at the root's copy, the doors
  read from the package's own `exports`. No demo prop moved across
  0.31→0.52; the demos typecheck and run unchanged, and the Lens demo now
  shows the rail (What happened · Served · Bookmarks), with every receipt
  reading Verified — the one-engine identity proof in itself. Measured, same
  build, three ways: 382.4 KB gzip on the old Lens with two engines; 514.0 KB
  on the current Lens as first pinned — the dedupe itself was −3.8 KB and the
  rest was two LENS defects the measurement exposed (no `sideEffects` flag,
  so a page mounting one component carried the whole Lens; and a bug-report
  button that imported the entire `agentfootprint/observe` door as a
  namespace object); agentfootprint-lens 0.52.2 fixed both the same day
  (audited flag, door opened on click), and the site re-measured on it at
  413.8 KB across 15 assets, one engine. So the whole Served tab, Served
  graph, bookmarks and tag picker the site now shows cost 31 KB over the old
  baseline. The deferred-demo ceiling is set at 422 KB (~2% over) with the
  three-way story beside it. Also fixed: the webpack stats
  the module-breakdown tool reads (`DOCS_WEBPACK_STATS=1`) omitted every
  cached module, so a second build in a row reported 0 modules —
  `cachedModules: true`.

## [9.94.1] - 2026-09-11

### Fixed

- **`servedAt` threw on every recording minted before 9.93.0.** 9.93.0 added
  `Receipt.cache.strategy` and had the served view read it off the receipt —
  `receipt.cache.strategy` — PAST the narrowing that admits a stored receipt
  (`servedView.ts` · `readReceipt`), which checks `basis.epoch` and nothing
  else. A stored receipt with a `basis` and no `cache` container therefore
  made `servedAt(snapshot, k)` throw `Cannot read properties of undefined
(reading 'strategy')` where 9.92 built a view. WHY it matters: a recording is
  older than the reader that opens it, and every recording a consumer already
  held was minted by the release that minted it — the lens found this the day
  after 9.93.0 shipped, on a recording it already had. That breaks the family's
  law twice over: a Lens may omit, never deny, and a reader never throws on a
  stored recording — it names what it could not read.
  FIX at the root, one owner: the narrowing now says what it admits. It hands
  back a **`StoredReceipt`** (new, exported) — `Receipt` with the containers
  the check does not verify declared optional (`cache?`, and `strategy?`
  within it) — and `receiptAt` answers that type, so the compiler holds every
  reader to it; `viewOf` reads the strategy through it (`receipt?.cache?.
strategy !== null`). A receipt with no `cache` yields a view, its
  `cache-transform` gap IS raised (the 9.93 rule: absence still raises; only a
  receipt SAYING `null` lifts it), and its `basis` and every hash row it
  carries still verify. Nothing is repaired: no `cache: {}` is fabricated and
  the record is never written to — `receiptAt` returns the stored value
  byte-for-byte. Every other 9.93/9.94 read of a receipt sub-key
  (`cache.transform`, `cache.transformHash`, `cache.markersApplied`,
  `omittedForAttention`) sits behind the same narrowing and the same type; no
  second reader existed in the library. `Receipt` itself is unchanged — it is
  the MINTED shape and a mint still writes every container.
  THE VINTAGE LAW, now in `src/lib/time-travel/README.md`: _a reader reads
  the receipt it is handed; a missing container is a fact about the vintage,
  never a throw._ `test/lib/time-travel/receipt-vintage.test.ts` ages real
  recordings three ways — no `cache` (the shape the lens hit), `cache` without
  `strategy` (the 9.88.0–9.92.1 mint, byte for byte), `strategy: null` (the
  9.93.0 mint on a chart with no strategy) — and requires a view, the gap, the
  hash law, `receiptAt` as stored, and the batch reader on each; the gap
  catalogue walk, the gap sentences, the receipt conformance suite and the
  fifteen byte-identity fixtures are unchanged and green. Type-visible change:
  `receiptAt(...)` now returns `StoredReceipt | undefined`; a caller that read
  `receiptAt(s, k)!.cache.transform` unguarded must guard the container — the
  compiler now says on the page what the runtime said with a throw.
  ```ts
  const receipt = receiptAt(olderRecording, 1)!; // minted by 9.92
  receipt.cache?.strategy; // undefined — not null, not repaired
  servedAt(olderRecording, 1)!.gaps.map((g) => g.gap); // ['cache-transform', 'provider-defaults']
  ```

## [9.94.0] - 2026-09-11

**An optional family is loaded when its option is enabled, never before.** What
`import { Agent, defineTool } from 'agentfootprint'` costs a browser consumer
is the library's DEFAULT graph, not its whole surface — and for four releases
it was not: the docs site's demo chunk grew 394 → 421 KB gzip across 9.61,
9.78, 9.88 and 9.92 for families the demo never calls, and two publishes
(9.87.0, 9.92.0) were lost to that ceiling. Measured on this commit, same
webpack build: the demo chunk 421.3 → 382.4 KB gzip (−38.9 KB, 16 → 15 async
assets; the library's own chunk 199.6 → 171.4 KB), and a plain esbuild bundle
of the root import 219.3 → 199.7 KB gzip (−19.6 KB, 717.7 → 658.2 KB minified).
Two root causes, both in the library, so every consumer gets the same cut. A
minor rather than a patch because a public provider's `list()` changes shape on
one iteration (below), and because every bundled consumer's output changes.

### Changed

- **`.selfExplain()` mounts the trace toolpack lazily.** The toolpack —
  eleven tools over a finished trace, at 47 KB minified the largest single
  module in the package — was on the default graph because `AgentBuilder`
  imported it for `TRACE_TOOL_NAMES`, the list of names it reserves at
  `build()`, and `buildSelfExplainToolProvider` composed the pack eagerly.
  WHY: an agent that never calls `.selfExplain()` was shipping the debugger;
  one that does was shipping it before a single turn had run. Now the names
  live in `lib/trace-toolpack/traceToolNames.ts` (with
  `NO_COMPLETED_RUN_MESSAGE`, the other fact needed before the pack exists —
  both still re-exported from their old modules), and the inline provider
  reaches the pack through `import()` on the first iteration the self-explain
  skill is ACTIVE: not at `build()`, not on a turn where nobody asked why,
  never for an agent without the option. A bundler splits it into its own
  chunk; Node loads it through the same `require`, one microtask later. The
  one visible change: on an active iteration the inline provider's `list(ctx)`
  answers a `Promise<Tool[]>` where it answered an array — the shape
  `ToolProvider.list` has always allowed and the composed provider already
  used; the idle iteration is still a synchronous `[]`, so the tools slot's
  fast path is untouched. Provider id, the reserved-name refusal, delegate
  mode and every trace tool are unchanged.
  `test/lib/trace-toolpack/lazyMount.test.ts` pins load-when-active (the
  module is evaluated exactly once, on that iteration), end-to-end answering
  through the lazy path, and cold-mount = warm-mount on the recorded events,
  catalogs and answers.
  ```ts
  const agent = Agent.create({ provider, model }).tool(lookup).selfExplain().build();
  await agent.run({ message: 'Refund order A-1001?' }); // pack not loaded
  await agent.run({ message: 'Why did you approve it?' }); // loads on the iteration read_skill opened it
  ```
- **The ESM build now carries `sideEffects`.** A bundler reads that flag from
  the CLOSEST package.json to the module it is deciding about, and
  `dist/esm/package.json` — written at postbuild to mark the build
  `type:module` — was a bare `{"type":"module"}`. WHY: the root's honest
  `sideEffects` list therefore never reached a single ESM module; webpack,
  Vite and esbuild had to presume every file under `dist/esm` might run
  something at load, keep each one a barrel named, and could only strip the
  pure declarations inside — which is also why a dynamic `import()` of a
  module a barrel re-exports (the toolpack, through the `/observe` door the
  lens imports) never split into its own chunk. `scripts/postbuild-esm.mjs`
  now copies the root list across, rebased (`scripts/lib/esmSideEffects.mjs`;
  `test/esm-packaging.test.ts` pins the shipped file against the same rule).
  The list was widened only where it is TRUE: `./dist/index.js` /
  `./dist/esm/index.js` (the root entry imports the three cache strategies for
  their `registerCacheStrategy` calls) and `**/lib/injection-engine/index.js`
  (the barrel imports `devWarnHost` to bind footprintjs's dev flag) — a barrel
  marked side-effect-free is a barrel a bundler may skip, imports and all.
  `test/lib/trace-toolpack/browserGraph.test.ts` proves at the code-split
  graph that the toolpack is off the root entry's sync closure, still
  reachable behind a `dynamic-import` edge, statically present on `/observe`
  by design, and that every registration survives (the three strategies on
  the root entry, the dev-warn host on `/context`). footprintjs's own
  `dist/esm/package.json` has carried its flag all along; this follows it.

### Docs

- `docs-next/scripts/check-site-budget.mjs`: the LAW above the demo ceiling
  (an optional family loads when its option is enabled; the demo bundle
  measures the default graph), the two families this release could not move
  and why — the integrity checks run inside synchronous stage helpers and one
  (`wireViolationsOf`) is unconditional; the observability recorders sit
  behind `enable.flowchart()` / `enable.localObservability()`, which return
  synchronously — and the ceiling LOWERED 429.4 → 390.0 KB (~2% over 382.4).
  `DOCS_WEBPACK_STATS=1` on the docs build writes per-module webpack stats and
  `docs-next/scripts/demo-chunk-modules.mjs` names what the demo chunk
  carries, so the next raise is argued per module, not per ceiling.
- README "Tree-shakeable & ESM-first" and docs/debug/self-explain: the rule,
  the example, the fences.

## [9.93.0] - 2026-09-11

**The receipt says which strategy, and what the window dropped.** Four of the
seven standing recorded-not-built entries close, one is verified rather than
rebuilt, and one is assessed and half-built. Every item below is a behaviour
change to a shipped record — a new receipt key on every minting chart, a gap
that stops firing on three of them, a field that starts being written — which
is why this is a minor and not a patch. Nothing that had no name collision, no
window and no cache strategy records a different byte except the one new key.

### Added

- **`Receipt.cache.strategy: string | null`** — WHICH cache strategy the
  request went through (its registry `providerName`; `'*'` is the built-in
  pass-through every agent runs), or `null` where none stood between assembly
  and the port. WHY: `cache.transform: 'unchanged'` is the honest verdict both
  when a strategy returned what it was given and when there was no strategy at
  all, so the served view had no way to know a rewrite was impossible and
  raised `cache-transform` on every view — including `LLMCall` and the two
  message-API charts, where a reader was told what a cache strategy may have
  done beside a call none could touch (entry 8). No fourth `transform` value
  was added; the fact is its own field, minted by the one owner
  (`buildReceipt` refuses to mint without it). A receipt from before this
  release has no key, and a reader treats that as "cannot say", never as
  `null`.
  ```ts
  receiptAt(agent.getSnapshot()!, 1)!.cache.strategy; // '*'  — an agent on the mock provider
  receiptAt(llmCall.getSnapshot()!, 1)!.cache.strategy; // null — nothing between assembly and the port
  ```
- **`Receipt.omittedForAttention` is written** — by the agent chart's window
  stage, for every turn it evicts for budget at an iteration's head. WHY: the
  field was declared in 9.88.0 for "why did the model not know that?" and
  excused as "no chart in this library supplies it" (entry 9) — a measurement
  that had looked at the slots, which drop nothing, and not at the window,
  which does (`context.evicted`, `reason: 'budget'`), and never wrote it. The
  window hands what left to the call-llm mint on an in-memory handle
  (`window/evictedTurns.ts`), the seam the compaction meter already crosses —
  never a scope read, which on every windowless run would be a tracked read of
  an absent key and a phantom context source per loop. Each hash is the
  evicted turn's own `messages.entries[].hash`, so a drop on epoch k's receipt
  pairs with the turn as an earlier receipt served it — the pairing law,
  driven on a real sliding window. Absent now means nothing was dropped before
  that call. The field left `UNGAPPED_FIELDS` and is named by
  `no-receipt-on-chart`, the one gap that can lose it. An agent without a
  window hands both stages the deps they always had.
  ```ts
  const agent = Agent.create({ provider, model })
    .system('bot')
    .tool(lookup)
    .window(slidingWindow({ keepRecentTurns: 1 }))
    .build();
  await agent.run({ message: 'go' });
  receiptAt(agent.getSnapshot()!, 3)!.omittedForAttention; // { count: 2, hashes: [...] } — the pair that left at this head
  ```

### Changed

- **`cache-transform` is raised only where a rewrite was possible** — where
  the receipt names a strategy, or where no receipt can say (a receipt-less
  view, a pre-9.93.0 receipt, a refused shape). WHY: entry 8 — a sentence
  about what a strategy may have done was printed where none could run. Only a
  receipt that SAYS `null` lifts it; absence still raises, so this is not the
  inference-from-absence the entry refused. Measured: `LLMCall` and both
  message-API charts with a run id now read `['provider-defaults']`; the
  receipt-less message-API view still reads
  `['no-receipt-on-chart', 'cache-transform']`, honestly. The printed sentence
  is unchanged and every clause of it still holds where it prints.
  ```ts
  servedAt(llmCall.getSnapshot()!, 1)!.gaps.map((g) => g.gap); // ['provider-defaults'] (was ['cache-transform', 'provider-defaults'])
  ```
- **`cache-transform` names `tools.forced`, `tools.withheld` and
  `cache.strategy`** — fourteen fields, the whole request the strategy holds
  (`params` alone stays off, read past it). WHY: entry 7 — both `tools`
  fields are written from assembly's own decision and never from
  `preparedRequest`, so a strategy that drops the forced answer tool from
  `request.tools` leaves a receipt whose `tools.forced` names a tool the port
  never carried, and the gap did not warn. Driven: an unforcing strategy on a
  `'tool-forced'` agent — wire has no tool and no forcing, receipt says
  `tools.forced: 'respond_with_schema'` and `params.toolChoice` absent, the
  gap names the half that describes the decision. Reading them off the
  prepared request instead was NOT done: that would describe a different fact
  under the same name.
- **The receipt-conformance law checks the cache verdict outright where no
  strategy ran** — `transform: 'unchanged'`, `transformHash: null`,
  `markersApplied: []`, and no `cache-transform` excuse; where one ran, the gap
  must excuse the unrebuildable fields as before.
- **Byte-identity references regenerated** (`test/core/tools/reference/`),
  with the whole delta against the 9.92.1 set on record in the test's header:
  the new `cache.strategy` key on every minting fixture, the gap's longer
  field list on every agent view, and the gap leaving the three no-strategy
  views. No message, tool or other key moved on any fixture.

### Verified

- **Recorded-not-built entries 4 and 5 hold under the 9.92.0 law** and are
  marked built (verified 2026-09-11 against the 9.92.1 `dist`, before any edit
  of this release). `.selfExplain()`'s `run_overview` against an always-visible
  skill, a never-activated scoped skill and a stepped skill: dispatch follows
  the offer on every epoch (the never-activated skill no longer answers the
  framework's own contract — the framework does), `tools.shadowed` names the
  wire's party and never `provider(skill-scoped:self-explain)`, and the losing
  claim is named by `tools.claim_swallowed` on every epoch it lost. The
  reservation this entry names is deliberately untouched; the measured output
  is pasted on the entries and pinned as `offer-and-answer.test.ts` §7.

### Assessed

- **Entry 10 ("an assertion can be weaker than its clause") is split, and the
  mechanical half is built.** Every clause in `gap-sentences.test.ts` declares
  the fields it is about; a seam hands its assertion a view or receipt with
  one declared field altered, then removed; a contract requires the assertion
  to fail under at least one. The first run found one insensitivity and it is
  fixed. What remains is the quantifier half — a clause about "every field" or
  "both chart shapes" asserted on fewer runs — which needs per-clause hand
  work and is named on the entry rather than faked by a mechanism.

## [9.92.1] - 2026-09-11

### Fixed

- **9.92.0 never reached npm; this release is the same code.** Its publish job
  failed the docs site's deferred-demo gzip ceiling by 0.4 KB (421.0 KB against
  420.6 KB): the interactive demo bundles the library itself, and 9.92.0's
  tool-resolution family rides the same main-entry graph as the receipt family
  did in 9.88.0. The ceiling is re-baselined ~2% over the measurement with the
  reasoning beside the number, and the docs-truth report regenerated. No
  library code changes between 9.92.0 and 9.92.1. This is the fourth raise of
  that ceiling for a family the demo never calls; the dynamic-import fix named
  in 9.61.0 is the next move rather than a fifth raise.

## [9.92.0] - 2026-09-11

**The offer and the answer are one party.** At every LLM call the model is
OFFERED a list of tool contracts (the wire; the receipt hashes each one), and
when it calls a name something ANSWERS. Until this release those two halves
could come from different parties for one name: the tools slot merges
`[static, provider, skill, step]` first-occurrence-wins, while dispatch
consulted the build-time registry first — so a provider's contract on the wire
was answered by a skill's `execute` (an INACTIVE skill's, even), a provider's
`skip_step` by the framework's (which then advanced the procedure on a call the
model made against somebody else's contract), and the report that exists for
this seam walked `activeInjections` and named the provider on epochs whose wire
carried the skill's contract. A claimant that lost both the wire and the
dispatch was simply dead, 22 rows of it in the divergence walk's baseline, with
nothing on the record. `docs/design/2026-09-the-offer-and-the-answer.md` states
the law; recorded-not-built entries 1, 2 and 3, the `claim-swallowed` bullet
under entry 1 and the 9.91.0 tools-slot follow-up are marked built.

**The law:** for every tool name on a call, exactly one party owns the OFFER and
the same party owns the ANSWER — or the record names the disagreement. Three
consequences, one example each:

- **Dispatch follows the offer.** `buildToolsSlot.ts` · `mergeWire` is the one
  pass that produces the wire AND the record of who won each name
  (`ServedToolParties`, closure-shared like `ProviderToolCache`, never scope
  state); `toolCalls.ts` · `lookupTool` reads it first. A provider and a
  never-activated scoped skill both claiming `shared_tool`: the wire carries
  the provider's contract, the provider's tool answers, and the skill's
  `execute` answers no call while the provider holds the name — nor after the
  provider withdraws it, because the skill's contract was never what the
  model read: that call is REFUSED as a recorded tool result (`toolCalls.ts`
  · `notServedResult`). A name NOT on this epoch's wire — a held-out step
  tool, a parked map's tool, a scoped tool named from a restored transcript —
  still dispatches (the capability law's held-out clause, `epoch-laws.test.ts`
  1(a)–(e)), but only to the party the model LAST read the name under
  (`ServedToolParties.lastServed`) or the name's only holder when it was never
  served; every such dispatch is on the record as the new
  `agentfootprint.tools.answered_off_wire` (`{ toolName, toolCallId,
iteration, answeredBy, answeredById? }`). A pause that re-dispatches on
  resume (a middleware ask, a check-in, a credential consent) carries the
  served party on its checkpoint (`pausedToolParty`, pause-path-only), so a
  resume in a FRESH Agent instance — empty closure, no Compose — cannot fall
  back to the build-time map's first holder either.
- **The report's subject is the wire.** `agentfootprint.tools.shadowed` now
  fires once per contested name per iteration when two contracts COMPETED for
  the wire, and `schemaFrom`/`dispatchTo` both name the wire's party — they
  agree by construction. A stepped skill and a provider sharing a name draw
  `skill 'desk-stepped'` in both halves on every epoch, never `'provider'`.
  The vocabulary gained `'framework'` (`ToolNameChannel`), so an auto-attach
  is named as itself.
- **A dead claim is reported.** New `agentfootprint.tools.claim_swallowed`
  (`ToolsClaimSwallowedPayload`: `{ toolName, iteration, lostBy, lostById?,
wonBy, wonById? }`, names only) fires once per iteration for every party
  whose claim to a name is held by somebody else — whether its contract
  competed (an active skill against a provider) or never reached the merge
  (the same skill while inactive; a provider tool whose name a static
  `.tool()` owns; the framework's `skip_step` between tenures). Identity is by
  IMPLEMENTATION: two skills sharing one `Tool` reference (documented-legal)
  are one claim and draw nothing. Now 111 typed events across 24 domains.

**`skip_step` is a claimant like any other** (`buildToolRegistry.ts` ·
`toolClaimants`, the registry's new list of every build-time claimant per
name — a list, not a winner). Its schema still merges last, so it rides the
wire only when nobody else put the name forward; when a provider serves
`skip_step`, the provider's tool answers and the step bookkeeping keys on the
framework's own instance having answered (`toolCalls.ts` ·
`frameworkSkipStepAnswered`) — the procedure does not advance. The build-time
refusals (a static `.tool()` or a skill tool named `skip_step`/`present`) stand.

**`buildAgentMessageApiChart` hands the model the declared tool set on every
turn.** Its tools-slot mount now says `arrayMerge: ArrayMergeMode.Replace`, as
the agent charts always did; turn 2 no longer serves `['weather','weather']`.

**Byte-identity for every run with no name collision.**
`test/core/tools/byte-identity.test.ts` drives fifteen collision-free shapes
(both agent react modes, a skill-graph hop, a stepped skill, a parked map, the
wrap-up, a tool-forced output, three provider shapes, two skills sharing one
`Tool` reference, `LLMCall`, both message-API charts) and compares `commitLog`
and `servedAt(k)` against references under `test/core/tools/reference/`
generated on the 9.91.0 tree. All fifteen are identical; the
receipt-conformance suite is unchanged and green on all four chart shapes.

**The divergence walk, re-recorded — and widened.** Every `contract-swap`
row (12) and every `report-misattributed` row (10) is GONE and ratcheted so
it cannot reopen quietly; the `claim-swallowed` family is 35 rows, every one
carrying what `tools.claim_swallowed` said about it. The walk gained the
cross-epoch × collision cases it never had (walk D: a provider withdrawing a
name an inactive skill also holds; a fresh-instance resume of a provider's
call) and a kind for the held-out dispatch the law keeps, `answered-off-wire`
(4 rows, each carrying the event). The harness moved to
`test/core/agent/toolDivergenceWalk.harness.ts` so the reproductions in
`test/core/tools/offer-and-answer.test.ts` — the entries' own, verbatim, each
red on 9.91.0, plus the review's own shapes — drive the same configurations.

**Consumer-facing changes, stated plainly.** (1) A provider tool that shares a
name with a skill tool now RUNS where the skill's used to — the contract the
model read is the one that answers. (2) `tools.shadowed` fires on
configurations that were silent (a provider against a static `.tool()` or a
framework auto-attach) and no longer names `'provider'` as `schemaFrom` where
the wire carried the skill's contract; `dispatchTo` now equals `schemaFrom`.
(3) Two new events, `tools.claim_swallowed` and `tools.answered_off_wire`.
(4) A call to a name that left the wire, whose last-served party can no longer
answer, is refused with a recorded result where it used to be answered by
whichever party the build-time map held first; the same sentence answers a
provider-served call resumed in a fresh instance (where it used to read
`Unknown tool`). (5) Two stale comments in `buildToolsSlot.ts` and
`buildToolRegistry.ts` corrected in the same diff; `Agent.ts`'s "fresh chart
per run()" comment corrected — the chart is built once at construction.

## [9.91.0] - 2026-09-10

**Every chart that serves a model now mints a receipt.** A receipt is the proof
of what the model was actually handed, minted at the call and committed in the
bundle the call already writes — and until this release exactly ONE stage minted
one. Three other charts in this library handed a model a request and left
`no-receipt-on-chart` on every view they produced, so a reader of an `LLMCall`
or messageAPI recording could only ever see Reconstructed, never Verified.

Two reasons were on the record for that. **Neither survived.** The first — that
`Receipt.cache.transform` has no honest value on a chart running no cache
strategy — was already refuted in 9.88.0 and left refuted in the source: an
`Agent` with a pass-through strategy records `'unchanged'` today, and the value
is true for the same reason where no strategy exists at all, because _the
request that went out IS the request that was assembled_. **No fourth enum value
was added.** The second — the salt — never applied to `LLMCall`, which owns its
executor and mints a run id exactly as `Agent` does. It DOES apply to the two
messageAPI charts, and that was verified rather than assumed: footprintjs stamps
`TraversalContext.runId` on recorder events, not on a stage's scope; there is no
`$runId` on `ScopeFacade`; `ExecutionEnv` is a fixed type carrying `traceId` and
no run id. A chart builder run on somebody else's executor genuinely cannot
invent the value — so it is a dep, and a chart given none mints NOTHING rather
than salting every hash with an empty string.

### Added

- **`LLMCall` mints a receipt** (`LLMCall.ts` · `callLLM`), salted with the run
  id `createExecutor` already mints per run — read at CALL time, not closed over
  at build time, so the second run of the same `LLMCall` is not salted with the
  first run's value. `servedAt` on an `LLMCall` recording now carries
  `basis.model`, `params` and the cache verdict, and stops raising
  `no-receipt-on-chart`.
- **`LLMCallOptions.recordReceipt`** — the twin of `AgentOptions.recordReceipt`,
  same field, same contract, default ON. `false` declines the mint (one
  commit-log value and a SHA-256 per piece, per message, per tool schema);
  `servedAt` still rebuilds the view and declares the missing witness.
- **`MessageApiChartDeps.getRunId` / `AgentMessageApiChartDeps.getRunId`** —
  supply the run id and the chart mints on every turn; omit it and it mints
  none. `src/core/agent/messageApiReceipt.ts` owns that rule for both charts,
  because the two are deliberate twins and a mint written out in each is two
  chances to disagree about what the model was handed.
- **`receipt.ts` · `receiptPieces`** — the injection-record → receipt-piece map,
  which was about to have four copies. One owner, calling the same
  `contributingPieces` the system-prompt join calls, so a piece cannot be on the
  receipt and absent from the string.

### Fixed

- **`servedAt` reported an EMPTY tool list on a call that served tools.**
  `servedView.ts` · `viewOf` read the served list from `dynamicToolSchemas`
  alone. The agent charts map the tools slot's output onto that key at the mount
  boundary; the messageAPI charts carry it out under the slot's own name — so a
  `buildAgentMessageApiChart` view said `tools.names: []` about a call that
  served one. An empty list is not an omission, it is a DENIAL, and it went
  unnoticed for as long as no receipt existed to contradict it. The read is now
  a fallback chain (the agent key first, so no agent recording changes), the
  same shape the conversation has had since 9.88.0. Red before, on
  `test/lib/time-travel/receipt-conformance.test.ts` · _the tool the model was
  served is hashed by the receipt AND rebuilt from the log_.

### Changed

- **`SERVED_GAPS['no-receipt-on-chart']` is unchanged, and still true.** Its
  printed sentence never named a chart, so nothing in it went false; the
  MECHANISM comment beside it now names the shapes that still reach it — a
  messageAPI chart handed no run id, a run that declined with `recordReceipt:
false`, a recording made before 9.88.0, and a consumer's own `call-llm` stage,
  which this library does not mint for. The cause `'no-receipt-committed'` is
  still driven by a REAL run in both walks; the driver moved from an `LLMCall`
  (which now mints) to a messageAPI chart with no run id.
- **The composed request is assembled once per chart.** Each of the three
  charts now builds ONE `LLMRequest` object and both sends it and fingerprints
  it, and each routes its conversation through `stripFrameworkFields` — the
  third rule of the one assembly — so the mint and the rebuild cannot drift.
  Every other byte those charts commit is unchanged: measured by dumping each
  chart's commit log, its per-bundle keys and its final state before and after,
  and diffing (identical apart from the new `receipt` key).

### Docs

- `src/lib/time-travel/README.md` — a "Which charts mint a receipt" table (chart
  → mints? → the salt) with the builder example, and every measurement that
  named an `LLMCall` view as receipt-less retaken on the shape that still is.
- `docs-next` `debug/time-travel.mdx` — the same section for the site. No new
  route.
- `docs/design/2026-09-recorded-not-built.md` — entry 8's reproduction retaken
  (it still stands; only its driver moved) and an appendix marking the standing
  no-mint fact BUILT in 9.91.0, with the reasons that died and the one that
  survives.

## [9.90.0] - 2026-09-10

**The recording carries its own milestones.** Until now a stored run could not
say which of its stops were an LLM turn, a tool call or a decision: every reader
re-derived that from the stage id — `milestoneFor(runtimeStageId)`, a switch
that parses `#` and `/`, lives outside the recording, and goes stale the day a
stage is renamed. footprintjs 9.21 gave a chart a way to DECLARE a stage's
names at build time and stamp them on its first commit bundle
(`CommitBundle.tags`). This release puts the agent's milestones there — law 3
of footprintjs's declared-tags design: **the tag is the fact; the derivation is
the fallback.**

### Added

- **Declared milestones, one vocabulary, one owner.** `conventions.ts` now
  holds ONE table (local stage id → `Milestone`) that both `milestoneFor(id)`
  and the new `milestoneTagsFor(localStageId)` read, so the fact on the bundle
  and the fallback from the id can never disagree. Every milestone site in
  `buildAgentChart`, `buildDynamicAgentChart`, `LLMCall` and the two messageAPI
  charts declares `milestoneTagsFor(<its id>)` — never a literal. The wire
  form: `milestone:<kind>` (what a reader filters on) and
  `milestone-label:<label>` (the human word). Exported: `MILESTONE_KINDS`,
  `MILESTONE_TAG_PREFIX`, `MILESTONE_LABEL_TAG_PREFIX`, `milestoneTag(kind)`,
  `milestoneTags(milestone)`, `milestoneTagsFor(localStageId)` (throws for an
  id the table does not classify — a wiring mistake is loud), and
  `milestoneFromTags(tags, labelWhenUndeclared?)` (reads a bundle's tags back;
  non-strings ignored; a `milestone:` tag with an unknown kind is `null`).
- **The Map advertises the vocabulary.** `buildTimeStructure` lists the tags
  each stage CAN produce before any run — a lens draws its legend first.
- `examples/observability/25-declared-vs-derived-stops.ts` — one real run
  scrubbed two ways: `tagStops(['milestone:llm-turn'])` (footprintjs's own
  strategy, no agent id conventions) and a DERIVED mark (a write-set predicate:
  stops where `currentSkillId` was written), with the measured cost of each on
  42 commits — declared 0.016 ms, write-set 0.020 ms, `milestoneStops`
  0.018 ms, and a `stateAt` fold per candidate stop 11.7 ms (≈ 750×). That
  ratio is why the declaration is the fact and the derivation is the fallback.

### Changed

- **`milestoneStops` reads the bundle first.** A stop's first bundle
  (`log[stop.commitIdx]`, where footprintjs stamps the tags) decides: tags
  present → they are the milestone, and a bundle tagged as something ELSE is
  not a stop however recognisable its id; no tags at all → `milestoneFor(id)`,
  exactly as before. A recording made before 9.90.0 therefore yields the same
  axis it always did; `milestoneOf(stop)`, `Stop<Milestone>` and the labels
  are unchanged in shape. `test/lib/time-travel/milestone-stops-equivalence.test.ts`
  now also pins the TAG-ONLY axis against the id axis on every fixture (both
  chart shapes, every drill, a paused-then-resumed run, an `LLMCall`) — the
  forgotten-tag catch: a declaration site without its tag goes red — plus a
  stripped-tags recording (the fallback), a mixed log, and the Map.
- **footprintjs `^9.21.1` (was `^9.20.0`)** — dev and peer. 9.21.1 is the
  release that lets a subflow mounted as a decider / selector BRANCH carry
  declared tags (`SubflowMountOptions.tags`, landing on the mount's FIRST
  bundle), which is how the three context slots — `sf-system-prompt` /
  `sf-messages` / `sf-tools`, selector branches in every Agent chart — declare
  `milestone:slot`. **Every milestone stage is declared.** On a 9.90.0
  recording the id fallback runs zero times, and the equivalence test counts
  it on every fixture, so a future undeclared site is caught even where the
  fallback would have hidden it on the axis.

```ts
import { tagStops, timeTravel } from 'footprintjs/trace';
import { milestoneTag, milestoneStopsStrategy } from 'agentfootprint';

// A reader with NO agent id conventions — footprintjs's own strategy, our word:
const turns = timeTravel(agent.getSnapshot()!, { strategy: tagStops([milestoneTag('llm-turn')]) });
turns.stops.map((s) => s.label); // ['Run start', 'CallLLM', 'CallLLM', 'Run end']
turns.stops[1].meta; // ['milestone:llm-turn', 'milestone-label:LLM turn']

// The agent's own axis, unchanged in shape — tag first, id fallback:
const all = timeTravel(agent.getSnapshot()!, { strategy: milestoneStopsStrategy });
all.stops[5].meta; // { kind: 'llm-turn', label: 'LLM turn' } — read off the bundle
```

## [9.89.3] - 2026-09-10

**One owner of a subflow's served state.** A patch: no signature changes; a
tool without `redact` behaves byte for byte as before.

### Changed

- **footprintjs `^9.20.0` (was `^9.19.1`), and the refold in
  `servableSnapshot` is deleted.** 9.89.1 made `servableSnapshot` the one
  owner of what `flowchartAsTool({ redact })` / `runbookAsTool({ redact })`
  may show, and had to refold every subflow's final state from its scrubbed
  `history` with footprintjs's `stateAt`, because
  `getSnapshot({ redact: true })` served
  `subflowResults[*].treeContext.globalContext` (and its `#n` twin) as the
  subflow's RAW heap — footprintjs mirrored the run-level runtime only, and
  9.89.2 named it as the one limit left. footprintjs 9.20.0 closed it at the
  root: a subflow keeps its own redacted mirror whenever the run does, and the
  redacted view serves that mirror as one object under both keys, equal to the
  fold over the subflow's scrubbed history. With that, the refold here was a
  SECOND owner of the same rule — and two owners drift — so it is gone: under
  a policy `servableSnapshot` returns `executor.getSnapshot({ redact: true })`
  exactly as the substrate serves it, and without one `executor.getSnapshot()`
  as before. Removed from `src/core/servableSnapshot.ts`: `refoldSubflowStates`,
  `refoldOne`, `isSubflowStateEntry`, the `SubflowStateEntry` type and the
  `footprintjs/trace` import. The five 9.19 proofs of 9.89.2 (§6) stay green.

  What a consumer sees — the same served state, now from the substrate, with
  ONE byte-level difference under a policy: a subflow entry's
  `treeContext.initialState` (its pre-seed base, `{}` — the seed is a commit,
  `history[0]`) is no longer dropped by this package but served as footprintjs
  serves it. `test/core/flowchartAsTool.redact.test.ts` §7 flips: footprintjs's
  own redacted view holds the placeholder (red on 9.19.x), and
  `servableSnapshot`'s view is that very object (identity), not a refold:

  ```ts
  const executor = new FlowChartExecutor(chart); // mounts a subflow that writes innerKey
  executor.setRedactionPolicy({ keys: ['innerKey'] });
  await executor.run({ input: {} });
  executor.getSnapshot({ redact: true }).subflowResults!['sf'].treeContext.globalContext;
  // { innerKey: 'REDACTED', derived: 'ok' } — the subflow's own mirror (the raw heap on 9.19.x)
  servableSnapshot(executor, policy); // the object getSnapshot({ redact: true }) returned — nothing rewritten
  ```

  The `redact` JSDoc on both options, `servableSnapshot`'s module note, the
  runbook recording notes, the runbook-as-tool guide and entry 6 of
  `docs/design/2026-09-recorded-not-built.md` now say the limit closed instead
  of answering it: nothing left the log carries that the served view does not
  scrub; the resume checkpoint is, as before, not a served view.

## [9.89.2] - 2026-09-10

**A redacted tool is as clean as the log, and the log is clean.** A patch: no
signature changes, no code path changed; a tool without `redact` behaves byte
for byte as before.

### Changed

- **footprintjs `^9.19.1` (was `^9.18.0`), and the five "substrate limits"
  9.89.1 could only pin are re-stated as closed.** 9.89.1 made
  `servableSnapshot` the one owner of what `flowchartAsTool({ redact })` /
  `runbookAsTool({ redact })` may show, and had to say that a served view is
  only as clean as the log beneath it — footprintjs 9.18 wrote plaintext INTO
  the record on five paths that bypassed the scope facade: `fields` (dot-path)
  redaction reached recorder views only; a subflow `outputMapper`'s merge-back
  landed in the parent log verbatim; an `inputMapper`'s seed was the subflow's
  raw `history[0]` and its narrated `Input:` line; and a stage that READ a
  redacted key kept the plaintext in `executionTree.*.stageReads`. footprintjs
  9.19.0 closed all five at the root — one `RedactionRule` per run, asked by
  `StageContext` on every staged write and every tracked read — and 9.19.1
  fixed a latent net-change defect its CI found, so this package now requires
  `^9.19.1` (dev and peer). Nothing in this package's code changed to get
  there: the served view was already built from the log, so it is now exactly
  as clean as the policy says.

  What a consumer sees now — the same charts 9.89.1 pinned, assertions
  inverted (`test/core/flowchartAsTool.redact.test.ts` §6; each `it` is red on
  footprintjs 9.18 and green on 9.19.1):

  ```ts
  const tool = flowchartAsTool({
    name: 'seeded',
    description: 'Seeds a subflow with the key and reads it there.',
    flowchart: chart, // parent writes apiKey; the subflow is seeded with it
    keepRecord: true,
    redact: { keys: ['apiKey'] },
  });
  await tool.execute({}, ctx); // → '{"apiKey":"REDACTED","seen":26}' — the subflow computed on the real 26-byte key
  const record = JSON.stringify(innerRunsOf(tool)!.get(ctx.toolCallId)!);
  record.includes('sk-live-'); // false — result, log, mirror, stageReads, narrative Input: line, history[0], parent log
  ```

  The law's other half is unchanged and now pinned in the same file: the live
  heap a stage computes on and the resume checkpoint (`err.checkpoint` on a
  paused run) hold the real values, because resumption must replay them.

  **The one limit that remains, named.**
  `subflowResults[*].treeContext.globalContext` (and its per-iteration `#n`
  twin) is still the subflow's own raw heap under
  `getSnapshot({ redact: true })` — footprintjs mirrors the run-level runtime
  only. That is exactly why `servableSnapshot` refolds each subflow's final
  state from its scrubbed `history`, and the limit and its answer are now
  pinned side by side (§7 of the same file): the raw view carries the secret,
  the served view does not. The `redact` JSDoc, `servableSnapshot`'s module
  note, the runbook option and guide, and entry 6 of
  `docs/design/2026-09-recorded-not-built.md` say this instead of the 9.18
  list.

## [9.89.1] - 2026-09-10

**What a chart-backed tool may show is one rule.** A patch: no signature
changes, and a tool without `redact` behaves byte for byte as before.

### Fixed

- **`flowchartAsTool({ redact })` / `runbookAsTool({ redact })` served the
  secret everywhere except the log.** footprintjs scrubs at COMMIT time, so a
  policy-redacted key never entered the inner commit log — and the option's
  own documentation drew the wrong conclusion from that. The live state view
  is not a commit: it is the run's raw heap, and its scrubbed twin (the
  _redacted mirror_ footprintjs maintains beside it) is served only by
  `getSnapshot({ redact: true })`. Both tools called `getSnapshot()` bare, so
  the string the model read (`JSON.stringify(snapshot.values)`, or whatever a
  `resultMapper` built from it), the envelope's state, and a kept record's
  `sharedState` all carried the plaintext while the log beside them said
  `REDACTED` (`docs/design/2026-09-recorded-not-built.md` · entry 6, now
  built). Fixed at the root, not per field: ONE owner,
  `src/core/servableSnapshot.ts` · `servableSnapshot`, decides what leaves the
  executor — the redacted view under a policy, the raw snapshot without one —
  and every state-bearing exit of both tools (result, envelope, recording,
  kept record on ok / error / paused) reads from it. One thing that view
  leaves raw is handled the same way: a subflow's final state
  (`subflowResults[*].treeContext.globalContext`) is the subflow's own
  isolated heap, which footprintjs does not mirror, so it is refolded from
  that subflow's scrubbed `history` through footprintjs's own `stateAt` — the
  construction the run-level mirror is, done at serve time.

  ```ts
  const tool = flowchartAsTool({
    name: 'weather_advice',
    description: 'Forecast tomorrow and advise on biking.',
    flowchart: adviceChart, // writes scope.apiKey = 'sk-…'
    keepRecord: true,
    redact: { keys: ['apiKey'] },
  });
  await tool.execute({}, ctx); // → '{"apiKey":"REDACTED","advice":"bike"}'
  const { snapshot } = innerRunsOf(tool)!.get(ctx.toolCallId)!.recording!;
  snapshot.sharedState.apiKey; // 'REDACTED' — was the plaintext
  JSON.stringify(snapshot).includes('sk-'); // false — in every field the log scrubs
  ```

  Two consequences, both deliberate. Under a policy a kept record omits
  `initialState` — footprintjs's own law for the redacted view (the raw
  pre-run seed never passed a policy) — so a fold of it reports
  `basis: 'log-only'` and says so. And a served view can only be as clean as
  the log beneath it: footprintjs 9.18.0 leaves plaintext IN the log for
  `fields` (dot-path) redaction (recorder views only), for a subflow
  `outputMapper`'s merge-back and for an `inputMapper`'s seed (both bypass
  the scope facade; the seed is also narrated as an `Input:` line), and a
  stage that READS a redacted key keeps the plaintext in its tracked reads
  (`executionTree.*.stageReads`). Those are named on the option and pinned as they are
  in `test/core/flowchartAsTool.redact.test.ts`, beside the reproduction
  (nested objects, patterns, arrays, subflow states, error and paused exits,
  and the no-option path against a direct `getSnapshot()`).

## [9.89.0] - 2026-09-09

**The third digest half, and one owner of the axis.** Two follow-ups to 9.88.0,
both additive: a 9.88.0 consumer compiles and behaves identically.

### Added

- **`toolDigestInput(tool)` — a consumer can verify the schema rows of a
  receipt.** 9.88.0 exported `receiptHash` and `messageDigestInput`, so a reader
  holding `servedAt(k)` and `receiptAt(k)` could prove the system text, every
  piece and every message against the receipt from outside this package — and
  could prove everything the model was served EXCEPT the tools' schemas. The
  receipt hashed each schema through a serializer the root barrel did not
  export, so a consumer's schema rows could never read Verified; its only
  options were to copy the serializer (a second owner of the rule, which drifts
  the day the digest gains a field — the message digest gained two in 9.88.0)
  or to leave the rows unchecked. The law now holds for the third row on the
  object a consumer already holds:

  ```ts
  receiptHash(runId, toolDigestInput(servedAt(k).tools.schemas[i])) ===
    receiptAt(k).tools.schemaHashes[name];
  ```

  It takes an `LLMToolSchema` — the tool as handed to the provider port, which
  is what `servedAt(k).tools.schemas` reads back — never a `Tool` definition,
  which carries `execute` and other fields the model never saw. It is the ONLY
  spelling of the schema rule: `buildReceipt` calls it too. A schema JSON cannot
  express (a `BigInt`; a cycle) digests to the `UNSERIALIZABLE` mark on both
  sides and never throws — the `BigInt` is the worked example, because a
  cyclic schema is refused by footprintjs's `deepEqual` in the subflow
  outputMapper before any receipt is minted under `dynamic-grouped` (a
  substrate limit, not a hole in the rule). `stableJson` stays off the root
  barrel on purpose —
  `hash(stableJson(tool))` would be the rule written a second time. Pinned on
  real runs in both chart shapes, every tool of every epoch
  (`test/lib/time-travel/receipt-conformance.test.ts`), on the unserializable
  cases and on the barrel by identity
  (`test/lib/time-travel/tool-digest-input.test.ts`).

### Changed

- **`milestoneStops` is a filter over footprintjs's own stop grammar.**
  footprintjs 9.18.0 shipped `filterStops(stops, keep)` — the bookend guard, the
  re-partition, `Stop.meta` for a strategy's own vocabulary and `Stop.prologue`
  on a start that absorbed stages — because two consumers had each re-derived
  all of it by hand against 9.17. This was one of them. The hand-rolled guard,
  the re-partition loop and `milestoneOf`'s re-derivation are gone;
  `milestoneStops` is now one expression, `filterStops(commitStops(log, tree),
keep)`, and the one owner of the `[start, …stages, end]` contract is the
  library that returns it. Public names and signatures are unchanged
  (`milestoneOf`, `milestoneStops`, `milestoneStopsStrategy`); the stops are
  now typed `Stop<Milestone>`, so `cursor.at()?.meta?.kind` is typed, and
  `milestoneOf(stop)` reads that `meta` when a stop carries one and falls back
  to classifying the `runtimeStageId` for a stop from another strategy (a meta
  of some other vocabulary is not mistaken for a milestone). **Behaviour is
  identical and proven, not asserted:**
  `test/lib/time-travel/milestone-stops-equivalence.test.ts` carries the 9.88.0
  implementation verbatim and drives it beside the new one over every recorded
  fixture the milestone tests use — both chart shapes, a skill graph, a
  dynamic-grouped run with its drilled inner histories, a plumbing-only log, an
  empty log, and a paused-then-resumed run including the 9.18 chained axis —
  requiring agreement on every stop's step, id, kind, label and commit range and
  on the `stateAt` fold at every stop. The only differences are the two things
  9.18 added, and both are asserted present and right: `meta` is the milestone
  on every milestone stop and absent on the bookends; `prologue: true` is on
  the start exactly when it absorbed a stage. A renderer that means "before
  anything ran" can now check `kind === 'start' && !prologue` instead of
  assuming it from the kind. `footprintjs` peer and dev ranges move to
  `^9.18.0`. `milestone-stops-contract.test.ts` still mocks a broken
  `commitStops` and requires the refusal to reach the consumer — it is now the
  port's refusal (`filterStops: expected a bookended axis …`), not ours.
  `test/type-regressions/MilestoneStops.assignability.test.ts` pins that the
  bare 9.88.0 shapes (`TimeTravelStrategy`, `Stop[]`, `milestoneOf(Stop)`)
  still compile.

## [9.88.0] - 2026-09-07

**The receipt at the stop.** Stand on an `llm-turn` stop, ask what the model
read, and until now the honest answer was "most of it". The request a provider
receives is assembled from committed pieces and is itself never committed — the
`call-llm` bundle holds the response, not the ask. Two things now stand at every
turn, and one law binds them:

```
hash(servedAt(k)) === receiptAt(k).hash
```

`servedAt(snapshot, epoch)` rebuilds the request from the committed pieces;
`receiptAt(snapshot, epoch)` reads the hashes-and-references record the call
itself left behind. Agreement means the record is complete. Disagreement means
something reached the model that the run never wrote down — a defect in the
record, not in the check.

Writing the conformance test found **five** places where the committed pieces
and the sent request had drifted apart. A four-lens review then found eleven
more, and two independent verifiers found five more after that — two of them
NEW instances of the very laws the previous pass was enforcing. Every one is
reproduced and closed below, each with a test that fails without the fix. None
was closed by loosening an assertion.

And then a fourth pass found two more, in the same place, for the same reason:
the gap catalogue was checked by a person reading it against the two shapes, and
three careful readings came up short three times. That is not a run of bad luck.
It is the defect this library diagnosed in 9.86 — **a hand-counted list is short
the day after** — so the catalogue is no longer counted. It is WALKED:
`test/lib/time-travel/gap-catalogue-walk.test.ts` derives every field of both
shapes and requires each one to be named by a gap or excused in writing, then
damages a real recording the way each gap describes and requires every field
that moves to be named by that gap.

Then a **fourth review round read the walk instead of trusting it**. The walk
was green and bit on five attack
probes — and three shipped sentences a renderer prints were still FALSE, which
is the half no walk can check. The one that matters most said only `Agent` has a
run id to salt the hashes with, in a paragraph explaining why `LLMCall` mints no
receipt; `LLMCall.ts` · `createExecutor` mints `runId: makeRunId()` exactly as
`Agent` does. The other two were the same defect in the account itself: a gap
naming a field whose absence its own mechanism does not cause. And the walk's
DIVERGENCE half turned out to be vacuous for two of its four rows — the damages
moved nothing, so both rows passed while proving nothing, and one gap's field
list could be emptied outright with the file still green.

And then a SEVENTH round drove a real view for every sentence in the catalogue
instead of reading them, which is how this release actually ends. It found four
more printed sentences that mislead a reader — one of them written by the round
before it, and MEASURED false: `no-run-log` said its fields "could not be fully
recovered here" on a view where the damaged rebuild is byte-identical to the
intact one. It also overturned that round's own conclusion, that a reduced
sentence cannot go false. Ten of the eleven still can. What ends the class is
not a rule about wording but an ASSERTION per claim, driven on a real run, and
that file now exists. All of it is closed below, at the root, additively.

### Added

- **`servedAt(source, epoch)` / `servedViews(source)`** — the request an epoch
  was served, rebuilt from the log: the joined system text and its pieces, the
  conversation as sent, the request-only lines, the tool names and schemas, the
  forced tool and the wrap-up withholding. Works on a live snapshot and on a
  recording read back from JSON, in both chart shapes.
- **`receiptAt(source, epoch)`** — the receipt, or `undefined` on a recording
  made before this release. A missing receipt never makes an epoch unreadable:
  `servedAt` rebuilds it either way, so an old recording stays readable. (It
  does return `undefined` for an epoch the run does not have, which is
  `epochAt`'s answer rather than a fact about receipts — the docstring says so
  now and used to say the opposite.)
- **`ServedView.gaps`** — what the log honestly cannot rebuild, each entry
  naming the receipt field it explains. `SERVED_GAPS` is the catalogue those
  sentences come from, so a renderer prints the library's own wording. A rebuild
  that quietly omits a piece looks exactly like one that proved the piece
  absent; this is what keeps them apart.
- **`epochAt` / `epochLocations`** — the ONE owner of where an iteration's
  pieces live: the run's own log under `reactMode: 'dynamic'`, the turn's inner
  `sf-llm-call` history under `'dynamic-grouped'`. `contextLedger` and
  `context-bisect`'s trajectory assembler each carried a private copy of that
  fork; both now ask this one and their own copies are gone. An `EpochLocation`
  carries the FOLD SOURCE its log belongs to — the log plus the base it was
  recorded against — and that fold's `basis` verdict.
- **`keyedFold(source)`** — the value of one state key at one commit, folded
  from the run's own base. Built because a RESUMED run replays a fiction
  without it: a resume is a fresh executor seeded from `checkpoint.sharedState`,
  so the whole pre-pause world is the resumed run's fold BASE and not its log,
  and `commitValueAt` says in its own docstring that it cannot see a base.
  Measured on a paused-and-resumed agent under `reactMode: 'dynamic'`: the old
  read returned an EMPTY system prompt and a one-message window for a call that
  really went out with 27 characters of prompt and three messages, and declared
  no gap. It now rebuilds both and matches the wire, in both chart shapes.
  `keyed-fold-equivalence.test.ts` pins every answer against footprintjs's own
  `stateAt`, which is used here for the base and the `basis` verdict.
- **`receipt.params`** — the sampling knobs the call went out with:
  `temperature`, `maxTokens`, `thinkingBudget`, `stop`, `toolChoice`, read off
  the request the provider PORT was handed. The same context at
  `temperature: 0` and at `1.2` is a different call, and "why did this turn
  ramble?" is unanswerable from a record that kept the prompt and dropped the
  dial. Scalars and short strings; no bytes, no privacy change.
- **`receipt.cache.markersApplied`** — which `cache_control` breakpoints the
  strategy actually applied, three scalars each (`field`, `boundaryIndex`,
  `ttl`). `transformHash` is a digest over the whole prepared request: inside a
  run it says only "something changed", and across epochs it is not comparable
  at all — so it could not answer _did the breakpoints move between call 3 and
  call 4?_, which is the question that decides an Anthropic bill. Two receipts'
  `markersApplied` answer it by inspection.
- **`receipt.cache.transform`** — `'unchanged' | 'rewritten' | 'unknown'`.
  Branch on this, never on `transformHash === null`.
- **`RECEIPT_BOUNDARY`** — the one sentence every receipt field is true at, so
  a renderer prints the library's own wording: _a receipt describes the request
  as this library last saw it._ Where that is — the provider port — is in the
  comment beside the constant, because the sentence is printed and the sixth
  round's rule is that a printed sentence names no mechanism.
- **`ServedView.basis`** — `{ model, provider, runId }`, read off the receipt.
  A served view could not previously say WHICH model saw this, only that
  something did. Absent when no receipt was committed, and deliberately not
  part of the law: there is no committed counterpart to check it against.
- **`AgentOptions.recordReceipt`** — the receipt's OFF SWITCH. Default ON.
  There is no privacy reason to decline it (it carries no bytes) but there is a
  cost reason: one commit-log value per iteration plus a SHA-256 per system
  piece, per message and per tool schema. An offline eval loop scoring ten
  thousand turns nobody will scrub is entitled to skip all of it. `servedAt`
  still rebuilds every epoch; `receiptAt` returns `undefined`, exactly as on a
  pre-9.88 recording.
- **Four more `ServedGapKind`s**, because a view must be able to say what it
  cannot prove: `no-fold-base` (the recording travelled without
  `initialState` — most of a resumed run is then unreadable),
  `no-conversation-on-record` (neither `history` nor `messagesInjections` was
  committed: the turns are UNKNOWN, not empty), `no-run-log` (a subtree handed
  in on its own loses every run constant) and `provider-defaults` (the sampling
  dials are the PORT's values; a vendor may resolve its own). Seven kinds ship,
  with `no-receipt-on-chart` below.
- **`UNGAPPED_FIELDS`** — the other half of the account. `SERVED_GAPS` says what
  a rebuild cannot prove; this says which fields need no gap and, in one
  sentence each, why (`omittedForAttention`, `callRuntimeStageId`, `gaps`).
  Between them they cover every field of a `Receipt` and a `ServedView`, and a
  walk is what keeps that true rather than a person's reading. TWO reasons
  qualify a field for this list and they are not the same reason: no fold can
  fail to produce it (`callRuntimeStageId`), or its absence is universal and has
  nothing to do with this recording (`omittedForAttention` — no chart supplies
  it, on any run). A field a gap DOES name never belongs here, whatever else is
  true of it, which is why `epoch` left.
- **`ServedGap` kind `no-receipt-on-chart`** — an epoch that minted no receipt
  now says so. `LLMCall` and the two message-API charts run a `call-llm` stage
  and rebuild perfectly, but mint nothing, so `ServedView.basis` was dropped and
  NOTHING explained it — a Lens denying rather than omitting, on a source
  `servedAt`'s own `@param` names as supported. The gap names the fields only a
  receipt carries (`basis.*` — all four, `params`, `cache.*`) and says what
  follows for them. WHY there is no receipt is carried as data, not prose — see
  `ServedGap.cause` below.
- **`ServedGap.cause` and `ServedGapCause`** — the discriminating fact, computed
  where it is known instead of guessed at in a sentence.
  `'no-receipt-committed'` when nothing was written under the receipt key;
  `'receipt-shape-rejected'` when something WAS and it carries no basis, so the
  read refused it — the value that means the recording is damaged rather than
  that the run never minted. A renderer prints the gap's structural sentence
  and, if it wants, the cause. Absent on every other gap: a gap carries one when
  the site that raised it read something that told it.
- **`receiptHash` / `messageDigestInput`** — the digest halves of the law, so a
  consumer checks the rebuild with the library's own rule instead of a fourth
  copy of it.
- **`BoundaryRecorder`** carries `systemPromptText` and the tool catalog through
  from `stream.llm_start`. Both were dropped there, which meant the one opt-in
  that puts the prompt on the record (`recordSystemPrompt`) reached every sink
  except the ordered boundary stream a replay reads.

### Fixed

- **The system-prompt join is one function.** `joinSystemPrompt` — pieces with
  content, `'\n\n'` between them — was written inline five times (`callLLM`,
  `LLMCall`, both message-API charts, the tool-calls self-call frame). The
  joined string is never committed, so a rebuild rests entirely on the join
  being one rule; a sixth copy in the reader is exactly the defect this closes.
- **`seed` records two build-time facts** it never had to before, both
  value-conditional so every other agent's committed key set is byte-identical:
  `forcedOutputToolName` (so a rebuild can NAME the forced tool without reading
  the receipt it is checking) and `toolWantsByName` (the last input to the
  staged-refs nudge that was build-time-only — with it, the one model-facing
  line written to no history is recomposed from committed state instead of
  being declared a gap).
- **`stepOutputText` skips the receipt.** A run-salted digest is semantically
  empty by construction; left in a step's output text it is hundreds of
  characters of noise inside a character budget that then has less room for the
  assistant's own words. Measured: it alone reordered `localizeContextBug`'s
  suspects and demoted a planted fact below a tool. A text corpus scored by an
  embedder must contain only text somebody wrote.
- **A resumed run no longer replays a fiction.** `readAtCall` /
  `readRunConstant` folded with `commitValueAt`, which cannot see a run's
  initial state. Every key not re-`set` after a resume folded to absent, so
  `servedAt` returned an empty system prompt and a truncated conversation while
  declaring NO gap. Both now fold through `keyedFold`, from the base the
  recording carries; when that base did not travel, the view raises
  `no-fold-base` instead of a confident empty one.
- **`servedAt` no longer asserts an empty conversation on an `LLMCall` run** —
  a source its own JSDoc named. Those charts have no `history`: the messages
  slot IS the conversation, and `?? []` swallowed the difference. The
  messages-slot join is now one exported function (`messagesFromInjections`),
  called by `LLMCall` on the way out and by the rebuild on the way back — the
  same argument that made the system-prompt join one function. A chart that
  committed neither source raises `no-conversation-on-record`.
- **`SERVED_GAPS['cache-transform']` no longer claims more than a receipt can
  know.** It said a null `transformHash` "is the proof that this particular
  call was not rewritten". It is not: the receipt is minted at the provider
  PORT, and a decorated provider, a vendor adapter or a consumer's own
  `complete()` rewrites downstream of it. Reproduced with an injected system
  suffix and an unregistered tool, both invisible to a record reading
  `'unchanged'`. The sentence is now scoped to the CACHE STRATEGY and carries
  `RECEIPT_BOUNDARY`.
- **`messageDigestInput` covers the join key — BOTH of them.** `toolCallId` —
  `tool_use_id` on Anthropic's wire, `tool_call_id` on OpenAI's — pairs a tool
  result to the call that asked for it, and was excluded. Two parallel calls
  whose results happen to be byte-identical hashed the SAME, so filing one
  call's answer under another was invisible to the law. `toolName` was excluded
  too, and on two shipped providers it is the join key: `GeminiProvider` ·
  `toGeminiContents` pairs a `functionResponse` to its call BY NAME (and drops
  a non-real id), and `OllamaProvider` · `toOllamaMessages` puts `tool_name` on
  the wire. There, two `role:'tool'` messages with identical text and SWAPPED
  names still fingerprinted identically — the exact mis-pairing the id was
  added to catch, invisible on the providers that need it most. It rides as its
  own field beside the id, so neither can absorb the other's bytes. It also now covers `thinkingBlocks` and
  `toolCalls[].providerMeta` as `stableJson` fingerprints: `adapters/types.ts`
  is explicit that a signed thinking block must be echoed byte-exact or the API
  rejects the turn, so two requests that differ only there are not the same
  request. Signatures are opaque tokens, not content — no bytes are added.
- **`stableJson` no longer collapses the unreadable to the empty string.** It
  returns `undefined`, and callers substitute a mark (`UNSERIALIZABLE`) or
  branch. Before, two DIFFERENT requests that could not be serialized compared
  equal, and the receipt wrote `transformHash: null` — "the cache strategy
  changed nothing" — about a pair it had never read. That case is now
  `cache.transform: 'unknown'`.
- **`readRunConstant` on a subtree says so.** Handed a recording with no run
  log, it read every run constant as absent; the view now raises `no-run-log`.
- **The per-epoch scrub is a constant factor over the batch form.**
  `epochLocations` re-located every epoch on every `servedAt` call, and the
  iteration number was resolved by rescanning the log per bundle. Measured
  against that shape: the scrub cost 2.4x the batch form at 13 epochs, 3.7x at
  49 and 5.0x at 97 — the factor grew with the run, which is what turned a
  600-turn scrub into 20.8 s. Epochs are now located once per recording
  (a module-level `WeakMap`), the iteration is read from the same one-pass index
  every other key uses, and the fold resumes forward rather than replaying from
  its anchor. The overhead is 1.0-1.1x at every size, and the absolute scrub of
  a 96-turn run (1,651 commits, 97 epochs) fell from 50.2 ms to 17.8 ms. The
  batch form pays for the correctness fix: 10.0 ms to 16.2 ms on the same run,
  because every read now folds from the base.
- **Control characters in `receipt.ts` are written as escapes.** The digest
  separators were literal `U+001C`-`U+001F` bytes in the source — invisible in a
  terminal, in a diff and in review, and one `sed` away from being eaten. Same
  bytes, same hashes; they can now be read.
- **`test/lib/time-travel/receipt-conformance.test.ts` · `describe('a redacted
run')` was a NO-OP, and two READMEs documented what it pretended to prove.**
  It passed `redact: [...]` to `Agent.create`, which has no such option;
  `tsconfig.json` excludes `test/`, so the unknown key was never typechecked and
  was silently dropped. The run was not redacted, and the READMEs' "honest edge"
  told a reader a recording was safe to pass on. The case is replaced by what is
  true — an agent recording carries the plaintext, the receipt carries
  unredacted run-salted hashes of it, and redaction here is EXECUTOR-level
  (`flowchartAsTool({ redact })` scrubs an inner run's commit log; note that the
  same snapshot's live `sharedState` is not scrubbed). Both READMEs now say so.
  `test/type-regressions/AgentOptionsRedaction.assignability.test.ts` pins it at
  the compiler: `redact` is not an `AgentOptions` key and an excess property on
  the literal is refused. The false sentence itself is swept out of the two
  places the previous pass missed — `receipt.ts`'s THIRD LAW, which said the
  salt "is the reason a recording is safe to pass on", and the PRINTED takeaway
  of `examples/observability/24-receipt-at-the-stop.ts`, which a reader copies.
  Both now say what a recording actually contains: the salt protects the
  fingerprints and only the fingerprints.

#### The five the verifiers found — two of them new instances of these laws

- **`servedAt` raises `no-fold-base` off BOTH folds, not one.** An epoch has
  two: the log holding its call, and the RUN log holding its build-time
  constants (the forced tool's name, the `wants` the staged-refs nudge is
  composed from). Under `reactMode: 'dynamic-grouped'` those are different logs
  with different bases, and `EpochLocation.runBasis` — added by the previous
  pass for exactly this — was computed, exported on a public type, and read by
  nobody. So a grouped recording that travelled without its RUN base read every
  run constant as absent and declared NO gap: the Lens denying rather than
  omitting, which is the law the two blocking fixes before it were about. The
  gap now also names what a missing run base costs — `tools.names`,
  `tools.forced`, `messages.requestOnly`.
- **A fold's answers are DETACHED.** `keyedFold` memoizes: the same object comes
  back for every read of the same question, and the forward cursor seeds every
  later epoch's replay from that very object. `servedAt` then aliased those
  objects straight into `ServedView` (`tools.schemas`, and `messages.asSent` in
  the common case), so a consumer that edited what it was handed silently
  rewrote what LATER epochs reported was served. This was new in 9.88.0 — the
  reader it replaced, footprintjs's `commitValueAt`, clones per call, so the
  same edit was harmless before; the memo introduced it, and the memo is where
  it is closed. Every answer is now deep-frozen before it is cached, which is
  what footprintjs's own `stateAt` already does, and `servedAt` copies the two
  containers it would otherwise alias so a `ServedView` is a value in its own
  right. `receiptAt` and `epochLocations` (array and locations) are frozen for
  the same reason. Cost, measured at 601 epochs / 10,219 commits: see below.
- **`receipt.params` describes the request the PORT got.** It was read from
  `baseRequest` — the request handed TO the cache strategy — so a strategy that
  rewrote `maxTokens` or `temperature` left five receipt fields describing
  something the port was never handed, no gap named them, and
  `SERVED_GAPS['provider-defaults']` asserted the falsehood in words ("the
  sampling knobs on the receipt are the values the PORT was handed"). It now
  reads `preparedRequest`, which is what `ReceiptParams` and `RECEIPT_BOUNDARY`
  already promised, and the `provider-defaults` sentence is true.
- **`SERVED_GAPS['cache-transform']` names everything a rewrite could have
  changed.** It listed the three `cache.*` fields — the report — and excused
  nothing it reports on. A strategy is handed the whole composed request, and
  both the receipt and the rebuild describe the version it was GIVEN, so the
  gap now also covers `system.*`, `messages.*` and `tools.*`. `params` is
  deliberately not among them: that one is read past the strategy.
- **`FlowchartAsToolOptions.redact` no longer claims a kept record is safe to
  serve back to a model.** The commit-log half of the claim is true; the
  `sharedState` of a kept recording is the live view and holds the plaintext.
  The behaviour is a different subsystem's decision and is recorded, with its
  reproduction and what a fix would cost, as entry 6 of
  `docs/design/2026-09-recorded-not-built.md`.
- **`ServedGap.fields` says which spelling it uses.** The catalogue is rendered
  beside a `ServedView` but names `Receipt` paths, and three of them differ
  (`system.hash`/`chars` is the view's `system.text`,
  `messages.entries`/`count` is `messages.asSent`, `tools.schemaHashes` is
  `tools.schemas`). The mapping is now on the field's own docstring instead of
  in a renderer's head.
- **`SERVED_GAPS['no-fold-base']` names the COUNTS, and the epoch number.** It
  named `system.hash` and `messages.entries` and not `system.chars` or
  `messages.count` — the counts of the very things it named. The two counts
  were not unnamed: `cache-transform` names them, for an unrelated reason, and
  its docstring said of exactly those fields that the rebuild "produces them
  and they DO agree with the receipt". So a base-less rebuild reported a
  shorter prompt over fewer turns while the only entry covering the counts told
  a reader they agreed. Measured on a resumed run whose base was stripped: a real system
  prompt and a real window become a shorter prompt and a shorter window, and
  both counts move with them. `tools.withheld` joins them, because it is folded
  from `wrapUpAsked` like any other key, and the VIEW's own `epoch` too, because
  a fold that cannot read `iteration` numbers the turn by its POSITION instead —
  so the view and the receipt can disagree about which turn this is. (That last
  entry shipped as `basis.epoch`, the RECEIPT's number, which a missing base
  cannot touch. Corrected in the round below.)
- **`cache-transform`'s docstring no longer asserts agreement it cannot have.**
  It said of its composition fields that "the rebuild produces them and they
  agree with the receipt", which is false on every view that also raises
  `no-fold-base`. Both the docstring and the sentence a renderer prints are now
  scoped: this entry says the rebuild stops AT the cache strategy, never that
  the rebuild got that far, and where another gap on the same view names the
  same field that one is the stronger claim.
- **`no-conversation-on-record` names `messages.requestOnly`.** The staged-refs
  nudge is recomposed FROM the conversation, so a rebuild with no conversation
  finds no refs and reports no nudge — indistinguishable from a call that had
  none.
- **A `ServedView` is a value, all of it.** Two of its six containers were
  frozen (`messages.asSent`, `tools.schemas`, the two that would otherwise alias
  the fold's memo); `system.pieces`, `messages.requestOnly`, `tools.names`,
  `gaps` and the view object itself were plain, while the type said `readonly`
  throughout. No leak — the other four are built per call — but a promise that
  holds for two containers out of six is one a reader cannot use. The whole view
  is frozen now, down to the pieces and gaps, and the docstring says which two
  are also copies and why.

#### The fourth round — three false sentences and one vacuous half

The walk was green and bit on five attack probes. What it cannot see is whether
a sentence is TRUE, and three of them were not.

- **A shipped sentence said `LLMCall` has no run id to salt hashes with, and it
  does.** `servedView.ts`'s module comment, and the `no-receipt-on-chart` `why` a
  renderer prints verbatim, both explained the refusal to mint a receipt on the
  three non-agent charts with THE SALT: "only `Agent` has a run id to give". But
  `LLMCall.ts` · `createExecutor` mints `runId: makeRunId()` exactly as `Agent`
  does and owns its own executor, so the salt is there for the taking. The
  DECISION is unchanged — declare, do not mint — because the other reason holds
  for all three charts: a receipt carries a cache verdict about a strategy none
  of them runs, and `cache.transform` has no value meaning "no strategy ran".
  The salt clause is now SCOPED to the two message-API charts, where it is true
  and is the reason wiring cannot fix them: `buildMessageApiChart` and
  `buildAgentMessageApiChart` are exported chart BUILDERS whose deps carry no run
  id and no way to ask for one, run on a consumer's own executor. The printed
  sentence gives the cache verdict and nothing else, because that is the half
  that holds everywhere the gap fires.
- **The epoch account was INVERTED.** `no-fold-base` named `basis.epoch` — the
  RECEIPT's number, minted live and carried in the call's own bundle, which no
  missing base can move — while the number that CAN be fabricated, the view's
  own `epoch`, was excused in `UNGAPPED_FIELDS` on the ground that "a caller
  passes it to `servedAt` and gets it back". True of `servedAt`; untrue of
  `servedViews()`, which returns whatever the fold produced, and
  `EpochLocation.epoch` falls back to POSITION when it cannot read `iteration`.
  Measured: a resumed run whose base and `iteration` writes had both gone
  rebuilt its second turn as epoch 1 while that turn's own receipt still said 2.
  Now `no-fold-base` names `epoch` and `no-receipt-on-chart` names `basis.epoch`
  (a receipt-only field like the other three on `basis`), the `UNGAPPED_FIELDS`
  key is gone, and `ServedGap.fields` names the ONE place the two shapes hold
  two records of one fact rather than two spellings of it. Pinned by a new
  conformance case that measures the disagreement.
- **`omittedForAttention` was blamed on the missing receipt.** It was in
  `no-receipt-on-chart.fields`, but its absence has nothing to do with a
  receipt: no chart in this library supplies it, on any recording, so it is absent on views that
  HAVE a receipt too — where nothing explained it at all. It is a key of
  `UNGAPPED_FIELDS` now with the true reason: a slot writes its budget drops to
  `slotCompositions` inside its own subflow and no boundary bubbles them out, so
  `buildReceipt` is never handed one. Recorded as entry 9 of
  `docs/design/2026-09-recorded-not-built.md`.
- **The walk's divergence half was VACUOUS for two of four rows.** It asks "is
  every field that MOVED named?", which a damage that moves nothing satisfies
  for free. `no-run-log`'s damage moved nothing at all and
  `no-conversation-on-record`'s never reached `messages.requestOnly`: measured,
  emptying `no-run-log.fields` to `[]` and deleting `messages.requestOnly` from
  `no-conversation-on-record` left the file green. The previous round wrote a
  guard for exactly this hazard, for ONE row. It is general now: the loop
  collects the moved paths per damage and FAILS on an empty set, and both rows
  are driven on a run that composes a staged-refs nudge, which is the one shape
  where losing the run log or the conversation really costs a request-only line.
  "A damage row that damages nothing" joins the header's own blind-spot list.
- **`no-fold-base`'s "mechanical rule" named a reader it does not apply to.**
  The comment said a field belongs on the list when the rebuild derives it from
  `readAtCall`, `readAfterCall` or `readRunConstant`. `readAfterCall` reads the
  receipt, which the call's own bundle commits — no missing base can cost it,
  and naming it is what let the receipt's own `basis.epoch` onto a list it does
  not belong on. The rule is now the two readers that fold over values the log
  may never have written, with the third named as deliberately excluded.
- **`cache-transform` says it is unconditional.** It is raised on every view,
  including the three charts that can run no cache strategy at all — where the
  same view's `no-receipt-on-chart` says exactly that. The `why` now OPENS with
  the condition: raised unconditionally, vacuous where no strategy ran, a
  boundary rather than a claim that anything was rewritten. Raising it
  conditionally instead would mean inferring "no strategy ran" from a recording,
  which is the absence-of-evidence reading this whole feature refuses; recorded
  as entry 8 of `docs/design/2026-09-recorded-not-built.md`.

#### The fifth and sixth rounds — a printed gap sentence stops describing code

Five review rounds, and each one found NEW false prose in the sentences the
round before had just written, at a roughly constant rate. That is not a run of
careless writing. It is the law this library named in 9.84–9.86 — **a sentence
composed once and read many times is a PREDICTION** — one surface over: composed
once, and read against every later version of the code it describes.

The reproduction is one shipped string. `SERVED_GAPS['no-receipt-on-chart'].why`
said _"THREE causes and none of them is a hole in this view: …"_. A fourth path
was then added — a value under the receipt key refused because it carries no
basis — and BOTH halves went false at once: four causes, and that one IS a hole.
Nobody edited the string. Nobody had to.

**THE RULE, AND THEN THE RULE THAT REPLACED IT.** The fifth round allowed a
gap sentence three things: which fields it covers, what MECHANICALLY could not
be established, and what therefore follows. The sixth round deleted the middle
one, and the reason is the whole story of this release.

Five rounds tried to write TRUE mechanism sentences and the rate of new
falsehoods held constant. So the sixth put one question to all ten printed
sentences — _could this become false without anyone editing it?_ — and NINE
could, two of them being false the day they shipped. Exactly one could not:

> `UNGAPPED_FIELDS.gaps` — _"The account itself rather than a fact about the
> request: a gap naming this list would be the account excusing its own
> absence."_

It survives because it makes **no claim about code**. It says what the field
means inside the account, and nothing outside the sentence can falsify it. Every
other sentence described a MECHANISM — "the fold could not read", "only its
inputs are on the record", "the request-only lines are recomposed from the
conversation" — and a mechanism is code, and code moves. The conclusion is not
to write them better. It is to STOP WRITING THEM.

**A printed gap sentence may now say only three things: WHICH FIELDS it covers,
WHAT THEY MEAN ON THIS VIEW for the person reading, and WHAT TO DO
DIFFERENTLY.** It may not name a module, a function, a key, a version, a chart,
a strategy, an option, or any mechanism at all — not `initialState`, not "the
fold", not "the cache strategy", not "recomposed from". A sentence that needs
one of those words to be understood is explaining WHY the gap exists, which is
not the printed sentence's job. NINE of the ten got shorter — the tenth is the
one that already had the shape, and it is unchanged to the byte.

**None of it is lost.** The mechanism moved into the code comment above each
catalogue entry, phrased for a maintainer and carrying the `file · symbol`
pointers that are correct there and banned in printed prose. The CAUSE is
already data (`ServedGap.cause`). The docs still explain the mechanism at
length, because a doc is versioned with the code and its reader can open the
file — so `src/lib/time-travel/README.md` and the docs-site page are now
deliberately LONGER than what a renderer prints, and both say so.

**WHAT IT RULES OUT — AND THE CLAIM A SEVENTH ROUND OVERTURNED.** The sixth
round shipped this paragraph saying the reduction had made the prose
UNROTTABLE: a sentence with no code claim in it cannot go false when the code
changes, so the class is closed outright rather than merely thinned. A verifier
then read all eleven printed sentences one at a time, and that is false. **TEN
of them still make a claim a code edit falsifies.** Exactly one does not —
`UNGAPPED_FIELDS.gaps` — and it does not because it is SELF-REFERENTIAL: it says
what its field is inside the account, not anything about the request. The other
ten cannot copy that shape, because a sentence that tells a reader something
USEFUL — _may be SHORT_, _absent means unknown_, _the tool list is complete and
the schemas are one short_ — is a claim about how the rebuild behaves, and the
rebuild is code. **The reduction changed the VOCABULARY of the claims, not their
CLASS.**

What the reduction really buys is smaller and still worth the rows: the
sentences are short and readable, and the enumerations that went false in five
rounds have nowhere to come back through. It also makes the rule enforceable.
The fifth round's checker was PHRASING-shaped and near-synonyms walked through
it; the sixth round's printed surface admits no code-shaped token — dotted path,
`.ts` file, camelCase, PascalCase, `SCREAMING_SNAKE`, a call with parens, a
quoted option name, a version number — and no mechanism verb from a closed list
of ten. That is close to a whitelist, and a whitelist has no synonyms.

**WHAT ACTUALLY CLOSES THE CLASS IS A RUN, and the evidence is in the same
report that overturned the claim.** Driving one real view per gap, the verifier
recorded seven sentences HOLDING and four MISLEADING — and caught a BRAND-NEW
false sentence in the very round written to end false sentences. No rule caught
it. Measurement caught it. So a gap sentence MAY make a code claim, because a
sentence that makes none cannot inform, and **every claim it makes is now
ASSERTED against a real view in a test that sits beside it**:
`test/lib/time-travel/gap-sentences.test.ts` drives one run per catalogue entry,
decomposes each sentence into quoted clauses, pairs every clause with its own
assertion, and requires the clauses to PARTITION the sentence so no printed word
sits outside a checked claim. The prose rule stays and is no longer sold as the
thing that makes the sentences true.

**THE HONEST LIMIT**, in the new file's header and in the checker's: a claim
nobody wrote an assertion for. The partition guarantees each clause has a test;
it cannot guarantee the test is as strong as the clause. That is a smaller blind
spot than six rounds of rewriting produced, and it is the whole of it.

- **The rule is a checker, not a habit.** `test/helpers/gapProseClaims.ts` is
  the reader-facing sibling of `modelFacingClaims.ts`: **six** banned shapes now
  — the two REDUCTION rows the sixth round added (code shape, mechanism verb),
  then the four PHRASING rows the fifth round wrote (cardinality, benignity,
  discrimination, cross-module), kept as the second line of defence and
  redundant on the printed surface by design. Each carries the reason an edit
  elsewhere falsifies it, and a structurally-required exemption argument (the
  same discriminated union, proven the same way in
  `test/type-regressions/GapProseClaims.assignability.test.ts`). The three
  strong rows stand down on `'prose-doc'`, because naming the mechanism is what
  a doc is FOR; the other three do not, because a cause count goes stale in a
  doc exactly as it does in a constant.
- **Every printed gap sentence is one or two sentences and names nothing.**
  `no-receipt-on-chart` now reads in full: _"Nothing on this view has been
  checked against what went out. Every field below is missing as a whole, and an
  absence among them says nothing about the call — not even that a dial was left
  unset."_ `forced-tool-schema` is 26 words. `callRuntimeStageId`'s excuse is 12.
- **TWO SENTENCES WERE FALSE THE DAY THEY SHIPPED, and both were mechanism
  claims, so the rule deletes the category rather than the instances.**
  `cache-transform` said _"only its INPUTS are on the record"_ while three of
  the fields it covers are OUTPUTS that are on the record — `cache.transform`
  (the verdict of comparing what the strategy was given against what it handed
  back), `cache.transformHash` (the digest of the result, when they differed)
  and `cache.markersApplied` (the breakpoints actually applied, as against the
  candidates in `scope.cacheMarkers`, which are the inputs). And
  `no-receipt-on-chart` opened _"No receipt was found for this epoch"_ and
  closed _"absent here means unrecorded"_ — both false under
  `'receipt-shape-rejected'`, where a receipt WAS written and the read refused
  it, which is to say the sentence asserted which cause applied and was wrong
  for one of two. Neither can be written under the new rule. Both are corrected
  in the two doc tables and in the comment beside each entry, where the
  mechanism now lives, rather than merely dropped.
- **`RECEIPT_BOUNDARY` was the one printed sentence exempted from the rule, and
  the exemption is gone.** It named `LLMProvider.complete` and `complete()` — a
  module and a call, printed to a reader who cannot open either. It now reads
  _"A receipt describes the request as this library last saw it. Whatever
  handled it after that could have changed it, and nothing on the receipt would
  show that."_ The port, the decorated provider, the vendor adapter and the
  vendor's own defaults are in the comment above the constant. One string, one
  rule set: the walk no longer strips it before judging, and asserts it on its
  own as well as inside the two entries that quote it.
- **THE CAUSE IS A VALUE.** The enumeration was prose doing DATA'S job: a frozen
  constant cannot know which cause applied at the site it is printed beside, so
  it listed them all and hoped. `ServedGap.cause` carries the answer now,
  computed in the one function that has it — the receipt read reports whether
  the key held nothing (`'no-receipt-committed'`) or held something it refused
  (`'receipt-shape-rejected'`). Same "one fact, one owner" move that fixed the
  `read_skill` refusals in 9.86. One test per cause: the first on a real
  `LLMCall` run, the second on a crafted recording whose receipt key holds a
  value with no basis, since no run produces one. The set is closed AT THE SITE
  and deliberately no wider — a pre-9.88 recording, `recordReceipt: false` and a
  chart that mints none all leave the same record, and claiming to separate them
  would be this field repeating the defect it was added to fix.
- **`ServedView.basis`'s docstring claimed the gap discriminates.** It said the
  gap "says which of the three it was", which it never could. It points at
  `cause` now.
- **`receiptAt`'s docstring merged two causes, omitted a third, and denied a
  fourth.** It said `undefined` has three causes, gave `recordReceipt: false` as
  a gloss on "this chart mints none" (two different causes), left out the
  malformed-receipt refusal, and asserted that none of them is "the epoch is
  missing" — which is false, because `epochAt` returning nothing is exactly one
  of the ways it returns `undefined`. It now gives the same account
  `ServedGapCause` gives, so the two exported accounts cannot disagree, and says
  plainly that a missing epoch is a separate answer.
- **`UNGAPPED_FIELDS.omittedForAttention` said "no chart supplies it".** True of
  this library and not of the world: `buildReceipt` is a pure exported mint, so
  a consumer can hand it the fact. Narrowed to **no chart in this library** —
  and then, in the sixth round, moved out of the printed sentence altogether,
  because a dated measurement over a set of charts is a claim about code. The
  measurement is unchanged and still re-taken by the walk on every run; it reads
  the claim from the COMMENT beside the entry now, so a chart that starts
  supplying one still fails the suite instead of aging the sentence. What a
  reader is shown is what the field means: _"Absent means nobody recorded a
  drop, never that nothing was dropped."_
- **`examples/observability/24-receipt-at-the-stop.ts` clipped a printed reason
  mid-version-number.** It printed `reason.split('.')[0]`, so "measured on
  9.88.0" reached a reader as "measured on 9." — a fragment that reads as a
  complete sentence. It wraps on word boundaries now, and prints the gap's
  `cause` beside its kind.
- **The walk's divergence half now STATES ITS MEASUREMENT instead of implying
  coverage.** The header claimed the vacuous-row guard was closed "by driving
  each row on a run that reaches its own fields". Measured, that clause is
  false: `no-fold-base` moves 7 of the 11 fields it names, `no-run-log` 1 of 4,
  `no-receipt-on-chart` 3 of 8, and only `no-conversation-on-record` reaches all 3. The reasons are structural — a receipt-only field never appears on a view,
  so removing the receipt cannot MOVE it — so the header names the numbers per
  row, a test pins them so the table cannot go stale, and it says plainly that a
  field claim divergence does not reach is carried by the coverage half and by
  `receipt-conformance.test.ts`. No new machinery was built for this; the honest
  fix was to say what was measured.
- **The gap tables in `src/lib/time-travel/README.md` and
  `docs-next/content/docs/debug/time-travel.mdx` were short AND over-broad on the
  day they shipped** — `no-run-log` missing `tools.schemaHashes`,
  `cache-transform` claiming all of `tools.*` when it names two of the four
  fields under `tools`. That is this release's own defect one layer out, where
  the walk was not looking. Both tables now carry the LITERAL field lists, and
  the walk parses them: every row must match `Object.keys(SERVED_GAPS)`, every
  field cell must match that entry's `fields` exactly, and no cell may name a
  field the catalogue has moved to `UNGAPPED_FIELDS`. A doc that restates a
  frozen exported constant is checked against it, not retyped.

#### The seventh round — every sentence is asserted against a real run

The rounds above all ended by READING the sentences. This one drove a view for
each of them, which is how the library closes everything else, and it found a
different class of defect: not prose that names a mechanism, but prose that is
plain, short, rule-abiding and UNTRUE OF THE VIEW IT IS PRINTED BESIDE.

- **`no-run-log` claimed a loss that a run says did not happen.** It read _"The
  fields below could not be fully recovered here"_ — an assertion that recovery
  DID fail. Measured on the ordinary view that raises it, a
  `'dynamic-grouped'` agent with one plain tool and its `commitLog` emptied:
  `tools.names`, `tools.schemas`, `tools.forced` and `messages.requestOnly` all
  come back BYTE-IDENTICAL to the intact view. The gap fires and costs nothing,
  because that run has no forced tool name and no `wants` to lose. It now reads
  _"The fields below may be SHORT: a name can be missing from the tool list, and
  a line that went out with the request can be missing too. An absence below is
  not evidence that there was nothing there — read the whole recording rather
  than a piece of it."_ **The repair is the sentence and not the condition**,
  and the reason is that the condition cannot be narrowed by anything the read
  can see: whether the run had a constant to lose is recorded in the log whose
  absence raises the gap. Both directions are asserted — emptying the run log
  takes a forced-output run's tool list from one name to none and a staged-refs
  run's request-only line to nothing, and takes nothing at all from the plain
  run. Its second clause was loose as well: it said a line could go missing
  _"from the conversation"_, and a request-only line is by construction in no
  conversation — asserted now against the wire, which carries it as the last
  message of the request while the rebuilt `messages.asSent` does not contain it.
- **Three sentences were true where they were composed and misleading where they
  were PRINTED.** One sentence, several contexts: the library's own Honest
  Sentence law says it has to hold in all of them.

  - `cache-transform` ended by quoting `RECEIPT_BOUNDARY` — _"A receipt
    describes the request as this library last saw it"_ — and it is raised on
    EVERY view, including a receipt-less one. Measured: an `LLMCall` view
    carries exactly `no-receipt-on-chart` and `cache-transform`, so the reader
    was told what a receipt describes beside a view that has none. The quote is
    gone from it and the claim survives in the entry's own words, in the
    vocabulary of a view: _"…and nothing on this view would show it."_
    `provider-defaults` keeps the quote and is the only entry that may have it —
    it is pushed inside `if (receipt !== undefined)`, so a view carrying it
    always has a receipt for the sentence to be about. Asserted across every run
    in the new file: a gap whose `why` includes the boundary appears only on a
    view whose `basis` is defined.
  - `no-fold-base` said the view's number _"may differ from the one the receipt
    for this turn carries"_ — printed on views that carry no receipt (a
    base-less `LLMCall` recording raises both gaps at once). It now says what
    the NUMBER means: _"The turn number below may be this turn's place in run
    order rather than the number the run itself gave it."_ Asserted on the
    resumed run whose base and `iteration` writes are gone: the view calls the
    second turn 1 while the run's own count for it was 2.
  - `no-receipt-on-chart` closed _"their absence here is a gap in the record,
    never a call made without them"_. True of each field AS A WHOLE and false
    one level down, which is the level a reader reads at: a receipt always
    carries `params` and always carries a `cache.transform` verdict, and an
    absence INSIDE `params` — measured `{}` on an agent that set no dials — IS a
    call made without one. It now claims nothing about what is inside a field it
    cannot see: _"…an absence among them says nothing about the call — not even
    that a dial was left unset."_

- **`test/lib/time-travel/gap-sentences.test.ts` — the assertion, beside the
  sentence.** One real run per catalogue entry and per `UNGAPPED_FIELDS` key,
  and an assertion for each claim the sentence makes — not that the gap fired,
  but that what it says about the view HOLDS. Each sentence is decomposed into
  clauses quoted verbatim from the constant, each clause carries its own
  assertion, and three contract tests hold the binding shut: every catalogue key
  is an entry, every quote is verbatim and in order, and **the clauses PARTITION
  the sentence** — strike them out and only punctuation is left, so no printed
  word sits outside a checked claim. Rewrite a sentence and the partition fails,
  which sends the author back to write the assertion for what it now claims. The
  measurements the round took by hand are transcribed into it rather than
  re-derived, and the rest were driven to fill the gaps between them.
- **`UNGAPPED_FIELDS.gaps` is labelled as the one clause class that is not a
  claim about the request.** It is the only sentence no code edit can falsify,
  and it is that way because it is self-referential — a statement about what its
  field is inside the account. The new file carries a flag naming that category
  rather than an assertion pretending to cover it, and a contract test requires
  exactly that one entry to be flagged.

### Changed

### The receipt's three laws

1. **Hashes and references, never bytes.** No message text, no prompt text, no
   schema bodies. Those bytes are already governed — `recordSystemPrompt` is
   opt-in for exactly this reason, redaction scrubs the committed mirror, a
   window strategy decides what survives — and a receipt carrying content would
   quietly reopen all three.
2. **Run-salted digests.** `sha256(runId + '\u001f' + content)`, first 16 hex
   characters. Hashes are NOT redacted, and the salt is why that is safe: an
   unsalted hash of a one-line prompt or a two-word user turn is a dictionary
   lookup away from being read back, and receipts travel inside recordings.
3. **No authority omissions.** A receipt never names — and never counts — what a
   caller's role was not allowed to see. Committed state is readable by the
   trace toolpack's debugging tools, so a receipt carrying `hiddenSkillIds`, or
   even "3 skills withheld", would restate a permission decision one layer down
   where nobody is checking.

### Measured

- `test/lib/time-travel/receipt-conformance.test.ts` — 51 tests over real runs:
  both chart shapes, a pause and a resume in both, a skill-graph hop, a stepped
  skill, a parked map, a wrap-up call, a forced output tool, a staged-refs
  nudge, a cache strategy that rewrites the composition and one that rewrites a
  sampling dial, a marker-applying one, a provider decorated past the port, an
  `LLMCall` chart, a JSON round-trip, a pre-9.88 recording, a recording with no
  fold base on either of its two folds, a recording whose base AND whose
  `iteration` writes are gone (where the view numbers the turn by position and
  its own receipt still says otherwise), a subtree with no run log, a reader
  that tries to edit what it was handed, and the off switch. The vendored
  SHA-256 is checked against `node:crypto` on every shape it hashes. Two
  mutation tests drop a committed piece from the replay and require the law to
  go red naming the epoch and the field.
- `test/lib/time-travel/gap-catalogue-walk.test.ts` — 44 tests, and the reason
  this release has one more file than it planned. `SERVED_GAPS` was hand-checked
  against the two shapes three times and came up short three times, which is not
  a run of bad luck: A HAND-COUNTED LIST IS SHORT THE DAY AFTER. So the
  correspondence is WALKED, the way `userTurnProducers.test.ts` walks every
  `role:'user'` producer and `toolDivergenceWalk.test.ts` crosses every
  claimant. It derives the field list twice — from the declarations, with the
  TypeScript parser, and from five real runs — and requires every field to be
  named by a gap or to be a key of `UNGAPPED_FIELDS` with a written reason;
  requires every `fields` entry and every `UNGAPPED_FIELDS` key to resolve to a
  field that exists, so a rename cannot leave a gap pointing at nothing; and
  requires the kinds `viewOf` can push and the kinds in the catalogue to be the
  same set. Then it DAMAGES a real recording the way each gap describes,
  rebuilds, and requires every field that MOVES to be named by that gap — which
  is the half that catches a field named by the wrong gap for the wrong reason,
  and the half the first three checks could not. Verified by reverting each fix
  and watching the right row go red.

  **The two halves, and what each cannot prove.** The ACCOUNT half (coverage,
  resolution, reachability, and the two doc tables) proves every field of both
  shapes is named by a gap or excused in writing, that every pointer lands on a
  field that exists, and that the prose copies say what the constant says. It
  cannot prove any of it is TRUE: a gap can name a field for a mechanism that
  does not cause its absence, and this release shipped two of those. The
  DIVERGENCE half proves that for the four damages it can apply, no field moves
  without the responsible gap naming it — and, since this round, that each
  damage moves SOMETHING, so a row cannot pass by damaging nothing. It cannot
  prove a row moved everything the gap is about, it has no damage at all for the
  three gaps that are conditions of the RUN rather than of the recording
  (`cache-transform`, `provider-defaults`, `forced-tool-schema` —
  `receipt-conformance.test.ts` drives those), and the damage table is
  hand-listed, so a gap whose damage nobody wrote down still gets only the
  account half. Neither half reads a `why`. That is a person's job, and it is
  where this release's last three defects came from.

- `test/lib/time-travel/keyed-fold-equivalence.test.ts` — 9 tests: every key at
  every commit of a real run, checked against `stateAt` itself, including a
  merge with no `set` anchor (which cannot be folded at all without the base),
  a resumed agent in both chart shapes, and a replayed value that comes back
  frozen.
- **The detachment freeze costs 23%, and the alternative costs more.** Measured
  on a 601-epoch run (10,219 commits): the whole per-epoch scrub is 1,141 ms
  with the freeze and 930 ms without, against 20.8 s two fixes ago; the batch
  form moves 919 ms to 1,116 ms. Copying instead is dearer, not cheaper — on
  the same 1,200-message structure `structuredClone` costs 0.94 ms against
  `freezeDeep`'s 0.26 ms, and a copy would run once per READ where the freeze
  runs once per memoized answer.
- `test/lib/time-travel/served-view-complexity.test.ts` — 2 tests: epochs are
  located once per recording (checked by identity, no clock), and the per-epoch
  scrub stays within 2x the batch form at both 13 and 49 epochs without
  drifting. Against the shape this release replaced those ratios are 2.4x and
  3.7x, climbing to 5.0x at 97 epochs.
- Full suite: 10,348 passing, 20 skipped, 624 files.
- `test/lib/time-travel/served-view-complexity.test.ts` is a RATIO guard, and a
  ratio is immune to the machine but not to contention: it failed once inside a
  fully parallel `vitest run` and passes alone and in a clean full run. The
  freeze does not touch its subject — the scrub and the batch form do the same
  folding in the same order, so both pay it identically (measured: scrub/batch
  is 1.02 with the freeze and 1.01 without). Recorded rather than widened.
- Runnable: `examples/observability/24-receipt-at-the-stop.ts` — three turns, the
  law checked against the rebuild AND against the request the provider really
  received, with the staged-refs nudge printed back from the record, the
  sampling dials, and the port boundary printed where a reader meets it.

### A stated limit

The `@wire` clauses of the conformance test are not an INDEPENDENT witness.
They compare the receipt against the request the provider stub really received,
which catches a rebuild that drifts from the request and a receipt that
describes something the provider never got. It does not catch a defect in the
shared assembly: the receipt and the request are minted from the same locals
inside `callLLM`, a few lines apart, so a change that alters both symmetrically
leaves every `@wire` clause green. A genuinely independent witness would have to
come from outside the process that composed the request — a recorded HTTP body
from a real adapter, or a second implementation written against the vendor's own
schema. Neither exists; the limit is stated in the test's own header rather than
left to be discovered.

Typechecking the whole of `test/` would have closed the redaction hole at its
root. It was tried and surfaces 1,054 pre-existing errors across the suite and
the examples it pulls in — a repair of its own, not a line item in this release.
The hole is closed instead in `test/type-regressions/`, which already compiles
under `npm run test:types`.

`ServedGap.fields` carries TWO relations on one list. Most entries mean _the
rebuild cannot produce this field_; `cache-transform`'s composition fields mean
_it can, and both sides agree, but only up to the cache strategy_. A checker
that granted the second as an excuse would stop checking fields the record
proves perfectly well — which is exactly what happened when the composition
fields were added, and it silently disabled one clause of the law. The clause
now asks its narrower question against its own list of gaps, and the field's
docstring names both relations. A second array on the public type is the
cleaner shape; adding a public field in a fix pass is not, so it is written
down rather than shipped.

**A green `gap-catalogue-walk` proves the fields are ACCOUNTED FOR, not that the
account is TRUE.** A gap can name a field for the wrong reason and the walk will
call it covered; a `why` can be a fluent sentence about the wrong mechanism; an
`UNGAPPED_FIELDS` reason can be wishful. Only a person reading the `why` catches
that — which is how the defect the walk was built for was found in the first
place — three times in this release, the last of them after the walk was
already green. Five narrower blind spots are named in the file's own header
rather than left to be discovered: the reachability half reads `gapOf('…')`
literals out of the source (and so fails on any `gapOf` call whose argument is
not a literal, which is the only shape that could hide one); the static half
follows type references by name and does not expand an alias, a mapped type or
an intersection; the runtime half only produces what its five scenarios reach;
the DAMAGES table is hand-listed, so a gap whose damage nobody wrote down gets
the coverage check and not the divergence one; and A DAMAGE ROW THAT DAMAGES
NOTHING passed as a green row for one release, which is why the loop now
requires each damage to move something and still says that "something" is not
"everything". Three gaps have no damage at all,
because they are conditions of the RUN rather than of the recording —
`cache-transform`, `provider-defaults`, `forced-tool-schema` — and
`receipt-conformance.test.ts` drives each of those on a real run instead.

**A recording stops being JSON-serializable at about 600 epochs**, and it is the
same reader at the same size that the epoch memo was built for. Measured on the
looping run the complexity guard uses: 301 epochs serialize to 145,238,645
characters; 601 epochs throw `RangeError: Invalid string length` — V8's maximum
string length, not a library limit. Nothing here fails before then, and none of
these readers needs `JSON.stringify` to work: `servedAt`, `receiptAt` and
`epochLocations` all read the live object. But a recording that cannot be
written to a file cannot be handed to anybody, so at that size the answer is to
persist per-epoch views rather than the whole snapshot. Stated rather than
worked around, beside the memo it shares a size with.

`flowchartAsTool({ redact })`'s kept inner recording carries an UNREDACTED
`sharedState` while the commit log is scrubbed. It is a different subsystem and
every available fix changes behaviour for runs that work today, so this release
corrects the option's own claim and records the defect — reproduction, cause
and what each fix would cost — as entry 6 of
`docs/design/2026-09-recorded-not-built.md`.

**Three more are RECORDED rather than built**, as entries 7-9 of the same file,
because the last review round's job was to make every printed sentence true
rather than to close every hole: `cache-transform` does not name `tools.forced`
or `tools.withheld` although a strategy that rewrote `toolChoice` could make
both stale (the receipt builds them from assembly's decision, not from the
prepared request); `cache-transform` stays unconditional, because raising it
conditionally would mean inferring "no strategy ran" from a recording; and a
slot's attention drops never reach `Receipt.omittedForAttention`, because no
boundary bubbles `slotCompositions` out of the slot subflow. Each entry carries
its reproduction, its cause, and what a fix would cost.

## [9.87.1] - 2026-09-06

9.87.0 never reached npm. Its publish job failed the docs site's byte budget —
`export bytes: 621.21 MB exceeds 617.00 MB` — after six new routes (the
time-travel guide and the API pages for `milestoneStops`,
`milestoneStopsStrategy`, `milestoneOf`) added 5.47 MB to a static export
that had 1.26 MB of headroom left. No library code changes in this release.

### Fixed

- **The site-budget ceilings are re-baselined** the way the script's own history
  says to: ~2% over the measured export (634 MB, 6,750 files), with the reason
  written beside the number in `docs-next/scripts/check-site-budget.mjs`. The
  gate did its job — growth nobody was watching is exactly what it exists to
  stop — and the number to look at next is the ~0.9 MB a single docs route
  costs, not the ceiling.

## [9.87.0] - 2026-09-06

The agent now supplies the stops for its own runs.

footprintjs 9.17.0 opens a reader's cursor over a finished commit log —
`timeTravel(snapshot, { strategy })` — with a fold at every stop, and a seam that
says where the cursor may rest. It ships one strategy, `commitStops`, which stops
on every executed stage: the truth, and unreadable. A two-turn agent in
`reactMode: 'dynamic'` commits **42** bundles, and most of them are called
`context`, `sf-cache` or `sf-thinking`.

`milestoneFor` has classified stage ids into `iteration` · `slot` · `llm-turn` ·
`tool-call` · `decision` for releases, and every consumer that wanted a milestone
slider mapped that classifier onto commits itself. This release does that join
once, on the seam: the same 42-commit run yields **15** stops — Run start →
Iteration → System prompt → Messages → Tools → LLM turn → Route → Tool call →
Iteration → … → Run end.

### Added

- **`milestoneStops` / `milestoneStopsStrategy` / `milestoneOf`** (`src/lib/time-travel/`,
  exported from the root barrel). A footprintjs `TimeTravelStrategy` built by
  FILTERING footprintjs's own per-stage axis rather than re-deriving it: it calls
  `commitStops` and keeps the stages `milestoneFor` classifies, so the collapsing
  that axis already solved — one stop per `runtimeStageId` at its first commit
  (mounts and fork children commit more than once), the mount set read off the
  execution tree, the `'start'` / `'end'` bookends, the id-less commit that
  carries a subflow's `inputMapper` seed — is used, not repeated. A stage that
  classifies `null` contributes no stop and its commits fold into the stop before
  it, so the survivors still partition the log end to end and `stateAt(stop)`
  stays "the state that existed when the next milestone started".

- **Both chart shapes, one strategy.** The classifier reads the LOCAL segment of
  a stage id, so nothing has to tell it which log it is holding. Under
  `reactMode: 'dynamic'` the `call-llm` bundle is on the run's own log and the
  llm-turn stop is on the outer cursor. Under `'dynamic-grouped'` the same run
  commits **10** bundles outside — the `sf-llm-call` mounts, which become the
  iteration stops — and `drill(mountRuntimeStageId)` opens that turn's own
  cursor, where the same strategy finds **7** stops including its LLM turn.

- **`examples/observability/23-time-travel-milestones.ts`** — the same agent run
  at both chart shapes, printing each axis, the skill the run stood in at each
  turn, `changedSince` between two turns, a mark that survives a jump, and a
  refused jump that leaves the cursor put. It also calls `milestoneStops` on the
  log directly, for the reader who holds a recording rather than a cursor, and
  shows the two axes agree. Offline, mock provider.

- **`docs-next/content/docs/debug/time-travel.mdx`** — why milestones rather than
  one-stop-per-stage, the three questions the cursor answers, and where the LLM
  turn lives in each chart shape.

### Changed

- **`footprintjs` is now `^9.17.0`** (peer + dev), for `timeTravel`,
  `commitStops` and the `TimeTravelStrategy` seam.

### Honest notes

- **The milestone kind is a function, not a field.** footprintjs's `Stop` is a
  closed shape with no slot a strategy may write its own vocabulary into, and its
  `kind` is the port's own `StopKind` (`'commit' | 'mount' | 'start' | 'end'`),
  not ours to overload. So the kind travels the only way it honestly can:
  `milestoneOf(stop)` re-derives it from the stop's `runtimeStageId` with the
  same classifier that put the stop on the axis — one source of truth, read
  twice. If a later footprintjs gives `Stop` an extension slot, `milestoneOf`
  becomes a one-line reader of it.

- **Which keys are visible where, in the grouped shape.** The settled skill
  cursor for turn _k_ is on the OUTER axis, at iteration _k_ (`currentSkillId`).
  Inside the drill, `currentSkillId` is the value the turn STARTED from — it
  crosses the mount as a read-only input — and the move the turn made is
  `nextSkillCursor`, merged back out by the outputMapper. Both logs are truthful
  about different questions, and `test/lib/time-travel/milestone-stops.test.ts`
  pins both rather than picking the flattering one.

- **`'start'` is not the fold base on this axis.** footprintjs's `'start'`
  bookend is the state before any stage ran; this one also absorbs every stage
  that ran before the FIRST milestone, because the stops must still partition
  the log. Measured on a two-turn `dynamic` run: `commitStops`' start folds
  commits `-1..-1` and 0 keys, `milestoneStops`' start folds `-1..0` and 32 —
  `seed`'s writes have already landed. So `stateAt(startStop)` here is the state
  the first milestone READ, not the run's raw base, and a renderer keyed on
  `kind === 'start'` to show "what the run began with" is showing post-seed
  state. Said in the folder README, on the docs page, and pinned by a test.

- **A resumed run gets an axis of its own.** The cursor reads the snapshot it is
  handed, and a resume is its own execution with its own log: after
  `agent.resume(checkpoint, answer)`, `getSnapshot()` carries the resumed half —
  the axis begins at the stage the resume re-entered and the pre-pause
  milestones are not on it. They are on the snapshot taken at the pause. The
  strategy itself holds across the break (both axes tile, both keep unique
  stops); it is the snapshot that split, not the cursor.

- **A log with no milestones is not an empty log.** A non-empty log the
  classifier recognises nothing in — a non-agent chart handed this strategy —
  yields the two bookends and nothing between them, and every `jumpTo` refuses
  with `'miss'`. An EMPTY log yields `[]`. Two different facts, two different
  answers.

- **The performance guards get a stated allowance under coverage.** v8
  instrumentation is not machine load: it is a per-call counter, so it taxes the
  two sides of a ratio in proportion to how many calls each makes, and a
  comparison between two differently-shaped paths moves even on an idle machine.
  Measured on this suite, the tightest guard sat ~2.8× under its ceiling
  uninstrumented and ~1.1× under it with `--coverage` — which is why it went red
  under whole-suite parallelism and green on a re-run. `test:coverage` now sets
  `AF_COVERAGE=1` and `test/helpers/perf.ts` widens the ceilings by a documented
  3× when it sees it. The plain `npm test` ceilings are unchanged, which is where
  a real regression is still caught; the multiplier is a floor on effort, not a
  promise that instrumentation costs exactly 3×.

- **17 tests over real runs**, not fixtures: the axis in both chart shapes, the
  partition property (every commit belongs to exactly one stop), a jump that
  lands and a miss that names a nearest without moving, the skill graph read
  along the commits with the wire as witness (the skill whose body rode turn _k_
  is the one that iteration's own log settled on), marks that survive jumps and
  never appear in the recording, what `'start'` folds on this axis versus the
  port's, a resumed run's axis, and a log with no milestones in it. One more
  file — 5 tests in `milestone-stops-contract.test.ts` — mocks `commitStops` to check the one
  assumption this strategy makes of footprintjs — that a non-empty log yields
  `[start, …stages, end]` — is refused loudly rather than silently mistaken for
  an empty axis.

## [9.86.1] - 2026-09-06

The release that removed hand-counted lists shipped with one, and with main red.

`chore: release v9.86.0` failed CI (run 34008382993, the `coverage` job) while both
plain `test` jobs and the local release gate passed. Two tests parse every file
under `src/` with the TypeScript compiler and were called fresh inside every `it`
— seven parses in one suite, three in the other — and under the coverage job's
v8 instrumentation each parse took 5.3–6.2 s on the CI runner, past vitest's 5 s
default. Locally the same parse takes about a second. The release script ran
`npm test` and never `npm run test:coverage`, so the one command that would have
shown the failure was the one it did not run. Both walks now parse `src/` once per
suite and carry a 60 s budget of their own, and Gate 4 of `scripts/release.sh` runs
`npm run test:coverage` — the instrumented run is a superset of the plain one, so
the gate now sees what CI sees.

Everything else here is one review of 9.86.0, taken finding by finding.

### Fixed

- **The `'guard'` refusal asserted a fact it did not have.** With no menu
  outstanding, `composeReadSkillRefusal` ended every refusal with "Declared routes
  moved the cursor instead." The gate handed it a boolean derived from two of
  `TurnRoute.by`'s six values, so the clause was composed for the other four too:
  false for `'continuity'` (the cursor was carried over from the previous turn and
  nothing moved it — the verdict every follow-up produces under `{ strictness:
'guard', continuity: 'conversation' }`), false for `'menu'` resolved by the
  model's own pick, and unprovable for `'none'`. The composer now takes
  `turnStartedBy: TurnRoute['by']` and says one past fact per value — "the turn's
  start had already been resolved decisively", "the cursor had been carried over
  from the previous turn", "the menu had already been resolved by an earlier
  pick", "the menu had been resolved by the configured decider before the turn's
  first call" — and nothing for `'none'`. The old tail is gone from every arm.

- **Two refusals named a cursor the role may not be told about.** The `read_skill`
  description withholds a hidden cursor's name by its own law, and the gate's
  refusal printed the same id raw in two clauses ("was not reachable from 'alpha'.
  Skills reachable from 'alpha' when that call was made: …"). The cursor now goes
  through the same filter as the hops: a hidden cursor is anchored as "the skill
  the cursor stood in" — the skill is real and merely unnamed — and "the turn's
  start" is kept for a genuine cold start, which is a different fact. The
  `propose-transition` refusal in the tool-effects judge had the same leak twice
  over: it composed "(reachable: beta, gamma)" from the raw hop set and "from
  'alpha'" from the raw cursor, and that sentence is appended to the tool result
  the model reads. It reads `scope.hiddenSkillIds` now, names the filtered hops,
  omits the clause when the filter emptied them, and anchors a hidden cursor the
  same way. `skill.rejected.currentSkillId` stays raw on purpose: it is the
  operator's record on the event channel, not a sentence the model reads.

- **A same-batch STAY did not compete for the transition slot.** The law is "first
  ACCEPTED proposal wins; later proposals to OTHER targets are superseded", and a
  stay is accepted — but it `continue`d past the bookkeeping, so a tool that judged
  its data first and said "stay" lost to a sibling later in call order that said
  "move", with two `'accepted'` events in one batch, the cursor moved, and no
  `route_conflict` on the record. A stay judged first now holds the slot (writing
  nothing to `pendingToolTransition`, because a stay moves nothing) and the later
  hop is `'superseded'` with the batch's `route_conflict` naming the stay as the
  winner; a stay judged after an accepted hop is the one superseded. Two stays are
  both accepted, as two hops to one target are.

- **Both 9.86.0 frames pointed with the word the same release repaired elsewhere.**
  The wrap-up instruction read "exhausted before this call … This call was for the
  final answer" and the stepped-skill nudge "This call was for running them". A
  frame is written into the `iteration_end` payload the checkpoint snapshots and
  restored verbatim by `applyContinuation`, so on the next `.continue()` turn —
  tools back on the wire — a model resolves "this call" to the call it is
  answering and reads "no tools were offered on it" about a request that offers
  them. They now name the call: "the wrap-up call this message opened … That call
  was for the final answer", and "This message asked for them to be run". The
  checker only knew `on this call`; a bare `this call` row catches the shape now,
  and it found nine more: seven `inspect_tool_call` result lines and the
  `inspect_tool_run` retention note, all anchored to `call '<id>'`; the coverage
  ledger's `COVERAGE_NOTE` ("ground the call this result answers did not look at";
  `canonical-notes.json` is regenerated by the build); and the runbook
  `recording_note`. The checkIn-resume refusal in the tool-calls stage — "cannot be
  retried this turn … Answer without it, or finish", a forecast plus a standing
  order on a persistent result — is a past fact about the resumed call now.

### Changed

- **The shape rows match the grammar they claim.** A second probe of seventeen
  sentences written AGAINST the rows — the plainest forecast forms, not the ones the
  rows had been derived from — walked past all four 9.86.0 shape rows: the
  effect-verb row knew no future or modal tense ("will move you", "can switch
  you"), the cursor row wanted a quote right after `in ` ("You are in skill
  'alpha'", "You're in 'alpha'", "Your current skill is 'alpha'"), the copula row
  knew six nouns ("is enabled", "is mounted", "are offered", "is off the wire",
  "have been withheld"), and a headed list ("Available tools: calc, probe.")
  has no copula at all. The rows are widened, a headed-inventory row and a
  next-call-forecast row are added, and the seventeen sit beside the fifteen in
  `test/modelFacingSurfaces.test.ts` so the next narrowing fails by name. The
  `src/` walk then flagged **twenty-five** more literals: ten are repaired above,
  fourteen are host-facing errors and check-up warnings now classified, and one —
  an integrity finding's frame line — joins the work list. The ledger stands at
  **ninety-one files / one hundred and seventy-eight literals**, with
  **thirty-four** unrepaired across thirteen entries; the suite computes those
  numbers.

- **A row may no longer exempt every lifetime.** `provableWhen` naming both
  lifetimes compiled, carried an argument, and disabled the row everywhere — the
  exemption-with-no-argument defect in a new coat. The suite asserts a strict
  subset now. The header of `test/helpers/modelFacingClaims.ts` also says what
  "may speak in the present" means beside the `now` row: present TENSE reported
  as the state of the request, not the deictic adverbs, which point at the moment
  of reading on every surface.

- **The divergence walk's summary block is checked whole.** Only `walk.cases` was
  read back; the other five numbers were written on update and never compared.
  All six are now derived from the recorded case outcomes and the row set. The
  placeholder gate also refuses `TODOs` and `to-do`, and the header names five
  defects, not three. A `claim-swallowed` row's auto-composed `cause` says "names
  this claimant as the winner of a wire it never reached" when the shadow report
  names the swallowed claimant itself — the framework's `skill-scoped:self-explain`
  provider — instead of "describes a different pair", which it does not.

- **Anchors in the walk's baseline and the design note name symbols, not lines.**
  The ten 9.86.0 rows cited `buildToolRegistry.ts` line ranges from the 9.85.0 tree
  that the same release had moved by about twenty-nine lines, beside a
  `buildToolsSlot.ts` line from HEAD. They name the checks now (`holders.includes
(PRESENT_TOOL_NAME)`, the `seenNames` loop, the `sharedSkillTools` backfill), and
  the baseline's `note` says so. The `present-vs-mcp` row no longer claims the MCP
  cell proves the blind spot is the provider channel: both claimants mount through
  `staticTools()`, so the cell shows an MCP catalog inherits that seam unchanged and
  nothing more.

- **`scripts/release.sh` Gate 4 runs `npm run test:coverage`.** See the opening.

### Docs

- `docs/design/2026-09-recorded-not-built.md`: entry 1's "16 baseline rows" is 22
  (18 with a provider's or a skill's tool dead, 4 with the framework's own), the
  appendix lists it as the third corrected sentence, and the row paragraph says
  four-and-six rather than eight-and-two.
- `docs/api-reference/interfaces/AgentOptions.md`, tracked and last regenerated at
  9.58.0, still quoted the pre-9.86.0 wrap-up sentence ("Do not request tools");
  the quote is updated in place, as are the three other copies.
- The skill-graph quickstart says a host wiring its own `read_skill` under a
  `tree()` must set `ReadSkillOffer.treeRouted`, and why.

### Changelog corrections

Four sentences in 9.86.0 are corrected in place, each marked where it stands:

- _"Eight of the ten are already-recorded seams … Two are defects"_ — four rows
  reach recorded seams and six record the two new defects.
- `ToolRegistryArtifacts.toolDeclaringSkills` and `AgentState.hiddenSkillIds` were
  listed under Added as if public; neither type is exported from any door.
- `unknownToolResult` was called "exported"; it is a module export inside the
  tool-calls stage and not on any door.
- The `report-misattributed` bullet did not say that `reported` — a field the
  ratchet compares — changed body on nine unrenamed rows.

### Deliberately not changed

- **The two permission-denied arms** ("This will not change during this run — do
  not call it again") stay on the unrepaired ledger. Making the sentence true means
  latching a denial per run, a behaviour change with no field finding behind it;
  rewording it is that entry's own packet.
- **The `now` row keeps no exemption.** The header now argues the same thing the
  row does, rather than the row being softened.
- **`skill.rejected.currentSkillId`** is not role-filtered — see above.

## [9.86.0] - 2026-09-05

Every hand-counted list in 9.84.0 and 9.85.0 was short by one or two.

"Five classes of `role: 'user'` message are authored by this library" — seven
were. "Reachability OR posture" — three arms refuse. "Sixty configurations,
crossing every source" — the cross skipped four of the seven sources it named,
and there are seventy-six. The rules that catch a sentence which outlives its
moment were a transcript of the wordings that had already escaped: thirteen of
fifteen plausible forward-looking sentences walked straight through them.

None of those was a typo. Each was a fact the library computed in one place and
re-derived, by hand, wherever a second consumer needed it — and a hand-derived
list is a list that is short the day after somebody adds the next case. Three
of them are now WALKS rather than counts: the user-turn producers are parsed out
of `src/` with the TypeScript compiler, every sentence-shaped literal in `src/`
is run through the model-facing rules with a file and a line on failure, and the
offer/dispatch cross iterates its source list whole instead of filtering it.
Two more are single owners: one function answers "is this `read_skill` target
the cursor?", and one scope key answers "which skill ids may this role see?".

### Fixed

- **`read_skill` refusals answered for a fact nobody owned.** Five call sites
  needed to know that `makeReachableSkills` filters the cursor out of its own
  successor set — correct for a MOVE, silent about a READ. Three of them wrote
  their own `requested === cursor` line. Two never heard: a tool proposing
  `propose-transition` back to the cursor's own skill was refused as unreachable,
  and the `skill_read` permission gate was asked to grant a capability the model
  was already exercising, then told the model that its own skill was "not
  available in this context".

  `classifySkillTarget({ cursor, target, hops, open })` now owns it, returning
  `'self' | 'hop' | 'open' | 'unreachable'`. It is a pure function in the
  injection engine, exported through the `agentfootprint/context` barrel and the
  `agentfootprint/skill-graph` door — the same function object through both, so a
  foreign host cannot re-derive it wrongly either. The five consumers switch on
  it: the gate arm, `describeOffer`, the tool-effects judge, the `skill_read`
  permission gate, and the refusal composer. `makeReachableSkills` keeps its own
  exclusion — it is the PRODUCER of the hop set, and excluding the cursor is what
  a move means — and its doc comment now says the exclusion is about movement and
  sends the next reader to `classifySkillTarget`.

- **A refusal could name a skill the caller's own policy hides.** Role visibility
  was a property of one builder: `Agent.hiddenSkillIdsNow()` fed
  `buildReadSkillTool` and nothing else. So the description named nothing hidden
  while the gate, one stage downstream, composed its refusals — and filled
  `skill.rejected.allowed` — from the graph's raw sets.

  The tools slot now resolves the hidden set once per iteration, publishes it on
  `scope.hiddenSkillIds`, and both chart shapes bubble it. The gate keeps two sets
  on purpose: the RAW one it judges with, and the filtered one it speaks with. It
  judges with the raw set because a narrowing may take a schema off the wire and
  may never take a name out of the dispatch map — filtering admission would remove
  a capability, which the monotone rule forbids. In practice a hidden id never
  reaches the gate, because the same checker denies it upstream; the filter is what
  makes that true by construction rather than by coincidence.

- **Two refusal composers that contradicted each other forty lines apart are one.**
  `skillRefusal` and `postureRefusal` are replaced by `composeReadSkillRefusal`,
  and every arm of it is a past fact about the one call it names. Gone with them:
  "from here" (deixis — a different place on every re-read), "Pick one of these, or
  finish" (an exhortation in a string that persists for the rest of the run), and a
  posture arm that named a hop the very next arm would have declined. A refusal now
  opens `read_skill("X") was not granted on that call:` and every clause after it
  refers back to that call.

- **`Unknown tool: X` told the model it was wrong and never what would have
  worked.** Both dispatch doors now compose one `unknownToolResult` (a module
  export inside the tool-calls stage, not on any package door — _corrected in
  9.86.1_), which
  names the dispatch roster: `Unknown tool 'X' on that call. Tool names that
resolved to an implementation on that call: …`, or, with an empty roster, that
  none did. The leading `Unknown tool` token is preserved, so every matcher on it
  is untouched.

  It says _resolved_, not _could be dispatched_, because two gates sit between
  resolution and a tool running — the `tool_call` permission check and the
  middleware chain — and neither is asked to phrase an error. And the roster is
  role-filtered before it is named: it used to read the dispatch map raw and could
  name a tool belonging to a skill the caller's own policy hides, which is the
  leak the refusals had just closed, one sentence over. `buildToolRegistry` now
  returns `toolDeclaringSkills` (tool name → the skills that declare it) from the
  walk it was already doing, and a name is withheld only when EVERY declaring
  skill is hidden — a tool two skills share stays named. Dispatch is untouched.

- **A filtered-empty list was reported as an empty one — a Lens denying what the
  Fold holds.** Three sentences branched on `length > 0` over an already-filtered
  array, so "the graph held nothing" and "the role filter emptied it" composed the
  same words. A cursor whose only declared hop was hidden answered `read_skill`
  with _"No skill was reachable from 'alpha' when that call was made."_ while the
  graph was routing `alpha`; a `'guard'` menu whose every id had been hidden since
  the turn started said _"no menu was outstanding when that call was made.
  Declared routes moved the cursor instead."_ — two false clauses in one breath.

  A model told the map is a dead end stops asking for the door it may not be
  shown, and the checker cannot see it: every one of those sentences passes
  `unprovable()`, because the defect is in what the composer was handed, not in
  how it was worded. So the fact is now a type. `SpokenIds` carries both halves of
  a filtered set — `named`, and `held` for whether the unfiltered set held
  anything — and `held` is required, so the compiler asks every caller the
  question every call site forgot to answer. Where a filter empties a set the
  clause is OMITTED. Omission is free and always true; the negative is a denial.

  The fourth sentence was the one the model reads to CHOOSE. `describeOffer`
  computed its columns from an already-filtered catalog, so a cursor whose only
  declared hop is hidden was told _"Nothing is reachable from here — answer with
  the skill you are in, or finish."_ while the graph held that edge. It classifies
  the hop set over the unfiltered catalog now and drops the clause when the filter
  is what emptied it; with nothing wired out at all the sentence still stands,
  because that absence is one the description has evidence for. Reaching it meant
  moving `SpokenIds`/`spoken` to `src/lib/spokenIds.ts`: it lived in the tool-calls
  stage, on the wrong side of the skill-graph fence, so the description — composed
  inside `src/lib/injection-engine/`, which may not import the agent loop — was the
  one surface that could not use the fact its own refusals were repaired with.

- **Under a `.tree()` with nothing open, `read_skill` is no longer offered.** A
  tree routes by predicate on every iteration and keeps no cursor, so the tool had
  nothing it could do and a menu of one refusal is worse than no menu. The schema
  leaves the request; the NAME stays in the dispatch map, which is the same law as
  everywhere else. With open skills present, the description explains the tree and
  lists exactly what a pick can open, instead of printing "Nothing is reachable
  from here".

- **Two library-authored user turns were credited to a person.** The out-of-budget
  wrap-up instruction and the stepped-skill nudge both append to `scope.history`
  with `role: 'user'` and took no registered opening, so `isSaidByPerson` said a
  person wrote them. Two things followed. The window's refusal engine could pin
  "the current request" on the framework's own wrap-up instruction and drop the
  real request underneath it. And a routing rule written the documented way —
  `saidByPerson(ctx).some((m) => m.content.includes(…))` — matched on the library's
  own bookkeeping: the wrap-up said "Do not request tools", and the nudge names a
  skill id and every unrun step's tool name.

  Both are registered now, and `LIBRARY_AUTHORED_PREFIXES` holds all six openings
  frozen, so the writer and the recogniser read one constant. Both sentences were
  also rewritten: each was composed once and re-read on every later call of the
  turn, which made their present-tense clauses predictions.

- **Three trace-toolpack results said "this call" and "right now".** They are
  anchored to the call they answer, in the past tense — including the one arm the
  new deictic-container rule caught the first time it was ever composed.

- **`escalation` counts three kinds of refusal, and its docs named two.**
  "Reachability OR posture" is wrong in the JSDoc behind `EscalationPolicy` and
  `SkillGraphOptions`, in the `skill.escalated` payload doc and on the skills page:
  the counter fires beside all three `skill.rejected` emit sites, self-call
  included. No behaviour changed — the self-call site has counted since 9.84.0,
  deliberately.

### Added

- **A WALK over every `role: 'user'` construction site in `src/`.**
  `test/lib/injection-engine/userTurnProducers.test.ts` parses the tree with the
  TypeScript compiler (a `PropertyAssignment` of `role: 'user'`, so type members
  and comments quoting the string are not counted) and requires every site to be
  classified as an authored frame, a person's own words, or never-in-history, each
  with a written reason. **Thirty-five** sites are classified today: six authored
  frames, seven person, twenty-two never-in-history. Sites are keyed by file with
  the per-file COUNT asserted, so a new producer inside an already-listed file
  fails as loudly as one in a new file. One producer the parser cannot see — the
  message an injection delivers, whose role is copied off the `Injection` — is
  named in the header and pinned by its `injectedBy` marker instead.

- **The model-facing checker judges SHAPE, not just remembered wordings.** Four
  new rules: a present-tense copula with a capability noun, deictic-present
  adverbs, second-person effect verbs, and a standing imperative at a clause
  start. Fifteen plausible forward-looking sentences were written out and put
  to the rules: "You are currently in 'alpha'", "Calling read_skill switches you
  to beta", "The following tools are available to you: …", "Nothing is live in
  this scope at the moment". All fifteen are caught by the rules as they stand,
  and the suite asserts exactly that. **Thirteen** of them passed against the
  rule list AS IT STOOD BEFORE THIS RELEASE — the number that motivated the
  work, measured once against a list this tree no longer contains, so it is a
  record of why the rules changed rather than something a run here can
  reproduce. `exemptBecause` is now structurally
  required: `BannedClause` is a discriminated union, and because the root
  `tsconfig.json` excludes `test/`, that is proven where it can actually be
  compiled — `test/type-regressions/`.

- **A WALK over every sentence-shaped literal in `src/`.** The registry's own
  header used to say the gap it could not close was "a scan of `src/` … and this
  is not that". `test/modelFacingScan.test.ts` is that: it parses every `.ts` file
  under `src/` with the TypeScript compiler, folds `+` chains and template holes,
  runs each literal through the rules at the persistent lifetime, and fails with
  `file:line` unless the file's flagged literals are accounted for in a ledger of
  **eighty-four files / one hundred and sixty-three literals**, every entry naming
  where the string is delivered and how many literals it covers. Per-file counts
  are the guard again. Four things it cannot see are stated in its header rather
  than left to be found: a sentence assembled across statements, text that lives
  in data rather than in `src/`, literals under twenty-five characters, and any
  falsehood that avoids all the shapes.

  Its ledger carries an `unrepaired` bucket of **thirty-three** literals across
  thirteen entries that are model-facing, persistent and correctly caught, and
  that were left alone because each needs its own tests. They are named with their
  delivery site, so the bucket is a work list rather than a pardon. The bucket's
  arithmetic is asserted by the suite itself — the counts above come from a run,
  not from a report, which is the failure this whole entry is about.

- **Five live producers are registered and read.** The `read_skill` refusal
  composer (every arm), `unknownToolResult`, the trace toolpack's inspection
  results, and — closing the gap 9.85.0's registry named — the wrap-up and
  stepped-skill frames at a shared `INJECTED_TURN` surface.

- **The offer/dispatch cross iterates its source list whole.** `frameworkCases()`
  re-derived a source list inside the walk —
  `CLAIMANTS.filter((c) => ['static', 'provider', 'skill-active'].includes(c.id))`
  — so a second hand-written list of sources existed with nothing keeping it in
  sync with the first, and 9.85.0's "crosses every source" was false. That mattered
  because the framework's four auto-attach reservations each read a DIFFERENT
  build-time list, so which source holds a contested name is precisely what decides
  whether a reservation can see it. The walk goes from **sixty configurations to
  seventy-six** and from **thirty-six divergence rows to forty-six**; all ten new
  rows carry a hand-written, checked `tolerated`. Three new tests own what was
  previously true only because somebody had typed it: that every claimant is
  crossed against every auto-attach name, that the header's arithmetic equals the
  recorded case count, and that a placeholder `tolerated` is refused (empty,
  `todo`/`tbd`/`fixme`/`xxx` on a word boundary in any case, or under forty
  characters — a floor on effort, not a measure of truth).

  Four of the ten reach seams the 9.85.0 baseline already recorded, through a
  source that had never been crossed, and say so. Six record two defects nobody
  had recorded — four rows for entry 4 and two for entry 5 of
  `docs/design/2026-09-recorded-not-built.md` — rather than papering over them
  (_corrected in 9.86.1: this paragraph said "eight of the ten" and "two", a
  count of defects presented as a count of rows_): `.selfExplain()` reserves its trace-tool names against
  `this.registry` and never `this.injectionList`, making it the one auto-attach
  family with no net at all against a skill's `tools: []`; and the misattributed
  shadow report can now name a `skill-scoped:self-explain` provider — one the
  consumer did not write and cannot open — as the file to go look at.

- **`report-misattributed` rows carry their attribution in the row id.** A shadow
  event's meaning lives in its `schemaFromId`/`dispatchToId`, and the row was keyed
  on case + tool + epoch, so two reports naming different sources in one epoch — a
  strictly worse fact than one wrong report — collapsed into one `Map` entry and
  vanished. The `reported` column of every row now carries the `*Id` halves too
  (`schemaFrom=provider(static) dispatchTo=skill(desk-active)`), which is why nine
  rows whose ids did not move changed body in the same re-record (_added in
  9.86.1; the re-record changed a compared field and the entry did not say so_).

- **`SkillRejectedPayload.allowed` is what the model was actually told.** Role-
  filtered rather than the graph's raw set. Shape unchanged; only agents with a
  `PermissionChecker` governing `'skill_read'` see any difference. The field's own
  JSDoc says so at the call site, which is the doc a consumer actually reads.

- **`ToolRegistryArtifacts.toolDeclaringSkills`** (internal — `ToolRegistryArtifacts`
  is not exported from any door; _corrected in 9.86.1_) — tool name → the ids of the
  skills whose `inject.tools` carry it, recorded on the walk `buildToolRegistry`
  was already doing and thrown away. Empty for an agent whose skills carry no
  tools. Its one consumer is the unknown-tool roster's role filter; it exists so
  that consumer does not walk `Agent.injections` a second time to re-derive what
  this file already knew.

- **`ToolEffectPayload.stay?: true`** on `agentfootprint.tools.effect` — a
  `propose-transition` naming the cursor's own skill is accepted as a no-op.
  Deliberately not a fourth `outcome`, so an exhaustive consumer switch keeps
  compiling.

- **`AgentState.hiddenSkillIds?: readonly string[]`** (internal — `AgentState` is
  not exported from any door; _corrected in 9.86.1_) — the per-iteration
  role-hidden set, written by the tools slot and read by the `read_skill` gate.

- **`ReadSkillOffer.treeRouted?: boolean`** — declares the mounted graph a decision
  tree, which is what lets the descriptor withhold the offer.

### Two decisions worth stating plainly

- **A self-call at a MOUNTED cursor is answered BEFORE the permission gate**, because
  it exercises no capability. `read_skill` naming the cursor's own skill activates
  nothing and moves nothing, so there is no grant for a `PermissionChecker` to make or
  withhold; asking it produced a denial about the one skill whose body was already in
  that call's system prompt. The skip stops at a PARKED cursor, and deliberately: a
  park suppresses a map's contribution without moving the cursor, so the gate below
  reads the same id as a RE-ENGAGEMENT and puts the body and its tools back on the
  wire — which is a capability, and the policy's question to answer. One predicate,
  `atMountedCursor`, is what both gates ask. Every other id still goes to the policy.
  The refusal BUDGET is
  unchanged and still counts the self-call, including the `surfaceMode: 'both'`
  re-read that returns the body — the 9.84.0 argument stands, and it is about the
  loop rather than about the wording: a model that keeps asking the graph where it
  stands instead of working is exactly the stuck run escalation exists for.

- **A `propose-transition` naming the cursor's own skill is a STAY**, accepted as a
  no-op with `stay: true` on the event and no refusal on the result. The tool asked
  for a state the run is already in; there is nothing to move and nothing to refuse.

### Deliberately not changed

- **The three `STATED:` prose pins** in `src/core/agent/buildToolRegistry.ts` are
  untouched, word for word. `test/core/agent/epoch-laws.test.ts` and
  `test/core/agent/toolDivergenceWalk.test.ts` both read them.
- **The escalation budget still counts `'both'`-mode self-call re-reads**, per the
  argument above.
- **The grounding gate** — item 5 of the "Offer, Not Dispatch" review — is a new
  DIAL, not a fix for anything here, and is not in this release.
- **The flat default is not narrowed.** `scopeTools` stays `false` until 10.0.0.
- **`isLibraryAuthoredTurn`** (the evidence gate's exempt corpus) is deliberately
  narrower than `isSaidByPerson` and was not widened to the two new frames. It
  decides who SUPPLIED a value, not who wrote a turn; widening it would change which
  values the evidence gate exempts, with no finding behind it.

### Changelog corrections

A reader auditing this project by its changelog has to be able to trust the older
entries, so six sentences in 9.84.0 and 9.85.0 are corrected in place, each marked
where it stands:

- **9.84.0** — _"Five classes of `role: 'user'` message"_: seven kinds are
  library-authored; the wrap-up instruction and the stepped-skill nudge went
  unregistered until this release.
- **9.84.0** — _"The window's own refusal engine has always applied that rule"_: it
  applied a three-class version, and 9.84.0 widened it to five.
- **9.84.0** — _"a step or park hold-out says the tools were withheld rather than
  naming them"_: the withheld arm names the declared tools, and a parked cursor
  never reaches the notice at all.
- **9.85.0** — the fifth _"model-facing sentence"_ bullet credited 9.85.0 with a
  `read_skill` description fix that shipped in 9.84.0, and quoted a sentence that
  existed only in a source comment. Removed, with the reason left in its place; the
  count above it is now four.
- **9.85.0** — _"drives a real run per configuration. Sixty configurations,
  thirty-six divergences"_: forty of seventy-six are driven, twenty-six are refused
  at build and ten are not constructible; the enumeration it replaced was a
  development draft, never a shipped list.
- **9.85.0** — law 1 was restated unscoped. It is scoped to the tools
  `buildToolRegistry` routes, with the shadow seam and the walk as its recorded
  exceptions.

## [9.85.0] - 2026-09-04

A sentence composed once and read many times is not a fact — it is a prediction.

9.84.0 fixed one such sentence and shipped a checker for the class. The checker
covered two surfaces. Five more sentences matching its own existing rule were
live elsewhere in the tree, unread by it, because coverage was decided by which
suite happened to import the helper. That is the same defect one level up: a
guard asserting a boundary it cannot verify.

### Fixed

- **Four model-facing sentences that outlive the moment they were true.** Each is
  now anchored to one named call, in the past tense, after tracing it to its
  delivery point to confirm it really is re-read:

  - `artifacts/present.ts` and `artifacts/wants.ts` — _"Nothing is live in this
    run's scope right now"_ and its sibling inventory, _"Live refs in scope: …"_.
    A census goes wrong in BOTH directions on re-read: entries sweep, new ones
    appear.
  - `core/codeRunnerTool.ts` — _"staged into this session"_. The anchor resolves,
    and goes on resolving; the defect is that it resolves to a scope holding many
    calls, so a per-call report cannot say which call it describes.
  - `maps/engagement/parkCard.ts` — _"Its instructions and its tools are not being
    sent right now"_, on a card that rides every call while a map is parked. Its
    falsifier is compose order, not staleness: the card is written in the
    injection-engine pass and the tools slot that acts on the park runs after it.

  _Corrected in 9.86.0._ A fifth bullet stood here, crediting 9.85.0 with the
  `read_skill` description fix and quoting _"You do not need read_skill to go on
  using it"_ as a wording it had replaced. `skillToolDescriptors.ts` has no
  non-comment change between `v9.84.0` and `v9.85.0`: that fix shipped in 9.84.0,
  where it is also recorded, and the quoted sentence lived only inside a source
  comment — no release ever put it on the wire. What 9.85.0 added to that file is
  the LENS LAW block above `describeOffer`, which is a Documentation change.

### Added

- **Surfaces carry `channel` and `lifetime` separately.** Where a string is
  delivered and how long it lives do not correlate: system text is rebuilt every
  request, so a present-tense clause in it is a fact; a tool result persists, so
  the same clause is a forecast. The rules judge lifetime. Both existing
  exemptions turned out to be lifetime claims wearing channel clothes and are now
  derivable rather than asserted.

- **A producer registry that fails when a surface is not exercised.** Coverage
  decided by which suite imports a helper is a habit, not a guarantee. Its header
  states what a green run does not prove: hand-maintained rows cannot see a
  producer nobody registered.

- **The offer/dispatch divergence list is walked, not written.**
  `test/core/agent/toolDivergenceWalk.test.ts` crosses every source that can put
  a name on the wire or answer to one — static, provider, MCP, always-on skill,
  active skill, inactive skill, stepped skill — against six narrowing states and
  the framework's auto-attach names. _Corrected in 9.86.0:_ at 9.85.0 the
  auto-attach cross did NOT reach every source — it filtered `CLAIMANTS` down to
  three of the seven — and the walk does not drive a real run per configuration.
  Both are true of the walk as it stands after 9.86.0 widened it, with these
  counts. Of its **seventy-six** configurations, **forty** are driven
  as real runs (thirty-six divergent, four clean), **twenty-six** are refused at
  build — which is the walk exercising a refusal, and its `because` records the
  refusal's first line — and **ten** are not constructible at all, so no run is
  attempted. **Forty-six** divergence rows come out of the forty driven, each
  with a mechanically derived cause and a stated reason it is tolerated. New
  fails. Disappeared fails. Vacuous fails, and is unbaselineable.

  It replaced a hand-written enumeration that claimed completeness and was
  falsified three rounds running — _corrected in 9.86.0:_ that enumeration was
  drafted and falsified during this work, and no released version ever carried
  it, so the walk shipped in place of a draft rather than of a shipped list.

  It then found three classes nobody seeded: a
  provider tool whose name a registry holder already owns is dead in both
  directions and the shadow report cannot see it; the auto-attach names disagree
  about what they refuse; and `selfExplain` is a fourth family whose reservation
  reads only the static registry.

### Documentation

- **Three laws stated where the code lives**, epoch-scoped, after two earlier
  phrasings were false in shipped configurations. Law 1, as the source states it
  and _corrected here in 9.86.0_, is SCOPED: **among the tools `buildToolRegistry`
  routes**, every offered capability resolves to a dispatchable implementation
  with stable identity for that epoch — same-epoch offer implies same-epoch
  dispatch. It is not a claim about the whole wire, and the source names its
  recorded exceptions rather than implying there are none: the SHADOW SEAM (the
  wire list is merged one layer out in `buildToolsSlot` and carries provider
  schemas these maps never hold), with the full enumeration delegated to
  `test/core/agent/toolDivergenceWalk.test.ts`. The second clause is unscoped and
  unchanged: attention may alter the offer, but omission from the offer must not
  be presented as proof of permanent capability loss. Only static skill-registry
  tools are known to remain dispatchable after leaving the offer.

- **`docs/design/2026-09-recorded-not-built.md`** — three real defects with
  reproductions, deliberately not fixed: an inactive skill's tool shadows in
  silence, the shadow report names the wrong source, and `skip_step` is
  claimable by a provider. Each names what deciding to fix it would cost.

## [9.84.0] - 2026-09-03

### Fixed

- **`read_skill` refused the skill the model was already in.** A turn routed
  decisively to `X`, the model called `read_skill("X")` to find out where it
  stood, and the gate answered _"`read_skill("X")` is not reachable from here.
  Reachable skills: …"_ — about the one skill whose body was in that call's
  system prompt and whose tools were in that same call's tool list. The cursor
  is in neither half of `hops ∪ open` by construction: `makeReachableSkills`
  filters it out of its own successor set (a move to where you already are is
  not a move) and `openSkillIds()` excludes every graph-wired skill. Nobody had
  written the case for _"you asked for the room you are standing in."_ Read as a
  claim about AVAILABILITY — which is how a model reads _"not reachable"_ — it
  says the opposite of the request it arrived in. A field report recorded the
  consequence three times in one day: the model concluded its capability was
  gone and answered that it could not help, while the skill's tools sat on the
  wire, loaded and callable.

  A self-call now gets the truth instead of a refusal. It names where the model
  stands and which tools it could call, taken from the merged wire list the LLM
  stage actually sent, intersected with the skill's own declared tools — never
  from the declaration alone. Every configuration that would make that false has
  its own wording: a skill declaring no tools says so, a hold-out names the
  declared tools and states that they were withheld — _corrected in 9.86.0:_ this
  read "a step or park hold-out says the tools were withheld rather than naming
  them", and the withheld arm does name them; a PARK never reaches the notice at
  all, because a self-call at a parked map member is a re-engagement request
  (9.59.0) answered on an earlier arm — and a call whose wire cannot be
  established says nothing about tools at all. Mechanically it is still
  a rejection — no activation, no cursor move, and the refusal budget still
  counts it, because a self-call _loop_ is exactly the stuck model that budget
  exists to escalate.

  **Every clause is anchored to one named call.** A tool result is composed on
  one iteration and re-read on every call after it, including the out-of-budget
  wrap-up that carries no tools under _"Do not request tools."_ So the notice
  makes no forward-looking claim at all: no exhortation to act, no offer of a
  move, no clause conditioned on a budget or a posture that can change after the
  sentence is written. Deixis counts as forward-looking — _"the call you just
  made"_ denotes a different call on each re-read, so the anchor is named once
  in the opening sentence and every later clause refers back to it.

- **The `read_skill` description said the same thing in the other channel.** The
  current skill was listed under _"Not reachable from here (read_skill for these
  will be refused)"_, where it appeared purely as an artefact of that same
  filter. It is in neither column now, and the description names the cursor on
  every call that has one — the positive signal whose absence was the root of the
  field failure, since the system prompt carried the skill's body with nothing
  saying which skill it was. A genuinely unreachable skill is still named there,
  and a genuinely unreachable hop keeps its refusal word for word.

- **The description no longer predicts what `read_skill` will do.** Naming the
  cursor is the fix; every sentence tried alongside it turned out false
  somewhere. _"read_skill MOVES you to a DIFFERENT skill"_ is false at compose
  time under `strictness: 'rails'` (every model hop refused) and under `'guard'`
  off an outstanding menu, where the posture arm contradicts it head-on. Its
  replacement — _"You do not need read_skill to go on using it"_ — was argued to
  be a claim about necessity that no posture, budget or hold-out could falsify,
  and the **park** falsifies it: a parked map member keeps the cursor, loses its
  body and its tools, and `read_skill` is then the only door back. The
  description is composed before the hold-outs run, so it cannot know when such a
  claim would be lying. Outside an outstanding menu it now states the name and
  stops. The menu's stay clause is unchanged.

- **Role visibility now covers the cursor.** The description read the cursor id
  past the `hiddenIds` filter, so a role denied `skill_read` on the skill the
  graph had routed to was still told _"You are in '\<that skill\>'"_ — leaking
  the name of a capability no cursor move would ever grant it. A hidden cursor is
  named nowhere: not as reachable, not as refusable, not as the cursor, and not
  in the menu's stay clause. The security suite's _"a hidden skill is never
  named"_ property is now driven on the `.skillGraph()` path as well as
  `.skill()`; it stayed green through the leak because its agents used `.skill()`
  only, so the leaking line never executed.

### Added

- **`saidByPerson(ctx)` / `isSaidByPerson(msg)` — telling what a person said from
  what the library wrote.** _Corrected in 9.86.0:_ this said "five classes", and
  **seven** kinds of `role: 'user'` message are authored by this library, not by a
  person. Five are registered here: the compaction frame, the drop notice (whose
  text names tools), the schema-check and evidence-check corrections, and any
  injection-delivered message. The out-of-budget wrap-up instruction and the
  stepped-skill nudge were library-authored the whole time and went unregistered
  until 9.86.0. _Also corrected:_ the window's own refusal engine had not "always
  applied that rule" — it applied a THREE-class version (drop notice, compaction
  frame, injection-delivered), and 9.84.0 widened it to the five registered here,
  so a schema-check or evidence-check frame can no longer become the protected
  anchor. That widening changes the anchor only when the run's own message text is
  absent from the window, because the anchor is matched by content first and only
  falls back to the last thing a person said. A `when` predicate could apply no
  version of it, because `InjectionContext.history` exposes only
  `{ role, content, toolName? }`. An author writing an entry rule
  that reads history was silently matching on our own bookkeeping. One
  implementation, reused by both — the rule cannot drift between routing and the
  window.

- **`SkillRejectedPayload.reason`** — `'self-call' | 'unreachable' | 'posture'`,
  optional and additive, so a consumer can tell a self-call from a genuine
  unreachable hop without comparing two fields.

### Documentation

- **`strictness` says what a posture governs, exactly.** A posture governs the
  model's `read_skill` door and nothing else. Two doors stay open under all three
  postures: OPEN skills, already stated, and a tool's `propose-transition`, now
  stated with its reason and its reachability check. `'rails'` means _the model
  never routes_ — never _"nothing but my declared edges routes"_; a tool of yours
  that proposes is a route you declared in code instead of in the graph. No
  behaviour changed: the exemption is recorded in three places and pinned by a
  test whose title is the argument.

- **The injection-engine README's runtime picture matched an older engine.** Its
  diagram drew one box that "evaluates triggers"; the engine is a four-stage
  footprintjs subflow — Gather, Evaluate, Route, Delta — and the cursor, the step
  pointer, the instruction leases and map engagement all advance inside Evaluate.
  The events table placed `context.evaluated` at subflow exit; the code emits it
  in stage 2 of 4. Both corrected, along with three counts that had drifted.

## [9.83.0] - 2026-09-03

### Fixed

- **The evidence gate claimed a boundary it did not measure.** Both of its
  user-facing sentences — the correction it sends the model
  (`buildEvidenceCorrection`) and the warning it prints an operator
  (`evidenceRefusalSentence`) — said the flagged values _"appear in NO tool
  result **from this turn**"_. The index behind them has never been turn-scoped:
  it walks every `role: 'tool'` turn in the history. The library was asserting a
  scope it could not honour, in the two places that assertion is read.

  Both now say what the check really reaches — _"appear in no tool result this
  run read"_ — which is both true and the stronger claim, and the operator
  sentence adds the two facts a reader needs: that the corpus is the LIVE
  WINDOW (a window strategy rewrites `scope.history` in place, so a dropped
  result is not in it), and that `noticePriorTurnEvidence` is what answers the
  recency question. The frame PREFIX is unchanged, so
  `isLibraryAuthoredTurn` and every consumer matching on it are untouched.

### Added

- **`noticePriorTurnEvidence` — the answer is grounded, and nothing this turn
  fetched grounds it.** Default off.

  The measured failure: a consumer's agent answered a data question with **zero
  tool calls**, and the gate approved it — `LLM calls 1 · Tool calls 0 ·
Iterations 1`, then _"All 7 values in the answer were found in what the tools
  returned — the answer stands."_ They were found: in an inventory result from
  four turns earlier, fetched for a different question. The user had asked about
  array performance; the answer recommended enabling a collector that had been
  running for months. Two turns did it back to back. Every rail passed honestly
  — the gate measures GROUNDEDNESS and had no notion of WHEN a value was
  grounded.

  Every indexed form now carries the turn that last served it — one number,
  stamped during the walk the index was already doing (`EvidenceCorpus.values`
  became a `Map<form, turn>`; a TURN starts at each `role: 'user'` message the
  library did not author). When at least one value in the answer is grounded and
  **not one of them** came from the turn being answered, one `advisory` finding
  is filed at the claim seam:

  ```ts
  const agent = Agent.create({ provider, model, noticePriorTurnEvidence: true })
    .tool(arrayInventory)
    .namesAndNumbersFromEvidence() // ← the other half: it owns the extractor
    .build();

  await agent.run('what arrays are there?'); // fetches, answers, files nothing
  await agent.followUp('how is array performance?'); // no tool call, answers from turn 1
  // → prior-turn-evidence: 3 grounded value(s), all last served in turn 1,
  //   and this turn called no tool at all.
  ```

  **The corpus is deliberately NOT narrowed to this turn.** That would have made
  the old sentence true and been the wrong fix: _"and what about that disk?"_
  leans on the previous turn's rows legitimately, and a check that cries wolf is
  a check somebody switches off. ONE grounded value from this turn's own results
  files nothing — not a threshold to tune, but the falsification of the claim
  being tested. A follow-up that calls a tool usually gets that for free,
  because a lookup keyed on an earlier identifier echoes it back.

  A turn that served no tool results at all is the SAME finding with a stronger
  witness, not a second kind: it is a cheaper proof of the identical fact.

  **The ceiling** ships as `PRIOR_TURN_EVIDENCE_CEILING`, exported and quoted
  verbatim into every message: referring back is indistinguishable, by evidence
  alone, from going stale; the ordinals count only the turns still in the live
  window, so the distance is a FLOOR (the boundary itself is exact — the
  current request is un-droppable); and values that reached the model through
  `.memory()` recall or RAG are exempt from grounding and invisible to it, so it
  can under-report and never over-report.

  **Two halves arm it**, and the second is structural rather than a policy
  companion: the dial AND `.namesAndNumbersFromEvidence()`, whose extractor
  decides which tokens in an answer are values at all. It REPORTS — whether an
  answer is advised or refused stays the gate's own `posture` decision, and
  nothing here blocks, revises or rewrites anything. Absent, a run is
  byte-identical save the registered `prior-turn-evidence` row filed
  `not-applicable`, which is the family's law rather than an exception to it.

  Three terminal exits reach a caller without the gate ever producing a
  grounding reading — an empty answer, a middleware denial, and an answer the
  output schema rejected — and each files its disposition rather than leaving
  the armed row untouched. An untouched armed row is what `assertAlive` reads
  as wiring rot, so without this an empty answer under
  `integrityPosture: 'dev'` would have failed a healthy run with
  `CheckerDeadError`.

  Docs: [Prior-turn evidence](https://agentfootprint.dev/docs/monitor/prior-turn-evidence).

## [9.82.0] - 2026-08-30

### Added

- **A runbook can finally name the verdict no rule chose.** `verdict_meanings`
  is generated from what the run itself said: the branch descriptions the chart
  declared, and the rule labels this run's `decide()` evidence carried. For one
  branch, both sources are silent by construction — the DEFAULT. It is the
  branch chosen by _no rule_ (it fires exactly when every rule failed, so no
  `label` describes it), and when the decider lives inside a dynamically
  generated fan-out branch the branch chart does not exist at build time either,
  so there is no declared description to fall back on.

  The library shipped visible proof of the gap: this repo's own worked example
  and the published docs page showed a `"verdict": "protected"` row beside a
  `verdict_meanings` map with no `protected` key.

  The meaning is now declared where the rules are declared — one line at the
  `decide()` call, on `footprintjs` ≥ 9.16.0:

  ```ts
  // before
  decide(scope, POSTURE_RULES, 'protected');
  // after
  decide(scope, POSTURE_RULES, {
    branch: 'protected',
    label: 'no rule fired — last backup within the 7-day threshold',
  });
  ```

  It rides `DecisionEvidence.defaultLabel` and is harvested exactly like a rule
  label — on every decision, including runs where a rule won, so a published
  meanings map does not gain and lose a key with the day's data.

  What deliberately did NOT change: there is **no caller-supplied meanings map**
  at the tool boundary. A map a caller can hand in is a map that can describe
  rules that never ran, and it would be indistinguishable in the answer from
  meanings the run produced. Declare nothing and `verdict_meanings` stays
  honestly silent about that branch — the bridge never invents a sentence from a
  branch id. A blank label (`''`) is recorded as no meaning at all, for a rule or
  for the default.

  Example: `examples/features/68-runbook-as-tool.ts` — its `verdict_meanings`
  now explains every verdict its own rowset shows.

### Changed

- **`footprintjs` peer dependency: `^9.15.0` → `^9.16.1`** — 9.16.0 carries
  `DefaultBranch` / `DecisionEvidence.defaultLabel`; 9.16.1 is the floor because
  9.16.0 threw on a `decide()` call that omits its default (this repo's own
  suite caught it).
- **The engine version stamp on a recording envelope is real again.** footprintjs
  9.15.1 added `'./package.json'` to its `exports` map, so `engineVersion()` can
  resolve the manifest it always tried to read: `producer.footprintjsVersion` and
  a bug report's `environment.footprintjs` now carry the installed version
  instead of the honest-but-useless `'unknown'`. The test that pinned the defect
  (and asked to be tripped when it was fixed) now pins the version instead.

## [9.81.0] - 2026-08-30

### Added

- **MCP from a browser — because the barrier was never the protocol, it was one
  line of ours.** `mcpClient` loads `@modelcontextprotocol/sdk` through a Node
  `require` loader, and that loader does not exist in a browser bundle. The SDK
  itself is fine: its `client/index.js` and `client/streamableHttp.js` bundle at
  `platform: 'browser'` with **zero** `node:` edges and never pull in
  `client/stdio.js`. So the fix is not to reimplement anything — it is to let the
  caller supply what the library would otherwise have loaded.

  **`sdk?: McpSdk`** — hand over the two SDK modules, imported statically by your
  own bundler, and the library **still builds the transport**. Everything the
  transport carries keeps working: `headers`, your own `fetch`, gateway
  vending, `retryOnThrottle`, `_meta` ingestion.

  ```ts
  import { Client } from '@modelcontextprotocol/sdk/client/index.js';
  import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
  import { mcpClient } from 'agentfootprint/providers';

  const sidecar = await mcpClient({
    name: 'sidecar',
    sdk: { Client, StreamableHTTPClientTransport },
    transport: { transport: 'http', url: '/py/mcp' },
  });
  const tools = await sidecar.tools(); // the same readonly Tool[], _meta and all
  ```

  **`connection?: McpConnection`** — the full escape hatch: you connect the
  client, the library only adapts its tools. Three methods over JSON-RPC and no
  vendor named, so an SDK `Client`, a fake, or a future fetch-only transport all
  satisfy it. `connect()` is deliberately **absent** from the type: you already
  connected it, and the library never calls it. Reach for this when the library
  must not construct anything — a strict CSP, where the SDK's own
  `jsonSchemaValidator` (reachable only here) is what keeps ajv's `new Function`
  off the page.

  **The refusals are the design.** On the `connection` arm the library builds no
  transport, so every option consumed INSIDE one is refused at construction,
  naming where the behaviour went — `retryOnThrottle`, `clientInfo`, `transport`,
  `sdk`, `_client`. Accepting a knob that names a behaviour which no longer
  happens is the defect class this release exists to close, not a convenience.
  `signal` IS honoured on both arms: it rides the SDK's request options.

- **`retryingFetch` is public** (`agentfootprint/providers`), with
  `ThrottleFetch`. It was `@internal`, and on the `connection` arm — the one a
  browser takes — a caller would otherwise have silently lost the HTTP 429
  handling every Node consumer gets ON by default. Same implementation, applied
  where you build the transport: `fetch: retryingFetch(yourFetch, { maxAttempts: 5 })`.

### Fixed

- **A relative `transport.url` resolves against the page.** `new URL('/py/mcp')`
  throws `TypeError: Invalid URL` — correct in Node, wrong in a browser, where a
  same-origin path is the ordinary way to reach a sidecar (and the way to avoid a
  CORS preflight entirely). It now resolves against `globalThis.location.href`
  when there is one, and in Node refuses **by name**, saying which world it is in
  and to pass an absolute URL. An absolute url takes the identical first branch,
  so Node behaviour has not moved.

- **The SDK-load errors stop lying.** Every load sat behind a bare `catch`, which
  cannot tell "the package is absent" from "the LOADER is absent" — so a browser
  that had the SDK installed all along was told to `npm install` it, and nothing
  changed when it did. The failure is now classified at all seven sites (three in
  `mcpClient`, four in `mcpServe`): a resolution failure produces the
  **byte-identical** message every release before this one produced, and anything
  else names the underlying error and the seam that gets past it. `mcpServe` says
  the honest thing instead — it listens on stdio or a Node socket, so that
  direction cannot run in a browser at all.

### Unchanged, deliberately

- **Zero packaging change.** No new subpath, no `browser` export condition (a
  compiler is blind to it), no `typesVersions` row, no `postbuild-esm.mjs` edit.
  `@modelcontextprotocol/sdk` stays an OPTIONAL peer, and there is no literal
  dynamic `import()` of it anywhere — one would be statically resolved by a
  bundler and would hard-fail the build for every consumer who does not have it.

- **Every existing Node consumer.** A call with neither `sdk` nor `connection`
  reaches the same `lazyRequire` on the same specifiers and builds the same
  transport; the difference is a `??` on an `undefined` parameter. `stdio` keeps
  the loader permanently — it spawns a subprocess, so it can never be portable,
  and keeping it there is what keeps the SDK's one Node-importing client module
  off every browser graph.

### Proof, and its limits

`test/lib/mcp/browserGraph.test.ts` bundles the SHIPPED `dist/` the way a browser
build does and asserts: `agentfootprint/providers` still bundles with the MCP SDK
**blocked at resolve time** (the optional-peer property, stated as a build); its
`node:` edges are EXACTLY the two known ones; the builtins hidden behind
`lazyRequire` — which no module graph can see — are exactly the four known ones;
the path a browser walks reaches `node:module` and nothing else and never pulls
in `client/stdio.js`; and everything on that path except the loader bundles with
NO externals and zero node edges. `mcpConnection.real.test.ts` drives both new
arms through a real socket against the real SDK.

**What none of that proves: a browser.** This repo has no browser test
environment, so nobody has yet driven initialize/listTools/callTool from an
actual page. The honest status is _proven in Node, fenced at the graph, not gated
in a browser._ Three costs land on the app, not here: your server must send CORS
headers (every MCP request preflights, and `Mcp-Session-Id` must be in
`Access-Control-Expose-Headers`) — `mcpServe` sends none; SSE through a dev or
production proxy is unproven; and the SDK's client path adds roughly 260 KB
minified, about half of it ajv, whose `new Function` needs `unsafe-eval` the
first time a tool with an `outputSchema` is validated.

## [9.80.0] - 2026-08-30

### Added

- **`presentation` on `runbookAsTool` — a rowset's surface is a fact about the
  CLIENT, and the caller is the only one who knows it.** Seen in production: a
  triage answer opened with a wall of pipe-delimited rows — the entire verdict
  table retyped into the prose — while those same rows were already on screen
  beside it, ticketed as a dataset with a table view and a chart view. The host
  had a standing rule against exactly that. The library was overruling it.

  The instruction was ours. Every verdict projection shipped `table`
  pre-rendered with `VERDICT_RENDER_NOTE`: _"table is PRE-RENDERED over the
  same rows as `verdicts` — output it VERBATIM."_ That note is RIGHT wherever
  the model's words are the rows' only surface — a chat client, a log line, an
  email — because the alternative there is retyping, and a retyped identifier
  that looks right and matches nothing is the failure the note exists to stop.
  It is WRONG in a client that draws the rowset itself: the retype buys
  nothing, runs the same transcription risk, and lands a second, subtly
  different copy of the table beside the real one.

  Nothing in a chart, a `resultKind` or a rule set says whether a human will
  read these rows in prose or in a grid — the bridge cannot know which client
  it is in. So the caller says, in one word:

  ```ts
  runbookAsTool({ /* … */ presentation: 'panel' }); // default: 'prose'
  ```

  - **`'prose'` (the default)** — today's envelope, key for key: `table`
    pre-rendered over the shown rows, `render_note` = `VERDICT_RENDER_NOTE`.
    Every existing consumer is byte-identical, pinned by a test that asserts
    the whole `result` key list in order.
  - **`'panel'`** — the host renders the rowset, so the envelope omits `table`
    ENTIRELY (the key, not an empty string), and `render_note` becomes the new
    exported `PANEL_RENDER_NOTE`, which states the opposite law: the rows are
    already on the reader's screen; do not reproduce them in prose in any form
    — not as a table, not as bullets, not as one sentence per row; when a
    finding names a row, quote the evidence sentence that row carries VERBATIM,
    and cite only the values the finding rests on, copied byte-for-byte.

  `verdicts`, `rows_shown`, `rows_total`, `rows_complete` and
  `verdict_meanings` are identical across both modes for the same run — the
  dial names who RENDERS the rows, never which rows there are. `table` stays
  RESERVED in both modes, so a chart's `report` cannot put a table back into a
  panel answer: the mode's promise outranks the freed name. An unknown value
  THROWS at definition instead of falling back to `'prose'` — a mis-spelled
  dial that silently keeps working is a dial you cannot trust to have been set.

  **The ceiling, stated:** this changes what the envelope SHIPS, never what the
  model does with it. A note is an instruction, not an enforcement —
  `presentation: 'panel'` takes away the table the model was told to output; it
  cannot stop a model that decides to retype rows anyway. And it is silent
  about every other part of the answer: coverage, provenance, rule version and
  the walk are untouched in both modes.

  New exports beside `VERDICT_RENDER_NOTE`: **`PANEL_RENDER_NOTE`** and the
  **`RunbookPresentation`** (`'prose' | 'panel'`) type. Worked example:
  `examples/features/68-runbook-as-tool.ts` now registers the same procedure
  twice, one dial apart, and prints both surfaces. Docs: "Who renders the
  rowset" in `docs-next/content/docs/build/runbook-as-tool.mdx`.

## [9.79.0] - 2026-08-30

### Added

- **`walk: { recording }` — file the runbook's inner chart as a recording, so
  the walk can actually be DRAWN.** A consumer wired the flow components of
  the lens family to a runbook's answer and could not mount anything, and they
  were right not to try. `runbookAsTool` files its walk as
  `recording/chart-walk`, whose payload is a **row projection** — 129 rows of
  `{step, type, depth, stage, stage_id, runtime_stage_id, subflow, text}`. A
  step graph cannot be inferred from sentences about steps; a consumer handed
  those rows can only correctly REFUSE to guess at the edges. The one piece
  that makes a walk drawable is `structure`, the chart's build-time graph —
  which a finished run does not leave behind and no snapshot carries.

  Everything needed was already in the file, a few lines apart: the bridge
  builds a fresh inner executor and ATTACHES RECORDERS (the run was recorded,
  it simply was not filed), `recordingPutInput` was already the mint for the
  agent's own run, `mintWalk` was already the guarded side effect that files
  and never fails the answer, and `WalkDescriptor` was already where the spine
  states what it filed. This connects them.

  Declare `walk: { recording: true }` (or `{ label, maxBytes }`) and the inner
  chart's own **`{ snapshot, events, structure }`** — the `recordRun` contract
  exactly, the shape `observeRecording()` mounts — is filed under the existing
  kind `recording/run`, and its ref rides the SAME spine descriptor as
  `result.walk.recording_ref` beside `recording_kind`, `recording_bytes` and
  `recording_note`. The wire ops that already redeem the walk redeem this with
  **zero new operations**.

  **OPT-IN, and that is the honest default.** A walk carries _sentences about_
  what happened and no payload from it — values are off by construction
  (`narrative({ includeValues: false })`). A recording is the run: shared
  state, the whole commit log, every attached recorder's data — **whatever the
  chart wrote**. Filing one is a materially bigger promise, so it is declared,
  never begun on an operator's behalf. Unset, nothing extra runs — no second
  snapshot, no bytes measured, no store call — and the envelope is
  byte-identical to 9.78.0, pinned by a test that asserts no `recording_*` key
  exists at all. A reader who never asked for a recording does not even get a
  sentence explaining its absence.

  **Redaction means the same for both artifacts.** The recording's snapshot is
  read from the REDACTED MIRROR (`getSnapshot({ redact: true })`), never the
  raw working memory — so the `redact` policy that scrubs the walk scrubs the
  recording by the same rule at the same moment, and a redacted key travels as
  `REDACTED` rather than vanishing (a reader sees that a value existed and was
  scrubbed). With no policy configured the flag is a documented no-op.

  **Size has a declared failure mode, and it is a refusal.** Over
  `walk.recording.maxBytes` (default `DEFAULT_RECORDING_MAX_BYTES` =
  5,000,000 — a walk is tens of KB, this package's own measured `recordRun`
  bundle was 2.76 MB, a fleet sweep is unbounded) the recording is **not filed
  and not truncated**, and `recording_note` names what it measured, the
  ceiling it broke, and the option that raises it. The asymmetry with the
  walk's row cap is the point: walk rows are independently meaningful so a
  projection of them is still true, but `{ snapshot, events, structure }` is
  one bundle — half a commit log under a whole chart draws a picture nobody
  can check.

  **The absence is always SPOKEN.** No store, an over-size refusal, an
  unserializable snapshot, a store that threw — each costs the REF and lands a
  named reason in `recording_note`, following `mintWalk`'s own law. A missing
  ref with no sentence would leave a reader guessing, which is the one thing
  the spine exists to prevent.

  **`events` is empty by construction, and says so.** It is the typed
  _agentfootprint_ stream, fired by an agent turn; what ran here is a
  footprintjs chart on its own executor, which fires none. All three keys are
  present (that is what a viewer reads), the empty array is the honest count,
  and the note states it so nobody reads it as a dropped stream — the walk's
  own story rides `snapshot`, where the narrative recorder's data already
  lives.

- **`recordingPutInput` accepts `toolCallId`** — stamped on `origin.toolCallId`
  the way `chartWalkPutInput` already did. A walk and the recording it projects
  are two views of ONE tool call, so they carry the same join key, and either
  joins back to the call the model made. Absent for an agent's own run
  recording, which is a whole turn and belongs to no single call.

## [9.78.0] - 2026-08-30

### Added

- **`Tool.resultColumns` + `checkColumnTypes` — the column-type contract: a
  tool declares what its rows contain, and the library checks the rows against
  it at the boundary.** Three recorded failures, and they are one shape — _a
  number became something else, and nothing noticed at the seam_:

  1. A mapping report wrote `str(m.get("logical_unit_number") or "")`. **LUN 0
     is falsy**, so LUN 0 was stored as an EMPTY STRING on 2,094 mappings, and
     a host group missing the LUN an initiator probes first became
     indistinguishable from one that had it.
  2. A capacity view rendered `round(mib / 1024, 1)`, so an 8 MiB disk came out
     as `0.0 GB` — which reads as NO DISK, a provisioning failure, during a
     live incident.
  3. A whole family of tools returned their numbers as quoted strings
     (`"1240"`), which silently blanked every chart, because nothing downstream
     could tell a measure from a label.

  Every rail passed, honestly, in all three: nothing errored, nothing was
  ungrounded. The library already lets a tool declare what its result IS
  (`resultKind`, 9.70.0); it did not let a tool declare what its result
  CONTAINS, so a rowset had nothing to be wrong against — and every consumer
  downstream was left SNIFFING types out of the data, where one stray `''`
  demotes a numeric column to text in silence.

  `resultColumns` is the sibling declaration: a column-name → type map, on
  `Tool` beside `resultKind`. Types are `number` / `string` / `boolean` /
  `date` — **the vocabulary this ecosystem's rowset consumers already sniff
  their way to**, not a new one. The one word deliberately left behind is
  `'unknown'`: a sniffer needs it ("I could not tell"), a declaration has no
  use for it. A column maps to a bare word or to `{ type, nullable }` (the
  `CostBudget` two-spellings pattern, normalized once).

  **THE CEILING**, exported as `COLUMN_TYPE_CEILING` and quoted verbatim into
  every finding, the `EMPTY_LOOKUP_CEILING` law: _"This judges TYPE, never
  MEANING — it can see that a column declared `number` holds a string, and it
  can never see that the string should have been 0, or that a 0.0 should have
  been an 8; a column whose every value has its declared type passes here and
  can still be wrong."_ Failures 1 and 3 are caught. **Failure 2 is not, and
  never will be** — `0.0` is a perfectly good number — and the check says so
  out loud rather than letting a green row imply otherwise.

  **TWO finding kinds, because the field bug turned on the difference.** New
  `ContextErrorKind`s at the **write seam**: **`column-type-mismatch`** (the
  column is THERE and holds the wrong thing) and **`missing-column`** (the
  declared column is in NONE of the rows). _"The value is not what it should
  be"_ sends a person to the mapping code; _"the column was never delivered"_
  sends them to the query. A checker that said only "something is off with
  logical_unit_number" would have helped with neither. Each finding names the
  column, the offending value quoted, the rows affected of the rows read, and
  the tool.

  **OPEN, never closed.** A declaration is a promise about what it NAMES — an
  unlisted column is allowed and never judged. A closed schema would punish the
  wrong party the day a backend adds a column, and it is the rule the
  neighbouring boundary (`toolArgsValidation`) already keeps.

  **`nullable`, and what "no value" means.** `null`, `undefined` and a key not
  set on a row are one idea with three spellings, and by default all three are
  violations; `nullable: true` legitimizes them and every finding about an
  absence names that one-word fix in its own message. `nullable` is a promise
  about VALUES, not about the column's existence: a declared column in no row
  at all is `missing-column` regardless.

  **The dial: `AgentOptions.checkColumnTypes`, default `'off'`** —
  `'off'` | `'warn'` | `'enforce'`. **The three words are borrowed, not
  minted:** this boundary is the MIRROR of `toolArgsValidation` (arguments in,
  against `inputSchema`; rows out, against `resultColumns`), and two validators
  at one seam grading themselves in different vocabularies would be a worse
  defect than either could catch — so there is no new `assist`/`guard`/`rails`
  trio here and no new `observe`/`warn`/`refuse` one either. `'warn'` files
  findings and the model reads the rows **exactly** as the tool returned them.
  `'enforce'` REFUSES in the library's own refusal idiom — the `resultCeiling`
  teaching sentence ("…Fix the tool so the column holds what it declares, or
  change the declaration. No data was returned."), the whole payload on every
  channel, delivered status `'invalid'`, never a thrown stack trace.

  **What it refuses to judge** (`readRowset`): a result is read only when it is
  an ARRAY OF PLAIN OBJECTS with at least one row. Prose, a `null`, a bespoke
  `{ rows: [...] }` wrapper, a claim ticket — and the **zero-row** result,
  which has no columns to be wrong about and is `empty-lookup`'s subject next
  door — all file an explicit `not-applicable` ROW and no finding. Filing
  `missing-column` for every declared column of an empty answer would turn one
  honest emptiness into a pile of false accusations.

  **Armed by two halves**: the dial off `'off'` **and** at least one tool
  declaring `resultColumns`. Absent either, the run is byte-identical — no
  finding, no event, nothing on the wire, and a declaring tool with the dial
  off runs byte-for-byte the run it ran before the declaration existed. The one
  visible difference is the two registered rows in the disposition report,
  filed `not-applicable`: registered-but-unarmed is a ROW, never silence.

  **Travels MCP `_meta`** like the library's other tool declarations, both
  directions — a remote catalogue is exactly where a numeric column arriving as
  text goes unnoticed, and leaving the declaration behind would arm the check
  for local tools while leaving every MCP tool a second-class citizen of it. A
  malformed declaration from a foreign server is warned about once and dropped;
  the tool still registers.

  Exports: `COLUMN_TYPE_CEILING`, `COLUMN_TYPES`, `readRowset`,
  `assertResultColumns`, and the types `ColumnType`, `ColumnDeclaration`,
  `ToolResultColumns`, `ColumnCheckMode`, `ColumnViolation`, `RowsetReading`.
  Docs: `docs-next` → Monitor → Column Types, which also names the three
  existing consumers this declaration feeds (chart axis pickers that sniff, the
  panel deciding table-vs-chart by inference, and `compute` staging rows blind)
  — none of those integrations are built here, they are named so the next
  person does not add an eighth sniffer.

## [9.77.0] - 2026-08-29

### Added

- **`noticeEmptyLookups` — the run produced the identifier, and the lookup for
  it came back empty.** A triage agent's reverse-lookup tool filtered a column
  before a pivot, so the column did not exist yet and EVERY reverse lookup
  returned an empty result — for every identifier, always. The tool then
  answered _successfully_ with an empty list, and the agent reported in a
  table, with confidence, that the device was not logged in to any port on any
  collected switch, advising a check of the physical cabling. It was logged in
  the whole time. Every rail passed, and passed honestly: nothing errored,
  nothing was ungrounded, no coverage was overstated. **An empty result from a
  broken filter is byte-identical to an empty result from a genuine absence**,
  and nothing in the framework was responsible for noticing the difference.

  The library was already holding both halves of the answer, separately: that
  the identifier was GROUNDED (it came out of an earlier tool result in this
  run, from a tool the consumer's own author named in `Tool.argumentsFrom` —
  the same declaration that arms `dangling-reference` and
  `unsupported-argument`), and that the lookup keyed on it came back EMPTY.
  Joining them is the whole check: new `ContextErrorKind` **`empty-lookup`** at
  the **write seam**, filed at the tool-dispatch boundary — the one moment a
  lookup's answer becomes a fact in the conversation.

  **THE CEILING, and it is why this can never be an accusation.** An empty
  answer can be perfectly true; the device may exist and simply have no logins
  right now. Nothing here can tell those apart and nothing here pretends to, so
  every finding is an **`advisory: true`** and the IDENTICAL advisory is filed
  for the broken filter and for the honest absence. The bound ships as one
  exported string, `EMPTY_LOOKUP_CEILING`, quoted verbatim into every message
  so it cannot drift out of one doc and leave a reader thinking the library
  knows more than it does: _"An empty result can be perfectly true — the thing
  may exist and simply have nothing to show right now — so this is a place to
  look, never a verdict that anything is wrong."_

  Deliberately NOT `dangling-reference`, whose meaning is the opposite: there
  the ground has left reach; here the ground IS in reach and the lookup found
  nothing.

  **What counts as empty is COUNTED, never interpreted** (`readLookupResult`):
  an array with zero elements is a rowset with zero rows, and an `absent(…)`
  envelope is an author saying the search ran and matched nothing. Every other
  shape — a sentence, a `null`, a bespoke `{ rows: [] }` wrapper, a placement
  claim ticket — is unreadable, and files an explicit **`not-applicable` row
  with no finding**. That row is the point: a check that silently skipped what
  it could not read would be the decoration the disposition ledger exists to
  make impossible.

  **Armed by two halves**, and the second one is why: `noticeEmptyLookups:
true` on `Agent.create` **and** at least one tool declaring `argumentsFrom`.
  The declaration alone is not enough — it already arms two other checks, and
  an advisory that armed itself off a declaration made for something else
  would not be opt-in at all. **Default off is byte-identical**: no finding, no
  event, nothing on the wire, in the history or in the answer changes. The one
  visible difference is the registered `empty-lookup` row in the disposition
  report, filed `not-applicable` — the family's law rather than an exception to
  it, since silence is exactly what let two shipped checks decay into
  decoration. Posture is the family's own (`integrityPosture`), with a dev
  canary like every sibling; the evidence gate's `assist`/`guard`/`rails` trio
  is deliberately absent, because those grade how hard a rail pushes back and
  this check never pushes back on anything.

### Changed

- **One rail for integrity findings, one spelling for an argument leaf.** The
  seen-list dedup that turns "detected many times" into one
  `integrity.context_error` per run moved out of `callLLM` into
  `core/agent/integrityFindings.ts` — the write seam files from a second STAGE,
  and its old header already warned that a second copy of that loop would
  eventually disagree with the first about what "already filed" means.
  Likewise the argument walk, the four-character fence and the quoting length
  moved to `src/integrity/argumentLeaves.ts`, shared by the choice seam and the
  write seam: the second check's whole job is to notice something about a value
  the first one already excused, so the two must agree to the character about
  which leaves are candidates and what their dot-paths are. No behaviour change
  on either move.

## [9.76.1] - 2026-08-28

### Fixed

- **`runbookAsTool`: the honesty spine actually wins.** The envelope's
  contract said "spine keys win" while the assembly spread the chart's
  `report` bag AFTER `af_provenance` and `rule_version` — so a chart writing
  either name into `report` silently replaced the two fields a reader checks
  the answer's boundary with. A procedure could have arrived stamped with a
  provenance it never had, or naming a rule version it never ran under, and
  the envelope would have looked exactly as honest as a true one. Found by
  the first consumer refit, before any chart did it.

  The precedence is now EXPLICIT, not a consequence of spread order: the
  spine and the projection this run assembled are built first, and the
  chart's `report` is admitted against the names they took. Reserved names
  are `af_coverage` (refused inside `result` too — a decoy ledger one level
  under the real one is exactly where a decoy would want to sit),
  `af_provenance`, `rule_version`, `walk`, `report_note`, and, for a
  verdict-shaped run, the projection keys. The reserved set is READ from the
  assembled objects, so a spine field added later is protected the day it
  lands.

  **A refused field is named, not silently dropped** — the same law the rest
  of the envelope already follows (the walk declares its projection, the
  rowset its completeness, declined rows land in the ledger). A collision
  costs one `result.report_note` listing every discarded field and saying the
  values under those names are the bridge's; it is absent whenever nothing
  collided, so the clean path — every real runbook — pays nothing.

## [9.76.0] - 2026-08-28

### Added

- **`runbookAsTool` — turn a written procedure into a tool whose every answer
  is evidence.** Triage is the most-used agent job in a business: run the
  standing procedure, come back with a verdict somebody can act on. The first
  production tool of that shape hand-rolled ~800 lines of envelope around a
  footprintjs chart — a coverage ledger merging every inner source's own
  ledger, a rule-version stamp on every sentence, capped verdict rows beside a
  pre-rendered table, and the recorded walk that lets a reader CHECK the
  verdict instead of trusting it. `runbookAsTool` is that envelope as one
  declaration bag; the smallest legal call is `{ name, description,
procedure }` and it still yields the honest spine.

  **The mandatory honesty spine**, on every answer whatever the runbook's
  shape: `af_coverage` (three lists + a sentence naming the rule set and
  version, with every inner tool's ledger folded upward), `af_provenance`
  re-emitted FIRST (a seeded source's confession survives composition),
  `rule_version` (or the honest `'undeclared'`), and the recorded walk as an
  artifact ticket — new kind **`recording/chart-walk`** beside
  `recording/run`, with `chartWalkPutInput` beside `recordingPutInput`. The
  walk descriptor carries truthful counters, the declared projection (over
  the cap, the CONTROL FLOW survives — stages, forks, and every `condition`
  entry with its decide() evidence — never a head slice that keeps four
  hundred writes and drops every decision), and a `walk_segment` discriminant
  (`'full'` today; the wire is ready for resumed segments before gates land).
  A failed mint costs the ticket, never the answer.

  **The optional verdict projection**, selected by `resultKind: 'verdict/*'`:
  rows off the chart's `verdicts` state key, ONE cap for the structured list
  and the rendered table, truthful `rows_shown/rows_total/rows_complete`, and
  `verdict_meanings` GENERATED from the decider's declared branches plus the
  rule labels this run's evidence carried — never hand-restated, so a rule
  change and its meaning change on the same day. Three outcomes, honestly: a
  clean envelope; an inner absence passed through VERBATIM (the framework
  still reads it as an absence); and `declined` rows counted into the ledger
  as not-checked ground.

  `flowchartAsTool` stays for compatibility (its `resultMapper` users stay
  put, byte-identical); its stale pause message now names the runbook
  program's gate phase instead of a version that shipped years ago.

- **`ctx.tools` — a tool's body can call other registered tools through the
  run's own dispatch.** The `procedure` factory is invoked per call with the
  agent's dispatch (static + skill-carried tools; ToolProvider-delivered
  tools are invisible — there is no build-time list, the stated 9.72.0
  caveat), so stages compose registered sources instead of importing modules
  and building a second query stack. Inner calls run with `hasArtifacts:
false` (one answer, one ticket — never competing chips), a derived
  toolCallId naming the outer call, `needs` resolved on the fail-closed
  non-interactive path, and `checkIn`/`wants` tools refused BY NAME (an inner
  call cannot pause, and must never silently skip a consent gate).

- **`composedOf` + `gates` on `defineTool`.** A composed tool names its
  ingredient tools; the drift gate runs at AGENT BUILD — the one moment the
  catalog is complete — so a renamed ingredient fails the build by name, not
  the first 3 a.m. run. `gates` declares a procedure that can raise an
  approval gate (read by composition-time checks that must keep a gating tool
  out of a fan-out branch). Both pass the declaration bar (consumer-side
  rails read them; nothing governs execution) and travel the MCP `_meta` bag
  in both directions, judged on ingest by the same exported asserts
  `defineTool` uses.

## [9.75.0] - 2026-08-28

### Added

- **Grounded numbers: the staged-refs nudge, and a revise correction that
  names the route.** The field failure this closes, from a consumer's recorded
  run: four tool results carried real numbers, a compute tool that could sum
  them was registered — with `wants` declared over the staged dataset kind —
  and the app's prompt said to use it. The model summed the numbers in its
  head anyway and stated the total; the evidence gate recorded _"appears in no
  tool result"_ and the answer shipped, because the posture only observed. The
  app patched it with more prose. The library-shaped fix is two mechanisms it
  already owns, on the one dial it already has:

  **`nudge: true` on `.namesAndNumbersFromEvidence()`** — when an iteration's
  context holds a tool result staged by reference (an `artifacts.placement`
  ticket) AND a tool the model can currently call declares `wants` over that
  ticket's kind, ONE short line is appended at the very END of that request,
  naming the refs and the spender tool by its registered name: derived numbers
  come from the tool, not from mental arithmetic. Composed entirely from
  declarations (`Tool.resultKind`, `Tool.wants`, matched by the exact-string
  law dispatch uses — never by tool name); no prose surface for apps. The
  placement is the point: the measured failure was recency — the app's own
  instruction sat at the top of a long context and the numbers at the bottom,
  so this one sits beside the data. Request-only (never history, so it never
  enters the gate's exempt corpus), recomposed per iteration so it exists
  exactly while both conditions hold, judged against the tools REALLY served
  this call (the wrap-up's withheld surface arms nothing). Each firing lands
  as `agentfootprint.agent.grounding_nudged` (event 109) with refs and tools
  as data — the line's one record, since the line itself is not conversation.

  ```ts
  const agent = Agent.create({ provider, model, artifacts: { store, placement } })
    .tool(exportRows) // resultKind: 'dataset/rows' — staged over the threshold
    .tool(compute) //    wants: { dataset: 'dataset/rows' } — the declared spender
    .namesAndNumbersFromEvidence({ posture: 'guard', nudge: true })
    .build();
  ```

  **The guarantee stays the postures the gate has had since 9.35.0** — the
  existing value extraction is THE detector, unchanged: `'assist'` records,
  `'guard'` allows the one bounded revision then delivers with both attempts
  on the record, `'rails'` refuses with `UnsupportedValuesError`. What the
  revision gains: when the flagged turn holds staged refs a served `wants`
  tool can spend, the correction now names them — _"pass 'art\_…'
  (dataset/rows) to `compute` — compute the number there and answer with what
  it returns"_ — inside the authored frame, so the quoted values still come
  last and the exempt-corpus fence is untouched. The `revision-asked`
  `evidence_checked` event carries the same facts additively (`stagedRefs`,
  `spenderTools`). Absent everything — no gate, `nudge` unset, or no
  `wants`-declaring tool — every request, record and correction keeps its
  exact bytes, pinned by test.

### Changed

- **A `guard`/`rails` agent that also registers a `wants`-declaring tool will
  see its evidence correction gain the refs clause above when staged refs are
  in context.** That is the fix, not a side effect: a correction that says
  "call the tool that provides it" without naming WHICH tool over WHICH ref
  leaves the model to head-math again. Agents without a `wants` tool — or
  without staged refs in the flagged turn — keep the exact 9.35.0 sentence.

## [9.74.0] - 2026-08-27

### Added

- **The Azure/Foundry column exists — keyless auth and both Microsoft inference
  doors, cloud and on-device.** AWS and GCP each had a full adapter column;
  Azure had a static api-key string and nothing else. This release fills the
  auth + inference tier, and every piece is a vendor adapter over ports that
  did not change — the same seams the AWS and GCP columns already use.

  **`foundry()` — the project-endpoint provider** (`agentfootprint/providers`).
  The JS answer to Microsoft's `FoundryChatClient(project_endpoint, model,
credential)`: point it at a Foundry project endpoint (or let the hosted
  platform's auto-injected `FOUNDRY_PROJECT_ENDPOINT` supply it), name the
  deployment (`AZURE_AI_MODEL_DEPLOYMENT_NAME ?? MODEL_NAME`), and auth is an
  Entra `TokenCredential`, an api key, or — given neither — the platform's own
  blessed default, `DefaultAzureCredential` from the optional `@azure/identity`
  peer. Inference rides the GA api-version-free `/openai/v1` route derived from
  the project endpoint; the deployment name travels as the `model` field; the
  token scope is `https://ai.azure.com/.default` (the management audience is a
  different token — the docs say so out loud). Rotating tokens reuse the
  per-request key-callback seam `openai()` has had since 9.29.0: the client is
  rebuilt only when the token string actually changes.

  ```ts
  import { foundry } from 'agentfootprint/providers';
  // In a Foundry hosted container: zero config — endpoint injected, identity ambient.
  const llm = foundry();
  // Locally: az login, then name the project.
  const local = foundry({
    projectEndpoint: 'https://acct.services.ai.azure.com/api/projects/my-project',
    deployment: 'gpt-4.1-mini',
  });
  ```

  **`foundryLocal()` — the on-device door.** Fetch-only, zero dependencies, the
  `ollama()` discipline applied to Foundry Local's OpenAI-compatible `/v1`
  wire: an alias like `qwen2.5-0.5b` resolves to a concrete variant through the
  service's own catalog (`GET /foundry/list`, priority order, first wins;
  cached per provider), a full variant id skips the catalog entirely, and the
  typed `FoundryLocalUnavailableError` tells the truth a local runtime needs
  telling — `foundry server start` to start it, `foundry server status` to find
  the dynamic port, `foundry model run <alias>` when the model is the missing
  piece, with the machine's actual model list attached when the service could
  answer. No API key is sent because none exists. Streamed usage is read off
  the final empty-choices frame — the exact bug class 9.73.0 fixed, pinned here
  from day one.

  **`entraIdentity()` — Azure credentials for tools**
  (`agentfootprint/security`). The `googleIdentity` anatomy, law for law:
  vends the deployment's identity as a bearer via any `TokenCredential`
  (default: `DefaultAzureCredential`'s chain — env service principal, workload
  identity, managed identity, VS Code, az CLI), scopes the request's way or
  `AZURE_AI_SCOPE` by default, refuses `mode: 'user'` and per-request user
  tokens BY NAME until an OBO surface exists, refuses services outside the
  allowlist, and never lets an SDK's failure text — which echoes request
  detail — reach a thrown message. `AZURE_AI_SCOPE` and
  `AZURE_MANAGEMENT_SCOPE` are both exported because the audiences are not
  interchangeable, and pretending there is one "azure scope" would be a lie
  that 401s at runtime.

  **`azureOpenai({ credential })` — the existing Azure door goes keyless.** An
  Entra credential now rides the SDK's `azureADTokenProvider`; the static
  api-key path is byte-identical to before; both given at once is refused by
  name as the config bug it is. The docs' old caveat — "azureOpenai is the
  wrong door for bearer auth" — is retired. Each keyless door defaults to the
  audience ITS route documents: this one asks for
  `https://cognitiveservices.azure.com/.default` (the classic deployment-scoped
  route's own documented audience, `AZURE_COGNITIVE_SERVICES_SCOPE`), while
  `foundry()` asks for `https://ai.azure.com/.default` (`AZURE_AI_SCOPE`, the
  v1/project route's) — both overridable via `scope`, both pinned on the wire
  by tests that record what the credential was actually asked for.

  **`openai({ legacyEndpoint })` — the dialect dial goes public.** `baseURL`
  has always implied the legacy dialect (`max_tokens`, no `stream_options`)
  because most OpenAI-compatible servers are behind; `legacyEndpoint: false`
  now declares "this baseURL speaks the current dialect" — which is exactly
  what the Azure v1 route is. Default unchanged: `!!baseURL`.

  **`providerFromEnv` learns both doors — upgrade-safely.** `FOUNDRY_LOCAL_MODEL`
  slots directly after `OLLAMA_MODEL` (a model name you typed for a local
  runtime — the same name-beats-leftover-credential law), and
  `FOUNDRY_PROJECT_ENDPOINT` + `AZURE_AI_MODEL_DEPLOYMENT_NAME` — a pair of
  product-specific spellings nobody exports by accident — outranks the
  lingering-credential arms. Two guards keep an upgrade from breaking a
  working environment, because the hosted platform auto-injects the endpoint
  into every container, Foundry-bound or not: an endpoint with **no**
  deployment named HOLDS its refusal (every arm below answers exactly as it
  did before this arm existed, and the held refusal is raised only when
  nothing else resolves), and the generic `MODEL_NAME` alone never carries the
  endpoint past a bootable Azure config — choosing Foundry over working Azure
  takes the deliberate spelling. Every existing precedence is pinned
  untouched; each guard has its own test.

  New from `agentfootprint/providers`: `foundry`, `foundryInferenceUrl`,
  `FoundryProviderOptions`, `foundryLocal`, `FoundryLocalProvider`,
  `FoundryLocalUnavailableError`, `FoundryLocalProviderOptions`,
  `TokenCredentialLike`, `AccessTokenLike`. New from `agentfootprint/security`:
  `entraIdentity`, `AZURE_AI_SCOPE`, `AZURE_MANAGEMENT_SCOPE`,
  `AZURE_COGNITIVE_SERVICES_SCOPE`, `EntraIdentityOptions`,
  `TokenCredentialLike`, `AccessTokenLike`, `AzureIdentitySdkModule`. New
  optional peer: `@azure/identity`. Pinned by 178 new test cases (counted in
  the diff, not the runner) across
  `test/adapters/identity/entra-identity.test.ts`,
  `test/adapters/unit/FoundryProvider.test.ts`,
  `test/adapters/unit/FoundryLocalProvider.test.ts`,
  `test/adapters/integration/foundry-wire.test.ts` (a real `openai` SDK against
  a local fake of the `/openai/v1` wire — Bearer header, `max_completion_tokens`,
  token rotation, and the audience each door asks its credential for, all
  asserted on the wire, not assumed), the extended Azure env/wire suites, and
  the fix pins from the adversarial review below. Deliberately NOT in this train: the App Insights sink,
  Azure AI Search, the Toolbox MCP transport (next trains), and every
  preview-only surface (A2A door, browser/computer-use, managed memory) —
  refusing to ship against previews we cannot verify is a feature.

  The whole train was adversarially reviewed before release (five lenses, every
  serious finding independently re-verified with a reproduction): 1 blocker and
  9 should-fix findings were confirmed and every one is fixed and pinned in
  this release — including a mid-stream failure frame that `foundryLocal()`
  would have reported as a clean stop, an abort signal that never reached a
  streaming body, and an env-detection arm that would have broken working
  deployments on upgrade.

### Fixed

- **`ollama()` inherited four stream/abort defects — found by reviewing the new
  Foundry Local adapter, fixed at the root.** The adversarial review of
  `foundryLocal()` proved its four streaming defects were byte-twin shapes
  copied from `OllamaProvider`, which had shipped them for months: a caller's
  already-aborted `AbortSignal` still sent the request; an abort after headers
  never reached the streaming body (generation ran on, un-stoppable); an early
  `break` leaked the response body (the reader was never cancelled); and a
  mid-stream `{"error": …}` frame was silently dropped, reporting a failed
  generation as a clean stop. All four now match the fixed Foundry Local
  shapes — same helper names, Ollama's NDJSON wire. 10 of the 12 new pinning
  tests fail against the previous source (proven by restoring it); no public
  API change; `OllamaUnavailableError` is byte-identical.

## [9.73.0] - 2026-08-27

### Fixed

- **Every local model was reporting zero tokens, and nothing said so.**
  OpenAI and Azure only emit usage on a stream when asked, via
  `stream_options: { include_usage: true }` — and this adapter deliberately
  withheld that field when `baseURL` was set, because some OpenAI-compatible
  servers reject an unknown field and a hard failure is worse than a missing
  number. That caution was right; its cost was invisible. **Anyone streaming
  through `openai({ baseURL })` — llama.cpp, Ollama, vLLM, LM Studio — read 0
  tokens everywhere usage is consumed:** cost recorders, dashboards, and the
  per-step cost on `agentThinkingTrace`. Nothing was broken, nothing errored,
  and every number was wrong.

  `openai({ streamUsage: true })` opts a custom endpoint back in. The default
  is unchanged, because the servers that reject the field still exist; both
  halves are pinned by tests. Found by wiring a real local model (llama.cpp
  serving Qwen3-4B) behind a four-agent workflow and noticing every card read
  `0 tok` while the server, asked directly, answered usage perfectly well.

## [9.72.0] - 2026-08-27

### Added

- **An app can vouch for ground the run never served — `externalGrounds`, the
  external-ground door for the choice-seam check.** The `unsupported-argument`
  check judges every armed call's identifier-like arguments against what the
  RUN served the model. Some ground the run never serves: a person clicked a
  row in the app's data panel, the app VERIFIED the clicked cells against the
  artifact the panel renders, and the model was told to act on that selection.
  An identifier taken from a human's verified selection is not fabricated —
  and until now the check had no way to be told so.

  ```ts
  const agent = Agent.create({
    provider,
    model,
    // DECLARED, never ambient — this option is the only door.
    externalGrounds: () =>
      viewerSelection.cells.map((cell) => ({
        value: cell.text, // verified by the app against the artifact
        source: 'viewer-selection', // the audit label that travels
      })),
  });
  ```

  The provider is consulted once per LLM response that contains an armed call,
  so entries follow the person's selection between turns. Its entries join the
  grounded corpus (`ChoiceCorpus.external`, each entry `{ value, source }`),
  and every excusal is put on the record as
  `agentfootprint.integrity.external_ground_used` — toolName, toolCallId, the
  argument's dot-path, the value, and the `source` label of the entry that
  excused it. An excusal on the record always means the app's assertion was
  the ONLY thing standing between that value and a finding: values the run
  itself served are never attributed to the door.

  The honesty note, stated where the option is declared: the library records
  what the app ASSERTS — verifying the assertion (against the artifact, the
  click, whatever the app's ground truth is) is the app's duty, done before
  the entry is yielded, and the source label travels precisely so a reader can
  audit that chain instead of trusting it.

  Absent, or a provider yielding nothing, is byte-identical to 9.71.0. A
  provider that throws or returns garbage contributes nothing and never aborts
  a run — an accounting door must never change a run's outcome. New public
  types: `ExternalGroundsProvider`, `ExternalGround`, `ExternalGrounding`, and
  the event payload `IntegrityExternalGroundUsedPayload` (108 typed events
  now).

### Fixed

- **The `toolGrounding` harvest sees skill-scoped tools — the choice-seam
  checks arm for an app whose query tools all ride skills.** Found by a
  consumer's MCP parity work: the harvest read only the STATIC `.tool()`
  registry at chart build, so an agent whose `argumentsFrom` tools were all
  skill-carried (delivered when a skill activates) never armed the
  `dangling-reference` / `unsupported-argument` pair. Its disposition rows
  read `{checked: 0, notApplicable: 1}` forever while the app's own comments
  believed the checks ran — the exact green-that-checked-nothing shape the
  disposition ledger exists to make impossible.

  The harvest now reads the FULL declared catalog (`buildToolRegistry`'s
  dispatch map: static registrations plus every skill-carried tool,
  `autoActivate`/scoped ones included). Arming is computable up front because
  a skill tool's DECLARATION is known at chart build even though the tool
  reaches the model only after its skill activates; the runtime checks stay
  correctly scoped on their own — dangling-reference intersects the map with
  the tools each call actually serves, unsupported-argument with the calls
  the model actually makes. `IntegrityChecksPresent.dangling` still means
  exactly "at least one tool declared `argumentsFrom`" — only the blindness
  changed. CAVEAT, stated rather than papered over: ToolProvider-DELIVERED
  tools remain invisible to the harvest — `list(ctx)` is opaque and
  per-iteration, so their declarations cannot be known at build. (MCP tools
  are not in that hole: `mcpClient(...).tools()` registers them statically,
  and 9.71.0 carries their declarations across the wire.)

- **`CHANGELOG.md` ships in the tarball.** The `files` allowlist named
  `CLAUDE.md` and `AGENTS.md` but never the changelog, so every tarball since
  the allowlist existed — 9.70.0's packaging audit included — shipped without
  it. One line in `files` closes it.

## [9.71.0] - 2026-08-26

### Added

- **An MCP tool server is a first-class agentfootprint citizen — the
  declarations travel, both directions.** A `Tool` is two things at once: an
  EXECUTION half (the handler, the credential it needs, the human it wants to
  check in with) and a DECLARATION half — flat, inert facts no code runs and
  every consumer-side rail reads. Only the execution half used to cross an MCP
  boundary, so a tool that arrived over MCP was thin: the dangling-reference and
  unsupported-argument checks never armed for it, artifact placement minted a
  kind no `wants` could spend, and subject-joined checks had no owner to join
  on. An MCP server could be somebody's whole tool catalogue and still be a
  second-class citizen of every check this library ships.

  `mcpServe` now writes five declarations into MCP's own `_meta` bag, under one
  namespaced key (`MCP_TOOL_EXTRAS_KEY`, the string `agentfootprint`), and
  `mcpClient` / `mockMcpClient` read them back onto the registered `Tool`:

  | field           | what it arms on the consuming side                              |
  | --------------- | --------------------------------------------------------------- |
  | `argumentsFrom` | the dangling-reference and unsupported-argument checks          |
  | `resultKind`    | placement's mint — a placed result a `wants` argument can spend |
  | `owner`         | the identity edge subject-joined checks read                    |
  | `resultClass`   | the per-class `check:semantics` rules                           |
  | `resultCeiling` | the author's refusing ceiling on an oversized result            |

  ```ts
  const fleet = await mcpClient({ name: 'fleet-mcp', transport });
  const agent = Agent.create({ provider, model })
    .tools(await fleet.tools()) // backup_status declares argumentsFrom: ['fleet_report']
    .build();
  // …and the choice seam now files `unsupported-argument` for it, exactly as
  // it would for a local defineTool — pinned end to end, disposition row included.
  ```

  **The inclusion bar, stated where the list lives:** _a declaration a
  consumer-side check or rail reads; nothing that governs execution._ `needs`
  (credentials), `checkIn` (human consent) and the session hooks are excluded
  and always will be — they decide how a tool RUNS, and the tool runs on the
  server. A client holding a consent gate the only executor already held is
  theatre; one holding a gate nobody is holding is worse. A bag that names them
  anyway cannot smuggle them onto the `Tool`.

  **Ingest never throws.** The bag comes from a server this process does not
  control, and one server's typo must not kill a bulk register of forty tools.
  Each field is judged by the SAME rule `defineTool` enforces — literally the
  same exported assert, so `assertToolOwner` and `assertArgumentsFrom` were
  extracted from `defineTool` rather than copied. A field that fails is warned
  about ONCE (naming the server, the tool, the field, and the rule it broke) and
  DROPPED; the tool registers without it and the rest of the bag still lands.
  The warning is unconditional rather than dev-gated, following the
  uncompilable-`pattern` precedent in `toolArgsValidation`: the symptom of a
  dropped declaration is silence, which looks exactly like a rail that ran and
  agreed. A field this library does not recognise is ignored in silence — a
  newer server talking to an older client is not an error.

  **Absent means absent, in both directions.** A served tool that declares none
  of the five gets no `_meta` key at all — not an empty bag. A client that
  receives no bag registers a `Tool` with exactly `schema`, `source` and
  `execute`, pinned field by field by a regression test.

  **The carrier was verified against a real socket, not assumed.** `_meta` is
  declared on the spec's `Tool` object and `@modelcontextprotocol/sdk` 1.30.0
  types it as `z.record(z.string(), z.unknown()).optional()` on `ToolSchema`, so
  it survives the SDK's own `tools/list` validation both ways — proved by
  `test/lib/mcp/mcpToolExtras.real.test.ts`, which serves over Streamable HTTP
  on a real port and reads the five fields back through `mcpClient`.

  New from `agentfootprint/providers`: `MCP_TOOL_EXTRAS_KEY` and the
  `McpToolExtras` type, public so a server this library did not write can speak
  the bag.

## [9.70.0] - 2026-08-26

### Added

- **`Tool.resultKind` — a placed result the `wants` rail can spend.** Two
  rules the library already had, read together, were a gap. `wants` matches
  artifact kinds by **exact string equality** — no wildcards, no hierarchy —
  and artifact **placement** minted oversized tool results under
  `tool-result/<toolName>`. So a consumer declaring
  `wants: { dataset: 'dataset/rows' }` was refused, as a kind mismatch, the
  very ticket placement had just minted for it. Found in the field, where the
  answer was to re-mint by hand at the seam: the framework declining to carry
  its own ref.

  The fix is on the PRODUCING end. A tool declares the kind its placed result
  is minted under, in its consumers' vocabulary:

  ```ts
  const getRows = defineTool({
    name: 'get_rows',
    description: 'Fetch the Q3 sales rows (large).',
    resultKind: 'dataset/rows', // ← what a wants argument names
    execute: () => bigArrayOfRows,
  });

  // elsewhere — resolves now, and would have been a kind mismatch before
  defineTool({ name: 'chart', wants: { dataset: 'dataset/rows' } /* … */ });
  ```

  - **The matcher is untouched.** Nothing here loosens `wants`; exact match is
    what makes a ticket a promise. What moved is the mint.
  - **Declared, never inferred** (the `capabilities` / `resultClass` law).
  - **Refused at `defineTool`** if it could never be redeemed: a blank or
    whitespace-only kind throws by name. `assertResultKind` is exported beside
    `assertResultCeiling` / `assertResultClass` for hand-built `Tool` objects.
    There is deliberately no charset rule — the kind is the consumer's
    vocabulary, not the library's.
  - **Zero-cost when omitted:** the mint is `tool-result/<toolName>`, byte for
    byte. `placedResultKind(toolName, declared?)` gained an optional second
    argument and remains the one place the kind is decided.

- **`canonical-notes.json` — the canonical wire strings, published as data.**
  `absent()`, `coverage()` and `semantic()` mint shapes carrying a static,
  never-interpolated note and a reserved marker key. Those bytes are a
  contract: the strict recognizers take the markers verbatim, and the notes
  are what the docs promise a model reads. A tool that is not written in
  JavaScript has to reproduce them exactly — and the only door this package
  offered was the compiled ESM, which a Python sidecar in the field duly
  regex-scraped out of `node_modules/agentfootprint/dist/esm` at import time.
  Reading the value rather than copying it was the right instinct; the door
  was wrong, and the wrong door was ours.

  The strings now ship as a JSON file at the package root, reachable both as a
  path and through the exports map:

  ```python
  notes = json.load(open("node_modules/agentfootprint/canonical-notes.json"))
  ABSENCE_NOTE = notes["notes"]["ABSENCE_NOTE"]
  ```

  ```js
  const path = require.resolve('agentfootprint/canonical-notes.json');
  ```

  - **Seven strings, in three groups**, keyed by the exported constant names
    so the same value is reachable as a TypeScript import: `notes`
    (`ABSENCE_NOTE`, `COVERAGE_NOTE`, `SEMANTICS_NOTE`), `markers`
    (`ABSENCE_MARKER`, `COVERAGE_MARKER`, `SEMANTICS_MARKER`) and `headings`
    (`COVERAGE_BLOCK_HEADING`). The bar for inclusion is a string a foreign
    process must reproduce or match byte for byte to interoperate — model-facing
    prose the library injects for itself is deliberately out.
  - **GENERATED, never hand-maintained.** `scripts/gen-canonical-notes.mjs`
    runs at the end of `npm run build` and reads the BUILT barrel, so the file
    cannot disagree with the code that ships. It fails loudly if a constant was
    renamed or un-exported rather than emitting a hole.
  - **`./canonical-notes.json` joins `./package.json` as the second DATA entry**
    in the exports map — a plain-string target that publishes a file, not a
    module. Without it Node's exhaustive exports map would refuse
    `require.resolve`, which is the same wrong-door failure again.
  - Also fixes a false positive the change surfaced: the docs-truth advisory
    "prose names a non-existent import path" read only CODE subpaths, so it
    reported a data entry that resolves perfectly well. It now reads the data
    entries from the manifest instead of naming `./package.json` by hand.

## [9.69.0] - 2026-08-26

### Added

- **`BrowserRunner` — a browser an agent drives, and a PERSON can take over**
  (`agentfootprint`, with `agentCoreBrowser()` on `agentfootprint/providers`).
  The port is deliberately small and deliberately not a browser-automation API:
  `click`, `type`, `press`, `screenshot` (→ `BrowserShot`), `stop`, and the one
  that earns the port its keep —

  ```ts
  await session.handControlTo('person'); // the automation stream stops
  // …they sign in, clear the CAPTCHA, approve the consent screen, watching live
  await session.handControlTo('agent'); // and the agent carries on
  ```

  Pair it with a check-in and the agent **pauses** rather than guesses: the
  handover, the wait and the resume are ordinary events in the trace, so "why
  did this run take four minutes" has an answer that names a person and a login
  screen.

  **A session has two doors, and the adapter refuses to blur them.**
  `BrowserSession.automationEndpoint` is a CDP WebSocket, and everything
  page-shaped — navigate, find an element, fill a form — belongs there, driven
  by Playwright or another CDP client. This library takes no dependency on
  Playwright and does no page work; it hands the endpoint over.
  `liveViewEndpoint` is where a person watches.

  **What verification changed.** The `InvokeBrowser` action union, read off a
  real install of `@aws-sdk/client-bedrock-agentcore` 3.1118.0, is exactly
  `mouseClick | mouseMove | mouseDrag | mouseScroll | keyType | keyPress |
keyShortcut | screenshot` — with **no navigate member at all**. An adapter
  written from memory would have invented page verbs for a door that has none.
  The same pass fixed `MouseClickArguments` (`{ x, y, button?, clickCount? }`,
  buttons `LEFT|MIDDLE|RIGHT`), `KeyPressArguments` (`{ key, presses? }`) and
  `ScreenshotResult` (`{ status, error?, data? }`) — which is why an empty
  screenshot refuses with the service's own status instead of answering with a
  blank image that reads as a blank page. All four commands joined the systemic
  name pin.

  `stop()` tolerates a session the backend already reaped: an idle timeout is
  the ordinary case on a managed browser, and a teardown that succeeded must
  not report failure.

  **One contradiction left as AWS wrote it:** the devguide says a session
  defaults to 15 minutes and `StartBrowserSession`'s API reference says 3600
  seconds. The adapter sends no timeout unless `sessionTimeoutSeconds` is
  passed, so the service applies whichever it means rather than this library
  picking a side in somebody else's disagreement.

### Changed

- The AgentCore guide's "Code Interpreter / Browser — wrap as tools" section is
  gone. It advised writing a tool by hand and not building a port "until a
  second backend has real pull" — a second backend arrived (`localCodeRunner`),
  so the advice was followed and then outgrown, which is the outcome it wanted.
  Both are ports with backends behind them now, and the page says so.

## [9.68.0] - 2026-08-26

### Added

- **`agentCoreA2AHost()` — other agents can call yours** (`agentfootprint/hosting`).
  AgentCore Runtime speaks four protocols and **A2A** is the agent-to-agent one:
  another agent (Strands, LangGraph, Google ADK, a Marketplace listing)
  discovers yours through its agent card and calls it. The same split as 9.65.0,
  for the third time:

  - **`a2aWire()`** is the A2A PROTOCOL — JSON-RPC 2.0, `message/send`, text
    parts, artifacts, `A2A_PROTOCOL_VERSION` `0.3.0` — an open protocol with no
    vendor in it, exported in its own right along with
    `a2aAgentCardDocument(card)` for deployments that must serve the discovery
    document from somewhere this wire does not own.
  - **`agentCoreA2AHost()`** is the CONTAINER CONTRACT: port 9000 (its own, not
    HTTP's 8080 nor MCP's 8000), the agent at `/`, `GET /ping` answering
    `{"status":"Healthy"}`, and the session from
    `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`.

  It needed no new machinery in `httpHost`, and one seam explains why: JSON-RPC
  requires a reply to ECHO the request's `id`, which is possible only because
  `HttpWire`'s body methods receive the request that produced them — a seam
  added in 9.65.0 for an unrelated protocol.

  **The A2A spec is broken here on purpose, and not by us.** The specification
  delivers JSON-RPC errors over HTTP 200; AgentCore returns the real status with
  the JSON-RPC error body. `agentCoreA2AErrorCode` is the runtime's published
  table (`-32051` … `-32055`, `-32603`), exported so a client shares one table
  with the host rather than keeping a copy that drifts — it is what tells a
  caller that `-32054` "Session operation in progress" must be retried with
  backoff, which A2A clients do not do on their own.

  **What it does not do, in the code as well as the prose:** `message/send`
  only. No `message/stream`, no task lifecycle, no non-text parts — each refused
  BY NAME before the agent runs. So the host declares **no** streaming
  capability and its card says `streaming: false`. AWS's own sample card says
  `true`; ours says what is true of ours, and a test pins the two agreeing.

- The host conformance suite gained a **fifth** subject. A2A is the first whose
  envelope is not ours at all — the reply echoes a JSON-RPC id and the answer is
  buried in an artifact rather than named as an output — and every assertion
  held unchanged. Nothing in `src/hosting/types.ts` moved to let it pass.

### Fixed

- **A capability this library claimed and could not honour.** `httpHost`
  declares `['streaming']` by default, so the A2A host inherited it while
  `message/send` has nowhere to put a chunk: `requireCapability(host,
'streaming')` would have passed for a host that then delivered none. The
  conformance suite caught it — it asserts chunks _if and only if_ the
  capability is declared — and the adapter now declares `[]`.

### Changed

- The vendor-name guard on `src/hosting/` grew `/ping`: one runtime's health
  spelling, on the list for the same reason as `/invocations` and `/readiness`.
  Still deliberately absent: `/.well-known/agent-card.json`, which belongs to
  the A2A protocol and to no vendor.

## [9.67.0] - 2026-08-26

### Added

- **`agentCoreGatewayTransport()` — reaching an AgentCore Gateway without
  looking anything up** (`agentfootprint/providers`). `gatewayTransport` says of
  itself that nothing in it is vendor-specific, and that stays true because the
  four facts which ARE AgentCore's now live in one file beside it:

  - **the endpoint** — `agentCoreGatewayUrl({ gatewayId, region })` builds
    `https://{gatewayId}.gateway.bedrock-agentcore.{region}.amazonaws.com/mcp`,
    a hostname nobody recalls correctly, which is why it is a function and not a
    line in a README;
  - **the policy session** — `AGENTCORE_POLICY_SESSION_HEADER`, stamped per
    request from `policySessionId`. AgentCore's temporal policies decide on
    SEQUENCES of actions, and a sequence needs a boundary. **Pass a function on
    any transport more than one person shares:** it is resolved per request, so
    `() => currentSessionId` keeps each caller's history their own, where a
    fixed string would merge everybody into one policy session and make one
    person's earlier actions count against another person's rule. The header
    rides the transport's `fetch` seam precisely so a function is possible;
  - **the catalogue's own search** — `AGENTCORE_GATEWAY_SEARCH_TOOL`, with
    `gatewaySearchTool(tools)` / `hasGatewaySearch(tools)`. Both answer
    permanently rather than transiently: semantic search is enabled when a
    Gateway is CREATED and cannot be turned on later, so absence is a fact about
    that gateway, not something to retry;
  - **the signing name** — `AGENTCORE_SIGV4_SERVICE`.

  Deliberately absent: a `search(gateway, query)` convenience. Executing a tool
  needs a `ToolExecutionContext` that belongs to the agent loop, and a call made
  on a fabricated one appears in NO TRACE — the model would be handed a
  shortlist whose origin nothing can later explain, which is the opposite of
  what this library is for. The search tool is registered like any other tool,
  and the search becomes an ordinary, attributable tool call.

### Changed

- The AgentCore guide and the AWS adapters page now record that a Gateway is
  **also a model router** — it serves `/v1/chat/completions`, so the existing
  `openai({ baseURL, apiKey: async () => … })` reaches it with no new code. The
  callback form of `apiKey` matters there for the usual reason: a gateway token
  expires.

## [9.66.0] - 2026-08-26

### Added

- **`agentCoreEvaluationSpans()` — an agentfootprint agent can now be scored by
  AWS's own evaluators, hosted anywhere** (`agentfootprint/observe`). Since July
  2026 AgentCore Evaluations grades agents that do not run on AWS, from spans
  that reach CloudWatch. Ours were invisible to it, and the reason was two
  fields: their classifier routes on the instrumentation scope name and skips
  anything not under `opentelemetry.instrumentation.*` **silently**, and their
  scorers read the turn's text off attributes we deliberately never emitted.
  Both are now options on the NEUTRAL adapter, because both are OpenTelemetry
  concepts rather than anybody's product: `otelObservability({ scopeName })`
  (default `'agentfootprint'`, unchanged — a rename moves every existing
  dashboard's spans out from under it) and `otelObservability({ captureContent })`
  (default **false** — enabling it exports raw prompt and answer text as
  `gen_ai.task.input` / `gen_ai.task.output`). `agentCoreEvaluationSpans()` is a
  CONFIGURATION of that adapter with the two settings AWS requires, exported
  from the vendor's own file beside `AGENTCORE_EVALUATIONS_SCOPE_NAME`; the
  scope name is deliberately not overridable through it, since honouring an
  override would produce spans the service skips. Per-inference message arrays
  are NOT emitted: `llm_start` / `llm_end` carry model, usage and stop reason,
  never the messages, so there is nothing truthful to put there. The division
  stated plainly, in the docs and here: **their evaluators say what the score
  is; the agentfootprint trace says why it happened.**

- **`agentCoreIdentity` learned the three operations AgentCore Identity grew
  after 9.4.0** (`agentfootprint/security`), each verified against a real
  install of `@aws-sdk/client-bedrock-agentcore` **3.1118.0** — names, request
  shapes and enum values read off the package rather than remembered, which is
  the 9.4.0 law:

  - **`userFlow: 'consent' | 'exchange'`** — `'exchange'` sends
    `ON_BEHALF_OF_TOKEN_EXCHANGE`, trading the person's existing login for a
    scoped downstream token with no consent screen at any point. Default stays
    `'consent'` (`USER_FEDERATION`), and `mode: 'machine'` is untouched: M2M has
    no user to act for. Not simply the nicer flow — the consent screen is what
    asks the person, and choosing `'exchange'` is a deployment saying it does
    not need to.
  - **`apiKeyServices` + `apiKeyHeader`** — services whose credential is an API
    key are vended with `GetResourceApiKey` and come back as an `apiKey`
    credential. No auto-detection: AgentCore holds both kinds in one vault
    behind two operations and the provider name does not say which, so guessing
    would mean a failed call, a retry, and an ambiguous error. A missing
    workload identity token is refused BY NAME rather than sent (the field is
    required on `GetResourceApiKeyRequest` — read off the SDK's types).
  - **`completeAgentCoreAuthorization({ sessionId, userToken | userId })`** —
    the handshake that closes a consent round-trip, exported as a FUNCTION and
    not a provider method because it runs in your web callback route: a
    different process from the agent run, often a different service. Naming the
    person twice, or not at all, is refused before any call, because the field
    it maps to (`userIdentifier`) is a one-of. The shape this takes in
    agentfootprint is a **pause**: first vend answers `authorization-required`,
    the person approves, your route completes the handshake, and the same
    request re-run is `issued` — pinned end to end by a test.
  - The AWS command-name pin grew both new commands; five of AgentCore
    Identity's six data-plane operations are now covered.

- **`otelObservability({ _otelApi })`** — an internal test seam for the path
  where the adapter builds its own tracer, which is the only path `scopeName` is
  observable on. Mirrors the `_client` / `_sdk` seams every SDK-backed adapter
  already has.

### Changed

- **The AgentCore guide stopped describing the 2025 platform.** Policy reached
  GA in March 2026 and `agentCorePolicy()` stays retired — re-enumerating all
  165 commands of `@aws-sdk/client-bedrock-agentcore-control` 3.1118.0 finds no
  `EvaluatePolicy`, `TestPolicy` or `IsAuthorized`, so the 9.4.0 reading
  (enforcement lives inside the Gateway, `LOG_ONLY` is the testing story) was
  the architecture rather than a gap we left open. The Evaluations row now names
  the bridge, and a new note says plainly that AWS ships its own TypeScript
  serve-app: if all you need is the `/invocations` contract, use theirs — what
  this library adds is the part that is not the contract.

- `otelObservability`'s `tracer` docstring named a version constant that has
  never existed in this package. It now describes what the code does.

## [9.65.0] - 2026-08-26

### Added

- **`foundryResponsesHost()` — an agent behind Microsoft Foundry Toolkit's
  Agent Inspector** (`agentfootprint/hosting`). One inbound hosting adapter on
  the same `AgentHost` port every other host uses: `HEAD /responses` answers
  the Inspector's capability probe with 204, `GET /readiness` answers
  `{"status":"healthy"}`, `POST /responses` takes a turn — `input` as text or
  as user-message items with `input_text` parts — on port 8088
  (`DEFAULT_FOUNDRY_PORT`; `FOUNDRY_INVOKE_PATH`, `FOUNDRY_READINESS_PATH` and
  `FOUNDRY_SESSION_FIELDS` are exported beside it, and every knob lives on
  `FoundryResponsesHostOptions`). `stream: true` **in the body** selects the
  nine-event Responses SSE lifecycle, `response.created` through
  `response.completed`, with stable ids and a monotonic `sequence_number`;
  failures end with `response.failed`. The session is read from
  `conversation` / `agent_session_id` / `session_id`, first present wins.
  Image/file input, non-message items, non-user roles, and the `awaiting` /
  `artifact` / `sessions` terminals are refused BY NAME — never silently
  dropped, never an invented success. It is an inbound hosting adapter, not a
  model provider (a Foundry Local model stays `openai({ baseURL })`), and it
  does not feed the Workflow Visualizer — the wire carries the conversation,
  not the agent's topology. Passes the same host conformance suite as
  `nodeHost` and `agentCoreRuntimeHost` over a real socket; the request and
  lifecycle shapes were captured from a real Toolkit 1.6.9 Inspector session.
  Guide: `docs-next` → Infrastructure → Microsoft Foundry; runnable example:
  `examples/deploy/foundry-responses.ts`.

- **`responsesWire()` — the Responses protocol as a plain `HttpWire`, with no
  vendor in it** (`agentfootprint/hosting`). `foundryResponsesHost` is a
  CONFIGURATION of it — Foundry's paths, port, probe body and session aliases —
  so the next runtime that speaks Responses composes
  `httpHost({ wire: responsesWire(), ... })` instead of copying a protocol.
  `ResponsesWireOptions` carries `defaultModel`, `sessionFields`
  (`DEFAULT_SESSION_FIELDS`) and `health`; `readResponsesInput` and
  `readResponsesSession` are the exported readers; `PUBLIC_FAILURE_MESSAGE` is
  what a caller sees when a handler THREW — an uncaught exception's text never
  travels, while `reply.fail(error)`'s chosen words always do.

- **Four provider-neutral seams on `httpHost`,** each defaulting to exactly the
  incumbent behavior: `wire.wantsStream?(facts)` (a dialect that selects
  streaming from the body instead of the `Accept` header), `wire.stream?(facts)`
  returning a per-response `StreamFraming` of `StreamFrame`s (protocols that
  frame a stream as a named-event lifecycle rather than one `chunk` per piece —
  the old shape is itself the default framing), `maxBodyBytes` (bounded body
  reads refusing at the crossing byte with the typed `RequestTooLargeError`,
  413; **default remains unbounded** so no existing deployment starts refusing
  — set it), and `invokeHeadProbe` (opt-in 204 for a bare HEAD on the invoke
  path). `WireRequestRefusal` lets a dialect refuse a request it cannot carry
  from `readRequest`, with its own status and code, before a turn is paid for;
  `FailureOrigin` (`'refused' | 'threw'`) tells a dialect which kind of failure
  it is describing, so sanitization replaces exception text and never a
  handler's chosen words. `nodeHost` and `agentCoreRuntimeHost` are
  byte-for-byte unchanged on the wire.

- **The host conformance suite learned that sanitizing is not a free pass:**
  a subject declaring `sanitizesThrownErrors` must still REPORT a thrown
  handler's failure, and is now asserted NOT to have repeated the thrown words.
  The vendor-name guard on `src/hosting/` grew `foundry`, `microsoft` and the
  `/readiness` route literal (the `/invocations` reasoning, applied again);
  `/responses` is deliberately NOT on the list — it is a protocol's path,
  spoken by more than one runtime and owned by none.

## [9.64.0] - 2026-08-26

### Added

- **`RunConfigFn`, `RunConfigContext` and `RunConfig` are exported from
  `agentfootprint`.** `.configure(fn)` has been a public door since 7.13.0, so
  the shape of `fn` was a public contract that could not be named — a consumer
  who wanted a resolver in its own module had to re-declare it by hand, and a
  hand copy stops matching the moment the context grows a field. `RunConfig`
  ships alongside the other two because it is what a resolver RETURNS: without
  it a factory cannot annotate its own return type. No runtime change; the
  types were already the ones `.configure()` used.

### Fixed

- **An absence's extra keys are evidence now — every field it carries except
  the one that echoes the caller.** A share-lookup tool returned its absence
  with the answer attached: an extra `known_shares` key holding the 40 real
  share names on the filer, and a `try_instead` telling the model to pick one
  of them. The model did exactly that. The evidence gate then called the share
  it picked ungrounded, because the absence projection indexed the coverage
  lists and excluded every other key. Following the tool's own advice produced
  a flagged answer, which makes the advice worthless and the gate wrong.

  The line was never "coverage vs the rest" — it is **tool-authored knowledge
  vs caller echo**. A recognized absence now projects every string and number
  leaf it carries: the coverage lists as before, plus extra keys, plus the
  tool-authored `try_instead` and the library's `note`. `looked_for` stays
  excluded, alone, because it is the one field whose job is to quote the
  REQUEST rather than state what the tool knows — index it and a fabricated
  name grounds itself by being handed to one tool that found nothing, which is
  the cheapest laundering machine there is. The laundering fence has its own
  test and did not move.

  This widens leniency: the gate accuses less. That is the safe direction on an
  accusation boundary — a missed fabrication costs a value nobody checked, a
  false accusation costs a correct answer and a real turn.

### Changed

- **A declared `pattern` is now an ENFORCED pattern. Consumers who already
  wrote one in a tool's `inputSchema` will see calls refused under
  `toolArgValidation: 'enforce'` (the default) that used to dispatch — that is
  the fix, and it is worth reading before upgrading.**

  The field story: a tool result ended with an offer — "I can also map these
  ids to volume names" — and the person answered "yes please". The model bound
  _that sentence_ as the identifier argument and dispatched. The tool's schema
  DECLARED the identifier's shape, in a `pattern` that "yes please" could never
  match; the pre-dispatch validator simply did not read the keyword. So the
  call went out, failed downstream, and cost a round trip — and the consumer
  hand-rolled a blocklist of affirmative phrases to do the job the declaration
  already described. A declared shape a boundary ignores is worse than no
  declaration at all: the author believes it is enforced.

  `pattern`, `minLength` and `maxLength` now join `type` / `enum` / `required`
  in the honest subset — same place in dispatch, same
  `agentfootprint.validation.args_invalid` event, same tool-result shape, and
  the same dial in every mode. `'warn'` emits and executes anyway; `'off'` is
  byte-for-byte what it always was. `pattern` follows JSON Schema exactly:
  unanchored, ECMA-262, strings only. A `pattern` that does not compile is
  IGNORED with one developer warning rather than throwing — a schema author's
  typo must never take dispatch down with it.

  **The refusal teaches.** `expected string, got string` is unactionable when
  the complaint IS the shape, so a string-shape issue names the argument path,
  quotes a capped (80-character) excerpt of the offending value, states the
  declared pattern or bound, and carries the parameter's own `description`
  sentence when the schema has one — that sentence is where an author writes
  what the identifier looks like, and it is usually the whole correction. The
  `value` and `hint` fields are new and OPTIONAL on the event payload's issues;
  structural issues (type, enum, required, additionalProperties) still name
  types and never values, and the OTel span event still projects
  path/expected/got only, so third-party telemetry stays value-free.

## [9.63.0] - 2026-08-25

### Added

- **`unsupported-argument` — the check at the CHOICE seam, and the fifth and
  last of the Context Integrity family.** In a recorded triage turn the window
  dropped the user message holding the true entity id and kept the assistant's
  own rendered answer; asked for "the status for that machine", the model
  resolved the reference out of its OWN prior prose, took a truncated job-name
  fragment for a machine name, called the lookup tool with it, got an honest
  "nothing found", and told the person their protected machine had no backup
  record. Every shipped rail passed honestly — the coverage envelope, the
  absence envelope and the evidence gate all held, because every value in the
  answer really was grounded; the defect was the REFERENT, bound wrong at the
  argument, at the one seam that had no check.

  After each response, every identifier-like string argument of a call to an
  armed tool must appear in the frame the model chose from: the system prompt,
  a USER message, or a TOOL result of the exact request the call was assembled
  from. Assistant messages are deliberately not ground — a value whose only
  source is the model's own rendered prose has been re-derived from a rendering
  rather than read from evidence. Detection only; nothing is blocked.

  **`argumentsFrom` now does double duty**: the one field that arms
  `dangling-reference` at the compose seam (is the ground still in reach while
  the tool is OFFERED?) arms this at the choice seam (did the value the model
  chose come from that ground when the tool was CALLED?). Nothing new to
  declare, and a tool that declares nothing is still never either check's
  subject.

  The fences are the check's honesty and each has a test: non-strings are never
  checked, values under four characters are never checked, a value served
  anywhere in the frame passes, and a value the tool's own `inputSchema`
  declares in an `enum` passes. The two remaining states file DIFFERENT
  messages, because they need different fixes — grounded only in the model's
  own prose (re-fetch the real ground, named), and grounded nowhere at all.

  `find_context_errors` now offers `'unsupported-argument'` in its `kind` menu;
  only `'duplicate-execution'` remains a class the finding type names and no
  check in this build can file. The disposition report grows from four rows to
  five, and one `argumentsFrom` declaration now produces two armed rows at two
  seams.

## [9.62.0] - 2026-08-21

**Three ways a check could be there and do nothing, and nobody could tell.**

### Fixed

- **An unarmed Context Integrity check is now a row, not a silence.**
  `invariant-violation` at the compose seam, `dangling-reference` and
  `unsupported-claim` only ever ran when the application declared their
  precondition — a `.maps()` plan, a tool declaring `argumentsFrom`, a
  `.claims()` contract. An application that declared none of them filed only
  the always-on `wire` row: checked, green, and indistinguishable from a run
  where all three looked and found nothing. This library's own reference
  agent shipped that way for weeks, and a second integration reported
  reaching the same state independently.

  All three now register on every run, and one with no subject this run is
  noted `not-applicable` immediately — the literal truth, in the vocabulary
  the ledger already had. Per check, deliberately: the common shape is
  PARTIAL, where an app arms one and never learns the other two sat out, so
  arming one check must never suppress the rows for the two it didn't.

  No new event and no new field. The rows travel through the existing
  `agentfootprint.integrity.disposition` event and `find_context_errors`'s
  partial-coverage headline, unchanged at every consumer.

- **`integrityPosture: 'dev'` now mints a canary for every registered check,
  not only the armed ones.** Otherwise the fix above would have removed an
  ambiguity at the arming level and reintroduced it one level down: a checker
  that has rotted and a checker that simply had no subject file an identical
  `not-applicable` row. The canary — one pure function against a deliberately
  contradictory fixture — is the only thing that separates them. The cost is
  a function call; the alternative is that whoever finally declares
  `.claims()` inherits whatever state that checker rotted into while nobody
  was looking.

- **A parked map's tools no longer reach the wire through a tool provider.**
  Parking held its owned tools out of the registry list and the skill
  injection list, but provider schemas merged unfiltered — so a provider tool
  sharing a parked member's name still rode the wire, and the compose-seam
  backstop could only report it after the fact. It is now held out on all
  three routes.

  It has to be filtered there rather than by the provider: `ToolDispatchContext`
  carries the active skill but nothing about engagement standing, so a
  `ToolProvider` cannot see that a map was parked. This is not the
  provider-wins-the-wire law, which governs two ACTIVE sources disagreeing
  about a name — a parked map is not competing, it is not talking at all. The
  backstop stays as a regression guard, now expected to be silent.

### Added

- **`repeatedWhen: 'arguments'` on a tool** — fingerprint repeated calls on
  arguments alone, ignoring the result. The detector keys on tool + args +
  result, so a tool that stamps a fresh value into every result (a screen
  tool returning a version, a cursor, a timestamp) never produces two
  matching keys and the detector is silently inert for it, even when the
  agent fires the byte-identical call twice. Declared per tool, because the
  default is right for tools whose results carry meaning.

  It still only NOTES. The documented anti-guarantee holds unchanged — tools
  will execute again, there is no built-in call-id dedup, and durability
  replay depends on that. The note is appended after execution and changes
  nothing about whether the call runs.

## [9.61.1] - 2026-08-20

### Fixed

- **`find_context_errors` no longer reports a greener run than its own rows
  support.** The all-clear headline summed `checked` across every registered
  check, so one busy check could carry the total while another check looked
  at nothing at all — the per-check rows said so underneath (`⚠ ran 0×`), but
  a reader who stops at the headline got the rosier story. The headline now
  states coverage: either _all_ registered checks ran, or it says COVERAGE IS
  PARTIAL and names the checks that checked nothing. Same law as the rows —
  a check that never saw a subject is silent about its seam, never a pass.

### Documentation

- **The claim seam is documented where a reader will find it.** The Context
  Integrity page was written before the claim seam shipped and still named
  two defect kinds and three checks. It now covers `.claims()` (what it
  catches that the evidence gate states it cannot, the `.outputSchema()`
  requirement, and the three fences: latest settles / uncollected is
  unreachable / doubt is an advisory), the third filable kind
  `unsupported-claim`, and the `'claim'` seam.
- **The step nobody told you about.** Findings and the disposition ledger
  ride the event stream, and typed events are dropped when nothing is
  listening — so `find_context_errors` needs a recording. The page now shows
  the whole door (`recordRun` → `openRecording` → `traceToolpack`), and a
  test runs exactly that path so the page cannot teach one that does not
  work.
- **The two switches that turn the feature on are named in the README**:
  `integrityPosture: 'dev'` and `.claims()`, with a link to the page. The
  feature previously appeared there only as a clause in one bullet.

## [9.61.0] - 2026-08-20

### Fixed

- **Six defects in the Context Integrity family, caught by an adversarial
  review before release** — each survived two independent attempts to refute
  it, and each is now pinned by a red-proved regression test.

  - _A claim finding's identity ignored the FIELD_, so a contract naming two
    fields of one entity (the shape `.claims()` itself tells you to write)
    filed one event and swallowed the rest — while the disposition ledger
    counted them all, leaving the two accounts of one run disagreeing.
    `ContextError.predicate` now rides the identity, mirroring the
    substrate's own `assertionKey`; findings that never set it keep exactly
    the identity they had.
  - _The dangling-reference check was DEAD under `reactMode:
'dynamic-grouped'`_ — `compactions` was threaded into the wrong mapper,
    so the check saw an empty window ledger every pass and filed a healthy
    verdict. Chart-shape parity is now pinned by tests that run the same
    trap under both dynamic shapes.
  - _The dev canary structurally disabled the wiring-rot theorem._ A minted
    canary proves the pure function still works; it says nothing about
    whether the pipeline ever calls it (`beginIntegrityRun` mints by calling
    the function directly). Masking theorem (i) with it meant the alarm this
    ledger exists for could never fire.
  - _`workExisted` was hardcoded `true`_ on every exit path, so a run that
    died or paused before its first LLM call reported every registered
    checker as dead. It is now measured from a signal the integrity code
    does not itself write.
  - _An answer agreeing with a settled non-reading was filed as an advisory_
    — `null` reported for a fact whose settled value is `null` is agreement,
    not doubt.
  - _The claim ledger accumulated for agents that never declared a
    contract_, and appended by whole-array spread. It is now gated on
    `.claims()` and appends without the quadratic copy — restoring the
    zero-delta promise for every agent that configured none of this.

- **Two honesty defects in `find_context_errors`**, both caught by the same
  adversarial review and both red-proved by a failing test first.

  - _The green headline never read the counts it claimed to summarise._
    "The checkers below RAN; nothing they cover was violated" was printed on
    the mere absence of a finding, so a run whose every encounter was
    `unreachable` (the check could not see the evidence), whose checks all
    ruled themselves out of scope, or whose registered checks never met a
    subject still got a clean bill of health. The headline is now chosen by
    summing the disposition rows' `checked` counts: real checked encounters
    earn the green sentence and it names how many; zero checked encounters
    read **⚠ NOTHING WAS CHECKED** with the reason (unreachable / out of
    scope / never met a subject); no rows at all, and no registered check at
    all, each keep their own sentence. A checker ROW with zero `checked`
    stopped saying "the checker ran and found nothing at this seam" for the
    same reason.
  - _The tool advertised defect classes no check can file._ The `kind` enum
    was pinned to the whole `ContextErrorKind` union, so it offered
    `unsupported-argument` and `duplicate-execution` — classes no check in
    this build files — and answering one returned a negative verdict about
    something nothing on earth could have produced. The compile-time pin
    stays (a new kind still fails the build until it is listed), but each
    entry now declares whether a check ships for it: only filable kinds
    reach the enum, the description says out loud which two have no checker
    here, and a caller who passes one anyway (args validation is a dial)
    reads **⚠ UNANSWERABLE — nothing ever looked for one, so silence about
    it is not evidence of its absence**.

- **`dangling-reference` no longer accuses a window that HAS been
  re-grounded.** The check compares two name sets, and the two were derived
  by different rules: the dropped side came off the window ledger, which
  names a tool result with `window/toolNames.ts` — the helper that recovers
  the name from the assistant turn that asked when the result itself carries
  no `toolName` — while the present side read `message.toolName` directly.
  `LLMMessage.toolName` is optional, so a conversation restored from an older
  release (or from a host that speaks the wire shape and nothing more) names
  its tools through `toolCalls[].id` alone; the SAME message was then
  evidence-that-left on one side and not-present on the other, and a
  legitimate re-fetch was reported as a dangling reference. The present side
  now asks the same helper the same question. One helper, two sides, so the
  two can never disagree about what a message is — and the check's second
  fence ("a re-fetched ground is silent") holds for windows that never
  carried the field.

### Added

- **`.claims()` — the claim seam: what the answer says vs what the run
  settled.** The evidence gate grounds an answer's names and numbers but
  states its own limit: it cannot catch a false claim assembled from real
  values ("fc1/3 is healthy" when the data says the port is down). This
  closes that for the facts you name. Tools returning `semantic({ facts })`
  now settle typed readings into the run's claim ledger (`scope.claimFacts`
  — the `coverageDeclared` shape, written only when a tool declares
  readings), and `.claims({ nav_count: { entity: 'screen2', field: 'nav' }})`
  declares which validated-answer field claims which fact. Declared, never
  inferred (the `argumentsFrom` precedent). A disagreement files one
  `agentfootprint.integrity.context_error` at seam `'claim'` and changes
  nothing else — it is the last of the four Route judges and the only one
  that never re-routes, because a contradiction on a finished run is a fact
  about the run, not a reason to re-ask the model. Fences: an uncollected
  fact is `unreachable`, an omitted field `not-applicable`, only the latest
  ledger row asserts (earlier ones ride as quoted history), and an answer of
  `null`/`'unknown'` against a verified value files an **advisory**
  (`ContextError.advisory`) counted apart from real defects. Requires
  `.outputSchema()` — refused at build otherwise, since prose has no typed
  stratum and a contract that checks nothing is the decay this family
  exists to prevent.

- **`find_context_errors` — the 11th trace tool: "what did this run
  contradict itself about, and why?"** The Context Integrity checks file
  their findings on the event stream; until now a debugging model had no way
  to ask for them. The new toolpack tool READS that channel — it never
  re-runs a check and never re-judges one — and adds the join a findings
  stream cannot carry: each finding lists its kind, seam, subjects, message,
  the STEP it was filed at (`meta.runtimeStageId`) and its witnesses' steps,
  in the exact shapes `trace_node` / `trace_slice` / `who_wrote` /
  `backtrack` / `find_in_trace` accept; when a subject names a key the
  commit log wrote, the last writer and a bounded value resolve inline. The
  run's disposition rows ride along, so "the checkers ran and found nothing"
  and "no checker was registered for that seam" stay different answers, and
  a registered check with zero encounters is named as wiring rot. Honest
  absence has its own sentences: no event tail is _no finding evidence_, a
  tail with no integrity events says the channel is empty and why, and rows
  reporting findings the tail no longer carries say **evidence missing** —
  none of them ever reads as "no context errors found". Synthetic canaries
  and advisories are shown but counted apart, and a run whose rows count
  more encounters than the deduplicated list shows entries reconciles the
  two out loud. Bounded like the rest of the pack (`limit`, default 10, hard
  cap `TOOLPACK_HARD_CAPS.contextErrorsMax` = 25) and mounted
  UNCONDITIONALLY — a tool that vanished with the event tail could not say
  the evidence is missing. `TRACE_TOOL_NAMES` (and therefore
  `.selfExplain()`'s reserved names) is now eleven.

## [9.60.0] - 2026-08-20

### Added

- **The disposition ledger goes live: every run accounts for its checkers**
  (T9's run lifecycle). Each run registers the applicable checks (wire:
  always; compose invariant: `.maps()` mounted; dangling-reference: any
  tool declaring `argumentsFrom`) and every check now notes one disposition
  per encounter — checked-pass / checked-fail / not-applicable /
  unreachable (a provider stating no wire manifest is UNREACHABLE, which is
  a different fact from clean). The run boundary files the rows ONCE as
  `agentfootprint.integrity.disposition` (107th typed event; every path —
  success, failure, pause — and before the recording stops, so recordings
  carry their run's checker accounting). New `integrityPosture: 'dev'`
  option adds the two liveness theorems: a run-start canary proves each
  pure check still catches its own synthetic defect (quarantined counts),
  and a finished run whose registered checkers demonstrably never ran fails
  with `CheckerDeadError` instead of returning green — because two shipped
  checks in this codebase decayed exactly that way. Default `'observe'`:
  rows only, listener-gated.

- **`Tool.argumentsFrom` + the dangling-reference check** (the closure
  check's decidable fragment). A tool author can now declare where a tool's
  arguments come from — `defineTool({ name: 'screen_fire', argumentsFrom:
['whats_here'] })` — and `callLLM` checks at request assembly that every
  served tool's declared grounds still have results in the window: a ground
  the window ledger says was evicted (`droppedObservations`) with nothing
  re-established files a `dangling-reference` finding at seam `'compose'`,
  once per run. Two fences keep it honest: a never-dropped ground is silent
  (not-yet-grounded is legitimate sequencing), and a re-fetched ground is
  silent however many drops preceded it. The last-tool-result pin remains
  the first line of defense; this covers what the pin cannot — pins off, or
  grounds older than its ceiling. No declaration → byte-identical.

- **The wire seam: the manifest of what actually crossed** (T7b — the check
  the compose seam cannot do). Anthropic and browser-anthropic adapters now
  state `LLMResponse.wireManifest`, tool names read back from the FINAL
  serialized request body after every transform; mock echoes its request.
  `callLLM` compares the manifest against the exact request object it handed
  the adapter (post cache-strategy, so a strategy edit is never blamed on the
  adapter) and files `integrity.context_error` findings at seam `'wire'`:
  one for names that crossed uncomposed (the recorded four-retained-schemas
  defect — invisible to every pre-serialization check), one for composed
  names that never crossed. A provider stating no manifest leaves the call
  incomparable — silence, never a guess; an empty manifest is a stated zero.
  Same identity-dedup rail as the compose backstop: one defect files once
  per run.

- **The first live check: `invariant-violation`, at the compose seam.**
  A parked map whose owned tool names are still on the final merged wire
  list is the recorded two-channels contradiction — one channel says
  inactive, another shows it available, in the same call — and it is
  still reachable today through provider shadowing (the park hold-out
  filters registry and skill lists; provider schemas merge unfiltered,
  and a provider copy of a parked member's name keeps riding). The check
  runs once per parked map over the merged list, hands both channels to
  the shared exclusion algebra (so the quotation/unknown/epoch fences
  apply for free), files ONE `integrity.context_error` per defect per run
  (identity dedup threaded across passes and both chart shapes), and
  never alters the composition — detection converts a silent
  inconsistency into an attributed one. The healthy park stays silent.
  One stated deviation from the design brief, documented in the unit's
  README: the brief placed this at the write seam; in this architecture
  the park's own pass is when both facts first coexist wrongly, so the
  check runs at compose and still names the guilty write.

- **The assertion algebra and the one visible finding type.** An
  `Assertion` is keyed by `(subject, predicate, epoch)` with two rules
  that do the work: _serving is asserting; history is quotation_ (checks
  never fire across the quoted stratum — the whole stale-but-honest
  false-positive class, closed structurally) and _single-valued by
  default_ (you declare exemptions, never rules). Unknown `Claim`s never
  participate in a comparison. `conflictsOf()` is the pure exclusion
  comparison; `ContextError` is the uniform finding — plain kinds
  (`invariant-violation`, `unsupported-argument`, `dangling-reference`,
  `duplicate-execution`, `unsupported-claim`), five seams, witnesses,
  deduplicated by identity so one defect is one finding however many
  passes re-detect it. Findings ride a new typed event domain,
  `agentfootprint.integrity.context_error`, bridged and
  wildcard-subscribable from day one.
- **Tools carry their identity edge.** `defineTool({ owner: { kind, id } })`
  stamps WHO owns a tool at registration — the one moment the code knows
  both ends — and the per-pass record then attributes the tool to its
  owning subsystem instead of deriving `'registry'`. A blank half is
  refused by name; omitted is byte-identical. Integrity checks read
  stamps and never infer; unstamped tools are `unreachable` to
  subject-joined checks, which the disposition ledger counts.
- **`src/integrity/` — the Context Integrity family begins, accounting
  first.** `disposition/` files one of four dispositions per check
  encounter — `checked-pass` / `checked-fail` / `not-applicable` /
  `unreachable` — so "zero findings" and "zero checks ran" are different
  observable states. `assertAlive()` carries both dead-detector theorems:
  a registered check that filed nothing while work existed fails the run
  by name, and a dev-posture canary that was minted and never caught
  fails it even when there was nothing real to find. Synthetic counts
  never touch real ones; `unreachable` is the falsification instrument —
  if it dominates, applications are not stamping identity edges and the
  design's own thesis is failing, measurably. Internal for now; the
  public surface arrives with the finding type.

- **A capped event tail says WHERE its kept window starts** (Context
  Integrity, phase 0). `EventTailSnapshot.firstRetainedIndex` states the
  original stream position of the first retained event — the retained
  window is `[firstRetainedIndex, firstRetainedIndex + events.length)` —
  and rides the live handle (`RunRecorder.firstRetainedEventIndex`) and the
  archive (`RecordingEnvelope.run.firstRetainedEventIndex`). A drop COUNT
  says how much is gone; the offset is what lets a reader align a capped
  tail against another record of the same run. On a bare `Recording` it is
  honestly ABSENT (never fabricated as 0), and a stated value that is not a
  stream position is refused by name.

## [9.59.1] - 2026-08-20

**9.59.0 exists so that an unknown number always carries its own reason. Its
own cache report did not.** Found by the clean-room probe of the published
bytes.

These bytes also carry the two entries still listed under Unreleased above
(the internal `src/integrity/` disposition accounting, and
`firstRetainedIndex` on a capped event tail) — they were already on `main`
when this patch was cut, and they are additive.

### Fixed

- **The cache report no longer invents a cause for a turn it could not
  measure.** _What changed:_ when `cacheRecorder().report()` hands back an
  unknown hit rate, the sentence attached to it is now the one the calls
  themselves gave — most often "no CacheStrategy was given to
  `cacheRecorder()`, so nothing read the usage". When the calls disagree about
  why, the summary says they disagreed and lists the reasons (up to three, then
  a count of the rest) rather than silently choosing one. _Why it was not
  there:_ the summary sentence was typed into the code as a fixed string, "the
  provider reported no cache fields" — true for the case the author had in
  mind, a guess for every other, and it overwrote what each call had already
  stated. _How it improves:_ run without a strategy against a provider that DID
  report cache traffic, and 9.59.0 told you your provider was reporting
  nothing — sending you off to debug a provider that was working fine, instead
  of naming the one line missing from your own setup. You now read the real
  cause. The same fault had a quieter half, also fixed: a provider that cannot
  report cache usage at all was only named when it happened to be the turn's
  FIRST call.

## [9.59.0] - 2026-08-20

**The kernel we shipped in 9.58.0 was right about the law and quiet about
everything else. This release makes it say what it is doing — to the model,
not just to the record — and stops a red gate from ever reaching npm again.**

A clean-room probe found ten defects in 9.58.0. Two further independent
reviews found that several of the first fixes would have been incomplete, or
would have rewritten history. Everything below is the corrected set.

The core law held: **parking never touches the cursor.** That was verified on
the published bytes and is unchanged.

### Fixed

- **A red gate could reach npm, and did.** _What changed:_ the docs-truth
  ratchet now runs inside the build job that the publishing job depends on,
  so a red gate fails the build and the publish never starts — however the
  release was created. _Why it was not there:_ the gate existed, but CI ran it
  on `push` while the publish workflow runs on `release: published`, and the
  release script fires the release seconds after the push. The two raced, and
  npm never waited for a verdict. _How it improves:_ 9.58.0 shipped with a red
  ratchet; that is now structurally impossible.
- **A generated report was being edited by hand.** _What changed:_
  `npm run docs:truth:report` regenerates the report **without** touching the
  accepted-debt baseline, and a test fails if the committed report is not what
  the generator produces. _Why it was not there:_ the report could only be
  regenerated by also re-recording the debt, so an author who merely wanted the
  numbers to match reality had to choose between accepting unrelated debt and
  editing the file. They edited the file: the 9.58.0 release commit changed
  "103 typed events" to "105" and nothing else, leaving the export count stale
  and the ratchet red. _How it improves:_ restating the truth and accepting
  debt are now separate acts, and the file cannot silently drift.
- **The cache meter reported 0% for turns that hit cache on every call.**
  _What changed:_ the strategies read the framework's normalised usage instead
  of raw provider field names, and every number in the report is now a `Claim`
  — a value that says how it knows itself. _Why it was not there:_ the
  strategies parsed `cache_read_input_tokens` off a value that has never
  carried it, so every field read as missing and nothing was recorded; and the
  report typed its totals as plain numbers, so "nobody measured" and "measured,
  and it was zero" looked identical. The test fixtures were themselves
  provider-shaped, which is how it survived a release with a green suite.
  _How it improves:_ a real hit rate, an unmeasured turn that renders as
  unmeasured, and a rate that always states its own denominator ("3 of 20
  calls"). A **silent non-cache** — a prompt below the model's minimum
  cacheable size, which providers process without caching and without an error
  — is now visibly different from a turn nobody measured.
- **A meter was attached to a provider that cannot feed it.** _What changed:_
  the Bedrock strategy declares itself disabled, passes requests through
  untouched, and answers "not applicable" with the reason. _Why it was not
  there:_ it claimed full support and clamped cache markers onto a request
  field our Bedrock provider discards, reporting markers that never reached a
  wire. _How it improves:_ it stays registered, so a Bedrock user is told the
  truth by name instead of guessing. The same honesty is applied to OpenAI,
  which is the costlier gap because it caches automatically.

### Changed

- **A parked map now tells the model it is parked.** _What changed:_ while
  anything is parked, the model receives a short status card naming the cursor
  and the engagement as **separate** things, the reason, and the way back as a
  concrete call. _Why it was not there:_ every honesty signal landed on the
  record, which the model never reads — so re-engagement was reachable in
  principle and unreachable in practice, because nothing told the model that
  re-picking a skill it appears to already be in means anything. _How it
  improves:_ a door the model can see. It also learns the distinction the
  kernel is built on instead of inferring a contradiction.
- **A parked map's tools actually leave the wire.** _What changed:_ parking now
  holds the parked map's tool schemas off the request on its own authority.
  _Why it was not there:_ `.maps()` promised parking stops "the prompt fragment
  and tools", but on the default posture for flat graphs only the fragment
  stopped — the model was shown tools for a skill whose instructions had just
  vanished. _How it improves:_ the promise is true on every posture. This is
  **not** a change to `scopeTools` and does not touch the 10.0.0 ledger: those
  dials answer different questions.
- **A pick of the skill you are already on is now a legal re-engagement.**
  _What changed:_ a `read_skill` pick is routed by intent — of a parked map's
  member it re-engages the map and does not move the cursor. _Why it was not
  there:_ the reachability gate refuses a pick of the node the cursor occupies,
  which is right for a move and wrong for this; since parking never moves the
  cursor, a parked map is parked exactly where the model wants to return. For a
  single-member map that made parking permanent. _How it improves:_ the
  documented recovery door is real.
- **An engagement's founding cause is never rewritten.** _What changed:_ the
  record now keeps three separate facts — why the map is participating at all,
  why the cursor is on this member, and why this contribution is being served
  right now. _Why it was not there:_ one field answered all three, so
  confirming a guess silently overwrote the guess, and a record founded on a
  keyword at iteration 1 later read as system-backed since iteration 1. _How it
  improves:_ an incident review can still ask "was this founded on a guess?"
  and get the true answer, however much has happened since.
- **A declared route no longer forges a user request.** _What changed:_ when a
  declared edge moves the cursor to a different member, that member's
  eligibility is worked out from **its own** evidence rather than inherited.
  _Why it was not there:_ the next member inherited the previous one's
  standing, and an explicit request never decays — so one explicit pick at the
  top of a turn silently warranted every skill the graph walked to afterwards.
  _How it improves:_ a member entered weakly can park, exactly as if it had
  been entered that way from the start. The founding cause still says, forever,
  that the engagement began explicitly on the skill that was actually asked for.
- **A new turn is judged on the new turn's evidence.** _What changed:_ a cursor
  carried into a new turn with nothing explaining it is recorded as `assumed`
  — nobody said why — which is the weakest rung and expires like any guess.
  _Why it was not there:_ an absent explanation was recorded as system-backed,
  the strongest and non-decaying category, so turn one's mistaken keyword match
  became a permanent warrant on turn two and every turn after. _How it
  improves:_ cursor continuity and engagement continuity have independent
  lifetimes, and both are now pinned by tests — half the defect was that
  nothing pinned either.
- **The idle test checks all three of the conditions it documents.** _What
  changed:_ a map only accrues idle when its contribution was actually served,
  none of its tools was called, and the turn went elsewhere. _Why it was not
  there:_ only the last was checked, while the refusal text asserted all three.
  _How it improves:_ nothing claims a fact it did not check. (Making it honest
  needed the kernel to carry its own record of what was served — reading it
  from the existing delta machinery was silently empty in the grouped chart
  shape, which would have disabled parking there entirely.)
- **A map that cannot explain its cursor moves is refused at mount.** _What
  changed:_ `.maps()` requires a map that reports why the cursor moved. _Why it
  was not there:_ without it, no explanation ever arrives, and a kernel whose
  whole job is weighing evidence had none to weigh — silently. _How it
  improves:_ the failure is named at build time instead of at 3am.

### Added

- **`.maps({ nonParkable: true })`** — mount a map as mandatory, so it never
  parks however long the turn ignores it. For a policy, compliance or safety
  map, whose absence is a defect even when unused. It was documented as
  shipped and was unreachable: the kernel's data model carried the field and
  no option ever set it. It suppresses the park, not the measurement — the
  record still shows a map riding every call unused.
- **Two documentation pages**: _Mounted maps_ (the kernel's why, the evidence
  ladder, the idle test, the three facts, turns, and the park card) and _The
  cache meter_ (how to read a report, and exactly which providers can feed it).
- **A measurement, not a fix, for the prompt-cache cost of `read_skill`.** The
  tool's description is rebuilt from the cursor every iteration, and changing a
  tool definition invalidates a provider's entire prompt cache. A shipped test
  measures it: a five-call turn with four cursor moves produces five distinct
  descriptions — one full cache rebuild per call — while a turn whose cursor
  sits still produces exactly one. Fixing it properly is a cross-layer change
  with a routing-quality risk, so it is recorded with its numbers in
  `docs/design/2026-08-recorded-not-built.md` alongside three other deferred
  design questions, rather than rushed.

### Note for anyone reading the cache report in code

`cacheRecorder().report()` returns `Claim` values, not bare numbers. Read them
through `isKnown(...)`, or render them with `describeClaim(...)`. This is a
signature change in a minor release, and deliberately so: the old bare numbers
were not a contract worth keeping, because the value was zero on every turn.

## [9.58.0] - 2026-08-20

**A map's cursor says where it stands. Nothing said whether it had earned
its seat. Now something does — without touching the cursor.**

From the same recorded consumer-integration corpus as 9.55.0–9.57.0. A
person asked to "find the most recent **zone** redundancy run" — where
"zone" was the name of a thing they wanted to find, not a task — and an
entry regex read it as a task. The turn started standing on an audit skill
and never left: the cursor law ("stay until an edge leaves") is correct,
no edge could fire, and the skill's procedure plus its four never-called
tools rode all 30 calls of a 359,000-token turn. 29 of 30 moves were
"stay". The map behaved exactly as specified; what was missing is the
layer that asks whether a contribution is still earning its place.

### Added

- **The maps kernel: `.maps()` — engagement, orthogonal to the cursor.**
  A mounted map (the skill map today) keeps sole ownership of its
  position, always. What the kernel owns is ENGAGEMENT: whether the map's
  prompt and tools ride the next call. An engagement founded on a guess
  (`lexical` keyword, `semantic` classifier) is renewed only by concrete
  evidence — the map's own tool called, a declared route fired, the model
  asking by name — and without corroboration for `renewalGrace`
  consecutive passes (default 3) it is **parked**: skipped by the
  evaluator with the honest reason `'parked'`, on every record, cursor
  untouched. Explicit or structural evidence re-engages it on the spot —
  an accepted `read_skill` pick is the recovery door, so parking is never
  a trap. Engagements the system or the model founded (`structural`,
  `explicit`) never decay; `nonParkable` maps never park. On the recorded
  turn, the kernel parks the wrongly-guessed map on call four, saving the
  remaining ~26 calls from re-serving ~7k characters of the wrong map.
- **A new door, `agentfootprint/maps`** — the kernel's vocabulary as pure
  data and pure functions: the lease machine (`advanceEngagement`), its
  renewal feed (`renewalEvidenceOf`), the strength ladder, and
  **`Claim<T>`** (`known` / `unknown` / `notApplicable`) — a value that
  says how it knows itself, so an unknown count can never render as zero.
- **Two typed events in a new domain**: `agentfootprint.map.engaged` and
  `agentfootprint.map.parked` (with strength, witness, idle count),
  bridged and wildcard-subscribable from day one — a rule whose
  engagements always park with zero renewals is measurable decoration,
  which is the declaration telemetry this ships.
- Runnable example: `examples/context-engineering/21-park-the-wrong-map.ts`
  reproduces the trap and runs it with the kernel off and on.
- **Two entry-evidence rows in `graph.checkup()`** — the build-time half of
  the same repair, replacing the intuitive per-node exit lint (which flags
  0 of 20 on the real failing graph, and 19 of 20 with its reachability
  half dropped — both wrong). `one-way-entries` (warning, once per graph):
  three or more rule-driven entries and more than half declare no outgoing
  edge — the stated precondition of a permanent mis-entry, with the cures
  named. `no-negative-evidence` (warning, once per graph): three or more
  rule-driven entries with zero `examples` and zero `neverRoutes` — the
  proving machinery ships and nothing uses it; the consumer that hit the
  recorded failure declared neither, anywhere. Warnings, not refusals, by
  the zero-delta law; and the recorded trap phrase declared as a
  `neverRoutes` row against its own graph is a build ERROR with a witness
  (pinned by test) — the incident as build-time arithmetic.

Zero-delta when unmounted: no scope key, no events, and the evaluator's
loop is byte-identical — the same guarantee `leaseActiveIds` (9.19.0)
models, of which the park check is the deliberate mirror.

### Fixed

- **The server Anthropic adapter now keeps both halves of the cache
  contract.** `AnthropicCacheStrategy` prepares cache markers for the
  `'anthropic'` provider on every call, and the adapter silently dropped
  them — so on the server path a byte-identical prompt prefix (measured at
  roughly 65% of every call on a real recording) was paid at full rate, and
  the miss was invisible: no `cacheRead`/`cacheWrite` ever came back on
  `usage` for a meter to read. Markers now reach the wire as
  `cache_control` (with the same request→body index translation the browser
  adapter already pins), and the API's `cache_read_input_tokens` /
  `cache_creation_input_tokens` come back as `usage.cacheRead` /
  `usage.cacheWrite` on both adapters, streaming included. Absent stays
  absent — an adapter never invents a zero for a number the provider did
  not report. The marker application itself moved to one shared module,
  `anthropicCacheWire`, so the two adapters cannot drift apart again.

## [9.57.0] - 2026-08-20

**The window used to keep the task and throw away the evidence. Now it keeps
both — and says so either way.**

From a context-gap audit over five real recorded runs of a consumer
integration. An agent drove a screen through tools. One tool result carried the
only list of ids it was allowed to act on. Under a small window that result
survived about two iterations — an assistant message plus its tool results is
ONE turn, so two kept turns are two tool rounds. Since 9.55.0 the user's
REQUEST is undroppable, so the model still knew exactly what it had been asked
to do, and no longer had the evidence to do it.

What it did next was invent. It took an entity name it remembered plus the
shape of an id it had used earlier, assembled one that has never existed, and
was refused — a wasted action out of a small budget. In one archived run the
final answer to the _person_ named a host that appears in no tool result at
all.

Nothing in the conversation said the evidence had gone. That is the release.

### Added

- **The window keeps each tool's most recent result.** For every tool the
  agent is using, its latest result stays in the window — up to
  `keepLastToolResults` (default **2**) beyond the recent-turns window — until
  the agent calls that tool again, or the person asks something new. The turn
  refuses by name, as `'last-tool-result'`.

  It lives in the one shared refusal engine, so all three shipped strategies
  and any strategy **you** wrote inherit it without an edit — the same way they
  inherited the 9.55.0 anchor.

  It cannot run away with your window. One pin per tool NAME, superseded on
  that tool's next call, so the candidate space is your tool roster and not
  your transcript. A parallel batch is one turn and costs one slot. A pin
  already inside `keepRecentTurns` costs nothing at all. Nothing at or before
  the current request is pinnable, so a new user turn releases the whole
  previous loop. The floor is `1 request + keepLastToolResults pins +
keepRecentTurns turns`, whatever your tool count, iteration count or run
  length.

  And a pin that BLOCKS is worse than a pin that misses: when two consecutive
  visits both removed nothing and both named `'last-tool-result'`, the pin
  releases for one visit and files `observations.standDown: true`. Two blocked
  boundaries is the hard bound, under any strategy.

  `keepLastToolResults: false` (or `0`) reproduces 9.56.0 byte for byte.

- **A drop now says whose results it took.** The authored notice gains one
  sentence: _"Tool results are among them (whats_here, pan_view) — call the
  tool again if you need its output; do not reconstruct ids or values from
  memory."_ The drop is now STATED rather than silent — whether that sentence
  changes what a model does next is **not measured here**: the five archived
  runs have not been re-run with it on, so it ships as an honesty fix and not
  as a performance claim. Tool names are the only caller data that reaches it, and they
  are shape-filtered to a plain identifier and **dropped, never truncated**,
  when they are not one — at most four, then `…`.

- **`WindowRecord.droppedObservations`** — the same fact on the record, full
  and uncapped, and filed even when no notice was authored at all. A removal
  further into the window inserts nothing, so the model is told nothing; then
  the record is the only witness.

- **`WindowRecord.observations`** — what the pin KEPT: each held turn, its
  tool, and its exact character count, plus what the ceiling turned away.
  Subtract the pinned chars from `windowCharsAfter` and you have the window
  this run would have had without the feature. A framework that keeps
  something has to be as visible as one that removes something.

- **An instruction can SAY a run-time number, not only gate on it.**
  `defineInstruction({ promptTemplate })` renders on every action from a
  CLOSED three-word vocabulary — `{{action}}`, `{{actionBudget}}`,
  `{{actionsRemaining}}`:

  > You are on action 25 of 30; 5 remain. Finish what you have rather than
  > start something new.

  Measured, not decorative: given its remaining budget a model wrote _"I have 5
  steps left, enough to finish this properly"_ and landed the task, where
  before it spiralled and produced no answer at all.

  The vocabulary is closed rather than a `(ctx) => string` because of
  **absence**. Given a function, an author writes `${ctx.maxIterations}` and
  ships _"23 of undefined"_, or writes `?? 0` and ships a fabricated
  denominator that nothing — and no model — can tell from a real zero. With
  named slots the library owns absence and applies one rule: if any named fact
  is unavailable, the whole instruction is skipped, by name, as
  `skipped: 'unknown-fact'`. Never a gap, never a fake zero, never the literal
  placeholder. A name outside the three is refused at define time, with the
  three listed in the error.

- **`InjectionContext.maxIterations` / `.iterationsRemaining`** — so a
  predicate can gate on how much room is LEFT rather than on a raw iteration
  number that means nothing on its own. They arrive paired: both, or neither.
  `iterationsRemainingOf` is now the one denominator, shared with the cache
  decision and the request assembly, so the three cannot drift by one.

### Fixed

- **A courtesy message could stop a window strategy dropping anything, for the
  rest of the run.** The drop notice was authored whenever a removal reached
  the front of what may leave, and the whole removal was abandoned when that
  notice was not smaller than what it replaced. But the obligation the notice
  exists for is narrower — the window must OPEN ON A USER TURN — and when the
  message that would become the head was already a user turn (the pinned
  request, or an older turn of a restored conversation) no notice was owed at
  all. Its 245–358 characters were nevertheless allowed to veto a legitimate
  drop; and because the removable span is the longest _contiguous_ run, the
  same verdict came back at every boundary while the window grew without
  bound.

  Reproduced by execution in both shapes before the fix: ten boundaries,
  `removedMessageCount === 0` every time, the window climbing from 10 to 28
  messages and still climbing. The decision is now a ladder — the notice
  naming the dropped tools, else the plain notice, else no notice at all — and
  `'replacement-not-smaller'` fires only when the wire genuinely needs a
  message in that position and none of them fits.

### Changed

- `WindowRefusalReason` gains `'last-tool-result'`. A consumer with an
  exhaustive `switch` over the union gets a compile error — deliberately, and
  precedented by 9.55.0: a reason that appears at run time and nowhere in your
  code is a reason nobody reads.
- The drop notice's text changed (one sentence added). It has always been
  library-authored prose; match it with `DROP_NOTICE_PREFIX` / `isDropNotice`,
  never on the full string.
- A **templated** instruction files one `agentfootprint.context.injected` per
  action where a static one files one per run, because `ContextRecorder` dedups
  by content hash and a template's content really is different every action.
  That is more truth, not less — but a consumer counting rows will see N times
  as many. Note also that a never-cacheable injection truncates the cached
  prefix at its declaration position, so **declare templated instructions
  last**.

## [9.56.0] - 2026-08-19

**Running out of budget now ends with an honest summary, not a fragment.**

From two real recorded runs of the same shape. An agent hit `maxIterations`
mid-task, the loop stopped, and the turn's "final answer" was whatever text
happened to ride the last call:

```text
The third finding focus is not settling… Let me check what's on screen now:
```

That sentence went to the person as if it were the answer. The status said
`ok`. Nothing on the record said the budget had run out, and the model never
got a chance to wrap up.

`maxIterations` is a cap on ACTIONS, and the model does not know it is about to
be hit. Every turn that ends against it ends mid-thought — that is not an edge
case, it is what the limit does.

### Added

- **One last call, with the tools withheld.** When `maxIterations` runs out
  while the model is still asking for tools, the run now spends one more LLM
  call carrying one instruction, and hands back what comes back:

  > Your action budget for this turn is exhausted. Do not request tools. Give
  > your best final answer from what you have: what you completed, what remains
  > undone, and anything the person should know.

  The tools coming off is the mechanism, not a courtesy. A model that was
  offered no tools has nothing to ask for, so the call can only answer — which
  is why it is exempt from `maxIterations` by construction rather than by an
  exception someone has to trust. It costs one call, and it is on the record
  like any other turn: its own `iteration_start`, `llm_start` and `cost.tick`,
  and a `wrap-up` box on the chart.

  On by default, because a half-sentence delivered as an answer is never what
  anyone wanted. `wrapUpAtMaxIterations: false` keeps the old behaviour.

- **`agentfootprint.agent.budget_exhausted`** — the budget ran out, and what
  the run then DID about it: `action: 'wrapped-up'` or `'cut-short'`. It fires
  beside `cost.limit_hit` rather than instead of it — that event reports a
  limit being crossed and stays exactly that; this one is the difference
  between an outcome chip that says "answered" and one that says "answered
  after the budget ran out". It fires for a halting `costBudget` too.

- **`stoppedEarly.wrappedUp`** and **`turn_end.stoppedEarly`.** The same fact,
  where each reader already looks: `agent.stoppedEarly()` for proof after the
  run, `turn_end` for the consumer drawing an outcome the moment the answer
  exists. When a turn was wrapped up, `answerWasEmpty` describes the answer the
  caller actually received — not the fragment it replaced.

### Changed

- A turn that runs out of `maxIterations` with tool calls pending now makes one
  more LLM call than it did in 9.55.0, and its answer is that call's answer
  rather than the last fragment. This is the fix, and it is worth stating as a
  change: an agent whose tests assert the old empty-or-fragment answer will see
  the new one.

  It rides the ITERATION budget only. A halting `costBudget` is unchanged —
  there you capped the money, and one more call would spend past the cap you
  set; an action cap says nothing about a call that takes no action.

  **A turn that never runs out of budget is byte-identical**: same calls, same
  events, same committed state down to the key set. So is an agent with no
  tools to withhold, which never mounts the branch at all.

## [9.55.0] - 2026-08-19

**The window can no longer forget what you asked for.**

Caught in a real recorded run, and quiet enough that it finished the task
anyway. A ten-iteration tool loop under a small window dropped the window's
head at iteration 4 — and the head was the user's own request. The context the
model worked from after that held the tool traffic, this line:

```text
[dropped history — 3 earlier message(s) were dropped from this window at iteration 4 …]
```

…and no statement of the objective anywhere. It finished by momentum. A longer
walk forgets what it was doing halfway through, and nothing in the record says
that is what happened.

It was not a bug in one strategy. On a fresh window the request is the OLDEST
message, and every window strategy here removes the oldest thing first — so it
went first, every time, under all of them.

### Fixed

- **The current request is un-droppable, under every window strategy.**
  `slidingWindow`, `tokenBudget`, `summarizeOldest` (`.compaction()`) — and a
  strategy you write yourself, which inherits the rule without knowing it
  exists. The fix is one refusal in the shared refusal engine, which is the
  only place every strategy has to pass through, rather than three fixes in
  three files that could drift apart.

  Other history drops ahead of it. If the budget cannot hold even the request
  plus the recent turns, nothing is removed at all: the window stays big, the
  record says why, and the run proceeds. That is the right way round — a
  request the model can no longer see is not a smaller context, it is a
  different task.

- **The refusal is named, like every other one:** `'current-request'`, a new
  member of `WindowRefusalReason`, filed on the `WindowRecord` with the turn
  and message index. A window that stayed big because of this rule says so.

- **The drop notice says what it kept.** When a drop stops short of the head
  because the request is sitting there, the authored notice takes the position
  just after it and gains one sentence, in the library's own words:

  ```text
  Your current request is kept — it is still in this window, above this line,
  and no window strategy may drop it.
  ```

  A model reading "3 earlier messages were dropped" and then finding a request
  above it should be told which of the two facts to trust. The sentence appears
  only on that path; every other notice is byte-identical to the one 9.54.0
  wrote.

- **Multi-turn is unchanged.** The anchor is the LATEST thing the person said —
  matched against the message the run was started with. Earlier turns of a
  restored conversation stay exactly as droppable as they were; only the turn
  being executed is protected. Three kinds of `role: 'user'` message are
  written by this library and none of them can become the anchor: a drop
  notice, a compaction frame, and a message an injection delivered.

### Nothing new to learn

No new option, no new door, no new event. `WindowRefusalReason` gained a
member, and a strategy you wrote yourself gets the rule without changing a
line — the bound `planRemoval` refuses that turn, exactly as it refuses an
unanswered tool call. The guards stay where they have always been: a strategy
receives the answer, never the guards.

### Unchanged, and pinned

A window that never dropped the request keeps its exact bytes: same span, same
notice wording, same record, same rebase. There is a test that pins it, and a
test that reproduces the original ten-iteration run and asserts the request is
present in EVERY iteration's context.

## [9.54.0] - 2026-08-19

A mid-call tool report now reaches **the person watching**, not only the
record.

`ctx.progress(payload)` shipped in 9.52.0 and did its half of the job well: a
report from inside a still-running tool call became a typed, stamped, ordered
`agentfootprint.stream.tool_progress` event, on the record and in the
envelope. A consumer integration then found the other half missing, and their
sentence is the whole bug report: `tool_progress` "is emitted by the tool-call
stage and in the event registry, but no status strategy consumes it — so it
lands on the record, not in the browser."

They were right. Nothing projected the event onto the surfaces a person
actually watches, so every consumer kept a hand-rolled side channel for the
live middle of a long call — which is half the feature written twice, in every
integration. The record half and the live half must come from ONE call. Now
they do.

### Added

- **The live status line consumes `tool_progress`.** While a tool call is in
  flight, an arriving report updates the sentence
  `agent.enable.liveStatus(...)` hands to whatever renders your chat bubble —
  and the low-level `attachStatus(dispatcher, { onStatus })` door too. No new
  event, no payload change, no wiring on your side: the arm was missing, and
  this adds the arm.

- **The display contract, stated and narrow.** `payload` is author-defined
  `unknown`, so a surface that guessed at it would put words in a tool's
  mouth. One rule, and it is the whole rule:

  | your payload                 | the line a person reads                          |
  | ---------------------------- | ------------------------------------------------ |
  | `{ message: 'Hop 3 of 12' }` | `Hop 3 of 12` — your sentence, verbatim          |
  | `{ done: 3, total: 12 }`     | `` `walk_graph` reported progress (3 so far)… `` |
  | `'a bare string'`            | the same generic line                            |

  A top-level string field named **`message`** is shown verbatim, trimmed, and
  cut at **120 characters** with the cut stated (`… (+N more)`) — `message` is
  the field MCP's own progress notification uses, so a tool already speaking
  that protocol needs no second vocabulary. Anything else — no `message`, a
  non-string one, an empty one, a bare string payload — gets the generic line:
  the tool's name, that it reported, and how many times.

  What it will **never** do is pretty-print your payload into a human
  sentence. A status line is prose, and a tool's JSON is not a sentence anyone
  wrote. One tool's `total` is hops and the next one's is bytes; a line that
  said "3 of 12" about the wrong unit would be worse than one that said
  nothing.

- **One call, two honest faces.** The structured payload rides to the record
  untouched either way. Adding `message` does not remove your numbers — it
  adds the half a person can read, and `getRecording()` still carries the rest.

- **Parallel calls interleave correctly, keyed by `toolCallId`.** Two calls in
  flight each keep their own progress tally; the newest report wins the line
  and names the call that made it; a call ending removes only itself. That
  last one also fixes a quieter imprecision that predates this release: a
  `tool_end` used to be able to clear a SIBLING call's status, leaving the
  bubble blank while a tool was still working.

- **Commentary narrates the middle**, so recordings replay it: _"The
  `walk_graph` tool reported progress while it was still running."_ The
  teaching voice states the fact and never the payload — the same split the
  Lens teaching view keeps, in the same words.

- **Consumers override by template key.** `tool.progress` (the `message`
  case), `tool.progress.generic` (everything else), or per tool with
  `tool.<toolName>.progress` / `tool.<toolName>.progress.generic` — the same
  map `.thinkingTemplates(...)` already takes.

### Changed

- **A tool that already calls `ctx.progress` will see its status line move
  where it did not before.** That is the fix, not a side effect. If you shipped
  a curated `tool.<toolName>` line and want it to stand through a call's
  reports, delete `tool.progress.generic` from your template map: the ladder
  falls through to `tool.<toolName>` and then `tool`, so a template map written
  before this release renders exactly what it always did, and nothing here can
  blank a bubble that used to have a line in it.

- A tool that never reports is **byte-identical** — same events, same status
  lines, nothing to opt out of. Pinned by a test that says so.

### For consumers

If you hand-rolled a side channel to show the middle of a long tool call —
a second event listener, a parallel status store, a bespoke
`tool_progress` → string renderer — you can delete it. Add `message` to the
payload you were already sending and the line says your words; leave it off
and the line still says the call is working.

## [9.53.0] - 2026-08-19

A tool can return **series, facts, and provenance as typed data** — and a
build gate refuses a triage tool that forgets its caveats.

The ask came from a triage-platform team with seventy tools. The things that
make a tool's numbers honest — the collection interval, whether the values
are counters that must never be summed, when the world was actually measured,
which clusters were NOT collected — were re-written by hand inside every tool
and held in place by code review. Culture like that scales to one disciplined
author, not to a hundred tools. This release makes the caveats **data that
travel with the numbers**, and makes forgetting them a build failure with the
tool's name on it.

### Added

- **`semantic({...})` — the semantic tool-result envelope.** A tool's
  `execute` returns typed data instead of prose:

  ```typescript
  return semantic({
    series: [{ t: '2026-08-19T10:00:00Z', entity: 'fc1/3', metric: 'avg_iops', value: 18450 }],
    grain: { interval: '30m', aggregation: 'avg', is_counter: false },
    provenance: { measured_at: '2026-08-19T10:20:00Z', source: 'InfluxDB SwitchPortStats' },
    coverage: {
      checked: ['fabric A: all 48 ports'],
      notChecked: [{ what: 'the peer fabric', why: 'collector scoped to one fabric' }],
    },
    render: { default: 'table', columns: ['entity', 'value'], sort: 'value desc' },
  });
  ```

  Fields: `series` (measured points), `facts` (typed rows, each naming its
  `entity`), `edges` (typed relationships), `grain` (what one value MEANS —
  interval, aggregation, `is_counter`, what was collapsed), `provenance`
  (when the WORLD was measured — not when the tool ran — and from which
  source), `coverage` (the exact three-list vocabulary `coverage()` and
  `absent()` already speak — absorbed, never duplicated), `clarify` (the
  ask-vs-answer decision as data), and `render` (hints for a UI — the tool
  never renders). `semantic()` refuses at the call site anything the
  vocabulary cannot honor: series without grain, data without
  `measured_at` + `source`, a counter-looking aggregation with `is_counter`
  unstated.

- **Two views of one envelope.** The MODEL reads a compact rendering-free
  projection — the data, the grain, the provenance, the composed
  `not_covered` prose (derived from `coverage`, so the two can never
  disagree), and a static note; it never sees the marker, the `render` hints
  or the three-list coverage detail. The RECORD gets everything: the full
  envelope rides the new typed `agentfootprint.tools.semantics_declared`
  event (registry now 102 events / 22 domains) into recordings and UIs — and
  it is filed BEFORE the tool's `resultCeiling` is measured, so an oversized
  result cannot silently delete its own caveats. The ceiling itself measures
  the projection, because that is what the model would have read.

- **The envelope's `coverage` flows through the coverage channel.** Same
  `tools.coverage_declared` event, same tracked state, and
  `.limitsTravelWithTheAnswer()` appends it to the final answer — exactly as
  if the tool had used `coverage()`. The three result envelopes compose on
  one return value: `{ content: semantic({...}), effects: [...], status }`.

- **`defineTool({ resultClass })` — a declared class for a tool's results.**
  `'triage'` (a health/fault verdict) or `'inventory'` (a population
  listing); closed set, validated at definition (`assertResultClass`), never
  inferred.

- **`check:semantics` — the build gate.** Judges sample results (what your
  mock tools return, dumped to JSON — the `check:tools` convention) against
  the envelope rules and the class rules: a `'triage'` or `'inventory'` tool
  whose sample declares no coverage **fails the build naming the tool and the
  field**; a marker-bearing envelope with faults fails under the recognizer's
  own codes; only provable violations error. Ships as the
  `agentfootprint-check-semantics` bin (exit 0/1/2, `--strict`, `--json`)
  with the unit-tested core (`checkSemantics`, `formatSemanticsReport`,
  `coerceSemanticsCatalog`) on `agentfootprint/observe`.

- Zero-cost when unused: recognition is strict (`af_semantics: true` AND the
  whole rule set), so every value any tool has ever returned keeps its bytes.
  Runnable example: `examples/features/66-semantic-envelope.ts`. Guide:
  docs _Build → Semantic tool results_.

## [9.52.0] - 2026-08-19

A tool can now say **"hop 3 of 12 done"** while it is still working.

Until this release a tool call was one atomic thing on the record:
`stream.tool_start` fired, your handler ran for as long as it ran, and
`stream.tool_end` carried the result. For a tool that finishes in 200ms that
is the whole story. For a twelve-hop graph walk that takes forty seconds it is
one long silence — and from outside, a tool that is working and a tool that has
hung look exactly the same. That was the ask, from a team whose agent walks a
dependency graph: nothing in the framework could report the middle of a call.

### Added

- **`ctx.progress(payload)` — progressive tool results.** One new method on
  `ToolExecutionContext`, callable as many times as you like from inside
  `tool.execute`:

  ```typescript
  execute: async (args, ctx) => {
    for (const [i, hop] of hops.entries()) {
      await visit(hop);
      ctx.progress({ done: i + 1, total: hops.length, hop: hop.id });
    }
    return summarize(hops);
  },
  ```

  Each call files one event, in call order, always between that call's
  `tool_start` and its `tool_end`.

- **`agentfootprint.stream.tool_progress` — the new typed event** (registry
  101 events / 22 domains), payload
  `{ toolCallId, toolName, iteration, payload }`. **The framework stamps the
  identity; the author owns the payload.** `toolCallId`, `toolName` and
  `iteration` come from the dispatch the framework is already holding, so a
  report can never claim to be from another call and a UI can correlate
  without trusting the tool; `payload` is your data, forwarded verbatim (any
  shape, as long as it survives `structuredClone`). Because the name starts
  with `agentfootprint.stream.`, it reaches a browser with no wiring of its
  own — `toSSE(agent)` carries it, and so does
  `agent.on('agentfootprint.stream.*')` — and it lands in recordings, so
  "where did those forty seconds go?" is answerable from an archive months
  later.

  It is **telemetry, not a result**: progress never enters the tool result,
  the history, or anything the model reads. The model still sees exactly one
  result, at the end, as it always did.

  Three rules make it safe to call from anywhere: **always present** (never
  `undefined` — the doors with no event stream to file on, a call served over
  `mcpServe` and the offline `callTraceTool` context, supply a no-op, so one
  handler is safe inside an Agent and outside one); **never fatal** (with
  nothing listening the report is dropped; it never throws, never blocks, and
  never changes what `execute` returns); **zero-cost when unused** (a tool
  that never calls it produces exactly the event stream it produced before —
  no `tool_progress` rows, nothing else moved, pinned by a test that compares
  the two streams row for row).

- **Example: `examples/features/65-tool-progress.ts`** — the twelve-hop walk on
  the mock provider: a live progress bar drawn from
  `agent.on('agentfootprint.stream.tool_progress')`, the framework stamps shown
  beside the author's payload, the same reports read back off a real `toSSE`
  stream, and a second agent whose tool reports nothing proving the feature
  costs nothing to anyone who does not use it.

## [9.51.0] - 2026-08-19

Route edges can now declare their condition as **data** — the map shows it,
the checkup checks it, the recording carries it. This completes the
SkillWalker's third mover: the map is data, entry matchers are data,
tool-outcome route arms are data — the general context guard was the last
opaque function on a route edge.

### Added

- **`guard:` on route edges — guards as data (the `when` predicate's declared
  twin).** `.route(a, b, { guard: { riskLevel: { in: ['high','critical'] },
score: { gte: 0.7 } } })` — conditions over the hop (`toolName`, `result`,
  `status`, `iteration`, `userMessage`, `currentSkillId`) and over the tool
  result's own top-level JSON fields, operators `eq/ne/gt/gte/lt/lte/in/notIn`
  (deliberately footprintjs's `WhereFilter` grammar, mirrored door-locally —
  the skill-graph door's no-footprintjs fence holds), every condition ANDed.
  At most ONE of `when`/`guard` per edge, refused at build naming both; a
  guard composes with `onToolReturn`/`onToolStatus` ("this tool, this
  outcome, AND these conditions"). ONE compilation produces the predicate
  that routes, the serializable `SkillGuardData`, and the evidence evaluator
  — so the three can never describe different guards. What being data buys:

  - **the check-up proves contradictions** — new ERROR
    `guard-unsatisfiable`: crossed bounds (`gt: 5, lt: 3`), `eq` a same-key
    `ne`/`in`/`notIn` excludes, a `status` outside the closed result-status
    vocabulary (the typo `'sucess'` is caught at build), or a guard that
    contradicts the edge's own `onToolStatus`/exact `onToolReturn`. Only
    provable breakage errors; nothing is claimed across keys or about
    runtime values.
  - **the map shows it** — `toMermaid()` captions a guard-only edge
    (`when riskLevel in [high, critical]`) and folds the clause into
    tool/status edge captions; guard-only edges draw as the new
    `SkillEdgeKind` `'guard'`; `SkillEdge.guard` carries the data.
  - **the recording carries it** — `skill.graph_declared` edges gain an
    optional `guard` field (additive), so a viewer drawing the SkillMap from
    a recording shows the guard conditions; route provenance
    (`metadata.skillGraph.guard`) rides too.
  - **every decision leaves evidence** — when a guard decides a hop, the
    move on `context.evaluated.cursorMove` carries the full per-condition
    evaluation: `guard` on the taken hop (verdict `true`) and `guardsClosed`
    for refusals (verdict `false`, at most one per edge per iteration, on
    whatever move resulted — a stay says `score gte 0.7 — saw "0.2" →
failed`). Agents without guards keep byte-identical events.

- **SkillMap & SkillWalker are now the official names.** You declare the
  **SkillMap**; the agent is the **SkillWalker**; the recording carries both.
  `defineSkillMap` ships as a permanent, reference-equal alias of
  `skillGraph` (and `SkillMap` of the `SkillGraph` type) on the
  `agentfootprint/context` and `agentfootprint/skill-graph` doors — both
  names forever, nothing renamed. There is deliberately no `SkillWalker`
  export: the walker is the agent itself, moving the cursor by exactly three
  movers — **llm** (the model picks, the gate bounds), **guard** (your data
  decides, evidence recorded), **linear** (no choice, every time).

- **Example: `examples/features/64-skill-map-guards.ts`** — the whole story
  on the mock provider: one SkillMap with all three movers, a guard that
  passes (evidence on the taken hop), a guard that refuses (the stay explains
  itself), the declared map carrying the conditions, and a contradictory
  guard refused at build.

## [9.50.0] - 2026-08-19

Three recording-surface facts, all born the same way: a debugger built over
recordings (the lens's SkillGraph views, echoed by an external triage-platform
design) kept finding facts the framework KNEW at run time but put on the
record only as prose — or not at all. "Don't parse reachability out of prose"
is the whole release.

### Added

- **`agentfootprint.skill.graph_declared` — the author's map, on the record.**
  Fired ONCE per run, right after the run-configuration manifest, for every
  agent whose `.skillGraph()` mount can state its map: the declared nodes
  (id, kind, catalog description verbatim, caption) and edges (from — `null`
  for the synthetic START — to, kind, caption), straight from the built
  graph and never inferred from runtime hops. Until now a recording's only
  declared-edge source was per-hop `routing[]` provenance, which names an
  edge once it FIRES — a lower bound every topology view had to caption
  "partial" or paper over by making the consumer pass the built graph in by
  hand. Same dispatch discipline as the manifest (the `createExecutor`
  funnel both `run()` and `resume()` share; stated pseudo-stage
  `graph-declared#0`; listener-gated), so a resumed run's fresh runId carries
  its own copy and `recordRun`'s `'*'` subscription archives one in every
  recording. No graph — or a structurally-typed graph that carries no
  `nodes` — files nothing: absent, never guessed. The projection is the pure
  `buildSkillGraphDeclared` (`src/core/agent/skillGraphDeclared.ts`).

- **`context.evaluated.cursorMove.reachable` — where the run could go next,
  typed on the move itself.** The routing gate has always known this set: it
  rebuilds `read_skill`'s menu prose from it every iteration and writes the
  refusal messages from it. Now every cursor move carries it as data — the
  declared hops out of the LANDED cursor plus the open skills, composed from
  the SAME two resolvers the gate uses, so the recorded set can never drift
  from the verdicts (`skill.rejected.allowed` — already typed — is the same
  set, on the refusing iteration). `[]` is a fact (a dead end); absent means
  the mounted graph predates `reachableSkills` and the set was honestly not
  on the record. The prose menu is untouched — this is additive data beside
  it, not a replacement.

- **`stream.llm_start.systemPromptText` — the assembled system prompt,
  opt-in.** New dial `recordSystemPrompt: true` on `AgentOptions` and
  `LLMCallOptions` (the `contextBudget` twin pattern). When on, every
  `llm_start` carries the joined injection pieces byte-for-byte as the
  provider received them — the one artifact the model actually read, which
  recordings until now only described piecewise (each injection is on the
  record; the assembled whole was an honest "not in this recording" card).

  **The default is OFF, and the default is the feature.** The assembled
  prompt is as sensitive as everything injected into it — skill bodies, RAG
  passages, memory recalls, per-user instructions — and it can be large,
  once per iteration. With the dial on it rides into every attached
  recorder, every vendor sink, every `recordRun` recording and every
  persisted envelope: treat those artifacts as being as sensitive as the
  prompt itself. Off, `llm_start` keeps its exact prior bytes —
  `systemPromptChars` still reports the length, and the envelope tests pin
  that the archived BYTES contain no prompt text by default.

- **Example: `examples/features/63-recording-carries-the-map.ts`** — one
  skill-routed mock run archived with `persistRecording`, all three facts
  read back off the JSON file, and the privacy default proven on the
  archived bytes of a second, un-opted-in run.

### Notes for recording consumers (the lens, triage platforms)

- Draw the declared topology from `skill.graph_declared` (`declaredSource:
'recording'` can now mean COMPLETE); filter `from !== null` for
  node-to-node edges, exactly as with a built graph's `edges`.
- Fill per-beat reachability from `cursorMove.reachable` first; the refusal's
  `allowed` and declared-edge folds remain as fallbacks for older eras.
- Render the assembled prompt from `llm_start.systemPromptText` when present;
  its absence still means "not in this recording", which stays the honest
  card for every run that did not opt in.

## [9.49.0] - 2026-08-18

### Added

- **The `sf-` subflow prefix is RESERVED, and the doors refuse it.** Framework
  composition segments are named `sf-*` (`sf-llm-call`, `sf-tools`, `sf-cache`,
  and more each release), and every downstream reader — commentary, step
  graphs, the OTel bridge, trace fingerprints — tells library plumbing from
  consumer structure by that prefix alone. So a consumer branch named
  `sf-billing` never failed like a name clash: it was silently read as
  plumbing and vanished from the very views it was built to appear in. Two
  different facts sharing one namespace with no law.

  `Parallel.branch()`, `Conditional.when()/.otherwise()` and `graph()` node
  ids now refuse the prefix at declaration time, teachingly. `Sequence` and
  `Workflow` are immune by construction (they mount `step-…`, so a consumer
  name can never start the segment) and a pin fails if that ever changes.
  `RESERVED_SUBFLOW_PREFIX` and `isReservedSubflowSegment` are exported so a
  viewer or pattern miner imports the law instead of hardcoding the string.

  The edge stated plainly: a composition that already used an `sf-*` name was
  already broken in every viewer — this turns silent misreading into a
  build-time refusal.

### Changed

- **`exportBugReport` packs a `RecordingEnvelope` instead of a bare recording.**
  The repo has ONE archive contract and several presentations over it; the
  bug-report zip predated the contract and was quietly a second one. The bundle
  now carries `envelope.json` — built through `buildRecordingEnvelope`, never
  re-implemented — and `environment.json` keeps only the facts the envelope does
  not stamp (Node, platform, architecture, the reporter's prose). The producer
  versions it used to repeat are stamped once, in the envelope's `producer`.

  - **Bundle layout version bumped: `manifest.manifestVersion` is `2`.** A
    versioned artifact that cannot say its version is the defect class this
    program exists to close.
  - **New `run` option on both entry points** (`BugReportRunFacts` —
    `{ complete, droppedEvents? }`). These are the two facts a frozen recording
    cannot answer; every other envelope fact is derived per recording from its
    own events, because a bundle may hold several runs and one `runId` or
    `startedAt` stated once cannot be true of all of them. Pass the **handle**
    from `recordRun(agent)` rather than its recording and the drop count is
    read rather than stated — a proven count always beats a stated one.
  - **A missing run fact refuses IN PLACE rather than throwing.**
    `persistRecording` is right to throw: its caller asked for an archive. A bug
    reporter asked for a filable bundle, and losing it because the library could
    not name a start time helps nobody. So that conversation rides as
    `recording.json`, the manifest carries a note naming the fact and the line
    that supplies it, and `BugReportUnit.enveloped` says per conversation which
    shape it got. Nothing is stamped that was not known.
  - **The evidence is never packed twice** — an envelope _or_ a bare recording,
    never both. The zip is store-only, so a duplicated recording is duplicated
    bytes against the size ceiling the trim hints exist to keep a reporter under.
  - The GitHub issue body names the file that is really in the bundle, including
    the mixed case (one conversation stamped, another not).

## [9.48.0] - 2026-08-18

**A run becomes an artifact, and an agent's setup becomes a named thing.** The first
wave of the Pattern program: the recording contract everything downstream will
consume, and the recipe surface that says which composition produced an agent.
Design decisions and their audit are recorded in `docs/design/pattern-program.md`.

### Added

- **`RecordingEnvelope` — the versioned contract a finished run leaves in.** Format
  `RECORDING_ENVELOPE_FORMAT`, wrapping the `recordRun` Recording unmodified and
  stamping only facts that are TRUE:

  - Identity is inherited, never derived — an anonymous run yields an envelope with
    the identity keys genuinely absent, and a session id is never promoted to a
    principal.
  - `droppedEvents` is read off the live recorder, which really counts cap drops; a
    bare `Recording` carries no count, so it is **refused** rather than reported as
    0 — "we did not look" must not collapse into "none were dropped".
  - `startedAt` is refused once the cap has discarded the head of the stream (the
    earliest retained event is when recording overflowed, not when the run began).
  - A recording spanning two runIds is refused — `resume()` mints a fresh runId, so
    filing the archive under the first would mislabel it.
  - Privacy v1 is `'full'` only; `'structure-only'` and `'redacted'` are refused BY
    NAME before the sink is reached — a false `redacted` label gets bytes handled
    with less care than bytes that admit they are raw.

- **`persistRecording` + `RecordingSink` + `fileRecordingSink`.** One JSON file per
  envelope, written atomically. The filename derives from the runId over an
  asserted safe domain — refuse-by-domain, the one acceptable alternative to the
  shared encoder, because a refusal cannot collide. Uppercase is refused outright:
  macOS and Windows fold case, the exact defect class fixed in 9.44.0.

- **`defineAgentRecipe` + `AgentBuilder.recipe()` — a declared, versioned
  composition over the existing builder.** No plugin system, no lifecycle, nothing
  hidden: recipes apply in declaration order, a duplicate tool or injection fails
  at build time naming BOTH sources, and the run manifest gains additive
  `recipes: [{ id, version }]` rows under the manifest's names-only discipline.
  Ids are plain names (no version suffixes — the version field exists); versions
  are strict SemVer, refused with the specific mistake named, never repaired.
  New door: `agentfootprint/recipes`.

- **Docs and examples for both**, including `examples/features/62-recording-envelope.ts`
  (runs end to end, zero network, and teaches two refusals on purpose) and
  `monitor/recordings.mdx` — which documents the refusals as the feature.

### Fixed

- **The capability index was missing `exportBugReport`** — and that omission is why
  the repo quietly grew three producer-owned archive shapes with their relationship
  stated nowhere. The row exists now, and the observability README states the rule:
  the envelope is the contract; `Trace` and the bug-report zip are presentations
  over it.

- **The committed TypeDoc tree had drifted 282 files behind** and was regenerated
  as its own deliberate commit.

### Notes

- `producer.footprintjsVersion` stamps honestly-`unknown` until your installed
  footprintjs is ≥ 9.15.1, whose exports map yields `./package.json`.

## [9.47.0] - 2026-08-17

**The answer gets a typed half, two more identifier folds close, and an index so
none of this gets rebuilt.**

### Added

- **`DecisionValue` — what a person CHOSE, not just whether they approved.**
  `AskComponent` gave the QUESTION a typed half in 9.24.0: which registered screen
  component collects the answer, and the props it renders with. The ANSWER never
  got one. A decision was `approved` plus a free-text `note`, so a picked row or a
  brushed date range had to travel as PROSE for the model to parse back out —
  precisely the failure the typed ask exists to prevent, surviving on the return leg.

  Shaped like the ask for the same reasons: `kind` is consumer vocabulary, `value`
  is small inline JSON because it rides the resume, and `from` is the artifact the
  choice was made AGAINST — a row id means nothing alone and something in a dataset.

  **`coverage` is the field people skip.** Somebody who filtered 5,000 rows to 3
  and picked one has not chosen from 5,000, and without it that pick is
  indistinguishable from an informed choice over the whole set. That difference is
  the entire value of a human in the loop. It is `coverage()` applied to the
  person, because on that turn the person IS the tool. It rides a DECLINE too:
  "none of these" is an answer with coverage, not the absence of one.

  Optional everywhere — an existing approve/decline is byte-identical.

- **`StaleDecisionError` — an answer must be about the thing that was asked.**
  When the ask pinned a `propsRef` and the answer names a different artifact,
  `resume` refuses by name, naming BOTH so a reader can tell which way it drifted.

  The cause is ordinary: time passes. A refresh lands, a filter moves, rows
  re-sort — and "the third row" now names something else. Accepting it resumes the
  run with a value the person never chose, and nothing downstream can notice: the
  id is well-formed, the type checks, the loop continues. Silent unless BOTH sides
  claim an artifact, because inventing that claim would refuse good answers.

- **A capability index in `CLAUDE.md`, keyed by what you would CALL a thing.**
  Three times in one day a capability was re-proposed after it had shipped — the
  typed-HITL ask, element bindings by role and name, the artifact-kind renderer.
  `CLAUDE.md` was a feature-work map, organised for CHANGING the library, and
  nothing was organised for "does this already exist". A reader searches with the
  words THEY have, finds nothing, and designs what is already there.

  `test/docs/capability-index.test.ts` fails if a row names a file or symbol that
  does not exist — it caught three wrong rows on its first run. The table can go
  stale by OMISSION and can never LIE about what it names; that limit is stated in
  the test rather than papered over.

### Security

- **The AgentCore code adapter stopped shipping raw identifiers to a vendor
  console.** `sessionName` carried the RAW tenant, RAW principal and RAW hosting
  session id to AWS's control plane — and so to its console, CloudTrail and logs —
  on every session open. `hashSessionKey` has existed in this repo all along with
  the docstring "Publishing it on the event wire would put a user identifier into
  every exporter's payload": two opposite decisions about one string, and the wire
  got the wrong one.

  Now `af-${hashSessionKey(key)}`, byte-identical to the `keyHash` already
  published on `agentfootprint.tools.session_closed`, so the console-to-trace join
  the old comment promised actually works instead of being a claim. The label loses
  its human-readable form, which is right: that form was lying whenever two keys
  folded.

  The reported fold in the same line is real and crosses no boundary — the address
  is the service-assigned `sessionId` and nothing looks a session up by name.

### Fixed

- **Two staged files no longer become one.** `safeFileName` folded illegal
  characters onto one filler, so staging `a/b.csv` and `a_b.csv` wrote ONE path:
  the second clobbered the first, the manifest pointed both logical names at it,
  nothing threw, and reading `a/b.csv` returned the other file's bytes. Wrong data
  handed to generated code with no signal — how a computation quietly answers about
  the wrong dataset.

  Fixed with the two-arm shape used elsewhere here: an already-legal name under the
  cap is returned BYTE FOR BYTE, so every `codeRunnerTool`-derived name lands where
  it did; anything else becomes `_enc_` plus an escaped form. The AgentCore code
  adapter had no behavioural test at all before this release.

## [9.46.3] - 2026-08-16

### Fixed

- **`checkSkillContract` threw instead of reporting when the tool list it was
  handed had a hole in it.** A non-string in `knownToolNames` reached a regex
  helper and produced `Cannot read properties of undefined (reading 'replace')`,
  naming neither the skill under check nor the missing tool — so every instinct
  led to auditing the skills, which were all fine. The hole is in whatever
  COMPOSES the tool list, and that is now what the message says.

  It reports rather than skipping, because a tool with no `schema.name` is a real
  defect somewhere and swallowing it would hide it; and rather than throwing,
  because a contract checker that dies without naming the contract is the exact
  failure this module exists to catch in other people's graphs. Reported from the
  field on a graph that had just grown its twentieth skill.

## [9.46.2] - 2026-08-15

### Fixed

- **`codeShape` erased the operation name, which was the entire signal.** It
  replaced every callee with a placeholder, so `groupBy(rows, x)` and
  `sortBy(rows, x)` hashed identically and the backlog the shape hash exists to
  build collapsed into one meaningless bucket. Callee names are kept now; a
  function name is code, not data, and the data lives in the literals and
  variable names that still go.

  Found by the clean-room probe on the published package, using a minimal pair.
  The unit test missed it because its two examples differed in their tails as
  well as their operation — a test that varies more than the thing under test
  cannot fail for the right reason, which is the same defect this release train
  has now found in a conformance case, a listing check and a normaliser.

## [9.46.1] - 2026-08-15

### Fixed

- **`codeShape` and `codeRunsOf` are exported.** 9.46.0 registered the event and
  shipped the normaliser it is built on without a public door to it, which the
  clean-room probe caught and the test suite could not: the tests import from
  source. The event alone covers runs from now on, because it carries the hash —
  but the whole point of the loop is reading recordings you ALREADY have, and
  normalising months of logged `args.code` needs the same function that produced
  those hashes. Shipping the second half of a loop is not shipping the loop.

## [9.46.0] - 2026-08-15

**Three gaps that had all been written down and left open.** Each one existed as a
comment naming itself — which is the small lesson here: a comment that names a gap
is not a mechanism for closing one.

### Added

- **`agentfootprint.tools.code_run` — every program a model writes is a request for
  a tool nobody built.** The code has always been in the recordings as an ordinary
  tool argument, so the loop worked for anyone who knew to go looking. This makes it
  discoverable, and the payload carries what makes it countable: language, how many
  artifact inputs were staged, output size, whether the output was truncated, and a
  **normalized shape hash**.

  `codeShape()` reduces a program to its CALL SHAPE — strings, numbers, comments and
  identifier names removed, operations kept. `groupBy(rows, 'wwn')` and
  `groupBy(items, 'serial')` hash to one value, so a totals-then-threshold written
  eleven times this month is one number eleven times rather than eleven clever
  answers. Rank the shapes by frequency and the top of the list is a build queue in
  build order; two things outrank frequency, and both are about consequence rather
  than volume: shapes on the path to a verdict somebody acts on, and shapes that
  re-derive an identifier a tool should have returned directly.

  **The code itself is never on this channel.** Generated code quotes the data it was
  handed, and this payload reaches every attached exporter — so the program is the
  one part of a code run that must not travel. Same rule the tool-session events
  already follow by publishing `keyHash` and never the key. The load-bearing test
  asserts a script containing an address and an email produces a shape holding
  neither.

  Emitted from the dispatch loop rather than from the tool, because that is the layer
  holding `typedEmit`; the facts are left on a symbol-keyed map under the
  `toolCallId` and taken there, since two tool calls in one iteration run
  concurrently and a single "last run" slot would file one call's facts under the
  other's name.

- **`agentfootprint.validation.*` and `agentfootprint.reliability.*` wildcards.**
  `dispatcher.ts` has carried the sentence "`validation.*` and `reliability.*` are
  still missing here" since 9.4.0, when the credential domain taught that a wildcard
  ships WITH its domain. Both domains emit; both were subscribable one event at a
  time; neither could be watched as a group — so an operator asking "is anything
  failing validation?" had to know every member name in advance.

### Fixed

- **`toolSessionKey` composes through the shared identity encoder.** It joined
  `tenant`, `principal` and the session or run id with `/` and `=` markers and no
  escaping, so a value could donate a marker and shift a boundary: tenant `acme/p=bob`
  with principal `x` composed the same string as tenant `acme` with principal
  `bob/p=x`. The absent-versus-`_` pair was the same collision `identityNamespace`
  was fixed for in 9.40.0, one module over, and `encodeIdentityField` is the encoder
  that fix produced.

  This key holds a live interpreter sandbox, so two identities that produce one key
  share a filesystem. **No reachable attack was found** — the markers are
  prefix-anchored, so a caller controlling only the trailing field cannot shift a
  boundary into somebody else's key. Closed anyway: "no attack today" is a property
  of the current call sites, not of the function.

## [9.45.0] - 2026-08-15

**Two more of the same defect, and the release that carries a correction 9.44.0 missed.**
An independent audit of the 9.44.0 GCP work found a documentation claim that had shipped
only halfway, a ledger that contradicted its own source of truth, and two live ownership
defects in the Agent Engine adapter. All four are here.

### Security

- **A losing writer could append into the winner's session.** `persist` reads who owns a
  session before writing, and `signedBy` answered `undefined` for two different facts:
  there is no session, and there IS one whose owner cannot be read. Before a create those
  are the same thing. They are not the same after another writer has created the session —
  and given a service that exposes a created session before its fields settle, the loser
  saw "no owner", appended, and left `ownerOf` naming the winner while `hydrate` returned
  the loser's conversation. That is the split brain closed across four stores in 9.37.0.

  `signedBy` now refuses when a session exists and its `userId` is unreadable. The service
  REQUIRES `userId` at create and an anonymous conversation carries an explicit placeholder,
  so an absent `userId` means the row is not readable yet — not that nobody owns it. This
  is the port's own `unreadable-is-not-absent` law applied to OWNERSHIP instead of to the
  conversation, because only one of those two answers is safe to write on. The refusal is
  transient and says so.

  **The first attempt guarded only the ALREADY_EXISTS branch and the regression went on
  failing**, which is how the reasoning was corrected: the losing writer never reaches that
  branch. The session exists, so its append succeeds on the ordinary path long before any
  create is attempted.

- **`safeResourceId` mapped two different session ids onto one conversation.** The function
  was idempotent ON PURPOSE — its own output came back unchanged — because
  `listByUser` answered with composed resource ids and callers fed those to `hydrate`.
  That property IS an arm overlap: if `f(x)` is a fixed point then `x` and `f(x)` are two
  different ids addressing one conversation, and the second is a value the store itself
  published. A caller who adopted a listed id as their own session id landed on somebody
  else's conversation.

  The fold's output is now excluded from the pass-through arm, and nothing needs the fixed
  point any more: a session carries the caller's OWN id beside its envelope
  ({@link SESSION_ID_KEY}), and the listing answers with that. Sessions written before this
  release do not carry it and fall back to the resource id, exactly as before.

### Fixed

- **The TTL correction that 9.44.0 did not actually ship.** The measurement — appending an
  event does not renew `expireTime`, so a conversation expires on the clock its FIRST turn
  started — landed after the 9.44.0 tag. It is in this release, and it was also incomplete:
  it had been written into the `ttl` option and nowhere else, so two other places went on
  saying the question had not been measured. One of them was `retention().enableWith`,
  which is not a comment but a **string this library returns to callers** as guidance on
  configuring expiry.

- **The status ledger claimed one declared limitation where the battery declares two.**
  `docs/ADAPTER_STATUS.md` omitted the limitation a field trial had confirmed — the service
  pins `userId` at create, so an anonymous-first session cannot move into a signed user's
  listing. The cause was a correction that moved a mis-attributed limitation OFF the wrong
  adapter and never ONTO the right one: deleting a true fact rather than relocating it.

### Added

- **`an-id-the-store-hands-back-is-not-a-second-address`** — a sixteenth conformance case,
  and the generic form of a collision a fold-pair table cannot express. A pair like
  `a_b`/`a-b` catches a store that folds punctuation; nothing catches a store whose mapping
  is idempotent, because only the store knows what its `f` is. So the case does not guess:
  it reads the id the store's own listing hands back and tries to use it as a second
  address. A caller doing that is the ordinary case — a sidebar lists conversations and
  opens the one that was clicked.

- **A regression test for the ownership race**, with a control. The control is the half that
  makes it worth having: with the winner's fields readable the re-check works, so the
  recorded failure was the adapter's assumption rather than the double's licence.

- **A test that the status ledger names every declared limitation.** It reads
  `docs/ADAPTER_STATUS.md` and fails if any declaration the harness makes is missing from
  it. A declaration a reader cannot find in the ledger is a limitation nobody will ever
  argue with.

### Status, stated plainly

`agentEngineSessions` is **not** promoted. The ownership race is closed in code and pinned
by a deterministic regression, but a double cannot establish that the window exists on the
real service, nor that closing it here closes it there. It stays at
`contract-shaped and tested` until a fresh live trial says otherwise.

## [9.44.0] - 2026-08-15

**Two cross-tenant collisions, and the batteries that certified them green.** Both
defects are the same shape as the two fixed in 9.37.0 and 9.40.0 — a mapping that
turns two different identifiers into one key — and in both cases a shipped
conformance battery passed the broken code, because each battery's collision case
varied the identifiers in a dimension the defect did not live in. The fixes are
here; so are the missing cases, and a test that proves those cases catch what they
claim to.

### Security

- **Artifact scopes no longer share a directory with their own case variants.**
  `scopeSegment` encoded a scope field with `encodeURIComponent`, which is
  injective as a STRING — and macOS/APFS and Windows/NTFS are case-insensitive by
  default, so a tenant of `Acme` and a tenant of `acme` encoded to two distinct
  segments and landed in **one directory**. Since an artifact ref is a content
  address that both scopes then resolve, the neighbour could `get`, `list` and
  `delete`. All three scope fields were affected, and all three are caller data:
  `standingAgent` sets `principal` from the request's user id and
  `conversationId` from the caller-chosen session header, so flipping one letter's
  case was enough to enumerate a neighbour's refs and then read their bytes.

  An uppercase ASCII letter is now escaped before `encodeURIComponent` (`~` as the
  escape, doubled when it appears in the input — the same escape-the-escape shape
  `identityNamespace` uses, so a decoder is a left inverse). Every output letter is
  then lowercase except the hex inside `%XX` escapes, which is always uppercase and
  never otherwise preceded by a lone `%`, so no two distinct outputs can differ by
  case alone.

  **What re-keys:** only a scope field containing an uppercase ASCII letter. Every
  all-lowercase field — including one carrying `/`, spaces, dots or non-ASCII —
  encodes to exactly the bytes it did before. A field that DID contain an uppercase
  letter was sharing a directory with its case variants on two of the three major
  platforms, which is the condition being fixed.

- **`agentCoreSessions({ store: 'memory' })` no longer folds distinct session ids
  onto one conversation.** `safeSessionId` replaced every character outside
  `[A-Za-z0-9_-]` with `-`, so `a:b`, `a/b` and `a-b` were one storage key. The id
  arrives in `X-Amzn-Bedrock-AgentCore-Runtime-Session-Id`, making it caller data,
  so this was a session someone could choose their way into. Logged as "Known, not
  fixed" in 9.42.0; fixed now.

  The mapping encodes instead of sanitising, in two arms whose outputs cannot meet:
  an id already legal (and not already claiming to be an encoded one) is returned
  byte for byte, and anything else becomes `_enc_` plus an escaped form. Past the
  provider's 99-character ceiling no mapping can stay injective, so that arm ends
  in a SHA-256 digest of the whole raw id rather than the previous 32-bit FNV-1a —
  a 32-bit hash over caller-controlled input is a collision somebody can go and
  find.

  **What re-keys:** only ids containing a character outside `[A-Za-z0-9_-]`, ids
  over 99 characters, or ids beginning `_enc_`. Every UUID and every `user_123`
  keeps the exact key it had. Ids in the first group were already sharing a key
  with everything that folded onto them.

### Fixed

- **A session id that names a prototype member is data, not a lookup.**
  `agentCoreSessions({ store: 'session-storage' })` keeps sessions as properties of
  one JSON object, so `hydrate('constructor')` on a store that had never been
  written to reached `Object.prototype` and refused BY NAME — telling a caller their
  session held "a STORED conversation this runtime cannot read", permanently, for
  any id naming a prototype member. Now an own-property test. Writes were always
  fine; this only ever bit the never-written case.

- **`agentfootprint.resilience.output_fallback_triggered` and
  `…output_canned_used` are registered events.** Both have been emitted since
  8.18.0 through a loosely typed `emit(type: string, …)` parameter that reached the
  dispatcher via `as never` — a cast that erased the only check that could have
  objected — so neither had a registry entry, a payload type, or a wildcard. They
  are now in `AgentfootprintEventMap` and `ALL_EVENT_TYPES`, the emit site is typed
  against the registry rather than taking a bare string, and
  `agentfootprint.resilience.*` joins `DomainWildcard`: the credential-domain lesson
  from 9.4.0 says a wildcard ships WITH its domain.

### Changed

- **The session battery's collision case is a fixture of fold BUILDERS, not
  suffixes.** It previously drew its base twice from a counter, so the two ids of a
  pair differed in their prefix as well and no fold could collapse them — the case
  could not fail. Rebuilt around one shared base and thirteen fold classes,
  including two whole families it could not previously express: mappings that
  discard the HEAD (a store keying on a last path segment, because its backend
  refuses `/` in a key) and Unicode normalisation (NFC/NFD, NFKC, non-ASCII case
  folding, zero-width stripping).

- **A store that REFUSES an id it cannot hold faithfully is conformant.** The
  collision case persisted ids of 1000+ characters and required every one to
  round-trip, so a store with an honest column width — one that raises rather
  than truncating, which is the SAFE behaviour, because truncation is exactly how
  two ids become one — was reported non-conformant for doing the right thing. Its
  only escape was declaring the whole case and losing every fold check with it.
  The law is now "every id the store ACCEPTED comes back as its own
  conversation": a write that never happened collides with nothing. Found by a
  field trial running this battery against a store with `NVARCHAR(400)` session
  ids.

- **The artifact battery gained the case pair it never had**, in all three scope
  fields. It carried pairs for separators, absence markers and pre-escaped values,
  and ran 106 green for months with the leak above live in the same process.

- **`list-by-user-is-newest-first` is its own case.** The paging case was holding
  three separate laws — no cross-user rows, complete paging with an honest cursor,
  and newest-first order — and a declaration is all-or-nothing, so a store with one
  real ceiling had to forfeit checks it passes, including the cross-user leak check.
  One case, one law. Its check now runs twice with the confounders inverted, because
  ids count up and writes are ordered: in any single arrangement the newest row is
  also the later-written row and the larger id, so a store that never reads the
  timestamp lands on the right answer for the wrong reason.

  `agentEngineSessions` **declares** it: the service orders a listing by its own
  immutable `update_time`, which the adapter also reports as `savedAt`, so a
  timestamp inside the envelope cannot influence the order.

### Added

- **`SECURITY.md`** — private reporting route, what to expect and when, and a
  finding-class list specific to this library (isolation, scope escape, ownership,
  redaction, evidence integrity) plus an explicit list of what is NOT a
  vulnerability, so nobody spends a weekend on a report that comes back "working as
  designed".

- **An adapter-trial issue form** that asks for `formatConformanceReport()` output
  rather than prose, and treats a declared provider limitation as a first-class
  outcome rather than a failure to excuse.

- **`docs/ADAPTER_STATUS.md`** — every hosting adapter, its rung
  (`contract-shaped and tested` → `field-validated` → `field-corrected`), and the
  rule that any rung above the first cites the evidence that earned it. No adjective
  without a link.

- **A test that the collision case catches what it claims to** — twelve stores,
  each non-injective in exactly one way, each of which must fail it, plus a control
  that must pass so the file cannot be satisfied by a case that always fails. It
  caught two of the new fold pairs being decorative on its first run: a pair meant
  to catch a tail-window store is useless unless its difference sits far from the
  end.

## [9.43.0] - 2026-08-15

**Five primitives that came out of field use.** A review of a live incident-triage
agent found its operator had independently invented things this library had no
answer for. These are ours, built from that evidence. The credit is the field's.

### Added

- **`absent()` — an absence that names its own coverage.** A tool that finds
  nothing returns a value saying WHAT was searched, what was not, what can never
  be covered, and that a retry returns the same. It carries a reserved key the
  framework recognises, because a convention cannot set a status, stop a loop, or
  keep a value out of the evidence corpus.

  It delivers a seventh `ToolResultStatus`, `'absent'`, routable by
  `onToolStatus`. Folding it into `'failure'` IS the confusion this exists to
  prevent; folding it into `'success'` leaves nothing to route on. The direction
  of error is the point: a nothing-found read as an outage sends someone to
  investigate a collector, and an outage read as nothing-found declares a system
  healthy that was never checked.

  **And it opened a hole in the evidence gate, which is why the gate now indexes
  an absence's COVERAGE ONLY.** An absence says what was looked FOR — which
  quotes the model's own arguments. Indexed whole, an invented identifier becomes
  grounded by the one operation that proves nothing about it. A failed lookup is
  the cheapest laundering machine there is, and this primitive would have made it
  cheaper.

- **`coverage()` — a ledger of what a clean answer does not rule out.** Sibling
  of the evidence gate: the gate catches invented VALUES, this catches unstated
  LIMITS. Recording is unconditional. Survival is enforced by construction and
  opt-in — `.limitsTravelWithTheAnswer()` APPENDS the folded block, so the model
  does not write it and therefore cannot drop it. What is deliberately NOT
  enforced: any check that the model stated its limits in prose, because deciding
  what counts as "stated" needs a second model, which is the one thing a guard
  here may not depend on.

- **`neverRoutes` — pin that a phrase must route NOWHERE.** Over-triggering is
  the failure that hurts: a skill claiming a turn it has no business in shapes
  the whole answer with the wrong instructions and the wrong tools. Declared at
  the GRAPH level, because a phrase pinned to a skill is deleted the day that
  skill is — which is exactly when a graph gets re-partitioned and over-triggering
  appears. It asserts that no declared start rule claims the phrase, and it ships
  its own boundary: intent scorers and `read_skill` are not covered, said on the
  checkup rather than left implied.

- **Three partition advisories in `graph.checkup()`.** A graph's partition is its
  highest-leverage design decision and a poor one is visible from names alone:
  tools in a skill all sharing a prefix, many skills declaring almost no edges, a
  one-tool skill with a body that adds nothing to its schema.

  The calibration is the feature. The verb exclusion came from surveying real
  tool names — `get`, `read`, `issue`, `lookup`, `run` are the commonest first
  segments and together outnumber every system prefix, so without excluding them
  the check would fire on the best-named skills here. And all three are silent
  below five skills, because without that floor they fired on small fixtures and
  would have taught authors to stop reading the checkup. Advisories, never
  errors: every one has a legitimate exception, and each message states the fact
  and names the design it is also consistent with.

- **`runbookFromDir` — routes on disk.** The ingest door carried prose, tools and
  steps but not the edges, so a runbook still had to be hand-wired. A file may
  now declare its exits using the two DATA guards a route already has — a tool
  return and a status — and refuses a `when` predicate by name, because that is
  code and nothing in these files is ever evaluated. The file PICKS, it never
  DEFINES: an unresolved id fails the whole load rather than producing half a
  graph. `skillsFromDir` REFUSES a file declaring routes and points here — a door
  that silently dropped routing would hand back a graph you believed was on disk.

### Fixed

- Two unanchored `coverage` rules in `.gitignore` matched `src/core/agent/
coverage/`, so a new source directory would have been absent from every clone.
  Anchored to the vitest report directory, with a comment naming why.

## [9.42.0] - 2026-08-15

**Comparing strategies with statistics, and retention on the session port.**

### Added

- **`compareStrategyArms`** — the counterfactual engine can now compare
  STRATEGIES, not only ablate context sources. It is a sibling type rather than
  a fifth `AblationSpec` arm, and the reason matters: `bisectCulprits` runs
  ddmin over SUBSETS OF REMOVALS, and substitutions do not compose that way —
  a scorer swap plus a window swap is a third arm, not a bigger removal. A
  union arm would have printed "minimal culprit set = {scorer swap}", and an
  arm is an alternative configuration, not a culprit. Every statistic is
  shared; no search machinery is. `ablation.ts`, `bisect.ts`, `rerun.ts` and
  `localize.ts` are untouched.

  The placebo band does not transfer and is not faked. Leave-one-out needs a
  POPULATION of peer suspects; two arms are not a population, so leaving one
  out leaves an experiment rather than a control. The arm tier uses the inert
  intervention that does exist — re-running the same configuration — on two
  axes, and the band deliberately does NOT gate when a custom comparator is
  supplied, because vetoing a real decision flip with an embedding statistic
  would suppress a true finding.

  **It catches an experiment that lies about itself.** A runner that believes
  it varies the model but builds the same one for both arms produces flips 2/2
  — the numbers say there is a difference — and the run manifest from 9.41.0
  contradicts the declaration, so the verdict is INCONCLUSIVE naming the facet.
  Manual bookkeeping would have shipped that as a finding. Absence in a
  manifest is a contradiction, not a wildcard.

- **`SessionLifecycle.retention?()`** — optional and feature-detected, like
  `listByUser`/`ownerOf`, reached through `sessionRetention(sessions)`.

  A discriminated union on `deletedBy`, because both arms are real: a store
  that holds its own rows SWEEPS (`forgetOlderThan`, clocked by the envelope's
  own `savedAt` rather than wall time, owner index deleted with it, bounded);
  a managed backend states its POLICY and deletes nothing on our behalf,
  because a query plus one billed delete per row duplicates what the service
  does free — and a store answering "0 deleted" from a backend that deletes
  plenty lies by omission.

  The shape rejected, and recorded as rejected: an expiry argument on
  `persist`. It demands something of the one REQUIRED method, and it cannot be
  feature-detected — `typeof persist === 'function'` is true whether or not a
  third argument is read — so a store that ignored it would keep everything
  forever while its caller believed retention was on.

  Sweep: `memorySessions`, `sqliteSessions`, AgentCore session-storage. Policy:
  `firestoreSessions`, `agentEngineSessions`. Honestly cannot: AgentCore memory
  mode, which has no delete on its surface and refuses by name.

- **Firestore gains `expiresAt`**, a Timestamp a native TTL policy can act on,
  beside `savedAt` rather than replacing it. Firestore orders values BY TYPE
  before value, so converting would have split old and new documents into two
  blocks and silently reordered somebody's history. Every stored document stays
  readable, listable and cursorable — pinned by a test seeded with a pre-9.42
  row. Old documents do not start expiring; an active conversation gains an
  expiry on its next turn, an abandoned one must be deleted by hand. Said in
  the header and the docs, and the docs now carry the operator command the
  code itself prints rather than a promise.

### Fixed

- `agentCoreSessions` is enrolled in the session conformance battery, in both
  modes. It was a fifth shipped store appearing zero times in it, undeclared.
  It needed no declarations, and the pass/not-applicable splits are asserted as
  NUMBERS so a proof cannot decay into a skip. A roster guard now fails if any
  exported `*Sessions(` factory is missing from that file.

- The `firestoreSessions` status lines said "nothing here has been run against
  a live Firestore" after a trial ran seven of eight areas live — including a
  third stale copy the audit had not named. Promoted honestly, naming the
  eighth area the trial did not cover: the foreign-signer refusal, which
  post-dates it and is held by tests and by nothing in the field.

### Known, not fixed

- `safeSessionId` (`src/adapters/hosting/agentcore.ts`) is non-injective —
  the same defect class 9.40.0 fixed in `src/adapters/memory/agentcore.ts`,
  and worse here because the session id arrives on a caller-controlled header.
  The conformance battery cannot see it: its collision case draws both ids
  from a counter, so they differ in their prefix and the fold never shows.
  Fixing it re-keys stored sessions. Next release.

## [9.41.0] - 2026-08-15

**Comparing strategies, and proving a store.** An audit asked whether this
library can support research-grade work — run one workload under several
strategies and collect comparable data. The verdict was that swapping a
strategy is easy and ATTRIBUTING an outcome to it is not: 93 typed events with
a correlated envelope, real numbers, and a genuine counterfactual engine in
`context-bisect` — but no record of what varied. This release adds the join
key, and the proof obligations for the second port.

### Added

- **`agentfootprint.agent.run_configured`** — one event at run start naming the
  strategies in play: provider and model, memories with their declared
  strategy / retrieval / embedder, window, skill-graph routing and scorer,
  evidence-gate posture, artifact dials. Because `runId` is already stamped on
  everything else, that single event turns N runs into N labelled ARMS with no
  workload type, no arm type and no sweep runner. Fired from the one funnel
  `run()` and `resume()` share, so a resumed run is its own arm.

  **Names and ids only, never values.** A manifest that leaks an endpoint is
  worse than no manifest, and a test configures obviously-secret values and
  asserts none appears. Absence is omission — never `'unknown'`, never a
  guessed `'default'`.

  What it deliberately does NOT name, because naming it would be a lie: which
  memory or artifact store (the ports declare no id, and shipped stores are
  factory-returned literals, so one arm would be labelled and another not);
  `entryBy()` scorers (the graph hands the Agent a bound function, never the
  scorer); and the "effective" model, since `.configure()` resolves after this
  point and calling a consumer's resolver twice per run to find out would be a
  cost the event does not justify. It names the starting model plus
  `modelOverrides`, and leaves per-call truth to `llm_start`.

  Gated on a listener check and pinned by SIZE rather than absence: a
  fully-configured agent serializes under 1,000 characters.

- **`runArtifactStoreConformance`** — the `ArtifactStore` port now ships its own
  proof obligations, the way `SessionLifecycle` has since 9.37.0. 19 cases, run
  against all five in-tree stores. Exported from the door the port ships from,
  so a third party writing their own store can prove it.

  The battery imports NO test framework — a case throws to fail — which is what
  lets it run under any runner or none. That rule is itself a test now: one
  walks all of `src/**` looking for a test-framework import.

  Three non-pass outcomes stay distinct: `not-applicable` (an optional member
  is absent), `declared` (cannot satisfy, BY NAME with a reason, and the case
  STILL RUNS so a declaration that starts passing is reported STALE), and
  `failed` — which includes needing a harness hook nobody supplied and nobody
  declared. Nothing can quietly disappear.

  It reads the STORE's clock through a probe artifact rather than `Date.now()`,
  because a case computing expiry from wall time would silently never expire
  anything on an injected-clock store, and pass forever.

  Two findings it surfaced rather than smoothed: `inMemoryArtifacts` must
  declare the digest-corruption case, because its payloads live in a
  closed-over Map with no seam to stage corruption through; and `fileArtifacts`
  cannot hold a scope value longer than a filesystem component, where the
  sibling session battery uses 1,000-character values freely.

  Migration, not duplication: the old test-only suite became fixtures, and its
  laws moved into the battery. A second copy of the same laws is exactly the
  drift this exists to prevent.

- `MemoryDefinition` gains optional declared `strategy`, `retrieval` and
  `embedderId` — additive, and what makes a memory row worth grouping on.

## [9.40.0] - 2026-08-15

**Two identity bugs, one of which had been paying out zeros since v2.8.**

### Fixed

- **`agentcore` actorId and sessionId were not injective.** `safeId` slugged
  every character outside `[A-Za-z0-9_-]` to `-`, so `a.b`, `a/b` and `a b`
  were one actor; and tenant and principal were joined with `_`, so `a_b`+`c`
  collided with `a`+`b_c`. Two different scopes became one actor at the AWS
  session boundary.

  Same law as the 9.37.0 identity encoder, different alphabet — and the
  difference is the point: AgentCore ids admit `/` and `:` but NOT `%`, which
  is precisely what that encoder escapes to, so it could not be reused. Every
  code UNIT outside `[A-Za-z0-9-]` now becomes an introducer plus four hex
  digits, fixed width, so a decoder is a left inverse. Code units rather than
  code points, so a lone surrogate does not flatten to U+FFFD.

  `sessionId` had the same lossy slug and is fixed too — leaving it would have
  kept the (actor, session) pair non-injective regardless.

  Byte-preserved for well-behaved values: `{tenant:'acme', principal:'alice'}`
  is still `afp-acme_alice`. What re-keys is exactly what was already sharing
  an address.

  **Hash truncation is gone, and that is a behaviour change worth stating.**
  Truncation maps infinitely many identities onto finitely many ids, so it
  cannot be injective — a hash tail makes a collision unlikely, not impossible.
  Over-long ids now refuse by name, with the ceilings raised to AWS's real
  maxima (255 / 100, from a shared 99), so the refusal is rarer than the
  truncation was.

- **Every cost strategy has been receiving zeros.** `attachCostStrategy` read
  `cumulativeInputTokens`, `recentInputTokens`, `cumulativeCostUsd` and
  `recentCostUsd` off `CostTickPayload`. `git log -S` shows those names NEVER
  existed on it — the projection has read fields nothing emits since v2.8, so
  every strategy attached through `enable.cost()` got `0` for all six numbers.
  `iteration` and `runtimeStageId` were read off the payload too; they ride
  `event.meta`, so they were always absent as well.

  The cause is worth recording: the test built its payload BY HAND, in the same
  wrong shape as the projector. Code and test shared one false assumption, so
  nothing could fail. The new test calls `emitCostTick` itself, and asserts
  non-zero values — a test that only checks "a number arrived" passes against
  zeros, which is how this shipped.

  `provider` now flows through to `CostTick` as well (optional; absent stays
  absent rather than becoming `'unknown'`).

## [9.39.0] - 2026-08-14

**Three false doors closed, and two promises the recording did not keep.** An
architecture audit asked whether a third party could add a new strategy without
forking. Mostly yes — but the first thing such an author reads was wrong.

### Fixed

- **`CLAUDE.md` listed 13 import paths that do not exist**, and omitted 5 that
  do. An exports map is exhaustive, so the very first line a strategy author
  writes — `import { skillGraph } from 'agentfootprint/injection-engine'` —
  failed to resolve. The line even framed the wrong list as a correction to
  older docs, so it read as freshly verified. Corrected to the 13 real doors,
  with the 16 paths 9.0.0 removed named as removed. A new pin test asserts set
  equality against `package.json` in both directions, with an anti-vacuity
  guard so a reworded line fails loudly instead of silently scraping nothing.

- **`MemoryRetrievedPayload` did not name the strategy that produced it**, while
  `RetrievalStrategy.name`'s own docstring promised "Stable name — appears in
  the recording". It now does, on both the evidence and the event, sourced at
  the one place they are constructed so the empty-query record carries it too.

- **`CostTickPayload` carried neither provider nor model**, so cost could not be
  attributed from the cost event alone. `model` is required — it was always
  known at all three emit sites. `provider` is OPTIONAL and deliberately so: at
  the window stage it comes from `WindowStrategy.billing`, which the seam
  allows to be absent, and an absent value means "the strategy did not say"
  rather than "the agent's provider". The pair travels as one argument so the
  two cannot drift.

### Removed

- **`src/strategies/registry.ts` was dead code advertised as an extension
  point.** `registerObservabilityStrategy` and its three siblings had exactly
  one non-declaration reference in the repository: a comment admitting the path
  was reserved. Not re-exported from any barrel, not an `exports` subpath, not
  in the shipped-surface baseline — so nothing public could reach it and its
  removal is not breaking. The by-instance door (`agent.enable.observability({
strategy })`) is real, first-class, and now the only one. The cache twin
  legitimately has two doors; this one had one door and a sign pointing at a
  wall.

### Deprecated

- `ContextSourceAdapter`, `RiskDetector` and `EmbeddingProvider` are exported to
  consumers and have zero implementations and zero call sites — nowhere to plug
  in. They cannot be removed in 9.x, so they are marked for 10.0.0 along with
  their satellite types. `EmbeddingProvider` is a dead duplicate of the live
  `Embedder` port.

  Two more were examined and left alone, because they are not dormant:
  `ReliabilityProvider` is read from `config.providers` at five sites, and
  `CheckInDriver` is a produced output type filled by the configured scorer.

### Known, not fixed

- `attachCostStrategy` reads four field names that do not exist on
  `CostTickPayload` (`cumulativeInputTokens`, `recentInputTokens`,
  `cumulativeCostUsd`, `recentCostUsd`), so every cost strategy attached through
  `enable.cost()` receives zeros. This release makes `model` resolve there; the
  numbers are still zero. Its own ticket.

## [9.38.0] - 2026-08-14

**Two behaviour changes that are bug fixes — a call that used to run now
refuses, and a call that used to mint an orphan now carries its lineage —
plus two gaps named rather than papered over.**

### Fixed — a declared `wants` was optional at runtime, if an unrelated dial was turned down

A tool declaring `wants: { dataset: 'kind/x' }` for an argument its own
schema marks REQUIRED would still execute when the model omitted it — but
only when `toolArgValidation` was `'off'` or `'warn'`. Under the default
`'enforce'` the args gate already caught it. So the artifact guarantee was
resting on a dial that has nothing to do with artifacts: turn down argument
validation for an unrelated reason and the `wants` contract quietly stopped
applying.

`resolveToolWants` now reads the tool's own `inputSchema.required` and
refuses a required-but-omitted ref by name, with the same teaching shape
the other refusals use (it lists the live refs of the wanted kind).
Optional arguments are untouched — declaring `wants` for an optional
argument and omitting it is legitimate, and stays legitimate.

Threaded at BOTH dispatch doors. Worth recording why that matters: the
mutation check found the resume door was UNPINNED — dropping the fix there
failed zero tests, because nothing exercised an approved check-in resuming
into a wants-declaring tool. The test that now covers it is named for the
rule it protects: an approved call is not a waived one. A human approving a
check-in does not waive the artifact contract.

Also: a `null` argument was refused with "not a object". It now says
`null`.

### Fixed — derived artifacts carry their lineage

`mintProducedFiles` minted code-produced artifacts with no `parentRefs`,
while the framework was holding the resolved input refs on `ctx.wanted`
from the very same call. So a derived artifact arrived with no ancestry —
and lineage broke at exactly the step that exists to demonstrate lineage.

Input refs are now stamped automatically, deduped, and ABSENT rather than
`[]` when nothing was resolved, because an empty array reads as "derived
from nothing". Kept strict: a parent that expired mid-call fails that mint,
contained per entry and stated in the model's line, rather than silently
dropping the lineage.

### Documented — two gaps named rather than papered over

**No shipped runner populates `CodeResult.artifacts`.** `localCodeRunner`
cannot collect outputs honestly today — its staging directory is for
inputs, and the child's cwd is the caller's own working directory, so
"files the code wrote" is not a set it can identify without guessing which
of a developer's files mattered. A dev-loop runner that uploaded whatever
appeared beside your source would be the worse failure. The field is now
documented as ABSENT rather than empty, with the three things a runner owes
to produce outputs: a declared output location the model is told about, a
bounded read-back, and a real byte count.

**`getStream` does not verify the digest, and `get` does.** Verifying a
stream would require buffering the whole payload — the digest is one-shot
over the canonical payload, chosen so one primitive works in Node and a
browser — and a second incremental implementation would be a different
promise under the same field name. So the loss is named in all three
places a caller meets it, and pinned by a test that demonstrates the
difference: tamper the bytes, `get` throws, `getStream` hands them over,
and `meta.digest` still rides so a caller can check it themselves.

### Documented — placement and routing predicates, at both ends

Automatic placement rewrites the tool-result string that `rule` triggers
and skill-graph `when` edges read, so raising or lowering `maxInlineChars`
can change which edge fires. This is intentional — predicates reading a
string the conversation never contained would be worse — but it was
undocumented, and it is a real footgun. Comments now sit at both ends and
name each other, so neither can be changed without meeting the other, and
a test runs the same tool with placement off and on to pin what a
predicate actually sees.

## [9.37.1] - 2026-08-14

**A hygiene release — nothing new is exported, nothing behaves differently.
Three things that already shipped are now trustworthy: a doc comment that
could not compile, a measurement that lived only in prose, and an
agent-facing file that had drifted two eras behind the library.**

### Fixed — the `/skill-graph` door's `@example` could not compile

It named `entry:` where the flat config takes `start:`, chained
`.route()`/`.build()` off a value that returns neither, and passed skill ids
to a `.route()` that takes `Injection` objects. Three ways broken and nothing
caught it: doc comments are not typechecked, and this repo has no twoslash
over `src/**`, so the block just shipped into `dist/**/*.d.ts` and became
what a consumer read on hover.

The fix is structural, not textual. The example is now a real file —
`examples/context-engineering/19-skill-graph-host.ts` — typechecked by the
examples typecheck and executed by the example runner, and the docblock is
pinned byte-for-byte to a region of it
(`test/lib/injection-engine/skill-graph-doc-example.test.ts`). The pin also
refuses if a second `@example` ever appears above this one, since it would
otherwise guard the wrong block silently.

### Added — evidence for the 18,225-tuple migration claim, and a correction to it

The 9.37.0 entry stated "18,225 realistic tuples identical" for the
identity-namespace re-encoding. That number lived only in prose — no
committed script, no fixture, nothing re-runnable. It is now a test
(`test/memory/identity/identity-migration.test.ts`), expressed as the LAW
rather than the count: a tuple whose fields carry none of the three reserved
characters encodes byte-identically to the pre-9.37 encoder, AND — the half
that makes the class tight rather than merely sufficient — every tuple that
DID change has a field in that class. Asserted as a biconditional, with a
non-vacuity guard. The pre-9.37 encoder is carried inline as a reference
implementation with its bugs deliberately intact, because a "cleaned up"
copy would prove nothing about the bytes actually on disk before this
release.

**And it corrects the published claim** — said plainly, because a quiet
correction to a shipped changelog is exactly the thing that must not be
quiet. The stated class was incomplete: the old encoder gave `tenant` and
`principal` an absence spelling (`_`) but never gave `conversationId` one —
a missing conversation id became the literal string `"undefined"`, an empty
one an empty segment, and both re-key. Neither was in the stated class. The
law here therefore requires the conversation id to be actually given, and
the sweep exercises both absent forms explicitly rather than excluding them
quietly.

The corpus is labelled a RECONSTRUCTION, sized to reproduce the published
figure, since the original was never committed. What makes it evidence is
that every tuple in it is checked, not that the total looks familiar.

### Fixed — the shipped agent instructions were two eras stale

`ai-instructions/claude-code/SKILL.md` — already in the published tarball,
already what `agentfootprint-setup` copies into a consumer's editor — still
described the v1/v2-transition library: it told readers to import only from
the top-level barrel (the door list has grown to 13 since), listed a
roadmap that had already shipped, and pointed at commands and subpaths that
no longer exist.

It now carries the current agent-facing reference, including a "what does
NOT exist" section built from four measured hallucinations: there is no
`startRun`; `RunStep` is the flowchart topology slider, not skill/route
history; the LLM classifier is a tier-2 strategy, not tier 3; skill tools
are not scoped by default. These are not guesses about what a model might
get wrong — they are what a capable author, working from a correct mental
model, actually got wrong. The negative space is the highest-value content
in the file, and now it ships instead of living on one laptop (`.claude/`
is gitignored).

Anti-drift is dogfooded rather than invented: this is the ONE canonical
source, and the `.claude/skills` copy is its INSTALL — byte-identical, the
same relationship a consumer gets from the setup command — pinned by
`test/agent-skill-ships.test.ts`, which prints the exact `cp` to run when it
drifts. Two more tests in the same file pin the doc's FACTS to the source of
those facts: the `RunStep` row must list exactly `RunStepKind`'s members,
and every `CursorMoveCause` must be named with the count the union actually
has.

**Known and NOT done, said here rather than left implicit:** five sibling
files in `ai-instructions/` — for Cline, Copilot, Cursor, Kiro, Windsurf —
still carry the same stale document and still ship. They were deliberately
left alone this release: copying the content into five places is how five
documents diverge, and the real fix — one source with a per-tool render — is
a design decision, not a mechanical edit.

## [9.37.0] - 2026-08-14

**A security release — three cross-tenant defects, and the suite that
would have caught one of them.**

### Fixed — scope namespaces were not injective (cross-tenant read)

`identityNamespace()` joined tenant/principal/conversationId with a raw
`/`, so two DIFFERENT scope tuples produced ONE namespace —
`{tenant:'acme/hr', principal:'alice'}` and
`{tenant:'acme', principal:'hr/alice'}` both became `acme/hr/alice/c1`.
No race required. An audit read another scope's artifact payload in
full. Reachable in practice: a JWT `sub` is frequently a URI containing
slashes. It also collapsed absent/empty/`'_'` onto one shelf, so a
tenant literally named `_` shared the anonymous scope, and
`conversationId: undefined` became the literal string `"undefined"`.

The encoding is now injective, and the proof is structural: `%` is
escaped before `/`, so a decoder undoing them in reverse is a left
inverse — and a left inverse existing IS injectivity. Pinned by a
39,304-tuple adversarial cross-product plus decoder round-trips.

MIGRATION IS THE DESIGN, not an afterthought: a value containing neither
the separator nor the sentinel keeps its EXISTING namespace byte-for-byte.
Measured against a corpus of realistic ids — **18,225 tuples identical,
and zero of the changed ones fall outside the class {contains `/`,
contains `%`, is exactly `_`}**. Only keys that were already colliding
move, and those were broken. Well-behaved deployments migrate nothing.
Eight literal expected strings are pinned so a refactor cannot silently
re-key anyone.

Affected far beyond artifacts: the memory subsystem keyed on the same
function. Three modules that had re-implemented the encoder by hand are
fixed directly rather than patched around.

### Fixed — `redis.forget()` deleted across tenants (cross-tenant destruction)

It built `${prefix}:${namespace}:*` and handed it to `SCAN MATCH`, then
`DEL`ed the results — with glob metacharacters unescaped. Redis's `*`
spans `/`, so an identity carrying `*` matched and destroyed other
scopes' keys. The pattern is now escaped at the point of use (`\`, `*`,
`?`, `[`; `]` correctly needs none, confirmed against Redis's own
`stringmatchlen_impl`), backslash first, for the same left-inverse
reason as above. Nothing is re-keyed — the escape is on the PATTERN, not
on stored keys, which is why this fix is free.

Worth recording as a lesson: the test mock implemented `MATCH` as a
RegExp `replace(/\*/g,'.*')`, which does not implement `?` or `[a-z]`
and reads `\` as a regex escape — so a glob-injection test against it
would have proven nothing. Redis's real matcher was ported into the
harness and pinned against the documented examples first. And one
`forget` case was initially passing by luck, because the bystander's id
was too long for `?` to reach; a one-character sibling was added. A
double that cannot model the bug makes the whole suite theatre.

### Fixed — session ownership split-brain (cross-tenant read, all four stores)

Write-once ownership preserved the FIRST writer's owner while storing the
SECOND writer's envelope — and the envelope carries its own identity. The
index said Alice, the stored conversation said Bob, so Alice listed it,
opened it, and read Bob's conversation. Found live by a field trial
running two real concurrent transactions; confirmed present in
`memorySessions`, `sqliteSessions`, `firestoreSessions` AND
`agentEngineSessions`.

A different non-empty signer on an owned session is now refused by name
(`SessionOwnershipConflictError`), carrying no principal, owner,
conversation text or credential. A LEANER turn is still accepted — the
contract blesses it explicitly, an absence claims nobody so it
contradicts nobody, and the composer cannot even produce the divergent
state because identity is inherited through `continueFrom`.

BEHAVIOUR CHANGE, stated plainly: a `persist` that used to succeed now
refuses. It cannot fire at a verifying door (the composer refuses
foreign turns before the store is reached). It CAN fire at a
header-trust door with no verifier — which is exactly the split-brain
producer — and there the model has already seen the prior conversation
before the write refuses. A verifier is what closes that door.

### Added — `SessionLifecycle` conformance suite

The real deliverable. This bug lived in four adapters at once because
every store is tested against its own doubles, so a flaw in the PORT's
semantics is invisible to all of them simultaneously.
`runSessionLifecycleConformance({ name, createStore, … })` is exported
from `agentfootprint/hosting` so an out-of-tree store can run it too. 13
cases × 4 stores.

A store that legitimately cannot satisfy a case DECLARES it by name with
a reason — and the case still runs, so a declaration that starts
passing is reported STALE. "Needed a harness hook nobody supplied and
nobody declared" counts as FAILED, not skipped. There is no way to make
a case quietly disappear, and that rule is itself a test. Exactly one
declaration exists today: `agentEngineSessions` cannot fill in ownership
on a later signed turn, because the service pins `userId` at create.

### Known and NOT fixed — named, not buried

- `agentcore`'s `actorId` slugs non-alphanumerics and joins
  tenant+principal with `_`, so `a_b`+`c` collides with `a`+`b_c`. A
  genuine cross-tenant collision at the AWS session boundary, left alone
  deliberately: any fix re-keys durable remote rows in a customer's
  account, and underscores in ids are common. Migration is unavoidable,
  so it is the operator's decision, not ours.
- Composition seams (`redis` `:`, `s3Vectors` `#`): a `:` or `#` inside a
  conversation id lets two (scope, entry) pairs compose one key.
  Escaping them in the encoder would close it but would re-key
  `urn:`/`sub:`-style ids, breaking the byte-preservation property that
  makes the fix above migration-free.

## [9.36.0] - 2026-08-14

**The adoption release — two changes aimed at the same moment: the first
skill graph someone builds who has never built one.**

### Added — `.toolsFromActiveSkill()`

An agent-level lever that scopes every skill's tools to the active skill,
so a tool reaches the wire only while its skill is current.

Why a boolean and not a third posture: the wire has no middle. A tool's
schema is either in the request or it is not, and "record that we sent
it" is just sending it. `strictness` and the evidence `posture` earn
three values because routing and evidence each have a real record-it
middle; this does not. A three-value dial here would ship one behaviour
under two names.

What it is not: authority to run. It governs what the model is SHOWN, not
whether an inactive skill's tool may dispatch — that is a different axis,
and the library already ships the composable answer (`gatedTools`,
`PermissionChecker`, `skillScopedTools`). The boundary is documented on
the method and pinned by a test, so nobody reads this as an execution
gate.

Why agent-level and not graph-level: `skillGraph({ scopeTools: true })`
already stamps every WIRED skill and already names 10.0.0 for its default
flip. The gap is everything outside that — listed-but-unwired graph
skills, skills registered beside the graph, and every skill on a
graph-less agent, including a whole `skillsFromDir` directory.

How it interacts with the per-skill flag: they cannot disagree.
`autoActivate` has exactly one legal value, so a skill can ask to be
scoped and can never ask to be exempt. The stamp is a default, never an
override, and the result is monotone — turning it on only ever removes
names from the static list. Pinned two ways: object identity, and a
value-level pin using a reserved future mode, so the law still holds the
day further modes ship.

Default unchanged, pinned by a wire-level test asserting the exact tool
list on iteration 1 without the call. The flip is on the same 10.0.0
ledger as `scopeTools`.

### Changed — `skillsFromDir` carries the whole runbook

A directory-defined skill can now declare its tools and its steps, not
only its body. It reuses the existing `key: value` grammar one level in
(`tools:` as an inline list or a `- name` block; `steps:` as `- tool: why`
items; `onSkip:`), and steps reuse the shipped `skillSteps` grammar
verbatim rather than a parallel one.

Why this is not a code-execution vector — said plainly: nothing in the
file is evaluated, imported, required, or resolved as a path. `tools:` is
a list of strings, and the only thing a string can do is MATCH a tool
name in a registry the caller built in their own source from their own
imports. The file PICKS; it never DEFINES. The capabilities a directory
can reach are a strict subset of what the calling file already handed
in. Pinned by a security test feeding `rm_rf`, `node:child_process`, and
`../../../etc/passwd`.

Unresolved names refuse at load, never a half-skill — because a silently
tool-less skill looks exactly like a working one. Every message names the
file (steps name the line) and carries the fix: an unknown name lists
what IS available; `tools:` with no registry prints the exact call to
paste. Also refused: a step naming an undeclared tool, a step with no
why, `steps` without `tools`, empty or duplicate `tools`, `onSkip`
without `steps`, an unknown `onSkip`, and a registry with two different
tools under one name.

No new checkup code, deliberately: the checkup is an advisory build-time
report, and a code there would have downgraded "never load a half-skill"
to a warning.

Additive: a directory that declares only prose loads identically — and
that constraint is guarded by the entire pre-existing `skillsFromDir`
suite as well as a new pin (breaking it fails 20 tests), which is the
strongest evidence it cannot silently rot.

## [9.35.0] - 2026-08-14

**`.namesAndNumbersFromEvidence()` — every name and number in the final
answer must appear in a tool result this turn actually read.**

Two engineering conventions, arrived at independently, said the same thing
about the same failure. The architecture guide promised this as a runtime
invariant — twice — and the runtime did nothing of the kind. On a
production consumer app, the same class of question produced a fabricated
port row: an alias and an FCID that appeared in no tool result, stated as
fact. That app's own house rule reads "facts come from data, never from
labels." Ours had no rule at all. Now it does, and it is enforced, not
promised.

### What it is, and — because the name invites the wrong reading — what it

### is provably not

It is a **fabrication detector, not a correctness judge.** If a value in
the answer never appeared in anything a tool returned this turn, the model
typed it rather than read it, and that is all this checks. It cannot catch
a false claim built entirely from real values — _"fc1/3 is healthy"_ when
the data says the port is down uses two grounded tokens and sails through.
It cannot catch a real value attached to the wrong thing, a fabricated
quantity under the digit threshold, or a fabricated name spelled in
letters only — which is exactly what declaring a `shapes` pattern is for.
`.factsFromEvidence()` was the name on the table first and was rejected
for promising exactly this: "facts" says more than the check can stand
behind. Say the limits plainly, because a reader who assumes this is a
hallucination checker will trust it for the one job it cannot do.

### The governing constraint: deterministic, on purpose

The check is set membership over normalized tokens — no LLM judge, no
embedding, no model call of any kind. This library's whole thesis is that
structure lets a small model perform like a large one; a gate that needed
a strong model to police a weak one would invert that thesis at the exact
place it is supposed to hold. The clean-room probe proves this the hard
way, not the easy one: the gate still flags a fabricated value after the
mock provider's scripted responses are exhausted.

### Three postures — a SEPARATE dial from routing strictness

Same vocabulary as `.skillGraph({ strictness })`, because it reads the
same way, but a different setting: routing authority and evidence
enforcement are different concerns, and an app may want strict routing
with loose evidence, or the reverse.

- `'assist'` (**default**) — record and flag; the answer ships unchanged.
  Every agent that does not ask for this feature is byte-identical to
  9.34.0 — no branch mounted, no event emitted.
- `'guard'` — the unsupported values are named back to the model for ONE
  bounded revision, tools still on the wire, so it can go fetch what it
  guessed instead of restating it. This is the posture that makes a
  smaller model behave like a bigger one, and it is the recommended one
  for a weaker model.
- `'rails'` — the same one revision, then a refusal: `run()` raises
  `UnsupportedValuesError`, naming the values, rather than return an
  answer that still carries them.

Every check lands on the emit channel as `agentfootprint.agent
.evidence_checked`, in every posture — `assist` is not a silent mode, it
is a recording one.

### The mechanism — a SIBLING branch, not a second loop

Evidence-checking rides the exact machinery `outputRetry` already built:
the same `{loopTo}`, the same conditional mount (nothing changes shape for
an agent that never calls `.namesAndNumbersFromEvidence()`), its own
`iteration_end`, its own cost tick. The route decider judges in a fixed
order — schema, then declared steps, then evidence — so an answer already
being replaced by a schema retry is never evidence-judged, a denied answer
is not judged at all, and a turn the iteration or cost limit just cut
short does not get to spend a revision it can't afford. It composes with,
rather than collides with, `.reliability()`: reliability governs whether a
call is retried before anything is committed; this governs an answer
_after_ it has already been committed to the transcript.

### Measured, not assumed

Two corpora, both built from real SAN inventory shapes, written the way
models actually write:

- **12 correct answers, 32 distinct grounded values — 0 false positives.**
- **4 fabricated answers, including the field's own port-row example, 5
  planted unsupported values — 5 flagged, 0 missed, 0 collateral.**

Both directions are pinned so an extractor going blind and an extractor
over-flagging fail equally loudly; a gate that only proved the flag proves
nothing about the answers it must leave alone.

### The lesson the mutation check found mid-development

The `guard` correction is a user-role turn that quotes the flagged values
back at the model — which means, before this was caught, the exempt
corpus exempted exactly the values it had just accused. The second pass
always came back clean, and `rails` could never refuse anything, because
by its own second look nothing was ever wrong. Library-authored evidence
frames are now excluded from the exempt corpus by construction, pinned by
a regression test. A gate that absolves itself on the second attempt is
worse than shipping no gate at all.

### Also in this release

- `UnsupportedValuesError` joins `run()`'s terminal-typed-error list. A
  verdict is not a crash, and wrapping it in something generic would bury
  the named values one `.cause` deep exactly when a caller most needs
  them at the top.
- Three anti-drift registries were extended, none weakened: the event
  registry (`agentfootprint.agent.evidence_checked`), `STAGE_IDS`
  (`evidence-recheck`, a boundary-local milestone — the run telling the
  model it made a value up is the single most interesting stop a reader
  can find), and the silent-success classification (this builder method
  refuses a second call by name, like every other one-shot configuration
  method on `AgentBuilder`).

## [9.34.0] - 2026-08-14

**The skill-graph purity fence, and the `agentfootprint/skill-graph` subpath it makes safe to ship.**

The skill-graph layer was already framework-neutral — by accident. Nothing
enforced it, and three recent minors had each pushed a little loop
vocabulary into it, because inside one package an import costs nothing to
write and nothing to notice. A comment saying "this stays pure" is not a
forcing function. A CI test that fails on the crossing is.

### Added — `test/lib/injection-engine/skill-graph-fence.test.ts`, 30 tests

Walks the TRANSITIVE import graph with the TypeScript parser itself, so
`import type`, `export … from`, `await import()`, and an inline
`import('…').T` are all seen — grepping for `from 'footprintjs'` would have
missed all four shapes. Two zones, both named in the test, not inferred
from directory structure: a PURE CORE of 18 files that may import nothing
from `footprintjs`, the agent loop, `core/tools.ts`, or an adapter; and a
PROVIDER LAYER of exactly two files — `constrainedEnumPick.ts` and
`llmClassifier.ts` — allowed to see `adapters/types.ts` and nothing else,
because a constrained-enum pick genuinely IS a model call and pretending
otherwise would be a fake abstraction, not a purer one. Every allow-listed
leaf is separately asserted to be a true leaf (zero imports of its own), so
an allow-listed file can't smuggle the loop in behind it. Every file that
lives in `injection-engine/` must land in exactly one zone, so a new file
dropped in later can't go unclassified. A refusal names the file, the
import, the reason, and the seam to use instead.

Independently mutation-checked before release: adding
`import { isDevMode } from 'footprintjs'` to `routingPolicy.ts` failed 11
tests, each naming the file, the import, and the fix — and the fence caught
it a second, harder way too, transitively through `evaluator.ts`, which
never touched `footprintjs` itself but imports the file that now did.

### Fixed — the leaks the fence found, each closed behind a pure seam

- `isDevMode` (a `footprintjs` import) → a bound `devWarn()` / `devMode()`
  reader that the host supplies; every existing warning reads verbatim, and
  the existing `enableDevMode()` tests pass unchanged — the proof that
  nothing about _what gets warned_ moved, only _how it's asked_.
- `ToolResultStatus` → pulled out to a zero-import leaf and re-exported from
  its old home, so the envelope grammar is unchanged for every existing
  caller. The fence caught four more inline crossings of this type that
  hadn't made it into the original list.
- `Tool` → replaced with a structural `SkillTool` (`{ schema, execute }`)
  that the real `Tool` satisfies without changes — zero compiler errors
  from the swap, because the graph never needed more than the shape.
- `LLMToolSchema` / `CachePolicy` → structural mirrors, pinned two
  independent ways: an AST field-list comparison in the fence test, and
  real two-way assignability in a compiler test — so the mirror can't drift
  silently in either direction.
- `defineTool`'s value imports → the graph now exports pure descriptors;
  one host-side file does the wrapping into a runnable `Tool`.

### Added — `SkillGraphHost`

A type, not a runtime — it names what a host owes the graph: advance the
cursor exactly once per iteration using the same `ctx` its triggers read,
enforce reachability at pick time, set the pending pick only after
acceptance, carry the cursor across iterations, emit the skill events.
There is no second run door behind it; `buildInjectionEngineSubflow.ts` is
now labelled what it always was — one reference implementation of this
contract, not the contract itself.

### Added — `agentfootprint/skill-graph`

A new subpath that ships the pure core on its own. Proven on the built
output, not asserted: loading `dist/doors/skill-graph.js` pulls zero
modules of the `footprintjs` package, where `require('footprintjs')`
explicitly pulls 104.

**The honest cost:** `footprintjs` is still a REQUIRED peer of this
package, so a host on another framework installs it even though this
subpath never loads a line of it — the fence buys you the import, not the
install. And nobody has run this door from outside agentfootprint yet.
Say so rather than imply otherwise.

### Changed — additive only

`buildReadSkillTool`, `buildListSkillsTool`, and `buildSkipStepTool` are
byte-identical and still return `Tool`; turning them into descriptors
directly would have been a breaking change, so the descriptor shape was
added beneath them instead. Three existing test files changed, and all
three changes are mechanical: two are export-map inventories that needed
an eleventh door listed, one moved an import between internal modules. No
assertion changed.

## [9.33.0] - 2026-08-14

**A fourth rung on the session ladder — Firestore — built around the one
query decision a field trial of a different adapter proved matters.**

### Added — `firestoreSessions()`

The `SessionLifecycle` port on Google Cloud Firestore, beside
`memorySessions()` and `sqliteSessions()`: a fleet-shared conversation store
with no instance to size, no connection pool to tune, and a free tier.
`@google-cloud/firestore` is an optional peer — a deployment that never
constructs this store installs nothing, and one that tries to without the
package is refused by name with the install line, alongside the fact that
`memorySessions()`/`sqliteSessions()` need nothing installed:

```
npm install @google-cloud/firestore
```

`listByUser` is SERVER-SIDE, INDEXED and CURSORED —
`where(owner) + orderBy(savedAt desc) + orderBy(__name__ desc) +
startAfter(...) + limit(n+1)` — and that query shape is the point of the
release, not a detail of it. An independent field trial of a different,
hand-written Firestore adapter passed eight ownership and history checks
against a real Firestore, and named its own defect in the report: it read
every document for one owner, sorted them in the client, and applied an
offset cursor. That is correct until somebody has had a lot of
conversations, and then it reads all of them to show ten.

Ownership is DERIVED from the stored envelope and established ONCE, inside
a transaction. Firestore has no `COALESCE`, and `set({ merge: true })` is
not a stand-in for one: mentioning `owner` at all lets the last writer win,
and leaving it out means a conversation that gains an identity on turn two
never records one. `ownerOf` returns `undefined` for both "no such session"
and "a session nobody signed for" — a deliberate ambiguity, so the method
can never be read as an oracle for which session ids are real.

Document names are the full sha-256 of a NUL-separated domain and the raw
session id, not the id itself, so a session id containing `/`, unicode, or
an awkward length still addresses cleanly. Worth saying plainly because the
shape invites the wrong reading: this is ADDRESSING, not encryption — the
conversation is stored in the clear, and the raw id rides alongside the hash
in its own field so a console reader can still see whose document it is.

A missing composite index refuses by name with the exact `gcloud firestore
indexes composite create` line, `--database` included even for `(default)`
— because an operator on a named database who follows a command without
that flag creates the index on the wrong one and gets the identical failure
back with nothing to suggest why.

**Status: contract-shaped and tested, NOT field-validated.** Nothing here
has been run against a live Firestore by this repository. The 18 pinned SDK
members were read off a real `@google-cloud/firestore` 9.0.0 install
outside this repo and hand-verified there. The reality assertion — the
check that every pinned member really exists on the real package — SKIPS
here: installing the package hoists `@opentelemetry/api`, which would
disarm the test proving `otelObservability()` refuses when that package is
absent. So CI machine-checks the SHAPE pin instead: this adapter dispatches
exactly the members its pin names and no others, every run, everywhere —
not the reality pin.

A rule worth stating because this file just relearned it, not just an
adapter's footnote: a comment claiming what a test proves is itself a
claim, and the only way to know is to break the code and watch. Mutation
checks during this work twice caught a claim a careful read had not.

## [9.32.0] - 2026-08-14

**Three questions we could not answer without an account came back
answered — and the honesty vocabulary got audited against its own
evidence.**

An independent field trial and an independent reviewer, both 2026-08-13
and 2026-08-14, drove this release.

### Answered — a Node service IS deployable on Vertex Agent Engine

Through the custom-container door: a Node image was accepted with
`agentFramework: 'custom'` and served, and the recipe is documented on the
Google Cloud page. We still ship no `agentRuntimeHost()`, and the reason is
now stated rather than guessed — our `httpHost` serves one invoke path
framed as SSE, while that contract's second route is NDJSON at its own
path. That is a port-shape change, tracked as its own release rather than
half-shipped here.

### Answered — the gateway

A plain-HTTP bearer gateway works end to end: tool discovery, a tool call,
fresh credentials vended per request, never stored. Google's own identity
path for Agent Gateway — mTLS + DPoP — was **not** expressible through our
transport, and still isn't; what changed is where the seam to build one
lives (below).

### Added — `gatewayTransport({ fetch })`

A consumer's own mTLS/DPoP `fetch` now composes UNDER the per-request
credential vending, instead of forcing a drop to the generic `http`
transport and losing rotation to get a client certificate. The credential
is vended and applied first; your function is called with the final
request and has the last word over the bytes. Zero vendor code lands here
— bring-your-own, offered as a seam, never described as support.

### Answered — streaming works end to end from a deployed service

Over the network, from a live host, with usage totals correct — including
the thinking count.

### Added (security) — an ingress decision record, `onIngressDecision`

`auditExport()` is a record of runs; a 401 out of `identity.verify` and a
429 out of `admission.decide` both happen before a run exists, so neither
was in the bundle — an empty bundle read as "nobody was turned away" when
it only meant "nobody ran." `standingAgent({ onIngressDecision })` now
hands your sink one `IngressRecord` per request, filed at the terminal the
reply actually reached. The honest contract is stated in the type itself:
`'served'` means **delivered**, not _admitted_ — a request the door let
through whose run, store or provider then broke files as `'failed'`, and
the record carries the admission verdict (`allow` / `queue` / `refuse`)
either way. It is a stream you chain into your own sink, not a join onto
the audit hash chain — saying otherwise would make this fix the exact
failure it exists to close.

### Added — circuit-breaker state transitions on the resilience report

`withCircuitBreaker` now emits `agentfootprint.error.circuit_changed`
(`{ state, reason, providerName }`) on every transition, so a trip is
visible on the same timeline as the tool calls it stopped instead of only
as the `reason` string on an enclosing `withFallback`. It reports
transitions, not calls — an open breaker rejecting a hundred requests
produces zero events. `onStateChange` and the event are complements: the
hook fires wherever the breaker lives, in a run or not; the event fires
only inside a run, where it can carry real correlation ids.

### Changed (status vocabulary audited) — five statuses corrected against their own evidence

A review found five statuses claiming **field-validated** on evidence that
was a deterministic local run. Corrected:

- **Stay field-validated** — `jwksIdentity`, the `identity: { verify }`
  door, and the 9.26 session-ownership / session-history contract. A real
  remote JWKS and a real Firestore participated in the trial that earned
  the rung.
- **Split out** — `turnsPerHour` is now **contract-shaped and tested**,
  not field-validated: a minutes-long run cannot cross an hour, and the
  shipped helper was never itself named as the policy under test, only its
  per-process bound.
- **Moved to contract-shaped and tested**, each naming what was NOT
  exercised — `withRetry`, `withFallback`, `withCircuitBreaker` (no live
  provider outage retried, no failover between live providers, no live
  breaker trip); `PermissionChecker`-as-execution-guard (no external
  authorizer answered a `check()`); `auditExport`'s hash chain (no bundle
  re-read from a durable store).

### Docs — a dependency advisory beside `gcsArtifacts`

`@google-cloud/storage`'s optional peer tree carries five transitive
**moderate** advisories, rooted in `uuid` (`GHSA-w5hq-g745-h8pq`) through
`gaxios` → `teeny-request` → `retry-request`. Not a defect in this
adapter, and no line here would fix it. `npm audit fix --force`'s
resolution installs `@google-cloud/storage@5.18.3` — a major downgrade to
a client several majors behind the service — and we refuse to pin you to
it. Pin the newest 7.x yourself and watch the upstream chain.

## [9.31.0] - 2026-08-14

**Two doors the field found shut: an Azure config our own docs advertised
could never boot, and streaming that no test could see was broken.**

An independent field trial and one production consumer drove this release.

### Fixed — the Azure door

The SDK's `AzureOpenAI` constructor defaults `baseURL` from `OPENAI_BASE_URL`
and refuses an `endpoint` alongside it — so the `OPENAI_BASE_URL` spelling
named in our own docs, help text and examples handed the SDK the value
twice and could not boot at all. We now compute the base URL ourselves and
never pass `endpoint`, so both spellings work and produce a byte-identical
request URL — asserted from what a fake Azure server actually receives,
including the `/openai` segment, trailing slashes, and an endpoint already
ending in `/openai`.

### Fixed — streaming was broken for every OpenAI-door consumer, not just Azure

The stream path iterated the SDK's `create()` return without awaiting it,
and the real SDK returns a promise that resolves to the async iterable.
Every test double in the repo returned the iterable directly, which hid the
defect from the entire suite. A non-iterable now yields a teaching refusal
instead of a `TypeError`.

### Changed — `providerFromEnv`'s Azure arm

Returns the DEPLOYMENT as `model` (it previously returned the literal kind
label `'azure'`), and refuses by name when Azure credentials arrive with no
deployment. Note for consumers who read that field: the value changed from
a constant to your deployment id.

### Added — examples on start rules

`examples: [...]` on a start rule declares the phrasings that rule claims,
and the check-up proves three things by running the compiled predicates in
declaration order — a witness, not regex theory: a rule whose example its
own matcher rejects; an example an earlier rule claims first; and an example
nothing claims at all. The last is coverage, which no matcher-vs-matcher
analysis can prove. Severity tracks provability — a data matcher rejecting
its own phrase is an error, an opaque `when` predicate that merely did not
match this turn is a warning; where the cold walk and the cascade would read
an unconditional entry differently, it reports a warning naming both
readings rather than asserting one. Tier note: on a tier-1 data rule,
examples are test material read once at build; in `match: { intent,
examples }` they remain scoring material read by the classifier at run
time — declaring both on one rule is refused.

The check-up now carries notes on the report itself: examples prove things
about the phrases you declared and nothing about the phrases nobody wrote —
no warning is not proof of coverage.

## [9.30.0] - 2026-08-14

**The field answered back: one adapter wrote with the wrong verb, another
dropped what it was handed — both corrected, and four statuses now say what
the trial proved.**

A second independent field-trial round on live Google Cloud, 2026-08, drove
this release.

### Fixed — `agentEngineSessions` persist: the service refuses a patch of session state

`sessions.patch({ updateMask: 'sessionState,ttl' })` stored the first turn of
a conversation and then answered every later turn with `HTTP 400 — "Can't
update the session state for session …, you can only update it by appending
an event."` Every injected-client test passed, because a double will patch
anything it is handed; only a live call could find this. `persist` now
appends a `SessionEvent` whose `actions.stateDelta` carries the envelope —
creating the session when it does not yet exist, appending again on a race
between two writers. The pin no longer names `patch` on the sessions path,
and the test double throws the service's own 400 for a `sessionState` patch,
so a regression here fails offline, not in somebody's production project.

### Fixed — `memoryBankStore` fidelity: source identity and caller metadata preserved

A memory's `source` and the caller's own `metadata` went in and did not come
back — silently dropped, even though the port documents `MemorySource`
fields as ones a storage adapter "MUST preserve verbatim on every
read/write." Both, plus `decayPolicy`, are now carried under prefixed
metadata keys and restored verbatim on read. A caller's own value under one
of the three keys this adapter generates (`source`, `resourceName`,
`distance`) is refused by name rather than silently shadowed — recognized by
_identity_, not shape, so a caller's own `distance: 12` cannot be mistaken
for this adapter's. An oversized carried field is refused rather than
truncated: provenance that came back shortened would be provenance nobody
could tell was shortened.

### Changed — engine naming: a project-number-shaped name beside a project id is refused teachingly

`reasoningEngine` naming one project's canonical (numeric) engine name
beside a `project` that names the same project by its textual id was already
refused as two disagreeing spellings; that refusal now teaches when the two
strings could plausibly be the same project spelled two ways. A project
number is not provably the same project as an id without a Resource Manager
lookup this library deliberately does not make — resolving them as equal on
a guess is how one project's conversations get written into another's. The
refusal names both fixes: pass the engine id alone beside `project` and
`location`, or pass the full name and drop `project`.

### Status — four promotions the trial earned

The Gemini 3.x tool loop and thought-signature round trip is
**field-validated**: the same trial re-ran it live against
`gemini-3.1-flash-lite`, tool call, signature echoed back byte for byte, and
a correct second answer. `agentEngineSessions` and `memoryBankStore` are
**field-validated with the corrections above** — a third honest word joins
the status matrix, **field-corrected**: the trial ran the shipped code, the
service refused it, and the code changed to what the service actually
accepts; neither repair has itself been re-run live yet, and the docs say
so. `googleIdentity` is **field-validated for machine identity** — a real
bearer credential from ADC authorized a live Vertex request, `mode: 'user'`
and a disallowed service both failed closed — with expiry-triggered refresh
still explicitly unproven; the trial vended twice minutes apart and did not
wait out an hour.

### Docs

The Google Cloud page carries per-adapter outcomes in place of one blanket
rung, the session method table matches the service (`appendEvent`, not
`patch`), and the Memory Bank mapping rules — what's carried, what's
refused, what's still dropped — are stated rather than implied. The deferred
unified ingress-audit story (a 401 or 429 before a run exists, so
`auditExport`'s hash chain never sees it) is named as a tracked gap rather
than half-shipped quietly, with the seams that can record a refusal today:
your own `verify` and `admission.decide` functions see every refusal they
hand back, and an empty audit bundle is not evidence nobody was turned away
— **absence of a refusal is not consent.**

## [9.29.0] - 2026-08-13

**The Google column tells field truth: signatures echo, doors default
honestly, thinking is counted, and keys can rotate.**

An independent field trial on live Google Cloud, 2026-08, drove this
release — a real Vertex + AI Studio account, not a mock.

### Added — thought-signature echo, so a 3.x tool loop survives its second call

A current Gemini model does not merely prefer its `thoughtSignature` back on
the next turn — the trial hit `400 INVALID_ARGUMENT — "Function call is
missing a thought_signature"` on the second call of an ordinary tool loop,
AFTER the tool had already run. `GeminiProvider` now carries the signature:
read off the `functionCall` part it belongs to, parked on the port's
vendor-neutral `toolCalls[].providerMeta`, and written back onto the
reconstructed part on the next request — byte for byte, never synthesized.
An unsigned call (a 2.5-series turn, or any turn a model chose not to sign)
carries no `providerMeta` key at all and is byte-identical to today's wire.

### Changed — per-door model defaults on `gemini()`

Vertex keeps the field-proven `gemini-2.5-flash` default (Google states its
retirement for **October 16, 2026**). The AI-Studio key door now REFUSES the
bare `'gemini'` shorthand: the trial's key-door call to that same model
answered `404 — "no longer available to new users"`, so shipping a second
silent default nobody has run would be this library guessing on a service's
behalf. The refusal quotes the 404 and names both fixes — `defaultModel` on
the factory, or a named model per call. Fires ONLY on the shorthand; a
request naming a real model id is unaffected on either door.

### Added — typed thinking usage on `llm_end`

`usage.thinking` (`LLMEndPayload`) — reasoning tokens the provider reports,
was already flowing off Gemini's `usageMetadata` and the payload's type
dropped it. The trial's own numbers made the gap visible: a 256-token stream
came back `input 21, output 9, thinking 243` — 243 billed tokens outside both
fields. Deliberately unpriced: `cost.tick` does not fold it in, because
`PricingTable` prices four kinds and thinking isn't one — inventing a rate
would be guessing at somebody's invoice. Undefined on providers that don't
report it, which is most calls; consumers estimating cost from
`input + output` alone should know that under-counts a thinking model by
whatever it thought.

### Added — `apiKey` as a callback, on the Google connection and the OpenAI-compat door

```ts
apiKey?: string | (() => string | Promise<string>)
```

on `GoogleGenAIConnectionOptions` (`gemini`, `geminiEmbedder`) and
`OpenAIProviderOptions` (`openai`, including Vertex's OpenAI-compatible
endpoint). The trial measured the boundary this closes: an OAuth token that
worked returned `401` once expired, with no place in either adapter's options
to put a fresh one. The callback is called once per request, before the
request is built; the SDK client is rebuilt only when the answer changed, so
a cached token costs one function call; a stream keeps the key it started
with — nothing re-authenticates a socket that's already open. Redaction
follows the key actually in force, not the one construction started with, so
a rotated credential never leaks into an error message under the old key.

### Added — the because-clause for rules-only graphs

`cursorMove`'s witness (9.28.0) now narrates identically to the cascade's
`skill.turn_routed` line — one sentence, shared by construction
(`ENTRY_WITNESS_LINE`), so the two records can never drift into two stories
about the same fact. Before this release the sentence only reached readers of
a cascade graph; a rules-only graph (no cascade, entry rules only) fired the
witness on the hop and said nothing. Also fixed: a cascade graph double-
narrating the same routing line once from `turn_routed` and once from the
hop that carried it.

### Docs

The door/model matrix, the Agent Engine Node recipe, and the billing
boundary; `fileObservability` promoted to field-validated (trial cited); the
Google adapter docs corrected where the trial contradicted them — the trial
read two different users' Agent Engine sessions by name under one ordinary
ADC principal, presenting neither identity, so `Session.userId` is metadata,
not authorization. The ownership check is OURS to enforce (above the port,
against `envelopeOwner`), not the service's — stated plainly rather than
implied.

## [9.28.0] - 2026-08-13

**The record quotes the evidence: routing carries the words that decided it,
and every story sentence knows its author.**

### Added — `RouteWitness` on `turn_routed` + `cursorMove`, for data-matcher routes

```ts
witness?: { text: string; keyword?: string }
```

A tier-1 route decided by a DATA matcher (`match:` — RegExp / `{ keywords }` /
`{ all }`) now records what it matched: `text` is the matched substring of the
**user message only**, whitespace-collapsed and bounded to 80 characters
(ellipsis included) — a greedy `/[\s\S]+/` rule cannot paste the whole message
into every record. `keyword` names WHICH declared keyword hit, for the
`{ keywords }` arm. A conjunction (`{ all }`) witnesses its leading part —
every part matched, so any part's text is true evidence, and the first is
deterministic. A zero-width or whitespace-only match records nothing rather
than quoting `""`.

Nothing is recorded for the routes whose evidence differs: a `when` predicate
is opaque code the library cannot quote, an intent match's evidence is already
its `scores`, and an unconditional entry matched nothing. `turn_routed` and
that hop's `cursorMove` carry the same value — the cascade extracts it once,
on the winning rule only, and the hop repeats it rather than re-deriving it.

The commentary layer renders it as evidence, not assertion — `routed this turn
to \`billing\` because the message said "chargeback"` — falling back to
today's sentence, byte-for-byte, when no witness is present.

### Added — `brainSource` on story-trace return beats

```ts
brainSource?: 'model' | 'framework'
```

A tool-result return beat's `brain` line is framework narration (the
commentary engine describing the mechanics), not the model's own words —
`AgentThinkingTraceRecorder` now stamps `brainSource: 'framework'` on it so a
notepad stops prefixing a sentence nobody's LLM said with "LLM reasons —".
Absent means model-authored, the pre-9.28.0 default, so existing readers are
unaffected. Pairs with `agentthinkingui` 0.26.

## [9.27.0] - 2026-08-13

**The story learns the artifact vocabulary, and the Google Cloud column gets
its sessions, memories, and identity.**

### Added — commentary templates for the artifact age

The prose layer (`commentaryTemplates.ts` + the new `artifactPhrases.ts`)
learns the events several recent releases shipped without a sentence:
`artifacts.minted` / `.presented` / `.resolved` / `.refused` / `.expired`,
`tools.result_refused`, the repeated-call nudge (9.26.0), and typed tool
effects. Every line follows the same rules as the rest of the layer:

- **Honest, not inferred.** `tools.result_refused`'s sentence never claims a
  retry happened — no event attests one, so the words don't either.
- **Sizes humanized, and the two units told apart.** `humanizeBytes` /
  `humanizeChars` — `41.0 KB` where the ceiling counts bytes, `240,000
characters` where it counts characters (`tools.result_refused` counts
  characters, because that's what the limit does).
- **Refs and digests stay out of prose.** They identify a row for the details
  panel; a reader doesn't read them. The repeated-call nudge's fingerprints
  are the same story: the sentence says "identical," never the digest that
  proves it.
- **Absent field, absent clause.** A tool effect with no `reason` renders no
  quote — through 9.26.0 it rendered an empty pair of quotes, a sentence
  claiming words nobody spoke.
- **`head` and `get` read as different decisions, not one hedge.**
  `artifacts.resolved.head` says a ticket was described; `.get` says it was
  redeemed and paid for — "described without paying for the payload" is the
  render-by-ref distinction the two sentences exist to carry.
- **Unknown events still fall through.** `selectCommentaryKey` answers
  `undefined` for anything without a template and the caller renders it raw —
  nothing new here is dropped on the floor, and nothing old changed shape.

### Added — Google Cloud Phase B: `agentEngineSessions`, `memoryBankStore`, `googleIdentity`

All three sit on one shared REST layer (`adapters/google/aiPlatform.ts`) over
the split `@googleapis/aiplatform` package (27 MB) rather than the `googleapis`
mega-package (209 MB) that carries every Google API for the same generated
code — contract-shaped and tested; awaiting field use.

```ts
import { agentEngineSessions } from 'agentfootprint/hosting';
import { memoryBankStore } from 'agentfootprint/memory';
import { googleIdentity } from 'agentfootprint/security';
```

- **`agentEngineSessions`** — a `SessionLifecycle` over Vertex AI's own
  session service (the API resource is still spelled `reasoningEngines`): the
  session id IS the resource id, so `hydrate` is one `get` by name. Writes
  wait for their long-running operation to report done before returning, or
  refuse — a `persist` that returned early never reports a landing nobody can
  see yet.
- **`memoryBankStore`** — a `MemoryStore` over Memory Bank, a natural-language
  memory service, not a vector store (`supportsVectorSearch: false`,
  `ranksBy: 'server-text'`, so `indexCorpus`/`indexFolder`/`indexDocuments`
  refuse it by name rather than embedding a corpus nothing will ever rank).
  The service answers a Euclidean distance, not a similarity; this adapter
  converts it so ordering comes out right, and keeps the raw distance in
  `entry.metadata.distance` rather than hiding it. `minScore` is refused by
  name — that number is calibrated to a cosine scale this service doesn't
  use, and reinterpreting it would look like a working threshold. Writes are
  scoped, and a stored row under a foreign scope is refused rather than
  overwritten. `forget()` really deletes: it walks and deletes every matching
  memory itself rather than calling the SDK's `memories.purge`, whose `force`
  flag defaults to false — the service's own documented behavior for that
  default is "validated but not executed," which would make a compliance
  erasure report success and delete nothing. (The sibling `AgentCoreStore`
  now declares the same `ranksBy: 'server-text'` for the identical reason, so
  the two server-ranked stores no longer disagree on how they say what they
  are.)
- **`googleIdentity`** — a narrow `CredentialProvider`: it vends _Google_
  access tokens for _Google_ APIs from whatever credential the environment
  already has (ADC, workload identity, an impersonated service account).
  `mode: 'user'` is refused by name rather than quietly served a machine
  token, since Google's user-token equivalent has no Node surface yet.

Five SDK traps found by pinning against a real install and handled once,
here, rather than per adapter:

1. **Regional vs. global host.** The generated client defaults to the global
   `aiplatform.googleapis.com`; sessions and memories are regional resources,
   so the client always sets a regional `rootUrl` derived from `location`.
2. **Operation races.** `sessions.create/delete` and `memories.create/patch/delete`
   answer with a long-running Operation, not the resource — every write
   awaits it to `done` rather than reading a resource that isn't there yet.
3. **Maskless patch replaces.** A `patch` with no `updateMask` replaces the
   whole resource — on a session, clearing the immutable `userId`. Every
   patch here names its mask.
4. **Purge's dry-run default.** Covered above under `forget()`.
5. **Typed metadata.** Memory Bank's metadata map is not free-form JSON; it's
   typed scalars (`stringValue`/`doubleValue`/`boolValue`/`timestampValue`),
   pinned on the wire type rather than assumed.

Every SDK error is sanitized the same way as the rest of the identity/memory
surface: the operation and the error's name travel, never the SDK's own
message, which echoes the request — and a request here can carry conversation
state and an access token.

### Docs

The [Google Cloud](doc:google-cloud) infrastructure page is filled in to the
same template every other provider column follows: a service → adapter map
(door, peer dependency, ops covered, status), the two renamed-product
callouts, and the three new adapters' boundaries stated in the same voice as
the rest of the page.

## [9.26.0] - 2026-08-13

**The server-brain deployment completes: verified identity at the door, spend
bounds per user, recordings and history served over the wire, refs inside
code sandboxes, and one nudge that ends retry loops.**

### Added — recordings as artifacts

```ts
const agent = Agent.create({
  provider,
  artifacts: { store: fileArtifacts({ dir }), recordings: true },
}).build();
```

Every completed run mints its own `{ snapshot, events, structure }` — the
same shape `recordRun` has produced since 8.x — into the artifact store under
kind `'recording/run'`, after the answer is final. No new wire operation: the
existing `{ op: 'artifact-get', ref }` redeems it, so any screen that already
speaks the artifact wire can replay a run it never held a reference to
before this shipped.

It is deliberately **awaited**, not fired-and-forgotten — stated as a cost.
The answer cannot change by the time the mint runs, but a container that
exits the moment it returns a reply would lose a fire-and-forget write, and
that is precisely the serverless deployment recordings are for. The cost is
one store write per turn, on the option. A mint failure (a full store, a
snapshot that will not serialize) can never fail the run: the reason lands as
`agentfootprint.artifacts.refused` and the turn's own answer returns
unchanged.

### Added — `verifyIdentity` + `jwksIdentity`

Bearer-token verification at the hosting door, BEFORE the run's scope is
composed — the ordering is the feature, since that composed scope is what
memory namespaces on, what artifacts isolate on, and what a credential
provider scopes a vault on:

```ts
await standingAgent({
  agent,
  sessions,
  host: nodeHost({ port: 8080 }),
  identity: {
    verify: jwksIdentity({
      jwksUrl: 'https://idp.example.com/.well-known/jwks.json',
      issuer: 'https://idp.example.com/',
      audience: 'my-api',
    }).verify,
  },
});
```

**Configured is closed-by-default.** A request with no `Authorization`
header is refused (401) unless `allowAnonymous: true` is set, and a request
that _names_ a `userId` without proving it is refused either way — a door
that verifies a token when offered and waves the request through when it is
not is a door anybody opens by sending less. `jwksIdentity` is the one
adapter this release ships (`jose`, loaded lazily, pinned against a real
install): signature, `iss`, `aud`, `exp`, `nbf` — not an authorization
decision and not revocation-checked, both stated on the export.

Failure travels as a named class (`expired`, `wrong-audience`,
`wrong-issuer`, `not-yet-valid`, `claimed-another-user`, `unverifiable`, plus
`keys-unavailable` → 503 rather than 401, since an unreachable IdP is this
deployment's outage, not the caller's bad token) — **never the token text**,
in the message, the event, or a log line. Verified `roles` / `claims` flow to
exactly two places: admission's policy decision and the session-history ops.
Nothing else reads them; they do not enter the run's own identity tuple.

### Added — admission / spend

```ts
await standingAgent({
  agent,
  sessions,
  host,
  identity: { verify },
  admission: turnsPerHour({ limit: 60 }),
});
```

`AdmissionPolicy.decide()` answers `'allow'`, `{ queue: true }` (run behind
this session's own in-flight turn instead of refusing it), or `{ refuse:
'<sentence>' }` — the policy writes its own words, because a limit and its
reset are facts only the operator has. The shipped reference,
`turnsPerHour`, is fed by `spendLedger`: a rolling-window, per-caller
accountant built from the token and cost events every run already emits
(`turns`, `inputTokens`, `outputTokens`, and `usd` — **absent, not zero**,
unless a `pricingTable` is configured; "we did not measure that" is a
different fact from "you spent nothing").

Honest boundary, stated on the type: **per-process** accounting. Two
replicas keep two windows; a restart forgets. A deployment that needs one
number across a fleet writes its own `AdmissionPolicy` reading its own
store — same seam, wider ledger.

### Added — code staging-in

```ts
Agent.create({ provider })
  .tool(codeRunnerTool({ runner: localCodeRunner(), wants: { dataset: 'dataset/rows' } }))
  .build();
```

`CodeRunnerTool` gains `wants`, declared exactly like any other tool's
artifact arguments. The model passes the `art_…` ref; the framework resolves
it under the run's own scope (the same `wants` machinery, the same teaching
refusals for a stale, unknown, or wrong-kind ref) and stages the resolved
bytes into the code session as a file — named in the new `AF_STAGED_INPUTS`
environment variable, a JSON object of argument name → path — before the
code runs. Data reaches the interpreter without ever entering the context
window, matching the outbound leg (`CodeResult.artifacts`, 9.22.0) with an
inbound one.

The port grew one optional member, `CodeSession.stageInputs()`; `localCodeRunner`
implements it, `agentCoreCodeRunner` does not yet. Declaring `wants` on a
session that cannot stage refuses BY NAME at dispatch rather than running
code against a file that was never written.

### Added — session-history wire ops

```
{ op: 'session-list' }                       → the caller's own sessions, newest first
{ op: 'session-transcript', sessionId }       → that session's messages, if the caller owns it
```

Both REQUIRE `identity: { verify }` on the door — a listing of "your"
sessions read off an unverified header is enumeration with a friendly
interface, so a door with no verifier refuses the op by name (501) rather
than serving it under a claimed identity. A transcript for a session the
verified caller does not own is one indistinguishable 404 — same law, same
reason, as the artifact wire's not-found.

Transcripts carry `{ role: 'user' | 'assistant', content }` only — never
tool call arguments or tool results, stated explicitly, because a transcript
that quietly dropped the tool leg would be one somebody reconstructs a
decision from and gets wrong. `memorySessions` and `sqliteSessions` both
grew `listByUser` / `ownerOf`; the SQLite adapter adds two nullable columns
via idempotent `ALTER TABLE` with **no schema-version bump** — an older
reader ignores columns it never asked for. The owner is derived at persist
time from the stored conversation's own identity and is write-once: no later
turn can erase or reassign it.

### Added — repeated-call nudge

Field-motivated: a traced production run called one tool three times in a
row with byte-identical arguments and got a byte-identical result each time,
and nothing in the loop could tell the model so. On the second identical
(tool, args) → identical result landing in one turn, the framework appends
one teaching sentence to that result — the call still runs, the result is
otherwise unchanged, nothing is refused, and a third or fourth repeat adds no
further note. `agentfootprint.tools.repeated_call` fires alongside it,
carrying only non-cryptographic fingerprints of the arguments and the
result, never the values.

It is a note, not a wall: a poll-until-status-changes loop is legitimately
identical calls returning identical results, and only the model knows which
kind it is doing. Opt out with `Agent.create({ …, repeatedCallNudge: false })`.
The counters live beside the dispatch loop, keyed by `runId`, never on
tracked scope — an agent that never repeats a call is byte-identical to
9.25.0 in state, snapshot, and every recording.

## [9.25.0] - 2026-08-13

**The reference architecture is complete: artifacts reach the clouds, and
skills declare what data they feed each other.**

### Added — `s3Artifacts` + `gcsArtifacts`

The five-verb store, on S3 and Cloud Storage, law-for-law with the three
shipped adapters: scope-partitioned traversal-proof keys (a tenant of
literally `..` is a name, never a hop), the digest verified on `get`,
retention stated at mint and swept on read, one indistinguishable miss for a
wrong scope, a foreign object, or an expired one. SDK surfaces are pinned
against real installs, and both are optional peer dependencies loaded lazily
at construction — a browser bundle sees nothing. Status: contract-shaped and
tested; awaiting field use.

S3-compatible on-prem stores (MinIO and the like) work the same way: build
the client against your own endpoint and path style and pass it as `client` —
the adapter dispatches the same five commands either way. Documented on the
[AWS](doc:aws) and [on-premises](doc:on-premises) pages.

### Added — skill artifact vocabularies

`defineSkill` and `SkillStep` gain `produces` / `consumes` (artifact kinds).
The checkup gains `artifact-kind-unsatisfied`: a declared consumption that
nothing on the path produces warns at build time — honest about what static
analysis cannot see (a tool's undeclared mint, an artifact from an earlier
run, from another agent, from outside the process). The skill graph and the
artifact store now speak the same vocabulary.

### Added — optional streaming on the port

`putStream` / `getStream` as feature-detected members (`canStreamArtifacts`,
`canPutArtifactStream`, `canGetArtifactStream`) — a store that cannot move
bytes without holding them whole leaves them absent rather than faking one.
`fileArtifacts` and both cloud adapters stream natively; `inMemoryArtifacts`
and `sqliteArtifacts` honestly do not.

### Quality notes

One shared contract suite now runs all five adapters — a cloud column that
drifts from the port fails the shipped adapters' own tests. A vendor-
neutrality guard covers the artifact port (the two adapter files are exempt
by name; everything else may not name a cloud). Raw SDK errors are sanitized
on every path — the operation, the exception's name and the HTTP status
travel; the vendor's own text, which echoes the bucket and the scoped key,
does not.

## [9.24.0] - 2026-08-13

**A person answers through a typed panel: the ask carries a component, the
options ride the store, and the decision returns as a fact.**

### Added — `AskComponent` on all three ask doors

```ts
component?: { componentId: string; props?: Record<string, unknown>; propsRef?: ArtifactRef }
```

`askHuman({ component })`, middleware `ask({ component })`,
`defineTool({ checkIn, checkInComponent })`. `componentId` is FE-registry
vocabulary — never markup. Big option sets ride `propsRef` through the
artifact store so the checkpoint stays lean (pinned: a 200-option ask via
`propsRef` keeps the payload out of the checkpoint entirely).

### Added — raise-time validation, one gatekeeper

Shape → store attached → the ref resolves in the run's own scope — refused
loudly AT THE SOURCE (a pause with a dead ref would strand the human).
Declaration-time refusals: `checkInComponent` without `checkIn`; a static
`propsRef` on a storeless agent.

### Added — the surface that collected a decision is on the record

`componentId` stamped additively on `checkin.decision`, `middleware.decision`,
and `pause.resume`. The decision itself is unchanged — structured, never
parsed from prose.

### Behavior note (recorded honestly)

The `component` key in an `askHuman`/`pauseHere` `pauseData` bag was
previously uninterpreted; it is now reserved and read as `AskComponent`
(validated at raise). Any consumer that used that key for private data must
rename it.

### Zero-cost when unused

Componentless asks are byte-identical — payload key sets, checkpoint, and
events all pinned.

## [9.23.0] - 2026-08-13

**The screen redeems claim tickets: artifact resolution joins the hosting
wire, scoped to the session that asks.**

### Added — two wire operations on the existing invoke path

```ts
{
  op: 'artifact-head', ref;
} // → meta
{
  op: 'artifact-get', ref;
} // → meta + data
```

Resolved under the requesting session's identity-composed scope — exactly
the scope the run's own tools used. A ref from another session, the wrong
identity, an expired artifact, and a never-minted ref all return one
indistinguishable 404 (`ERR_ARTIFACT_NOT_FOUND`) — pinned byte-identical.

### Added — port surface

`HostRequest.artifact` + a fourth `HostReply` terminal, `artifact(result)`
(with a named not-carried fallback, `ERR_ARTIFACT_NOT_CARRIED`). Both
shipped wire dialects carry the ops; the grammar has one owner
(`artifactWire`) exported for custom dialects. `Agent.getArtifactStore()`
is the composer door.

### Read-only by design

No put, delete or list over the wire — a screen redeems tickets, it does
not mint, sweep, or ENUMERATE a scope. Citable.

### Teaching refusals

No store attached → 501 naming `Agent.create({ artifacts })`. No session →
400 (there is no bare-ref mode). Malformed op → 400. An op-carrying body
never falls through to a model turn.

### Behavior note (recorded honestly)

A legacy invoke body that carried a top-level `op` field previously fell
through to a model turn; it now answers 400 `ERR_INVALID_WIRE_OP`. `op` is
reserved on the invoke path from this release.

### Events

Wire redemptions ride the existing `agentfootprint.artifacts.resolved` /
`.refused` events exactly once; the `tool` field is now honestly optional
— the redeemer was the hosting door.

## [9.22.0] - 2026-08-13

**The model routes claim tickets: tools receive resolved data, screens
receive described refs, and six megabytes of freight costs two metadata
lines.**

### Added — ref arguments (`wants`)

```ts
defineTool({
  name: 'summarize',
  wants: { dataset: 'dataset/rows' },
  execute: async (args, ctx) => {
    /* args.dataset is the RESOLVED DATA */
  },
});
```

The model passes a ref string; dispatch resolves it under the run's own
scope and kind-checks it BEFORE the tool runs. The handler receives the
data — never the ticket — plus the meta on `ctx.wanted`. A stale,
unknown, or wrong-kind ref never reaches the tool: the model reads a
teaching refusal listing the live refs of that kind in its own scope, so
the correction is what to pass, not a retry of the same dead ref.

### Added — the `present` tool

Auto-attached only when a store is attached. `present({ ref, as, label })`
verifies the ref and returns a description snapshot — `{ kind,
mediaType, bytes, label }` — INSIDE the tool result. The claim ticket
describes the parcel, so a conversation reloaded after the artifact has
expired can still render an honest placeholder from history. New typed
event `agentfootprint.artifacts.presented`. The model never serializes
what the screen will show.

### Added — the placement threshold

```ts
Agent.create({ artifacts: { store, placement: { maxInlineChars: 10000 } } });
```

A tool result over the threshold is checked into the store (kind
`tool-result/<toolName>`, the exact displaced text) and the model
receives the ticket: ref + meta + how to consume it. Ceiling precedence,
stated and pinned: the tool's own `resultCeiling` (the author's refusal)
first, placement second, the agent-level truncation net last. A placed
result is a ticket, not a refusal — it still advances steps and keeps
its declared effects.

### Added — code results join the store

Files a code run produces are minted into the same store — deterministic
`file/<ext>` kinds, origin stamped — and `CodeResult.artifacts` entries
gain a `ref`. Staging refs INTO code sessions is deferred and stated as
such.

### Security

Every new door is scope-locked: another session's ref resolves to
nothing, and refusal listings name only the caller's own live refs.

### Zero-cost when unused

Pinned on all four legs — no `wants`, no `present`, no `placement`, no
code-result minting, and behavior is byte-identical to 9.21.0.

This is Phase 2 of the reference-architecture work, the data legs, on
top of the artifact store shipped in 9.21.0.

## [9.21.0] - 2026-08-13

**Data stops riding the conversation: the artifact store — a tool checks
its result in and hands back a claim ticket.**

### Added — the ArtifactStore port

Five verbs: `put`, `head`, `get`, `delete`, `list` — scope is always the
first argument. `get` returns `null` for missing-or-expired, never a
thrown error; a store is a claim-check, not a query engine, so there are
no query or transform verbs, by design and citable.

Refs are opaque minted ids (`art_…`) — never content-addressed. The
sha-256 digest of the payload rides as metadata and is verified on
`get`; a mismatch is a named integrity error, never silent corruption.
`parentRefs` are derivation facts validated at mint time — a parent ref
that doesn't resolve is refused on the spot, a foreign key that cannot
dangle at birth.

### Added — three adapters

`inMemoryArtifacts`, `fileArtifacts`, `sqliteArtifacts`. `inMemoryArtifacts`
is always bounded per scope (32MiB / 256 rows, LRU, drop-counting) — there
is no unbounded mode. `fileArtifacts` is scope-partitioned with
traversal-proof paths. `sqliteArtifacts` pairs with the existing
`sqliteSessions` adapter — same lazy-dependency loading and the same
schema-refusal laws.

### Added — `ctx.artifacts`

Shaped like `ctx.credentials`: always present on the tool context,
fail-closed with a teaching refusal naming `Agent.create({ artifacts })`
when no store is attached. Scope is composed by the framework from the
run's own identity — a tool can never widen it — and origin (`runId`,
`toolCallId`) is stamped from the run's own facts, never supplied by the
tool.

### Added — four typed events

`agentfootprint.artifacts.minted` / `.resolved` / `.expired` / `.refused`
— meta-only payloads, the bytes never enter the event. A ref alone opens
nothing: resolution requires the session's scope, so the same ref under
another tenant resolves to `null`, on the record.

### Retention

A `ttl` stamps `expiresAt` at mint time — stated, never sprung on a later
read. Budget evictions are reported by the `put` call that caused them
and counted, not swallowed.

### Zero-cost when unused

No store attached is a byte-identical agent — same behavior, same
events — pinned by regression test.

This is Phase 1 of the reference-architecture work. The data legs — ref
arguments at dispatch, the present tool, the placement threshold — come
next.

## [9.20.0] - 2026-08-13

**Two-dimensional rules as data, and oversized results that teach instead
of truncate.**

### Added — conjunction matcher

```ts
{ match: { all: [/zone/i, { keywords: ['audit', 'sweep', 'all'] }] }, use: 'audit-skill' }
```

A rule fires only when EVERY member of `all` matches. The 2D routing case
— "zone AND audit-shaped" — becomes declared data instead of a hand-rolled
condition: drawn by `toMermaid()` with its parts joined by `AND`, compared
by the checkup (provable shadows only — a conjunction sitting above its
own broader fallback is a supported design and is never warned about),
and stored on provenance. An `intent` condition inside `all` is refused at
compile time, with the alternative named; a nested `all` is flattened
rather than refused — AND is associative, so the stored data describes
what actually runs.

### Added — the refusing result ceiling

```ts
defineTool({
  resultCeiling: { maxChars: 10_000, narrowBy: ['vsan', 'wwpn'] },
});
```

Over the ceiling, the model reads a teaching refusal — `Result too large
(N chars). Narrow and call again: pass vsan or wwpn. No data was
returned.` — and the oversized payload never enters context, history, or
recorders. The record keeps the TRUE size via the new typed event
`agentfootprint.tools.result_refused`; delivered status is `'invalid'` so
`onToolStatus` edges route on it; a tool's declared effects still apply (a
proposed transition survives its own oversized payload); a procedure step
never advances on a refusal.

A truncated result the model cannot tell is partial produces confident
summaries of the wrong subset. A refusal that names the narrowing
parameters produces a clean retry — field-verified.

Composes with the agent-level `maxToolResultChars` (the operator's net,
truncate-with-verbatim-head): the per-tool ceiling is the tool author's
teaching layer underneath it.

## [9.19.0] - 2026-08-13

**The cursor picks the brain, and tools stop smuggling control through
prose.**

### Added — per-skill brains

```ts
defineSkill({
  id: 'refund',
  provider: strongProvider,
  model: 'refund-strong-model',
  tools: [issueRefund],
  body: 'Check the order, then issue or deny.',
});
```

A skill graph already decides WHERE the run is; a per-skill brain lets
that same position decide WHO answers. `defineSkill({ provider, model })`
keeps the choice beside the skill it serves; `.skillGraph(graph, {
providers })` keeps a fleet's choices in one place at the mount — same
meaning, two homes. While the cursor holds a skill with a declared brain,
every LLM call in that tenure runs on it; which brain answered is stamped
on `llm_start`.

Precedence is stated and enforced, most specific wins: **escalation
brain > per-skill brain > `.configure()`'s run model > the build
default.** A brain naming only a model inherits the agent's own provider;
a brain naming a _foreign_ provider without a model is refused at
`Agent.build()` — the run's configured model belongs to another vendor's
namespace and would fail mid-turn, on exactly the iteration the cursor
enters the skill.

### Added — escalate-on-evidence

```ts
.skillGraph(graph, { escalation: { provider: strongProvider, afterRefusals: 2 } })
```

`N` gate refusals in one turn (`skill.rejected` — reachability or
posture, real recorded refusals, never vibes) flip the rest of that turn
onto the escalation brain. Recorded once as
`agentfootprint.skill.escalated`. The flip resets at the start of the
next turn — evidence, not a standing setting.

### Added — the tier-3 decider

```ts
.skillGraph(graph, { decider: { provider: smallProvider } })
```

An out-of-band constrained-enum pick (a declared skill id, or `'stay'`
— never free text) resolves a routing menu the earlier rungs left
outstanding. `turn_routed.by` gains `'decider'`. It is the sanctioned
resolver for a `rails`-posture menu, which otherwise proceeds on the base
prompt with nothing decided.

### Added — typed tool effects

A tool may return `{ content, effects, status }` instead of a bare
value. Plain `{content}`-shaped returns — and every string a tool
returns today — stay byte-identical; the envelope is recognized only by
its own strict shape.

- **`propose-transition`** — `{ kind: 'propose-transition', targetSkillId,
reason }`. The typed replacement for a string routing marker: the
  _graph_ decides. A same-batch declared edge still wins; an unreachable
  target is refused out loud, not silently dropped.
- **`require-instruction`** — `{ kind: 'require-instruction',
instructionId, deliveryLease: 'next-call' | 'until-skill-exit' }`.
  Pushes a _registered_ instruction into the coming call(s) —
  `read_skill` stays the pull door for optional knowledge; this is the
  push door for mandatory procedure, and it only pushes what was
  registered at build. An unknown id is refused, never improvised.

Every acceptance or refusal is a typed `agentfootprint.tools.effect`
event carrying a teaching note the model can act on.

### Added — route on meaning

`onToolStatus` route edges match a tool result's declared outcome —
`success | failure | denied | invalid | partial | pending` — so a denied
call can never route like a success. Composable with `onToolReturn`;
drawable in `toMermaid()`.

### Law

Push mandatory procedure. Pull optional knowledge. Never let arbitrary
text promote itself into control authority.

## [9.18.0] - 2026-08-12

**Procedures become data: the framework holds the step pointer, the model
fills in the blanks — and the whole cascade now narrates itself.**

### Added — steps as data

```ts
defineSkill({
  id: 'refund',
  tools: [findOrder, checkHistory, verifyIdentity, approveRefund, issueRefund, fileReceipt],
  steps: [
    { tool: 'find_order', note: 'find the order before touching money' },
    { tool: 'check_history', note: 'confirm the duplicate charge' },
    { tool: 'verify_identity', note: 'verify the caller owns the card' },
    { tool: 'approve_refund', note: 'a person approves before money moves' },
    { tool: 'issue_refund', note: 'refund the duplicate charge only' },
    { tool: 'file_receipt', note: 'file the receipt for audit' },
  ],
  onSkip: 'advance', // or 'hold'
});
```

While a stepped skill is active the framework injects the current step
every iteration ("step 3 of 6: …"), offers that step's tool plus every
intact escape hatch (`read_skill`, other active skills' tools), advances
the pointer on the tool's return — including across pause/resume, so a
human-in-the-loop step resumes with the pointer intact — and records
everything as it happens. A skill declared without `steps` is
byte-identical to before (pinned by regression tests).

### Added — `skip_step`

The model may decline the current step with a required reason. The reason
is recorded, never silently lost. `onSkip: 'advance'` (the default) moves
the pointer on; `'hold'` keeps the step current so the model can retry it,
work around it, or finish and explain. A premature stop with steps
unfinished gets one teaching nudge — never a forced continue — and a second
stop is honored.

### Added — three typed events

`agentfootprint.skill.step_advanced`, `agentfootprint.skill.step_skipped`,
`agentfootprint.skill.steps_unfinished` — every pointer move, skip, and
early stop lands on the record.

### Added — build-time teaching refusals

Four combinations that could never honor a declared procedure are refused
at `Agent.build()`, naming both the problem and the fix, instead of
silently activating a procedure that never engages:

- a step naming a tool the skill doesn't carry (refused at `defineSkill`,
  where the tool list and the steps arrive together);
- `steps` on an OPEN skill of a mounted skill graph (activated by
  `read_skill`, never receiving the cursor a procedure's tenure depends on);
- `steps` on a decision `.tree()` leaf, or beside one (a tree never writes
  a cursor);
- `steps` on a skill with no mounted graph and a non-`llm-activated`
  trigger (no `read_skill` activation, so no tenure ever begins);
- `reactMode: 'classic'` with `steps` (classic freezes the tools slot after
  turn 1 — the per-step narrowing would freeze with it).

### Added — the story rail narrates routing

Commentary templates render `agentfootprint.skill.turn_routed` verdicts
with the numbers behind them (intent scores + runner-up, a near-tie hold's
two closest shares), `route_conflict` suppressed hops (which tool result
lost and why), `strictness` posture refusals (`guard`/`rails`), and a
model pick's divergence from the menu it was offered. The trace recorder
taps these into the next beat as they happen, not after the fact. Pairs
with the Why Lens 0.33.x narration.

### Deprecation reminder

`refreshPolicy` remains deprecated (9.16.0) and still does nothing —
per-step injection is its successor. Dev mode now also warns when a skill
sets both `refreshPolicy` and `steps`.

## [9.17.0] - 2026-08-12

**The turn starts where the conversation is — a routing cascade that
consults the model last, and says exactly which rung decided.**

### Added — the turn-start routing cascade

Every turn now resolves through one ordered cascade instead of one rule:

```
sticky cursor (continuity: 'conversation')
  ← declared rules
  ← a scorer over declared intents
  ← the model's menu
```

Each rung is tried in that order; the first one that produces a verdict wins.
Every verdict — win or fall-through — is recorded on a new typed event,
`agentfootprint.skill.turn_routed`: `by`, `from`, `to`, ranked scores
including losers, the runner-up gap, the policy numbers verbatim, and
`droppedResume`. Near-ties fall through to the next rung rather than
argmax-ing a coin flip. The cascade runs once per turn, off the hot loop —
the cursor resolver itself stays synchronous.

### Added — intents as data

```ts
{ match: { intent: 'refund_request', examples: ['I want a refund', 'charge me back'] }, use: 'billing' }
```

`match: { intent, examples }` joins regex and keywords as a third matcher
arm. It is scored by a pluggable `IntentScorer` port that scores **every**
candidate — never hands back a bare winner. Built-ins:

- `keywordScorer()` and `embeddingScorer(embedder)`, both widened to the new
  scorer shape.
- `llmClassifier(provider, { window? })` — new: a constrained enum
  (declared skill id, or `'none'`), never free text feeding routing
  decisions.

`skillGraphCheckup` gains intent audits — duplicate examples across skills,
leave-one-out overlap — with their honesty boundaries stated up front
(what the audit can and cannot promise).

### Added — `strictness` on `.skillGraph(graph, options)`

```ts
.skillGraph(graph, { strictness: 'guard' })
```

Three postures:

- `'assist'` — today's behavior, and the default.
- `'guard'` — picks are pinned to the offered set (or stay) while a menu is
  outstanding.
- `'rails'` — the model never routes; a menu under rails proceeds on the
  base prompt, recorded as `by: 'none'`. That's the honest cost of the
  posture, and it's documented as one.

Un-honorable combinations (`rails` × `entryByRead`, `conversation` ×
`tree`) are refused at build time with a teaching message, not a silent
no-op.

### Added — `continuity: 'conversation'`

```ts
.skillGraph(graph, { continuity: 'conversation' })
```

The previous turn's cursor becomes the default entry on a resumed
conversation, riding the existing run checkpoint — no second cursor, and
opt-in only. If the graph was redeployed and no longer recognizes the
inherited cursor, it is dropped and the drop is recorded, never silently
kept.

### Safety

Role-hidden skills stay out of candidates, scores, menus, and the envelope
end to end. A hidden-skills resolver that throws fails **closed** — nothing
is offered that turn, and dev mode warns. A lone non-finite score reads as
unmatched, never as an uncontested winner.

### Zero-cost when unused

Graphs that use none of the new options are byte-identical in behavior
_and_ events to 9.16.0 — pinned by regression tests. 78+ new tests cover
the cascade, the scorers, the strictness postures, and continuity.

### Deferred

Per-skill model/provider switching and escalate-on-evidence are named in
the design but not in this release; they land in a later minor.

## [9.16.0] - 2026-08-12

**Parallel tool batches stop lying to the router, and a combination that could
never be honored now says so at build time.**

### Fixed — batch routing

Before this release, when a turn's tool batch came back with more than one
result, only the **last** tool call in the batch drove skill-graph routing and
`onToolReturn`. Two identical parallel calls could route to different skills
depending only on where each one happened to land in the message — an
ordering bug with no error, no log line, just a silently different cursor.

- Every result in the batch now routes, in call order. The first match wins
  the cursor; the loop still stops there (a router picks one skill per turn).
- A later result that would have matched a **different** skill is suppressed,
  not silently dropped — it emits `agentfootprint.skill.route_conflict`:

  ```ts
  {
    winner:  { toolCallId, toolName, target },
    losers:  [{ toolCallId, toolName, target }],
  }
  ```

  On the record, so a trace answers "why didn't the second call route?"
  instead of leaving the reader to guess.

- Single-tool iterations are byte-identical to 9.15.0 — this only changes
  behavior when a batch actually contains more than one result.
- New `AgentState.toolResults` / `InjectionContext.toolResults`: the full
  batch, in call order, each entry carrying its `toolCallId`. `lastToolResult`
  is unchanged (it is now defined as the last entry of `toolResults`). Rule
  `when` predicates can read `ctx.toolResults` directly via the new
  `toolResultsOf(ctx)` helper.

### Added — build-time teaching refusal: classic + a skill graph

`reactMode: 'classic'` caches the system prompt and tool list after turn 1.
Wiring a `.skillGraph(...)` onto a classic agent meant the graph would still
route and the trace would still show an activation — but the model never saw
the newly-active skill's prompt or tools, because the slot it would have
changed was already frozen. The configuration _looked_ like it worked and
didn't.

`Agent.build()` now refuses this combination outright, naming both the
problem and the fix:

```
AgentBuilder.skillGraph: reactMode 'classic' cannot honor a skill graph.
Classic caches the system prompt and tools after turn 1, so a route-driven
activation would move the cursor and the trace but never reach the model.
Use reactMode: 'dynamic' or 'dynamic-grouped', or drop .skillGraph(...) and
compose the always-on skills you need directly.
```

Classic without a graph is unaffected, and so is a turn-1-only composed set
of always-on skills. This was previously only a dev-mode console warning;
the docs already said not to do this. Now the build says it too.

### Deprecated — `refreshPolicy` on `defineSkill`

`refreshPolicy` has been accepted and stored since it was added, and never
read by anything — it did not do what its name promised. It is now marked
`@deprecated` and triggers a one-time dev-mode warning naming the
replacement direction (a coming steps-as-data feature) when set. It will be
removed in the next major.

### Verified & pinned

Two lifecycle questions settled with end-to-end probes rather than left as
folklore:

- An open skill picked via `read_skill` stays active until the turn ends —
  by design, and now documented as a test rather than tribal knowledge.
- The batch-order routing bug above has a repro that fails on the old
  behavior and passes on the fix, so it cannot silently come back.

## [9.15.0] - 2026-08-12

**The skill graph's front door, simplified.** Same graph, fewer things to type,
and the routing table becomes something the library can read, lint, and draw —
not a bag of opaque functions.

### Added — `scopeTools` on the flat graph (one line, not one per skill)

```ts
const graph = skillGraph({
  skills: [billing, shipping, returns],
  start: { rules: [{ match: /refund|charge/i, use: 'billing' }] },
  scopeTools: true, // every wired skill's tools appear only while it is active
});
```

What previously required `autoActivate: 'currentSkill'` typed on every single
skill is now one graph-level line. A skill's own explicit `autoActivate` always
wins — the graph sets a default, never an override. Only _wired_ skills (named
by an entry or a route) are stamped: an unwired skill's tools would otherwise
never appear at all. With the dial absent or `false`, compiled skills are
byte-identical to 9.14.0 (pinned by test). On a `tree()` graph the flat-arm
dial is refused with a pointer to `tree(root, { scopeTools })` — one dial, one
home. The default stays `false` in 9.x; it flips in 10.0.0.

### Added — matchers as data: `match` beside `when`

```ts
start: {
  rules: [
    { match: /refund|charge/i, use: 'billing' },          // RegExp form
    { match: { keywords: ['track', 'package'] }, use: 'shipping' }, // keywords form
    { when: (ctx) => ctx.iteration > 1, use: 'triage' },  // predicates still work
  ],
}
```

A rule now takes `match` (data) or `when` (function) — exactly one; both or
neither is refused at the type level and at runtime with the fix in the
message. Keywords are case-insensitive escaped literals (any present matches,
whole-word at word-character edges — `refund` never fires on `refunds`);
stateful regex flags (`g`/`y`) are dropped at compile so the same message can
never alternate answers. Because the matcher is data, it is **drawn**
(`toMermaid()` captions the entry edge), **stored** (`SkillMatchData` on the
skill's provenance and the entry edge), and **compared** (below). The union is
extensible by design — a future `{ intent, examples }` arm lands without
reshaping.

### Added — three check-up codes for the rules form

- `rule-id-exists` (ERROR): a rule routing to a skill not in `skills[]` refuses
  to build under every `check` mode, listing all bad ids and the known catalog.
- `overlapping-rules` (warning): two data matchers provably overlap (a shared
  keyword) and declaration order decides those messages.
- `rules-shadowed-by-order` (warning): a later rule provably can never win —
  an identical regex earlier, or an earlier keyword superset.

The comparisons claim only what data proves: `when` predicates are opaque and
the messages say they were not checked. And the `multi-entry-fanout` warning no
longer fires on routers where every entry carries a `when` or `match` —
deterministic rule-routing is a supported design, not a smell.

### Changed — `knownTools` is now automatic at agent build

A graph built without `knownTools` defers its two body-contract checks
(`body-foreign-tool`, `body-unknown-tool`) instead of guessing: the deferral
note travels on each compiled skill's metadata, and `Agent.build()` — the one
point that sees the full tool registry — runs the checks exactly once, whether
the graph arrived via `.skillGraph(graph)`, `.skills({ list: () => … })`, or
`.skill()`. Passing `knownTools` by hand still works and keeps today's
graph-build-time behavior. `graph.checkup()` is unchanged. ToolProvider tools
cannot be enumerated at build time — pass those via `knownTools`.

### Docs

The object-literal form is now the canonical taught form (the fluent builder
remains fully supported). New module README for the skill-graph family
(`src/lib/injection-engine/README.md`) and a new runnable example
(`examples/features/54-skill-graph-front-door.ts`).

## [9.14.0] - 2026-08-12

**A strategy that said so now does so.** `defineMemory({ strategy: { kind:
SUMMARIZE } })` has required an `llm` since it existed and never called one: the
compression stage sat in `src/memory/stages/summarize.ts` composed into no
pipeline, so `EPISODIC × SUMMARIZE` behaved as `WINDOW(recent)` — eight turns
through it with a counting provider made **zero** `complete()` calls. 9.5.0
wrote that fact down honestly, in `listMemoryStrategies()`, the docs table,
MENTAL_MODEL.md, AGENTS.md and the factory arm. This release deletes all five
sentences by making them false.

### Added — SUMMARIZE compresses, once per span, and keeps the originals

```ts
const memory = defineMemory({
  id: 'long-chat',
  type: MEMORY_TYPES.EPISODIC,
  strategy: {
    kind: MEMORY_STRATEGIES.SUMMARIZE,
    recent: 6, // the 6 newest entries stay verbatim
    size: 20, // how much history to load per turn
    llm: anthropic(), // its OWN instance, not the agent's
    model: 'claude-haiku-4-5', // named explicitly — no fallback
  },
  store,
});
```

What runs, per turn: load `size` entries, keep the newest `recent` verbatim
(seam rounded outward to a whole turn, so a question is never folded away from
its answer), fold everything older with **one** call to `model`, and **write the
summary back to the same store** under `msg-summary-{fromTurn}-{toTurn}`. Recall
becomes `[summary, ...recent verbatim]`. Because the summary is stored, a span is
compressed **once in the life of a conversation** rather than once per recall —
that write-back is the entire cost model, and it survives a fresh `Agent` (or a
fresh process) per turn, because the store is what remembers.

**The folded originals are never deleted.** They stay in the store byte-identical
and are excluded from recall by the summary's coverage metadata
(`metadata.summarizes.coveredIds`) and by nothing else — delete the summary entry
and the next recall is verbatim again. A summary is a claim ABOUT the
conversation, the same law `.compaction()` follows in the live window.

### Added — the summarizer names its model, and may not be the agent itself

`model` is **required** on the strategy, with no `?? agentModel` fallback: the
8.14.0 `.compaction()` law, applied to the second door that spends money on your
behalf. The deleted default had no correct case — the same provider family
quietly bills your MAIN model for compression, and a different vendor is sent a
model id it has never heard of, mid-conversation, on a paid run.

`Agent.memory()` now also refuses a summarizer that is the agent's own provider
**instance** at the agent's own model (the narrow 8.14.0 rule; a _second
instance_ of the same vendor at the same model is allowed and sometimes right).
`defineMemory` cannot make that check — it has never heard of an agent — so a
`MemoryDefinition` now declares `billing: { provider, model }` and the builder
reads it, the same field and shape `WindowStrategy.billing` already used. One
refusal, three doors.

Two more refusals at build, both naming the line that fixes them: `recent >=
size` (a verbatim tail as large as the window means nothing older is ever
loaded, so the summarizer could never fire — a paid dependency wired to a stage
that cannot run), and `readOnly: true` (the write-back IS the cost model, so
"nothing is ever stored back" and SUMMARIZE contradict each other).

`listMemoryStrategies()` reports `requirements: ['llm', 'model']`. They are two
requirements rather than one because a deployment can hold a provider and still
have no answer for which model compression should run on — and a library that
picked one would be picking your invoice.

### Added — three ways it declines, all of them out loud

Every one emits the existing `agentfootprint.memory.strategy_applied` with a
reason a reader can act on, plus the model and the token usage the call
reported. **Not `cost.tick`** — the USD channel needs a `pricingTable` and the
run's cumulative counters, both of which live on the Agent's scope, and a memory
pipeline is a subflow with neither; a tick reading `estimatedUsd: 0` would be a
cheaper-looking lie than saying nothing, so the tokens ride the memory event and
the fold is never silent:

- **not worth a call** — fewer foldable entries than the floor. No call, no
  change. (`defineMemory` sets the floor to the size of the verbatim tail: never
  fold less than you keep.)
- **summarizer failed** — one `console.warn` per stage instance, one event, and
  recall proceeds **VERBATIM**. A broken compressor degrades this strategy to
  `window`; it does not fail the turn. (Through 9.13.0 the stage re-threw. A
  memory that cannot recall because its optional compressor is down is a worse
  answer than an uncompressed one.)
- **replacement-not-smaller** — the summary plus its authored label is no shorter
  than the span it would replace, so the fold is dropped and the span is
  **latched** by its own entry ids: the same question is not bought twice. A span
  that has GROWN is a different key and is asked again, on purpose (the 8.14.0
  latch, same reasoning, same shape).

Prompt-injection boundary, both directions, as `.compaction()` has it: going out,
the span is rendered as DATA between delimiters the authored instruction names;
coming back, the summary is appended after an authored label the library wrote,
so an entry always says in the library's own words and first that what follows is
a model's claim and that the originals are retained.

### Changed — behaviour worth knowing before you upgrade

- `EPISODIC × SUMMARIZE` now makes LLM calls where it previously made none. It is
  the same config shape plus a required `model`, so an existing definition
  fails at `defineMemory` (naming the fix) rather than silently starting to spend.
- The `summarize` stage's `llm` accepts an `LLMProvider` (+ `model`) as well as
  the 2.x `(messages) => Promise<string>` callback. The callback keeps its exact
  contract; passing `model` with a callback is refused, since nothing would read
  it. The provider form is what reports token usage to the event.
- A summary entry is filed at the time of the **material it stands for** —
  strictly one millisecond after the newest entry it covers — not at the time of
  the fold. Order depends on it (a claim about turns 1–7 stamped `now` sorts
  after turn 12 and reads as if it happened last), and so does correctness: being
  strictly newer than everything it covers is what guarantees a recency-limited
  load can never admit a covered original while dropping the summary that
  excludes it. Anchoring on the tie instead lets a page boundary separate them,
  and the span is then folded a second time under an overlapping id — found by
  the end-to-end probe, and pinned by test.
- A write TTL applies to the summary on the **span's** clock, so a retention
  window ("delete chat history after 30 days") expires the summary with the turns
  it compressed instead of days after them. Decay scores it by the same age, so a
  summary of last month fades on last month's schedule rather than passing as
  fresh.
- `defaultPipeline` takes a `summarize` config and composes a `Summarize` stage
  directly after the load — before decay and before the budget picker, because
  both decide against what recall CONTAINS. Absent config means an absent stage,
  never a stage that runs and does nothing (the `decay` precedent).

### Removed — the caveat, everywhere it was written

The 9.5.0 honest-caveat text is gone from `listMemoryStrategies()`'s description,
the `missingRequirement('llm')` refusal, the `defineMemory` dispatch table and
arm comment, `docs/MENTAL_MODEL.md` (§7, the latent-gap block and §14),
`docs-next` (`build/memory.mdx`, `infrastructure/memory-and-stores.mdx`) and
`AGENTS.md`. A test now asserts the description does NOT carry it, in both
directions — a caveat that outlives the gap is the same kind of lie as a gap that
outlives its caveat.

### Tests + example

`test/memory/summarize-wired.test.ts` is the 9.5.0 probe with its assertion
inverted (8 turns, counting provider, `complete()` calls > 0), plus: the summary
lands in the store under its deterministic id, covered originals are excluded
from recall AND still present, the recent turns survive verbatim, no two folds
ever cover the same entry, a fresh Agent per turn keeps the same books, the loud
degradation, and every refusal. `test/memory/stages/summarize.test.ts` grew to 31
tests across the 7 patterns. `examples/memory/03-summarize-strategy.md` and its
runnable example — which passed a summarizer that never ran — now assert that it
did, that the summary was stored, and that every summarized-away original is
still in the store.

## [9.13.0] - 2026-08-12

**The third provider column opens, and it opens with the two adapters that can be
built honestly today.** Google Cloud joins AWS and on-premises as a documented
column. What ships is `gemini()` — a native `LLMProvider` over `@google/genai`,
not a `baseURL` on the OpenAI one — plus `geminiEmbedder()`, plus a pin that
checks its own claims against the really-installed SDK. What does not ship says
why, with a date.

### Added — `gemini()`: the native provider, on both of Google's doors

```ts
import { gemini } from 'agentfootprint/providers';

const vertex = gemini({ project: 'my-project', location: 'us-central1' }); // ADC
const studio = gemini({ apiKey: process.env.GEMINI_API_KEY! }); // one key
```

Two doors, one adapter, and neither is guessed: a project selects Vertex, a key
selects the Gemini API, and configuring **neither** is refused at construction
naming both — because the SDK's own behaviour in that case is to warn on stderr,
construct anyway, and fail on the first call with something that reads like a
network problem. An empty environment variable reads as absent.

Four things this adapter can do that `openai({ baseURL })` against Google's
OpenAI-compatible endpoint cannot, and they are the whole reason it exists:

- **Honest cached and reasoning tokens.** `usage.cacheRead` ←
  `usageMetadata.cachedContentTokenCount` and `usage.thinking` ←
  `thoughtsTokenCount`, each its own number. The compat endpoint's documented
  response has neither field, so a cost dashboard behind it can only ever show a
  total.
- **Tools stay JSON Schema.** `FunctionDeclaration.parametersJsonSchema` takes
  your schema untranslated. The compat endpoint's `function.parameters` is an
  **OpenAPI** subset, where `$ref`, `oneOf` and `additionalProperties` mean
  something else or nothing — a divergence you discover from a model that ignored
  half your constraints.
- **`carriesForcedToolChoice: true`, earned.** `toolConfig.functionCallingConfig`
  with `mode: 'ANY'` and one `allowedFunctionNames` entry really does constrain
  the answer to that function, on both doors — so
  `.outputSchema(parser, { strategy: 'tool-forced' })` works rather than refusing.
- **Auth that does not expire in an hour.** ADC refreshes itself; the compat
  endpoint takes an OAuth bearer with a 60-minute life and no refresh home in
  `OpenAIProviderOptions`.

Also on the wire: `systemInstruction` as a top-level field, which makes this an
**Anthropic-family wire** — `carriesInMessages` is `['user', 'assistant']`, so a
`slot: 'messages'` injection with `role: 'system'` is refused at run start rather
than silently dropped; `thinkingConfig.thinkingBudget` from `.thinking({ budget })`;
`abortSignal` threaded; `stopSequences`, `temperature` and `maxOutputTokens`.

Three decisions worth reading before you rely on them:

- **Tool-call ids are sometimes invented, and never sent back.**
  `FunctionCall.id` is optional on Gemini's wire and Vertex routinely omits it,
  while the agent matches a tool result to its call BY id — so an absent id is
  synthesized (`gemini-call-N`, in call order, per provider instance, the
  `ollama()` precedent). Sending an invented id back would be a
  `functionResponse.id` the service never issued, so it is stripped on the return
  trip; Gemini matches by NAME, which is always present.
- **No thought summaries are requested.** `usage.thinking` is reported, but
  `includeThoughts` is deliberately unset: Gemini's thought parts carry a
  `thoughtSignature` that must be echoed byte-exact on the next turn, and there is
  no Gemini `ThinkingHandler` in this release to round-trip them. Asking for
  content nothing can carry back would be a leak, not a feature. A thought part
  that arrives anyway is kept out of the visible answer on both paths.
- **A stream that reports no usage reports ZERO, never an estimate.**
  `models.countTokens` is on the namespace, is not called, and is named in the pin
  as not called: it answers what a request _tokenises to_, not what the call was
  _billed for_. Same law as `openai()` and `ollama()`. (Usage is read off the
  closing chunk BEFORE any content guard — the bug that made streamed turns bill
  as zero on two earlier adapters.)

Stop reasons are mapped only where the mapping is unmistakable — `STOP`,
`MAX_TOKENS`, and the four safety refusals — and everything else passes through in
Google's own spelling. Gemini has **no `tool_use` finish reason**, so the presence
of function calls is what produces one.

### Added — `geminiEmbedder()`

```ts
import { geminiEmbedder } from 'agentfootprint/providers';

const embedder = geminiEmbedder({ project: 'my-project', dimensions: 768 });
```

The same two doors, over `models.embedContent`. `gemini-embedding-001` by default
(3072 dimensions, Matryoshka-shortenable, a 2,048-token window, the full
`task_type` vocabulary) and `gemini-embedding-2` known by name (an 8,192-token
window and **no** `task_type`, which is refused rather than sent and ignored).
`embed()` sends `RETRIEVAL_QUERY` and `embedBatch()` sends `RETRIEVAL_DOCUMENT`,
because that is what this library's two call sites are — the `bedrockEmbedder`
Cohere lesson, applied. The id carries the size (`gemini:gemini-embedding-001:768`)
for the reason `bedrockEmbedder`'s does: one model id at two sizes is two embedding
spaces, and `embeddingModel` stores the id alone.

Two Google-specific traps became refusals:

- **One text per request.** `gemini-embedding-001` accepts exactly one input, so
  `embedBatch` is honestly N sequential calls. Libraries that batched it like an
  OpenAI client send oversized requests that fail on every batch of more than one.
- **`onTruncation: 'refuse'` is the default.** Over its window Gemini does not
  refuse — it clips, and a full-looking vector comes back for the opening of the
  passage, which is the exact failure `maxInputChars` was added for in 9.1.0. This
  is the first embedder whose backend TELLS us (`statistics.truncated`), and it
  turns that into an error naming the text's length and both fixes, so a passage is
  never indexed by a prefix of itself. `'allow'` is there when a prefix embedding
  is genuinely what you want.

### Added — the Google surface pin, and the assertion AWS never needed

`test/adapters/google/googlePin.ts` carries the AWS pin's dispatch, reality and
completeness assertions, re-aimed at method-based clients — plus a third that is
new and load-bearing.

- **API-VERSION reality.** `@google/genai` 2.16.0 defaults to **`v1beta1` on
  Vertex** and **`v1beta` on the Gemini API** — not `v1`. An adapter or a docs page
  claiming "GA, v1" while the client dials `v1beta1` is the 9.4.0 bug class in a new
  costume: it compiles, it passes, and the calls go somewhere else. The registry
  records the version each door resolves to and the test asks the installed
  package. `apiVersion` is the option that overrules it.
- **Method-name reality enumerates the INSTANCE, not just the prototype.**
  `@google/genai` assigns `generateContent`, `generateContentStream` and
  `embedContent` as instance fields; only `countTokens` is a prototype method. A
  prototype-only check — the shape the AWS pin would have suggested — would report
  three of our four pinned methods as missing.
- **`@google/genai` and `google-auth-library` are REAL devDependencies**, unlike
  the AWS SDKs. That trade is deliberate and reversed on purpose: AWS keeps its
  SDKs uninstalled so six adapters prove their missing-peer-dep refusals by real
  absence, which makes the AWS reality check vacuous in CI. Google is mid-rebrand
  and its Node surface lags, so version drift is where the bugs live and the
  reality checks have to actually run. The missing-peer-dep refusals are proved by
  stubbing module resolution instead.
- **One row is `documentedOnly`.** The Cloud Trace recipe on the new provider page
  tells readers to call `GoogleAuth.getClient` / `getAccessToken` /
  `getRequestHeaders`, so those names are a claim this package makes about someone
  else's library. It is reality-checked and never dispatched — a claim in prose is
  not a weaker claim than one in code.

### Added — Gemini's over-long-request sentence joins the typed error

`ContextWindowExceededError` (9.6.0) now translates _"The input token count
(1200293) exceeds the maximum number of tokens allowed (1048576)."_ — a word order
the existing patterns did not match — and reads both numbers out of it, including
the case where Google ships the first parenthesis empty. Detection stays
conservative: "INPUT token count" is what keeps it off a `max_tokens` validation
error, and Google spells a rate limit "quota exceeded".

### Added — Google Cloud as a documented provider column

`docs/infrastructure/google-cloud.mdx` is the third column, and it states what is
NOT there as plainly as what is: the service map, the surface pin, the required
concurrency-and-sessions section, and a status row per boundary.

- **Cloud Trace is a recipe, not a factory.** `googleCloudTracer()` was designed
  and then not built: Google's Telemetry API accepts **standard OTLP** (and Google
  recommends it over their own exporter), `otelObservability()` already takes the
  tracer, and a factory would be twenty lines of wiring behind four new optional
  peer dependencies — each needing its own pin row and version-drift story. The
  page ships the complete copy-paste recipe instead, including the two
  `OTEL_SEMCONV_STABILITY_OPT_IN` environment variables that make Google's own
  console render our `gen_ai.*` attributes as GenAI views.
- **Named absences, with dates.** Agent Retrieval (ex-Vector Search 2.0) and the
  Agent Identity auth manager are **parked as of 2026-08-12** — no Node SDK
  published for either. Vertex AI Extensions is deprecated (shutdown after
  2026-11-26). `@google-cloud/vertexai` is past its own removal date and nothing
  here builds on it.
- **Agent Runtime hosting is gated on one live probe.** Google's deploy page says
  "only supports Python" while its runtime-contract page says any language and
  ships a Node build script. Designing on an unresolved contradiction is how three
  AWS adapters once shipped calling operations that did not exist. Cloud Run with
  `httpHost` needs nothing new meanwhile.
- **No `SecurityStrategy` for Model Armor or Semantic Governance**, and that is a
  finding rather than a gap: Google enforces policy at the Gateway, in front of the
  process, exactly as AgentCore does — the architecture that retired
  `agentCorePolicy` in 9.4.0.
- **Memory Bank carries three silent-wrongness vectors** and the page names them
  before anybody writes an adapter: it returns LLM-extracted facts rather than your
  entries, its score is a **Euclidean distance where lower is closer** against our
  cosine contract where higher is, and `scope` is an exact match that is
  **immutable after write**.

### Changed

- `createProvider({ kind: 'gemini' })` joins the by-name factory; `ProviderKind`
  gains a member (additive).
- `@google/genai` joins `peerDependencies` as **optional** — installing
  agentfootprint installs nothing, and the SDK is lazily required on first use.
- A `gemini()` error never prints the API key it was constructed with. The
  redaction is narrow by design — the exact string you passed, removed from the
  message, the stack and the wrapped cause — and is not a heuristic scrubber:
  a thrown provider error reaches the model as a tool result _and_ the commit log
  _and_ every observability sink, so one interpolation would leak to all of them.

## [9.12.0] - 2026-08-12

**The per-user identity chain, both ends.** 9.11.0 put `EventMeta.principal` on
every event of a run whose caller named an identity — and then a served agent had
no way to name anybody, so the actor half of every hosted audit trail was empty by
construction. Two gaps closed here join the ends: the runtime's own header on the
way in, and the user's own token on the way out. Both are opt-in by
construction — a request that names nobody behaves exactly as it did in 9.11.0.

### Added — `GetWorkloadAccessTokenForJWT`: proof, where there was only an assertion

An agent that authenticated a real person could pass a userId **string**
downstream. AWS took its word for it. Now it can pass what the person's identity
provider signed:

```ts
const credentials = agentCoreIdentity({
  region: 'us-west-2',
  workloadName: 'workflow_assistant_agent',
  requireUserToken: true, // optional — refuse a delegated call with no proof
});

// inside a tool
await ctx.credentials.getCredential({ service: 'google', mode: 'user', userToken: callersJwt });
```

- **`CredentialRequest.userToken`** is the new port field, and it rides the
  **request** rather than the provider: the person calling is per call, and a JWT
  in a provider's construction options would be one user's live session serving
  everybody. Its presence selects the exchange — a proof that arrived is never
  downgraded to an assertion, even when an `identity` is beside it.
- **Nothing downstream changed.** `GetWorkloadAccessTokenForJWT` answers with the
  same `workloadAccessToken` the by-userId exchange does, so it feeds the same
  `GetResourceOauth2Token` call, the same `Credential`, the same `toHeaders()`.
  The vault entry at the end belongs to the _person_ rather than to the agent,
  which is what makes revoking their access actually revoke it.
- **Verified against the real SDK before it shipped**, names and shapes both:
  `{ workloadName, userToken }` in, `{ workloadAccessToken }` out. It joins the
  command-name pin, taking `agentCoreIdentity` to **three of AgentCore Identity's
  six data-plane operations** — the docs name the other three and say they are not
  covered.
- **`requireUserToken`** is the deployment-level opt-in for a front door that
  really does authenticate everybody: a `mode: 'user'` request with no
  `userToken` is refused by name instead of quietly falling back to something
  weaker. `mode: 'machine'` is never affected — M2M has no user to prove.
- **Refusals that teach, in both directions**: a JWT with no `workloadName` to
  exchange it against, a JWT on an M2M request, and an injected `_client` that
  cannot exchange are each named with the fix rather than resolved by guessing.
- **The framework does not thread the JWT for you, on purpose.** The only routes
  from your door to a tool are tracked scope and the run input, and both flow to
  the commit log, the recorders and every observability exporter. A tool captures
  it at the door in its own closure.

### Fixed — a token in an SDK error message

The new secrecy suite found a leak on the path it was written to guard, and the
fix covers every command this adapter dispatches, not only the new one.

- AWS clients report transport and validation failures by **echoing request
  detail into the message**. Every input this adapter sends is a secret — the
  user's JWT into the exchange, a workload access token into the vend — so a
  failed call handed the caller a message with a live token in it, and a
  `getCredential` message is read by the model, emitted on
  `agentfootprint.credential.failed`, and kept by every sink attached to it.
- A failed SDK call now keeps its exception **name** (`AccessDeniedException`,
  `ThrottlingException`, …) and HTTP status, and loses its text. The original is
  deliberately not attached as `cause`, which would travel with it into every
  serializer that walks own properties.
- A malformed exchange response is described by its **shape** — how many fields
  came back and what they are called — never by its content, because every field
  of a token-exchange response is a token. One shared refusal now covers both
  exchanges.

### Added — `HostRequest.userId`: WHO, beside which conversation

`agentCoreRuntimeWire` reads `X-Amzn-Bedrock-AgentCore-Runtime-User-Id` — the
header that runtime forwards from its front door, spelled the way the SDK spells
it (`InvokeAgentRuntimeRequest.runtimeUserId` binds to exactly this name, as
`runtimeSessionId` binds to the session header beside it). Matched
case-insensitively, through the same helper.

- **A session is a thread; a user is a person.** They are two fields because they
  are two facts, and an audit trail that reports the first where the second
  belongs names the wrong party. No wire derives one from the other.
- **`standingAgent` composes it into the run's identity**: the principal comes
  from this request, the conversation id from the conversation already in play
  (else the session — the 9.10.0 derivation, composed rather than replaced), and
  the tenant from whatever the stored conversation carried, since no transport
  field supplies one. With 9.11.0's actor-in-meta that puts a real person on every
  event, in `ctx.identity` inside a tool, and in the identity a credential
  provider scopes its vault on — the whole chain, unconfigured.
- **Turn two reports turn two's caller.** Preferring a stored principal would pin
  a whole session to whoever spoke first; a turn that names nobody continues the
  conversation's own identity, which is 9.2.0's rule and not a new one.
- **The generic wire reads no such header, and a test asserts it doesn't.** The
  header is worth reading where a front door sets it; on a container you expose
  directly it is a string anybody can send. Absent stays absent everywhere: with
  no session and no stored conversation there is no conversation to name, and
  nothing is fabricated to carry a principal.
- The ports still name no vendor — the header name lives in the adapter, and the
  existing grep-for-vendor-names guardrail proves it.

Status, plainly: both halves are **contract-shaped and tested** — the JWT
exchange against the installed SDK's own request/response shapes, the header
mapping over a real socket — and **awaiting field use**. No live account has
exercised the exchange path yet, and no page on the site says otherwise.

## [9.11.0] - 2026-08-12

**The enterprise batch.** An external enterprise-readiness review asked four
questions of this library. Three of them turned out to be right, and the fourth
turned out to be a misreading worth correcting in public. Everything shipped here
is **opt-in by construction** — no existing agent composes a different prompt,
refuses a call it used to allow, or emits a field it did not before.

### Added — `maxToolResultChars`: a ceiling on ONE tool result

```ts
Agent.create({ provider, model, maxToolResultChars: 20_000 });
```

Over the cap, the result is **replaced** by a marker that tells the model what
happened and what to do about it:

```json
{
  "truncated": true,
  "reason": "orders_export returned 812431 chars, over the 20000-char cap. Narrow the request and call again.",
  "head": "id,customer,total\n1001,…"
}
```

- **The marker IS the result.** It is what the model reads on the `role: 'tool'`
  message AND what `agentfootprint.stream.tool_end` carries — so a run that
  capped an 800KB result does not then ship that same 800KB to a log sink, and a
  trace shows the truncation instead of hiding it.
- **`head` is verbatim and proportional.** It gets whatever the cap has left
  after the sentence explaining it, so the serialized marker stays inside the cap
  and a bigger cap buys a bigger head. When the cap cannot afford its own
  explanation, `head` is dropped rather than the explanation — a lesson truncated
  in half teaches nothing, which is the failure this exists to prevent.
- **Every dispatch path is measured**: the ordinary loop, a resumed middleware
  `ask`, a check-in decision, a credential-consent resume, and a `pauseHere`
  answer a person typed.
- **It composes, and replaces nothing.** A tool's own paging keeps working,
  `CodeResult.truncated` still means what it means, and an `onToolResult`
  middleware that summarizes runs FIRST — the cap measures what the chain
  produced. When big tool DATA is normal rather than accidental, the answer is
  still the `CodeRunner` port ("summarize prose, compute data"), not a bigger cap.
- **No default, and there will not be one.** A default would silently modify tool
  results, and a tool that returns 200KB is doing what somebody wrote it to do.
  Omitted, results are never measured and never replaced. `0` is not "off" — it
  is refused at construction, naming the value and pointing at the omission.
- Read it with the exported `isTruncatedToolResult(value)` guard.

### Added — WHO the run was for, on every event

`EventMeta.principal` and `EventMeta.tenant` (9.11.0) join `sessionId` (9.4.0) on
every event's meta. The stream has always said _what_ happened and _when_; this
is the _who_, and the three together are an audit record rather than a debug log.

```ts
await agent.run(message, {
  identity: { tenant: 'acme', principal: 'alice@acme.test', conversationId },
});
```

- **Stamped only from an identity a caller NAMED** — `run({ identity })` or
  `run(input, { identity })`, the same tuple memory and the permission gate scope
  on. Never from the run's internal identity, which is always populated and
  defaults to `{ conversationId: '<runId>' }` (or, since 9.10.0, to
  `{ conversationId: sessionId }` on a session-bound run).
- **A conversation id is not an actor.** A session-derived run leaves both keys
  ABSENT. `sessionId` is caller data — anyone who can reach the host can send any
  string, including somebody else's — and promoting it to "who did this" would
  produce an audit trail that looks complete and names the wrong party.
- **`conversationId` is deliberately not carried.** It is a thread, not a person,
  and `sessionId` beside it is the fact the transport delivered.
- **Which sinks carry it, checked rather than assumed.** `fileObservability`,
  `cloudwatchObservability`, `agentcoreObservability` and `auditExport` serialize
  the whole envelope and inherit it for free — in `auditExport`'s case _inside_
  the hash chain, so editing who breaks the same verification as editing what.
  `otelObservability` maps signals onto spans rather than serializing, so the
  actor is PLACED there: `agentfootprint.principal.id` /
  `agentfootprint.tenant.id` on the `invoke_agent` run span. `xrayObservability`
  does not map it, and the docs say so rather than implying a coverage it lacks.

### Added — capability enforcement, where both sides speak

`PermissionRequest.capability` has carried five values since v2.4. Until now
**only `'tool_call'` was ever sent**: every construction site passed it, and
`PermissionPolicy` read the field only as a fallback target id that a tool call
never reaches. Four fifths of the vocabulary was defined and dead.

It is enforced now, under one rule — **a tool DECLARES what it touches, a checker
DECLARES what it governs, and enforcement happens where both speak**:

```ts
const fetchInvoice = defineTool({ …, capabilities: ['external_net', 'user_data'] });

const policy = PermissionPolicy.fromRoles(roles, 'support', {
  capabilities: { support: ['user_data'] },   // external_net is not listed → denied
});
```

- **`Tool.capabilities`** (`'memory_read' | 'memory_write' | 'external_net' |
'user_data'`) is a declaration, never an inference. A tool's reach is not
  knowable from its name, schema or description, and guessing would rest a policy
  decision on a heuristic.
- **`PermissionChecker.governs`** is an optional, feature-detected member —
  **absence is NO**. A checker written before 9.11.0 is asked exactly what it was
  always asked. `checkerGoverns(checker, capability)` is exported so a custom
  checker's tests can assert the same answer the framework will get.
- **`PermissionPolicy.fromRoles(roles, role, { capabilities, skills })`** derives
  its own `governs` from the rules, so "unconfigured" and "never asked" cannot
  drift apart. Configuring capability rules for any role means the policy governs
  all four — governing only what some role listed would let an unlisted
  capability pass unasked.
- **Said plainly instead of implied: the memory pipeline is NOT gated by this
  port.** No recall or write stage builds a `PermissionRequest`, so
  `'memory_read'` / `'memory_write'` reach a checker only for a TOOL that declared
  them. Memory isolation is `MemoryIdentity` scoping — a different mechanism, not
  this one under another name.

### Added — per-role skill-catalog visibility

The same composition, applied to the skill catalog. A checker that declares it
governs `'skill_read'` is asked about each skill, target `skill:<id>`:

```ts
PermissionPolicy.fromRoles(roles, 'support', {
  skills: { support: ['refunds', 'lookup'], hr: ['payroll'] },
});
```

- A refused skill's row **disappears** from the `read_skill` menu the model reads,
  and activating it anyway is refused with the policy's own message — one rule,
  both ends, so the menu and the verdict cannot disagree.
- The refusal lands **before `execute`**, so a `surfaceMode: 'tool-only'` skill's
  body is never even computed.
- **Hidden means unnamed.** The graph offer lists unreachable skills as "not
  reachable from here" because a cursor can move; a hidden skill is about _who is
  asking_, and naming it would tell one role about another role's capabilities.
- **The enum stays the full catalog.** `toolArgValidation` runs before the gate,
  so narrowing it would turn a policy refusal into a generic schema error and the
  model would never read the policy's own message — the reasoning 8.5.0 recorded
  for the graph offer, applied again.
- `skillTarget(id)` / `skillIdFromTarget(target)` / `SKILL_TARGET_PREFIX` are
  exported from `agentfootprint/security` so a custom checker spells the target
  exactly as the agent produces it. Scope: this governs the `read_skill` surface
  the Agent mounts; a `list_skills` tool you register yourself is your own catalog.

### Documentation — the sqlite "50,000 chunk ceiling" is guidance, not a limit

The review read `sqliteVectorStore`'s documented ceiling as an enforced cap. It
is not, and nothing changed in code because nothing needed to: **no counter, no
refusal at 50,000, no deliberate degradation** — chunk 50,001 is stored and
searched exactly like chunk 3. The number is the point on the measured curve
where this implementation stops being obviously the right tool, published so the
decision is yours and dated rather than discovered in production. The docstring
and the capability page now say that in as many words, and list what the store
really does refuse.

### Documentation

Every item above lands on its capability page under the provider-column template
— [Governance & policy](https://footprintjs.github.io/agentfootprint/docs/infrastructure/governance-and-policy),
[Identity & credentials](https://footprintjs.github.io/agentfootprint/docs/infrastructure/identity-and-credentials),
[Observability sinks](https://footprintjs.github.io/agentfootprint/docs/infrastructure/observability-sinks),
[Tools & gateways](https://footprintjs.github.io/agentfootprint/docs/infrastructure/tools-and-gateways) —
plus a new decision-table row ("audit who did what") on the Infrastructure index.
The actor-in-events row appears **identically** on both provider pages, AWS and
on-premises, because it is the same field and the same rule on both columns.

## [9.10.0] - 2026-08-12

**Multi-user, made easy.** Three things a self-hosted deployment had to build
itself — who is asking, whose memory is whose, and how two people get answered
at the same time — are now one option each.

### Added — `standingAgent({ agentFactory })`: one agent per active session

An `Agent` holds per-run state on itself, so one instance can only be in one run
at a time. `standingAgent` shared ONE instance across every session and
serialized globally to keep that safe — correct, and a hard ceiling of one
person at a time per process. The law has not changed; its SCOPE has:

```ts
await standingAgent({
  agentFactory: () => Agent.create({ provider, model }).system('…').build(),
  sessions: sqliteSessions({ file: './sessions.db' }),
  host: nodeHost({ port: 8080 }),
  maxActiveSessions: 200, // default 100
});
```

- **Sessions run in parallel.** Each active session gets its own instance from
  the factory; two people asking two questions are two runs and neither waits.
  Pinned by a test where both sessions are inside the model call before either
  returns, and their wall-clock intervals overlap.
- **One session still serializes** — on its own instance, under the same
  `onConcurrentInvoke` policy — so the Agent's own `RunInFlightError` never
  reaches a caller.
- **Bounded and LRU.** A new session at a full pool retires the least recently
  used IDLE one: its tool sessions close with the existing `'evicted'` reason
  (9.7.0's vocabulary — no new event invented), its agent is shut down, and its
  CONVERSATION stays in the session store. The next request re-hydrates onto a
  fresh instance and the person never knows.
- **A running session is never evicted.** The pool grows past the bound rather
  than ending somebody's turn, and comes back under it when a run finishes.
- **Anonymous requests share one fallback instance** — there is no conversation
  to isolate, and an instance per anonymous request would be an instance per
  request.
- **`{ agent }` is unchanged, to the byte.** Same global queue, same refusals,
  same durability wiring; the shared shape is a pool of exactly one lane, so
  there is one implementation rather than two that can drift.
- **Two refusals, both by name.** `agent` AND `agentFactory` together is refused
  at construction (two spellings of one decision, and the winner would be
  invisible). A factory that returns an instance it has already returned is
  refused on the spot — that mistake type-checks perfectly and destroys the only
  property the pool exists for. `maxActiveSessions` without a factory, and a
  non-positive bound, are refused too. The mutual exclusion is enforced at the
  TYPE level as well (`StandingAgentSharedOptions` | `StandingAgentPoolOptions`).

### Added — a session IS a conversation: honest memory identity

A run that carries a `sessionId` and **no** `identity` is now scoped to
`{ conversationId: sessionId }`.

`standingAgent` has passed the session id on every run and resume since 9.4.0,
so **a served session now gets durable per-user memory with zero
configuration**. Before this it got the per-run default — `{ conversationId:
'<runId>' }`, with a fresh runId every turn — which meant a registered
`.memory()` wrote one namespace per turn and recalled nothing across a
conversation. The turn always looked right; only the recall was missing.

- An `identity` you pass **always wins**, including the one a continued
  conversation carries.
- A run with no session and no identity is **unchanged** — same namespace, same
  committed keys.
- The derivation is **recorded, not inferred**: it commits
  `runIdentitySource: 'session'`, written on that path only, so a trace can tell
  a namespace somebody chose from one this library derived.
- It is still **not** published to `tool.execute` as `ctx.identity`. A
  synthesized namespace is not something anybody named, and "absent" keeps
  meaning "nobody named one"; a tool that wants the session has `ctx.sessionId`.

### Added — the two halves of "which session is this?"

```ts
// client (main barrel — browser-safe, zero deps)
import { browserSessionId } from 'agentfootprint';
fetch('/invoke', { headers: { 'x-session-id': browserSessionId() }, … });

// server
nodeHost({ sessionHeader: 'x-conversation' });   // default 'x-session-id'
nodeHost({ sessionCookie: 'af_session' });       // …or no client code at all
```

- `browserSessionId({ storageKey? })` mints a UUID once and keeps it in
  `localStorage`, falling back to memory when storage is missing or throws
  (private mode). On the MAIN barrel, not `agentfootprint/hosting`: the rest of
  that door is Node, and a browser bundle must not reach through it.
- `nodeHost({ sessionHeader })` names the header the adapter has always read.
  `jsonWireWith({ sessionHeader, sessionCookie })` is the dialect as a factory;
  `jsonWire` is `jsonWireWith()` and behaves exactly as before.
- `nodeHost({ sessionCookie })` reads the cookie and, only when the request
  carried no session at all, issues one: `Path=/; HttpOnly; SameSite=Lax`. No
  `Secure` flag — this host cannot know whether it is behind TLS, and the
  docstring says so rather than pretending. A caller that already sent a session
  is never handed a competing one.
- `HttpWire.readRequest` may now return `responseHeaders`, which is how a pure
  wire issues a cookie without touching the socket. `content-type` set there is
  ignored: the framing (one JSON body vs SSE) is the host's decision.

### Changed — docs

- **Hosting & runtime** gains a **Concurrency & sessions** section: the
  three-strategy table (platform-per-session · agent pool · process-per-worker),
  the pool's laws, both session recipes, and the memory-identity ladder.
- **On-premises** and **AWS** each state where their parallelism comes from —
  AWS gets it from the platform (a container per session), an on-premises box
  chooses the pool or a fleet.
- **Conversations** documents the identity ladder and both session recipes.
- `redisSessions` is **not built**, and the hosting page says so with the
  ten-line sketch: `SessionLifecycle` is two methods, and a shipped adapter
  would have to decide key prefix, TTL and client for everybody.
- New example: `examples/deploy/multi-user.ts` — two people served at once,
  proving the overlap in wall clock and that neither saw the other's memory.

## [9.9.0] - 2026-08-12

**A bug report IS the evidence.**

The usual bug report is a person's memory of a run: "it said the wrong thing, I
think it called the search tool twice". The run itself — the timeline, the
state, the chart, the narrative — was sitting in the process the whole time and
never left it. This release turns that around: the report is the run, packaged,
with the prose attached.

### Added — `describeBugReport()` / `exportBugReport()`, the consent seam

`agentfootprint/observe`. Two calls, because consent needs two:

```ts
import { describeBugReport, exportBugReport } from 'agentfootprint/observe';

const offer = describeBugReport(recording); // measure — nothing has left yet
// …show offer.units to the human; they tick some…
const report = exportBugReport(recording, {
  include: ['conv-1', 'file-conversation', 'file-environment'],
  title: 'Agent answered with a stale price',
  stepsToReproduce: '1. ask\n2. update\n3. ask again',
  expected: 'the updated price',
  actual: 'the price from before the update',
});
fs.writeFileSync(report.filename, report.zip); // a real .zip
```

- **The manifest is SELECTABLE UNITS, not a blob.** Each conversation is a unit
  — keyed by session id when the run was session-bound, else by run id, so
  several `run()` calls in one session are ONE unit, which is what a person
  means by "the chat that went wrong" — carrying its size, event count and turn
  count. Each derived file (`conversation.json`, `narrative.txt`,
  `environment.json`) is a unit too. A dialog cannot ask about a blob it has not
  measured, which is the whole reason `describeBugReport` exists separately.
- **A deselected unit is out of EVERY file.** The transcript and the narrative
  are rebuilt over the selected conversations, not filtered afterwards — the
  first cut of this shipped a conv-2 that was out of its own file and quietly
  inside `conversation.json`, and the property test that caught it is now the
  pin.
- **What was left out is STATED.** `manifest.excluded` counts the conversations,
  files, events and turns that were withheld, names their unit ids, and the
  issue body repeats it. A maintainer reading turn 4 must be able to tell that
  turns 1–3 were _withheld_, not _lost_.
- **Redacted keys, BY NAME.** The recording arrives already redacted (footprintjs
  scrubs at commit time), so nothing here scrubs anything — it would be too late
  to matter and a second policy could only disagree with the first. Instead the
  manifest lists the key names whose values are placeholders, derived from the
  evidence itself, so a human can consent knowing which secrets were protected.
  An empty list is explained rather than left to look like "nothing secret here".
- **`environment.json` is versions and nothing else** — library, engine, Node,
  platform, arch, plus the reporter's prose. No username, no hostname, no
  working directory, no environment variables, no file paths. A bug report should
  not be how an internal directory layout leaves a company.
- **Over 20 MB, the trim hints name real unit ids** ("Drop conv-2 (14.0 MB) →
  6.1 MB."), never "make it smaller", and never the last remaining conversation.
- **An agent works as input too**, honestly: a finished runner gives up its
  snapshot and its chart but not its events (the dispatcher drops events nobody
  subscribed to), so that arm produces a note saying the timeline is missing and
  naming the one-line fix, rather than a silently empty panel.

The zip writer is **~150 lines, zero dependencies, STORE-only (no compression)**,
and says so in its docstring. Deflate would shrink a JSON bundle well and would
cost either a dependency or `node:zlib` — which would make the export Node-only,
when building a bundle in the browser is exactly the flow the consent dialog is
for. Verified two ways: a structural parser written against APPNOTE walks the
central directory and re-checks every CRC, and the system `unzip` opens the real
file (`unzip -t` verifies the CRCs, `unzip -p` prints back the exact bytes,
extraction recreates the tree). Zip-slip names (`..`, a leading `/`, a drive
letter, a backslash) are refused by name — an archive is extracted on the
machine of the person it was filed against.

### Added — `githubBugReporter()`, with TWIN TARGETS

`agentfootprint/observe`. Commits the evidence zip and files the issue, over
plain `fetch` with no SDK:

```ts
const reporter = githubBugReporter({
  issueRepo: 'footprintjs/agentfootprint', // public — the conversation
  evidenceRepo: 'acme/af-bug-evidence', // private — the run
}); // token: GITHUB_TOKEN, or `token`
const { issueUrl, zipUrl } = await reporter.file(report);
```

- **The issue and the evidence may live in different repos.** The case that
  shipped it: a field tester files a LIBRARY bug — the issue into the library's
  public repo, the evidence zip into a private repo the maintainers can read.
  The issue links the bundle and says plainly that the evidence is private.
- **The doctrine's teeth.** Before committing evidence, the repo's metadata is
  read; a PUBLIC evidence repo is **refused** unless
  `acknowledgePublicEvidence: true` says so out loud. If the metadata call itself
  fails (a token that can write contents but not read metadata is a legitimate
  configuration) the report proceeds and the result carries
  `checkedVisibility: false` — a permissions quirk must not block a bug report,
  and skipping the check silently would be worse than either.
- **Size is refused BEFORE the upload** (24 MB), quoting the manifest's own trim
  hints rather than inventing advice.
- **A name already taken is suffixed, never overwritten** — no `sha` is ever
  sent, so this reporter cannot replace somebody else's evidence even by
  mistake.
- **The two-clause secrecy law, applied.** The token appears in no message, no
  error and no log, and neither does a byte of the bundle: a failure names the
  status and GitHub's own `message` field only — never the request, never the
  headers, never the response body (which can echo both). Transport failures are
  re-wrapped rather than rethrown, because a `fetch` implementation is free to
  put the whole request into the error it throws. Pinned by a suite that forces
  ten failure paths — including a transport error carrying the auth header
  verbatim — and greps the message, the stack and the JSON projection.
- **Refusals teach where each thing goes**: a missing token names both the env
  var and the option AND the fine-grained-token page, scoped to exactly the two
  repos with exactly two permissions; a 403 names those permissions again; a 404
  explains that GitHub answers 404 for a private repo a token cannot see.
- **`apiBase` for GitHub Enterprise Server**, so the whole path works on a
  network that never reaches github.com.

### Added — `githubDeviceSignIn()`, filing as yourself

`agentfootprint/observe`. GitHub's OAuth **device flow** in three plain `fetch`
calls — browser-safe and server-safe, no client secret, no dependency:

```ts
const signIn = await githubDeviceSignIn({ clientId }); // returns at once
show(`Open ${signIn.verificationUri} and enter ${signIn.userCode}`);
const { token, login } = await signIn.completed; // resolves on approve
```

A server PAT files every report as the _application_; this files it as the
_reporter_, which is what a field tester filing upstream needs. It honours
`slow_down`, respects the code's expiry, takes an `AbortSignal`, and fetches
`/user` for attribution (a `/user` that refuses is not fatal — the token still
works, the login is simply absent). The token it returns is handed to
`githubBugReporter` with no special-casing: a token is a token.

Two things the docstring says plainly rather than leaving to be discovered:
classic OAuth scopes are **coarser** than a fine-grained PAT (GitHub's design,
not ours — `public_repo` is the default here and grants write across every
public repo the account can reach), and the token must live **in memory for the
session only** — never `localStorage`, never a log line. The collaborator caveat
is stated too: a reporter who is not a collaborator on a private evidence repo
gets a 404, and the honest fallback is attaching the zip by hand.

### Docs

- New page: **File a bug with the run attached** (`debug/file-a-bug`) — the
  browser consent flow with the manifest shown before anything leaves, the
  server wiring (two endpoints, hand-written: there is deliberately no route
  helper, because consent needs two round trips and the run-id → recording
  lookup is state the application owns), the token-provisioning section
  (fine-grained, two repos, two permissions, an expiry), the "filing upstream"
  twin-target recipe with the private-evidence pattern, the two-mode table
  (server PAT vs device sign-in), and the cross-organisation doctrine.
- **On-premises & self-hosted** gains a row: the whole path runs on a network
  that never reaches github.com, GHES included, via `apiBase`.
- New example: `examples/observability/22-file-a-bug.ts` — records two
  conversations, prints the consent manifest, exports a subset, parses the zip's
  central directory back off disk, and files it against a scripted GitHub. Exits
  non-zero if any of that stops being true. No key, no network, no token.

### Internal

- `libraryVersion()` moved from `adapters/observability/audit.ts` to
  `lib/libraryVersion.ts` and gained `engineVersion()` beside it. Two copies of
  "which version produced this?" would be two answers to a question that must
  have exactly one; `auditExport` now imports the shared one.
- `narrativeFrom()` (the shape-detector for a narrative recorder's snapshot row)
  is exported `@internal` from `lib/trace-toolpack/openRecording.ts` and reused
  by the bundler, for the same reason.

## [9.8.0] - 2026-08-11

**The on-premises column, finished.**

Every port on this library is vendor-neutral, and every one of them has had an
AWS adapter for months. The deployments that own their own machines have been
filling the same ports the whole time — a model on a GPU, a corpus in Postgres,
sessions in a SQLite file — and two of them had nowhere to go but "write it
yourself": telemetry with no collector to ship to, and secrets in a vault.

This release fills those two, and writes the column down.

### Added — `fileObservability({ path })`, telemetry for a shop with no collector

`agentfootprint/observe`. An `ObservabilityStrategy` that appends the typed
event stream to a local file as NDJSON — one `JSON.stringify(event)` per line,
in **the same envelope `cloudwatchObservability` puts in a log event**, so a
query written against one reads the other. Zero dependencies: `node:fs`, lazily
required, so importing the door stays browser-safe.

```ts
import { fileObservability } from 'agentfootprint/observe';

agent.enable.observability({
  strategy: fileObservability({
    path: '/var/log/agentfootprint/events.ndjson',
    maxBytes: 64 * 1024 * 1024,
  }),
});
process.on('SIGTERM', async () => {
  await agent.shutdown();
}); // flushes
```

Four things it is deliberate about:

- **Rotation is ONE generation.** With `maxBytes`, a batch that would cross the
  ceiling renames the file to `<path>.1` — replacing any previous `.1` — and
  starts fresh. No `.2`, no compression, no schedule, no cross-process
  coordination. It exists so an unattended agent cannot fill a disk, and for
  nothing else: **retention is a log-management daemon's job**, and omitting
  `maxBytes` (the default) means the adapter never renames anything, which is
  right when `logrotate` already owns the file. The docstring says exactly this
  rather than implying a rotator.
- **An unwritable path is refused at construction**, naming the path and the
  three ordinary causes — not at the first event, hours later, into nobody's
  console.
- **The hot path never throws.** `exportEvent` serializes, buffers and returns;
  even an unserializable event is reported rather than raised. Write failures
  follow the 8.11.0 `deliveryErrors` pattern — loud but not fatal, rate-limited
  on the console, every failure to a wired `onError`, and the batch **dropped
  rather than requeued** so a full disk cannot grow the buffer without bound.
- **Nothing is bounded or redacted on the way out**, and the page says so.
  Narrow it with `eventTypes` (which becomes the strategy's
  `relevantEventTypes`, so the dispatcher does not even forward the rest),
  `tier` / `sampleRate`, or a footprintjs `RedactionPolicy`. For a record
  bounded by construction, `auditExport({ payloadMode: 'bounded' })` is still
  the adapter that does that job.

`flush()` / `stop()` follow the 8.12.0 lifecycle laws exactly, including the
8.11.1 one that cost a shutdown spin: a `flush()` after `stop()` still writes
what was already accepted, and the drain is bounded by construction.

### Added — `vaultCredentials({ address })`, a CredentialProvider over KV v2

`agentfootprint/security`. A `CredentialProvider` for HashiCorp Vault and
anything Vault-API-compatible (OpenBao, and the Vault-API modes of several
managed stores). No SDK: one `GET` per resolution through the runtime's own
`fetch`, with a `_fetch` test seam.

```ts
import { vaultCredentials } from 'agentfootprint/security';

const credentials = vaultCredentials({
  address: 'https://vault.internal:8200',
  paths: { github: 'ci/github' }, // …or resolve(service), or neither
}); // token: `token`, else VAULT_TOKEN
```

The tool code does not change from the `staticTokens` version — same port, same
`ctx.credential!.toHeaders()`.

**V1 is one shape, and every other shape is refused by name.** Token auth only;
KV v2 only; no leases, no renewal (`getCredential` re-reads the secret every
call, which is the library's model since 9.7.0). AppRole, Kubernetes, JWT/OIDC,
AWS IAM, userpass and LDAP each refuse at construction **naming the options a
login would arrive on** — `roleId` + `secretId`, a role plus a projected
service-account token — because an auth method nobody has exercised against a
real cluster would be a guess wearing an adapter's clothes. A KV v1 mount is
named as such the moment its response shape gives it away (`data` with no inner
`data`), and names `kvVersion` as the option a v1 reader would arrive on.
Passing `paths` **and** `resolve` is refused: two spellings of one rule can
disagree, and the loser would do so silently.

A secret's fields become a credential by the first rule that matches — `token` →
`bearer`, `api_key`/`apiKey`/`key` (+ optional `header`) → `apiKey`, `username` +
`password` → `basic`, `headers` → `headers` — with `toCredential(secret,
service)` as the seam for a shop whose field names are its own.

### Security

- **A plain-`http://` address is refused unless `allowHttp: true`.** The Vault
  token travels in the `X-Vault-Token` header: on plaintext, anyone on the path
  reads a token that can usually read every secret it can reach, and a leaked
  read token is not revoked by rotating one secret. The refusal names that,
  rather than saying "use https".
- **No secret can reach a message.** Every error `vaultCredentials` raises names
  the service, the mount path and the HTTP status — and nothing from the
  response body, nothing from the token, not even the field names the secret
  carries. This is the 8.6.0 law applied one adapter down: a thrown message
  reaches the model as a tool result _and_ rides
  `agentfootprint.credential.failed` to every observer. It is pinned by a
  grep-shaped test that walks every failure path — unknown service, 401, 403,
  404, 503, a non-JSON reply, a KV v1 response, an unrecognised field set, and a
  transport error whose own text echoes the request headers — and asserts that
  no secret and no `x-vault-token` survives into any message, stack or JSON
  projection of the thrown error.

### Documentation

- **`infrastructure/on-premises.mdx`** — the provider page beside AWS. The
  local-first ladder (mock → local model → your gateway → a paid API) as the
  opening frame, then a service-by-service map: LLM (`ollama`, `openai({
baseURL })` for vLLM / llama.cpp / a corporate gateway, or the two-method
  port), stores (`sqliteVectorStore`, `pgVectorStore`, `staticVectorStore`,
  `RedisStore`), embedders (`localEmbedder`, `staticEmbedder`), hosting
  (`httpHost` / `nodeHost` + `sqliteSessions` / `memorySessions`), code
  execution (`localCodeRunner` — _isolation, not a sandbox_), telemetry
  (`otelObservability` to any OTLP collector, `fileObservability` when there is
  none, `auditExport` for evidence), credentials (`staticTokens`,
  `vaultCredentials`, and the port for everything else) and tools (`mcpClient`
  over stdio or Streamable HTTP). It ends with **what is NOT here** — no
  Kubernetes-native anything, no second secret-manager adapter, no metrics
  exporter, no retention policy, no air-gapped model distribution.
- **The status vocabulary gained one honest rung.** _Contract-shaped and tested;
  awaiting field use_ is what `fileObservability` and `vaultCredentials` carry:
  their ports and refusals are pinned by tests, and neither has met a real
  production disk or vault. _Verified in a production field deployment_ now
  appears in exactly one place, describing a deployment **shape** — a standing
  agent over `httpHost` + `sqliteSessions` against an OpenAI-compatible gateway,
  the shape several past releases exist because of — and never an adapter. The
  infrastructure index and the AWS page were both updated to say so rather than
  keep an absolute claim that had stopped being true.

## [9.7.0] - 2026-08-11

**Tools have somewhere to hold a session.**

`ToolExecutionContext` was six fields and none of them said WHO or WHICH RUN, and
a `Tool` had no end-signal at all. So a tool backed by a session service — a
managed code interpreter, a headless browser, a leased connection: Start →
Invoke ×N → Stop — could only pay session start-up on every single call, or hold
the session in a module-level map.

The second option is the one people take, and it is an isolation failure rather
than a performance trick. A `Tool` is a singleton: built once, shared by every
run and every session the process serves. In a standing agent, the session in
its closure is shared too, so person B gets person A's files, environment and
half-run state. No test with one user shows you this.

Everything needed to fix it already existed within one object-hop of the
dispatch site. What was missing was the wire, and any signal a tool could be
handed that said "this is over".

### Added — run/session identity on `ToolExecutionContext`

Three optional fields, sourced from what the engine already stamps:

| field           | source                                         | absent when                                                             |
| --------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `ctx.runId`     | the run in flight                              | there is no run — a call served over `mcpServe` is one call, not a turn |
| `ctx.sessionId` | `run({ sessionId })` ← `HostRequest.sessionId` | the run is not session-bound                                            |
| `ctx.identity`  | the identity the CALLER passed                 | the caller passed none                                                  |

Every one is **absent rather than invented**, which is the 9.4.0 rule applied one
layer down. `ctx.identity` is deliberately _not_ the run's internal
`runIdentity`: that is always populated, defaulting to
`{ conversationId: '<runId>' }`, and handing a tool a synthesized conversation as
"the identity" would let it isolate a live sandbox on a fiction.

`toolSessionKey(ctx, scope)` is exported because the derivation IS the isolation
boundary — one implementation, or two that disagree:

```
session →  t=<tenant|_>/p=<principal|_>/s=<sessionId>     requires sessionId
run     →  t=<tenant|_>/p=<principal|_>/r=<runId>         requires runId
call    →  c=<toolCallId>                                 always available
```

**A `sessionId` alone never keys a live session.** The hosting port already said
why in its own words: it is caller data, and anyone who can reach the host can
put any string there, including someone else's.

### Added — a real teardown contract

`ctx.onTeardown(cleanup, { scope, key })`. Not `Tool.dispose()` (a singleton
cannot dispose one caller's session) and not a lifecycle port the consumer wires
(the tool that knows the key is the one that cannot reach it). Execute time is
the only moment the key and the resource are both in hand.

`ctx.teardownScopes` is a FACT to branch on, exactly like `hasCredentials` — a
tool that wants a run-scoped session needs to know it is at a door with no runs
BEFORE it opens one. Asking for a scope a door cannot honour throws, naming the
door.

| scope        | fires                                                                                 |
| ------------ | ------------------------------------------------------------------------------------- |
| `'call'`     | when `tool.execute` settles — resolve **or** throw. Every door, including `mcpServe`. |
| `'run'`      | at a run terminal that is **not a pause**.                                            |
| `'session'`  | `agent.closeToolSessions({ sessionId })`.                                             |
| `'shutdown'` | `agent.shutdown()`.                                                                   |

Seven laws, each pinned: at most once ever · idempotent by `(tool, scope, key)`
with the FIRST registration winning (it holds the live handle) · reverse
registration order · bounded by `toolTeardownTimeoutMs` (default 5s, because
teardown is on the SIGTERM path) · never throws into the run and never silent ·
tolerates "already gone" · nothing live is ever persisted into a checkpoint.

**A pause is not a terminal.** `'run'` teardown deliberately does not hang off
`finally`, which also runs on both pause shapes. A `checkIn` on a code
interpreter stops the run so a person can approve the code; tearing the sandbox
down there destroys the exact state the resume needs, and it fails _quietly_ — as
a resumed run that "just re-ran everything". An error IS a terminal.

### Added — `agent.closeToolSessions({ sessionId })`

The mechanism is the library's; the **timing is your composition root's**.
Nothing here can know when a request/reply session is over: a `HostRequest`
carries a `sessionId` and no end, `SessionLifecycle` stays `hydrate`/`persist` by
design, and managed backends do not tell you either — an idle timeout is the
reality. Guessing would tear down a live sandbox mid-conversation.

On the conversation door it is one line, now shipped in
`examples/deploy/echo-conversation.ts`:

```ts
conversation.onClose(() => void agent.closeToolSessions({ sessionId }));
```

Never calling it is survivable, not silent: a lazy idle sweep (no timers — a
library that installs an interval keeps your process alive), a bounded live count
that evicts the coldest, and `shutdown()`.

### Changed — `shutdown({ stop: false })` now closes tool sessions

**Behaviour change, stated loudly.** `stop` governs BORROWED strategies: a host
shutting down without owning the agent it was handed drains telemetry without
releasing what the caller still holds. A tool session is not borrowed — this
runtime opened it, on behalf of runs it executed, and nobody else holds a handle
to close it. Leaving it open under `{ stop: false }` would leak every sandbox on
`standingAgent`'s DEFAULT (`shutdown: 'flush'`) path.

Nothing live is cut: by the time a composer reaches shutdown its host is closed
and in-flight runs have finished. And it stays true to "the agent itself remains
usable afterwards" — the next run opens a fresh session, exactly as the first one
did. If you were relying on `{ stop: false }` to keep a tool's session alive
across a shutdown, hold it yourself and register `'shutdown'`-free cleanup.

**Behaviour change, second one:** a tool that registers teardown now has it
FIRED where previously nothing did. That is the feature; it is named here because
a `close()` that never used to run now runs.

### Added — four typed events

`agentfootprint.tools.session_started` · `_reused` (with `calls`) · `_closed`
(with `reason`: `call-end` · `run-end` · `session-end` · `shutdown` · `idle` ·
`evicted`) · `_close_failed` (with `errorClass`). 73 typed events → **77**.

They ride the EXISTING `agentfootprint.tools.` prefix, which is the compat gift:
`toolsRecorder` already bridges the whole prefix and the wildcard arm already
exists, so a new domain would have re-opened the two-part trap 9.4.0 spent a
release climbing out of.

`session_started` / `_reused` fire inside `tool.execute` and carry the real
`tool-calls#N` stage. `session_closed` / `_close_failed` fire after the last
stage committed and carry a STATED pseudo-stage, `tool-teardown#0`, built with
`buildEventMeta` from the run context — never `minimalMeta()`, which hardcodes
`runId: 'consumer-scope'` and would make a teardown unjoinable to the run that
opened the session.

Payloads carry a `keyHash`, never the key: the key composes tenant, principal and
`sessionId`, and publishing it would put a user identifier into every exporter's
payload.

### Added — `CodeRunner`, and the first consumer that proves the contract

**Summarize prose, compute data.** A tool whose honest answer is 40,000 rows has
not given the model data; it has spent the context window — the failure 9.6.0
named (`ContextWindowExceededError`, from a real 879,073-token request) is the
one this makes unnecessary. The model writes the aggregation, the runner holds
the rows, and what comes back is the finding.

- **`CodeRunner` / `CodeSession` / `CodeResult`** (main barrel) — Start →
  Execute ×N → Stop. `CodeResult.truncated` is load-bearing doctrine: **an
  unstated slice is a silent success**, pinned in
  `test/api-conformance/silent-success.test.ts`.
- **`localCodeRunner()`** (`agentfootprint/providers`) — a child process, and
  the name says what it is. **Isolation, not a sandbox**: separate process and
  heap, kill-on-timeout, no inherited stdin, an env ALLOWLIST (`process.env` is
  not inherited — only `PATH`, so the OS can find the interpreter). No filesystem
  jail, no network jail, no CPU/memory limit. In-process `eval` / `node:vm` is
  refused outright — Node documents `vm` as not a security mechanism, and
  shipping it as one is theater.
- **`agentCoreCodeRunner({ region, identifier })`** (`agentfootprint/providers`)
  — AWS Bedrock AgentCore Code Interpreter, a real managed sandbox behind the
  same port. Dispatches `StartCodeInterpreterSessionCommand`,
  `InvokeCodeInterpreterCommand`, `StopCodeInterpreterSessionCommand` via
  `client.send(new Command(...))`, pinned in `test/adapters/aws/awsCommandPin.ts`
  and **verified against a real install of the SDK before shipping** — including
  two shapes a design could only have guessed at: `Invoke` answers with an EVENT
  STREAM, and seven of its nine union members are modelled _exceptions_ (folded
  in as empty output, an `AccessDenied` would have reported a clean run that
  "printed nothing"), and `Stop` takes the session id, not a URI.
- **`codeRunnerTool({ runner, scope })`** (main barrel) — holds one session per
  isolation key, reuses it across calls, registers its own teardown. Degradation
  is REFUSED, never silent: a wider key is the cross-binding bug, a narrower one
  is a hidden ~30× latency change.

Worked end to end in `examples/features/52-run-code.ts`.

### Compatibility

All additive. `ToolExecutionContext` gains three optional data fields and two
optional members — every existing tool compiles and behaves identically, and one
that ignores them pays nothing. `Tool` and `defineTool` are unchanged: session
behaviour is a FACTORY, not a Tool-shape change. `SessionLifecycle`,
`HostRequest`, `HostReply` and `AgentHost` are untouched. No new subpath.

An agent whose tools never register a cleanup never allocates a teardown tier;
its run terminals are one `undefined` check.

## [9.6.0] - 2026-08-11

**Three findings from one production blowup — an 879,073-token request against
a 272,000-token limit — fixed at the root.**

A field deployment ran an agent with `.memory()` over a stable
`conversationId`, tools returning large inventory dumps, and a fresh agent per
turn. It failed with a provider 400. Investigating it turned up three separate
things the library was doing quietly: memory that remembered one exchange
however large the window said it was, a provider refusal that reached the
caller as an opaque 400 naming none of the fixes, and a checkpoint that
advertised a resume which could only reproduce the same failure.

### Fixed — episodic memory retains the turns you asked for

`.memory(defineMemory({ strategy: { kind: WINDOW, size: 12 } }))` recalled
exactly ONE prior turn, silently, forever. The seed stage wrote
`turnNumber = 1` on every `run()`, and `writeMessages` keys entries
`msg-{turn}-{index}` — so every turn overwrote `msg-1-0` / `msg-1-1`. Six
turns of conversation left two entries in the store. Nothing threw. Every
write reported success. The only symptom was an agent that kept forgetting,
which reads exactly like a model problem.

The turn is now resolved **once per run**, from the two sources that can know
it:

- the conversation the run was handed — how many user turns the history
  already contains, which is right for `followUp()` and
  `run({ continueFrom })`, and
- **the stores the memory writes to**, which is the only anchor that survives
  the shape the field deployment actually uses: a fresh `Agent`, in a fresh
  process, per turn.

The rule is `max(hostTurn, highestStoredTurn + 1)` — a host that tracks turns
honestly keeps its numbering, a stale counter is raised to the next unused
turn, and neither can drag a conversation backwards. It is the rule
`writeSnapshot` has applied to causal snapshots since 9.1, generalised so
every memory kind shares one definition of which turn this is; the causal
stage keeps its own narrower scan as self-defense for hand-composed pipelines
and now shares the paging with the general one.

**Behaviour change, named loudly: multi-turn memory starts actually
retaining.** A six-turn conversation stores twelve message entries where it
stored two, and the window injects up to `size` of them instead of the last
exchange — so prompts get longer and stores get bigger _because the agent is
now remembering what it was asked to remember_. Turn it down deliberately
(`size`, `DECAY`, `.compaction()`) rather than by accident.

Cost: one paged `list()` per store per run, and only when a memory actually
writes — an agent with no memory, a read-only memory, or a corpus-only
`.rag(...)` makes no extra call and its seed stage stays synchronous.
`resolveTurnNumber({ stores, identity, hostTurn })` and
`maxStoredTurn(store, identity)` are exported from `agentfootprint/memory` for
hosts that mount the memory subflows into their own flowchart, and
`MemoryDefinition` now carries the `store` it was built with so the Agent can
ask it this question.

### Added — `ContextWindowExceededError`: the refusal that names its fixes

Every vendor refuses an over-long request in its own words and none of them
says which dial moves the number. What the field saw was:

```
[openai] 400 Input tokens exceed the configured limit of 272000 tokens.
Your messages resulted in 879073 tokens.
```

True, and useless: it looks exactly like a transient 400, so the natural next
move is a retry that re-sends the same oversized history. The `openai`,
`anthropic`, `bedrock`, `browser-openai` and `browser-anthropic` adapters now
translate that class of refusal — and only that class — into one typed error
carrying `provider`, `limitTokens`, `actualTokens` (when the vendor stated
them), `status`, the original as `cause`, and the code
`ERR_CONTEXT_WINDOW_EXCEEDED`. Its message carries the three fixes in the
order they are worth trying: cap oversized **tool results** where they are
produced; `.window(slidingWindow({ keepRecentTurns }))` to drop older rounds;
and the one that is not obvious until it fails — **`.compaction()` cannot fold
a span bigger than the window**, because the summarizer call sends that span.

Detection is deliberately conservative. Only unmistakable wording translates
(`context_length_exceeded`, `maximum context length`, `prompt is too long`,
`exceed context limit`, `Input is too long for requested model`, `Input tokens
exceed the configured limit`); a **rate** limit and a `max_tokens` validation
error are different failures with different fixes and are never translated;
everything else passes through as the provider error it always was. The
browser adapters translate in `wrapStatus` as well as `wrapError`, because an
HTTP refusal never reaches the latter. `isContextWindowExceeded(err)` asks the
question without importing the class.

### Fixed — a checkpoint stops advertising a resume that cannot work

`RunCheckpointError` said `Pass to agent.resumeOnError(checkpoint) to
continue` for every failure. Measured on the field case: resume re-sent the
same 540k-token history and got the identical 400 — a deterministic loop, and
the library was recommending it.

`resumeOnError` replays the checkpointed conversation to the same provider
with the same credentials, which is right for a transient fault and hopeless
for a failure the request itself causes. So three classes now get a checkpoint
message that says plainly why resume cannot help and what to do instead: a
context-window refusal (the item above, with its three fixes — recognised
both as the typed error and as the vendor's own sentence, because the field
case came from a custom `LLMProvider` in front of a gateway and never passed
through an adapter at all), rejected credentials (401 / 403,
`UnrecognizedClientException`, `invalid api key` — matched on the vendor's
exception NAME rather than loose prose), and a malformed request
(400 / 404 / 422). Everything else keeps today's hint word
for word, because wrongly telling a caller not to resume costs them a run that
would have succeeded.

The checkpoint is still built and still carries the whole conversation for
every class — `checkpoint.history` is what was about to be sent, which is what
a post-mortem wants. The message now says that too: evidence, not a retry
handle. `canResume(error)` is the same classification as a boolean, so a retry
loop can branch on it instead of reading prose.

## [9.5.1] - 2026-08-09

### Fixed — a malformed strategy is a sentence, not a `TypeError` from inside the library

Field report: `defineMemory({ type: EPISODIC, strategy: { kind: HYBRID, size: 5 }, store })`
— a hybrid written with the fields of a window — failed with

```
TypeError: Cannot read properties of undefined (reading '0')
```

A hybrid IS its `strategies` list, and that config has none. 9.5.0 added the
requirements walk, which checks what each sub-strategy NEEDS but reads the
sub-strategy list before anything establishes there is one; the pipeline
dispatch reads `strategies[0]` even earlier. Both are field reads off a shape
that never had the field, so the caller got the library's internals instead of
the name of the option they got wrong.

`defineMemory` now checks the strategy's SHAPE first, before the dispatch and
before the requirements walk, and every refusal names the field, shows a line
that would have worked, and points at `listMemoryStrategies()`:

```
defineMemory[chat]: the `hybrid` strategy needs a non-empty `strategies` array
and none was passed — a hybrid is defined by the strategies it composes, so an
empty one has nothing to compose and no behaviour of its own.
  Fix:  strategy: { kind: 'hybrid', strategies: [{ kind: 'window', size: 20 },
        { kind: 'topK', topK: 3, embedder }] }
  Or:   drop `hybrid` and name the one rule you meant, e.g. { kind: 'window', size: 20 }.
  `listMemoryStrategies()` describes all seven kinds — what each one does,
  which memory TYPES accept it, and what it needs supplied.
```

Four shapes that used to end in a raw `TypeError` or in nonsense now end in
that kind of sentence:

- **`hybrid` with no `strategies`** — the reported one. It threw on EPISODIC
  from the dispatch, and on SEMANTIC / NARRATIVE from the requirements walk
  (`strategy.strategies is not iterable`).
- **`hybrid` with an EMPTY `strategies: []`** — EPISODIC refused it tersely;
  SEMANTIC and NARRATIVE **accepted** it, because the pipeline they build
  never reads the list. An empty hybrid composes nothing, so it is now refused
  uniformly.
- **`strategies` that is not an array** — `strategies: 'window'` indexed the
  STRING, took the character `'w'`, and refused it as an unknown strategy kind.
- **A malformed ENTRY in the list** (`null`, a nested `hybrid` with no list of
  its own) — refused at its own path, e.g. `strategy.strategies[1]`.

Two more shapes one level up, found by sweeping the other six kinds:

- **No strategy object at all** (`strategy: undefined` / `null`) — was
  `Cannot read properties of undefined (reading 'kind')`.
- **The bare-string form** (`strategy: 'window'`) — refused with a bare
  "unknown strategy kind", which does not tell a caller what is wrong with a
  perfectly reasonable-looking line. It now teaches the object shape and
  echoes the kind that was reached for: `strategy: { kind: 'window', size: 20 }`.
  (Strings are still not accepted — the message teaches, it does not widen the
  API.)

The sweep found no other raw-`TypeError` gap: `summarize` without its `llm`,
`topK` without its `embedder`, `decay` without its `halfLifeMs` and CAUSAL
without an embedder already refuse by name, and the remaining absent-field
cases (`window` without `size`, `topK` without `topK`, `extract` without
`extractor`) fall through to a stage default rather than throwing — behaviour
that has shipped for many releases and is deliberately left alone in a patch.

The new guard judges SHAPE only. It does not rule on whether a kind is real or
legal for the type — the dispatch refuses those and names what that type does
accept, which is the better message, and it still speaks. Nothing that built
before builds differently: every refused shape either threw already or built a
definition with no coherent behaviour.

## [9.5.0] - 2026-08-09

**Memory strategies tell the truth.**

`MEMORY_STRATEGIES` advertised seven strategies and `defineMemory` built six —
`DECAY` was in the const, in the type union, in the docs table, and threw "not
yet wired" on every config. A host building a strategy picker off that const
offered a choice that could only fail. This release wires `decay`, and makes
every strategy DECLARE what it needs so a host can check before it offers,
rather than learning from an exception mid-run.

### Added — `DECAY` is wired: old memory fades

`defineMemory({ type: EPISODIC, strategy: { kind: DECAY, halfLifeMs, minScore } })`
now builds a real pipeline. A `FilterByDecay` stage sits between the load and
the budget picker: every entry loaded this turn is scored `2 ^ (-age /
halfLifeMs)` against its `lastAccessedAt` and dropped below `minScore`
(default `0.1`, ≈ 3.3 half-lives). A day-old entry scores `0.5` against a
one-day half-life; a week-old one scores `0.008` and is gone. Free — no LLM,
no embedder, no store round-trip beyond the load that was happening anyway.

Three decisions worth stating, because each is a thing it deliberately does
not do:

- **Age, not use.** `computeDecayFactor` also has an access term, and this
  passes a neutral `1` for it. `accessCount` is incremented by `store.get()`,
  and no shipped read path calls `get()` — they `list()` or `search()`. A knob
  for it would be a dial wired to a counter that never moves.
- **Nothing is deleted.** Decay is a read-time judgement; the entry stays in
  the store, and a shorter half-life or a lower floor lets it back in. `ttl`
  is still the way to say "stop storing this".
- **Dropped before the picker, not by it.** What has faded is not a budget
  question, and a stale entry that fits should still not be injected.

An entry whose `lastAccessedAt` is missing or non-finite is **kept**: a store
that does not date its entries has not told us they are old, and the
alternative is `NaN`, which fails every comparison and would silently drop
everything such a store returns. `halfLifeMs` must be finite and non-negative
— a negative half-life scores OLDER entries higher, which no config means, so
it is refused by name. Runnable: `examples/memory/11-decay-strategy.ts`.

### Added — `listMemoryStrategies()`: strategies declare their requirements

Seven bare strings are enough to WRITE `strategy: { kind: … }` and not nearly
enough to OFFER the choice. `listMemoryStrategies()` returns the same seven
described — `{ kind, description, types, requirements }` — following the
`listInfluenceStrategies()` exemplar already in this package. `requirements`
is what the HOST must supply (`'embedder'`, `'vector-store'`, `'llm'`); empty
means it runs anywhere at $0. `types` is the other half of "can I offer this?"
— `decay` on a SEMANTIC store is refused however good your credentials are.
`memoryStrategyInfo(kind)` looks up one.

```ts
const canSupply = new Set(embedder ? ['embedder', 'vector-store'] : []);
listMemoryStrategies()
  .filter((s) => s.types.includes('episodic'))
  .filter((s) => s.requirements.every((r) => canSupply.has(r)));
// → window, budget, decay, hybrid
```

The declaration is enforced rather than decorative — the pairs it calls
supported are built in a test, and the requirements it declares are removed
one at a time to prove each is refused.

### Fixed — a missing dependency is a sentence at build, not a `TypeError` mid-run

`defineMemory` now refuses at BUILD when a strategy's declared requirement is
absent. Two gaps this closes, both of which used to build a definition that
could not do its job:

- **`SUMMARIZE` without its `llm`** built silently for JavaScript callers and
  casts (TypeScript already required it).
- **A `HYBRID` whose sub-strategy needs something the host does not have** was
  accepted and the sub-strategy list then quietly ignored — a `hybrid`
  containing `topK` with no embedder built a pipeline that embedded nothing.
  Every sub-strategy is now checked where the caller's words still exist.

The check runs AFTER the pipeline dispatch on purpose: the existing arms know
more (the `ranksBy: 'server-text'` exemption, that it does not apply to
CAUSAL, that `EXTRACT`'s `llm` matters only for `extractor: 'llm'`), so they
speak first and this is the backstop that leaves no declared requirement
unchecked. A throw where there was a silent no-op is a fix, not a break:
nothing that worked stops working.

### Fixed — `SUMMARIZE` says what it actually does

The `summarize` stage exists in the source and is composed into **no**
pipeline. `defineMemory({ strategy: { kind: SUMMARIZE, recent, llm } })` loads
the last `recent` turns and stops — verified by counting: eight turns through
that pipeline with a counting provider produced zero `complete()` calls, while
the docs table promised "LLM compresses older turns" and the example passed a
summarizer that was never called.

The compression is not wired in this release — it needs things the strategy
does not carry (a model name, cost accounting, the separate-instance law
`.compaction()` enforces), and the Agent already has that door. What changes
is that the library now SAYS so: the caveat is in the strategy's own
`description` from `listMemoryStrategies()`, in the docs table, and in the
factory's dispatch table. `.compaction({ summarizer, model })` is the
compaction that runs.

## [9.4.0] - 2026-08-09

**AWS adapters tell the truth.**

A production field report tested 9.3.0 against a real account and found two
adapters _dispatching calls that were never made against AWS_ — one sending a
command that does not exist, one calling a method that a command-based client
does not have. Both compiled. Both had green tests. Every one of those tests
injected a double past the SDK, which is exactly why the bug class survives: the
one part of an adapter a type-checker cannot see is **which operation of the
vendor's API it dispatches**, and a fake answers whatever it is asked.

This release fixes both, seals the class across every AWS adapter in the
package, and closes three more things the same report measured. No breaking
changes to any type.

### Fixed — `agentCoreIdentity` never worked at all

`agentCoreIdentity({ region })` — the documented path, in the README and in its
own docstring — failed **100% of the time, on the first call**, with a message
blaming the SDK version:

```
agentCoreIdentity: the SDK client has no getResourceOauth2Token. Confirm the
@aws-sdk/client-bedrock-agentcore version, or pass `_client`.
```

It built a `BedrockAgentCoreClient` and then duck-typed
`client.getResourceOauth2Token` off it. A bare `@aws-sdk/client-*` **Client** is
command-based: its prototype carries `send` and `destroy` and nothing else. The
per-operation shortcuts live on the AGGREGATED client (`BedrockAgentCore`),
which is a different class. Verified on 3.1066.0 — the installed
`BedrockAgentCoreClient` prototype is exactly `[constructor, destroy]`.

It now goes through `sdk.send(new GetResourceOauth2TokenCommand(input))`, which
is the pattern the **memory adapter in this same package** has used all along.
Two more things the shim was getting wrong, found while fixing it:

- **`sessionId` came back empty on every consent round-trip.** The service
  reports a 3LO session as `sessionUri`; the adapter read `sessionId`, which is
  not a field of `GetResourceOauth2TokenResponse`. Now mapped.
- **`workloadIdentityToken` is REQUIRED on the request** and was sent as
  optional, so a call without one bought an opaque `ValidationException`. It is
  now refused by name before the call, naming both ways to supply one
  (`workloadIdentityToken`, or `workloadName` for per-user scoping).
- `expiresAt` is documented as never reported by AgentCore, because the response
  has no expiry field.

The `_client` seam is untouched: an injected client is somebody else's mapping
and keeps it.

### Added — one registry pins the AWS command names, for every adapter

The systemic half. `test/adapters/aws/` holds ONE registry naming, per adapter,
the SDK package, the client constructor and every command constructor it
dispatches — and three assertions over it:

1. **Dispatch.** Each adapter is driven through an `_sdk` double whose only
   exports are the pinned names. Reach for anything else and the adapter's own
   "missing command" refusal fires. Runs offline, always.
2. **Reality.** Wherever the peer dep is resolvable, every pinned name must be a
   real function export of the real package. (The AWS SDKs are deliberately NOT
   devDependencies: six adapters prove their missing-peer-dep refusals by the
   packages genuinely being absent. The check runs on any machine that installs
   them, and reports its own reach rather than skipping silently.)
3. **Completeness.** Every source file that LOADS an `@aws-sdk/*` package must
   have a row. A new AWS adapter cannot ship unpinned.

Coverage: `agentCoreIdentity`, `AgentCoreStore`, `agentCoreSessions`,
`BedrockAgentMemory`, `s3VectorsStore`, `cloudwatchObservability` /
`agentcoreObservability`, `xrayObservability`, `bedrockEmbedder`, the `bedrock`
LLM provider — and `agentCorePolicy`, whose row records that it now dispatches
nothing. CloudWatch, X-Ray and the Bedrock provider gained an internal `_sdk`
test seam so their command names are assertable at all; nothing about their
public behaviour changed.

### Changed — `agentCorePolicy` is retired, and says why

It dispatched `EvaluatePolicyCommand`. **That command does not exist** in
`@aws-sdk/client-bedrock-agentcore`, in any version, under any name. AgentCore
has no data-plane authorization operation: the policy surface is control-plane
only, and **AgentCore enforces policy AT THE GATEWAY**, in front of the tool,
before a request reaches your process. So every evaluation ended in the
adapter's own `catch`, and fail-closed turned that into a denial of every tool
call while reporting the engine unreachable.

The factory and all of its types remain exported and still type-check; calling
it now throws `AgentCorePolicyRetiredError` (`ERR_AGENTCORE_POLICY_RETIRED`)
naming the phantom command, the Gateway, and the alternatives —
`PermissionPolicy.fromRoles(...)` for local rules, `.toolMiddleware()` for
conditional ones. Deleting an export breaks a build with a module-resolution
error that explains nothing; a factory that refuses breaks it with a paragraph.
Whether the symbol is removed is a decision for 10.0.

**Gateway-enforced denials arrive as MCP errors** on the tool call made through
`mcpClient(...)`, and land in the loop as that tool's result. Surfacing them
honestly is the library's job; pre-evaluating a second copy of the rule
in-process never was. The `PermissionChecker` port and every local policy on it
are untouched.

### Changed — a fail-closed refusal now READS final

When a `PermissionChecker` throws, the call is denied. What the model was _told_
was the checker's own thrown message — and those are written for operators:
_"not available right now"_, `ECONNREFUSED`, _"timed out"_. **Measured in
production: a real model read that as weather and retried the same tool to
`maxIterations`, then returned the empty string.** Against the local policy's
long-standing bracketed form the same model adapted cleanly on the first
refusal. So the denial now uses that form and states that it is terminal:

```
[permission denied: Tool 'refund' could not be authorized. This will not change
during this run — do not call it again. Continue without it, or say what you are
unable to do.]
```

The thrown message stays on `agentfootprint.permission.check`'s `rationale`,
where operators already look — which also keeps infrastructure detail
(hostnames, internal IPs) out of the transcript. A checker that ANSWERED still
speaks for itself: an explicit `deny` carries its own `rationale` / `tellLLM`
unchanged.

### Fixed — credential failures were invisible to `agent.on(...)`

`agentfootprint.credential.*` has had payload types, registry entries and real
emit sites since 6.11.0 — and **no dispatcher bridge and no domain wildcard**.
Every one of those events stopped on footprintjs's raw emit channel:
`agent.on('agentfootprint.credential.failed', …)` observed nothing however
correctly the event fired. That is how an identity adapter failing 100% of its
calls did so in a silence that read like health.

- `credentialRecorder` is attached on every run (zero-cost with no listener), so
  the domain reaches the typed dispatcher at last.
- `agentfootprint.credential.*` joined `DomainWildcard`, so an operator can
  subscribe to the domain as a group.
- `CredentialFailedPayload` gained **`tool`** (what actually stopped working)
  and **`errorClass`** (routable without parsing prose). Both optional and never
  invented; still never the token, and never a consent URL.
- A tool that resolves its **own** credential via `ctx.credentials` now reports
  failures too. That path emitted nothing at all: the throw was caught by the
  generic tool catch and became one indistinguishable `error: true`.

### Added — `EventMeta.sessionId`: which CONVERSATION an event belongs to

`meta.runId` is per `run()` / `resume()`; a session spans many. A shipped
telemetry stream could answer _"what happened in this run?"_ and not _"what
happened in this conversation?"_ — the question a session-oriented host is built
around, and one the events alone cannot be joined back into afterwards.

`standingAgent` now threads the caller's own session id onto every event the run
emits, and `agent.run(input, { sessionId })` sets it outside a host. The
CloudWatch and AgentCore adapters serialize the whole envelope, so it arrives
without their knowing it exists.

**Absent when there is no session, never fabricated.** An anonymous request has
none (the host's internal `#anonymous-N` concurrency latch is not published as
telemetry); a bare `agent.run()` has none.

### Fixed — `s3VectorsStore` never verified the index it was given

The same field report, on the same run. This store dispatched exactly
`PutVectors` and `QueryVectors` and **never looked at the index** — trusting
three preconditions it had no evidence for, all three of which were wrong at
once:

- **A euclidean index was accepted.** The construction refusal read
  `options.distanceMetric`, a _claim by the caller_ about an index the store did
  not create, so the default (undeclared) sailed through. Measured live: a
  vector queried against itself returned **0.9991630113800056**, where a true
  cosine self-similarity is exactly `1.0` — the very "number that READS like a
  cosine and is not one" this adapter's own header warns about.
- **A missing `nonFilterableMetadataKeys: ['af']`** surfaced as a raw AWS
  `ValidationException` — _"Filterable metadata must have at most 2048 bytes"_ —
  **mid-import**, with documents already written and success already reported
  for them.
- **The index dimension was never compared with the embedder.**

One `GetIndex`, lazily on first use and memoized, now answers all three: the
metric is verified (refused by name, quoting both the index's answer and the
caller's declaration when they disagree), `af` is verified **before the first
byte is written**, and the dimension is checked against the vectors being
written or searched — which also catches the first search of a fresh process,
which the per-process fingerprint could not. This is the discipline
`sqliteVectorStore`, `pgVectorStore` and `staticVectorStore` already applied at
open; this store had nothing to open, so it opened nothing.

A `GetIndex` that fails is refused teachingly — naming the index and what to
check — never passed through, because an index this store cannot read is an
index whose metric, layout and dimension it would be guessing at.

**Requires a new IAM permission: `s3vectors:GetIndex`.**

## [9.3.0] - 2026-08-09

**Three promises the code had already made, kept.**

`MemoryStore`'s own docstring has named its backends since 2.x — _"Every storage
backend (InMemory, Redis, DynamoDB, **Postgres**, Bedrock AgentCore) implements
this interface"_ — and named the queries too, in the two places an implementer
would look: _"**Postgres**: multi-row INSERT … ON CONFLICT DO UPDATE"_ for
`putMany`, and _"**pgvector**: `ORDER BY embedding <=> query LIMIT k`"_ for
`search`. Every one of those sentences was true about the design and false about
the shipped package. Two of the three items below are the same shape: a
documented promise with nothing behind it.

### `pgVectorStore` — the backend the port has named since 2.x

```ts
import { Pool } from 'pg';
import { pgVectorStore } from 'agentfootprint/memory';

const store = pgVectorStore({ client: new Pool({ connectionString: process.env.DATABASE_URL }) });
await indexDocuments(store, embedder, docs, { embedderId: embedder.id });
```

Postgres is the database most teams already run; a corpus that lives in it
inherits the backups, the failover, the access control and the migrations you
already have. `putMany` is the multi-row upsert the docstring promised and
`search` is `1 - (embedding <=> $query::vector)` — pgvector's cosine distance
turned into the cosine similarity the port reports.

Three decisions worth knowing:

- **It does not create the table.** A `vector(N)` column fixes N at creation and
  N is a fact about your embedder; picking it implicitly would pick it forever,
  in a migration nobody reviewed. The `CREATE TABLE` is in the docs and in the
  adapter's own docstring, and a **missing table is refused**
  (`PgVectorSchemaError`) rather than read as an empty corpus — an unreadable
  index and an empty one are different facts, and only one is safe to answer
  with "no matches".
- **Nothing is ever two statements pretending to be a transaction.** A `pg.Pool`
  hands each `query()` its own connection, so everything that must be atomic is
  ONE statement: `putMany` is one upsert, `putIfVersion` is one conditional
  upsert, `forget` is one statement with CTEs across all four tables.
- **Identifiers are validated, not escaped.** Every table and column name is an
  option (so this fits a schema with conventions), and a name that is not a
  plain SQL identifier is refused — a store configured from an environment
  variable is one `DB_TABLE` away from being an injection point.

### `s3VectorsStore` — a corpus you can add to at 14:00

`sqliteVectorStore` (8.9.0) made a corpus survive a restart, and a corpus bundle
(8.20.0) made it survive a runtime with no disk. Both leave the same gap, and a
field report named it: **a bundle can only change when you redeploy.**

```ts
const store = s3VectorsStore({ bucket: 'my-corpus', index: 'docs', region: 'us-east-1' });

// From a cron job. No deploy, no restart — the agent sees it next turn.
await indexDocuments(store, embedder, newDocs, { embedderId: embedder.id });
```

`search()` maps 1:1 onto QueryVectors and `put`/`putMany` onto PutVectors, so
`indexCorpus`, `indexFolder` and `indexDocuments` run against it unchanged —
that is the point of writing it rather than only reading it. It refuses a
euclidean index at construction (a rescaled euclidean distance reads like a
cosine and is not one), refuses the three operations a vector index cannot do
(`putIfVersion`, `recordSignature`, `feedback`) rather than faking them, and
answers their read halves truthfully.

Both adapters carry the embedder-fingerprint refusals `sqliteVectorStore` has
had since 8.9.0 — and `EmbedderMismatchError` is now ONE class in `lib/`, shared
by all three, so `catch (e) { if (e instanceof EmbedderMismatchError) }` cannot
depend on which store threw. The import path is unchanged.

### The store says what its `search()` ranks

`defineRAG` has always required an `Embedder`, because somebody has to turn the
question into a vector. A managed knowledge-base service does not work that way:
it embeds and ranks on ITS side, and its retrieval API takes TEXT. Wired to one
of those, the embedder was still constructed, still called once per turn, still
billed — and the vector it produced was discarded on arrival. The wiring read
exactly like a working one.

```ts
// The store declares `ranksBy: 'server-text'`, so this is the whole wiring:
.rag(defineRAG({ id: 'docs', store: managedKnowledgeBase }))
```

`MemoryStore.ranksBy` is `'vector' | 'server-text' | undefined`. Passing an
`embedder` (or `embedderId`) to a server-text store is **refused**, not ignored:
an ignored embedder reads, from the wiring, exactly like a working one — same
line, same id in the recording, no way to tell that nothing was embedded. Such a
retriever is read-only by construction, and no
`agentfootprint.embedding.generated` event is emitted because none happened.

It is a second member rather than a widened `supportsVectorSearch`, because a
boolean that grew a third value would slip past every `!== false` already
written against it. The two must agree, and a store that declares both and
contradicts itself is refused by name rather than silently resolved.

**Absence still means undeclared.** Every store written before this release, and
every store you have written yourself, behaves exactly as it did.

### `bedrockEmbedder` speaks each model's own body shape

`InvokeModel` is one operation over vendor-specific JSON: Titan takes
`{ inputText }` and answers `{ embedding }`; Cohere takes `{ texts, input_type }`
and answers `{ embeddings }`. This factory sent Titan's body to everything, so
`bedrockEmbedder({ model: 'cohere.embed-english-v3', dimensions: 1024 })` —
a call the previous docstring suggested — constructed fine and failed at the
first embed, against the real service.

The model id now selects a FAMILY, and the family owns the request body, the
response field and the batching. Four models are known by name (Titan V2, Titan
V1, Cohere Embed English/Multilingual v3), each with its own size rule and its
own documented input window: **32,000 characters for Titan, 2,000 for Cohere v3**
— the same runtime, the same factory, and the same 2,500-character chunk read
whole by one and truncated by the other. That gap is the argument for a
per-model ceiling. Cohere also batches for real: 500 chunks are 6 round-trips
(96 texts a call), not 500.

`input_type` is a real parameter, not a hint — the v3 models embed a QUERY and a
DOCUMENT into deliberately different places. `embed()` sends `'search_query'`
and `embedBatch()` sends `'search_document'`, matching this library's own two
call sites; `inputType` pins both when yours differ.

The unknown-model refusal stays: a model this library has never met must state
its `dimensions`, and now may also state its `family` and `maxInputChars`. An id
that WRAPS a known model — `us.amazon.titan-embed-text-v2:0`, or an ARN ending
in the model id — now resolves to the model it names instead of being refused.

### Compatibility

- Additive across the board except one refusal that got stricter:
  `bedrockEmbedder({ model, dimensions })` where the model has ONE fixed size
  (Titan V1 at 1536, Cohere v3 at 1024) and `dimensions` disagrees now throws at
  construction. It previously reported a length that could never come back —
  which is the value a vector store fingerprints on. Drop `dimensions`; the
  factory knows the model's size.
- `EmbedderMismatchError` moved to `lib/embedderMismatch.ts` and is re-exported
  from its original module, so both import paths work and `instanceof` is now
  one class rather than one per store.
- `pg` and `@aws-sdk/client-s3vectors` are OPTIONAL peer dependencies, lazily
  required at the first call. Importing `agentfootprint/memory` costs nothing
  for consumers who never build one of the new stores.

## [9.2.0] - 2026-08-08

**The agent stops forgetting the conversation it is in and calling it success.**

9.1.0 fixed one call that was accepted and quietly did something else — an
indexer that half-read a chunk. This release went looking for its siblings
across the whole `Agent` / `LLMCall` surface, and the seed was a field find:

```ts
await agent.run({ message: 'Book me a table for two.' });
await agent.run({ message: 'Make it three.' });
// → "I don't have any earlier booking from you — this is your first message."
```

`run()` is one turn. It seeds history from the message you pass and nothing
else, so the second call started a **new conversation**. Nothing threw, the
trace was perfect, and the model was honest about what it had been shown. The
door that really continued a conversation was `checkpoint()` + `resumeOnError()`
— a conversation primitive wearing an **error** name, which is exactly why a
competent implementer missed it.

Thirteen shapes were probed on the shipped build. Four were already right and
are now pinned; the rest are below.

### The conversation has a door with its own name

```ts
await agent.run({ message: 'Book me a table for two.' }); // one turn
await agent.followUp('Make it three.'); // the next one

// …or hand the conversation around — plain JSON, any store, any machine:
const conversation = agent.checkpoint();
await agent.run({ message: 'Make it three.', continueFrom: conversation });
```

`followUp(message)` is sugar for `run({ message, continueFrom: this.checkpoint() })`
and nothing else — one restoration path, so the convenience cannot drift from
the mechanism. `standingAgent` used to assemble that continuation by hand
(append the turn, rewrite `originalInput`, hand the result to `resumeOnError`);
that hand-assembly **is** the door now, so a server and a script continue a
conversation the same way.

`run()` itself is unchanged and stays single-turn. What changed is that it says
so, in the first paragraph of its own docstring, and names both doors.

### A continued turn no longer re-namespaces its own memory

The quietest bug in the batch, and the one most likely to be live in somebody's
product right now. `resumeOnError` called `this.run({ message })` with **no
identity**, and `AgentRunCheckpoint` had nowhere to keep one. So every continued
turn ran under a fresh `conversationId` derived from its own runId: turn two
wrote its memory somewhere turn three could not read it. Nothing threw. The only
symptom was an agent that kept forgetting — which reads exactly like a model
being flaky.

`AgentRunCheckpoint` now carries `identity`, `AgentRunOptions` accepts one, and
a continued turn runs under the conversation's own namespace unless the call
names another. Version stays **1**: an optional field is not a format change,
and a runtime that has never heard of it continues the conversation correctly
(the same reasoning `folded` shipped under in 8.2).

### One agent no longer answers another agent's conversation

A transcript can be replayed on any agent, and usually that is the point — a
deploy that adds a tool or edits a prompt must still continue yesterday's
conversations. Replaying the **billing** agent's conversation on the **support**
agent is a different mistake, and it used to be accepted in silence.

The rule is the one the embedder fingerprint already uses: **ids decide only
when both sides named themselves.** A checkpoint records `agent: { id }` only
when that agent was given an explicit `Agent.create({ id })`; a default
(`'agent'`) is not naming yourself, so the majority of callers are never
refused. Two sides that both chose a name and chose different ones get
`ConversationMismatchError`, by name.

### Two behavior changes — refusals replacing silent corruption

Both of these used to **succeed**. They are refused in a minor, not held for a
major, on the same reasoning 8.13.0 and 8.14.0 used: the refused path was
already broken in effect, so the throw is a fix, not a new restriction.

**`RunInFlightError` — two overlapping `run()` calls on one instance.** An
`Agent` keeps its last executor, run context, answer and pause on itself; that
is what makes `checkpoint()`, `getLastSnapshot()` and `followUp()` possible.
Two overlapping runs both finished, both returning plausible answers, and the
state afterwards belonged to whichever finished last — so `checkpoint()` could
hand back the _other_ run's conversation, with nothing in either recording
saying so. That is corruption, not concurrency. `standingAgent` has serialized
runs since it existed and calls it "a correctness requirement rather than a
tuning choice"; the guarantee now lives in the primitive. Two turns at once:
build two agents (charts are per instance, instances are cheap), or
`standingAgent({ onConcurrentInvoke: 'enqueue' })`.

**`PendingQuestionError` — a new message while a person still owes an answer.**
A paused run is unfinished work with a person on the other end. Sending a
different message used to start a fresh run and orphan the pending question —
a consent gate any later message could walk around. Answer it with
`resume(checkpoint, decision)`, or say plainly that it is being dropped:

```ts
const dropped = agent.abandonPause(); // { toolName, toolCallId, question }
await agent.run({ message: 'never mind, different question' });
```

`abandonPause()` _returns_ what it dropped, so the abandonment can be logged
rather than performed blind.

**A pause belongs to a session, not to the instance.** `standingAgent` shares
one `Agent` across every session, so the instance guard alone would have let
session A's unanswered question refuse session B's _first_ message — a
different conversation, a different person, an answer they were never asked
for. The composer now releases the instance at the moment ownership moves: once
the pause is in the store, the store owns it, and a later request carrying a
decision continues it without consulting the instance at all. On the
cannot-be-carried path it releases for the opposite reason — blocking every
other session on a question nobody can ever answer is strictly worse. Pinned by
`test/hosting/pausedSession.test.ts`.

**`.system()` twice now refuses**, on both `Agent` and `LLMCall`. It was the
last silent last-wins setter among the policy doors — eight siblings
(`.toolProvider()`, `.configure()`, `.act()`, `.window()`, `.outputSchema()`,
`.reliability()`, `.thinking()`, `.thinkingHandler()`) already refused. The
first prompt was never sent and nothing said so. The refusal names the three
things a caller might have meant: `.steering(...)` for a second always-on
block, `.configure(...)` for a per-run prompt, or joining the strings yourself.
No shipped example, test or doc called it twice.

### `agent.canExplain()`

`.selfExplain()` was already honest to the **model** with no record bound — the
trace tools answer _"No completed run is available yet"_ and the skill body says
to say so plainly. It had no answer for the **program**. `canExplain()` returns
`false` for two honest reasons — not built with `.selfExplain()`, or built with
it and no turn completed — so a caller can route a why-question before spending
one.

### Docstrings that were not true

- `getLastSnapshot()` said "undefined before the first run completes". It is
  **live during a run**: the executor is assigned at run start, so reading it
  from a listener or a tool returns the in-flight run, partially filled. That is
  deliberate (Lens scrubs a running agent through it) and is why `.selfExplain()`
  captures at the terminal flush instead. Fixed on `Agent` and `RunnerBase`.
- `attach()` now says **when** it starts observing: the next run. A recorder
  attached mid-run is not dropped, it is early.
- `AgentInput.identity` said "multi-tenant memory scope". It names all five
  consumers now, says it does **not** reach `tool.execute`, and states plainly
  that `conversationId` is a namespace key rather than a session handle.

### The seal — `test/api-conformance/silent-success.test.ts`

34 tests, one per audited shape, so no future release can reintroduce a member
of this class quietly. Three kinds of pin:

1. **Refused** — pinned by message substring, so a refusal cannot decay into a
   bare `throw`.
2. **Adapted** — pinned by what reaches the model / the store / the caller,
   observed on the wire, never by mocking internals.
3. **Stated** — pinned **twice**: the behavior, _and_ the sentence in the source
   that states it. A stated behavior whose statement was deleted is back to
   being a silent success, and only the second assertion catches that.

Plus a **doctrine sweep**: every public `AgentBuilder` method is classified as
refuses-a-second-call (14), repeatable-by-design (14), a named last-wins
exception (4: `appName`, `commentaryTemplates`, `maxIterations`,
`thinkingTemplates` — scalars and display strings that decide nothing about
what is sent), or not-a-setter (2). A method that is none of the four fails the
suite, so a setter added in a later release cannot join `.system()`'s old club
unnoticed. The exception list is pinned by exact content: growing it is a
decision somebody makes in a diff.

### Also

- `examples/features/51-conversations.ts` — runs the trap and both doors and
  prints the messages the provider actually received for each. The model's own
  "this is your first message" reply is the evidence.
- `examples/features/49-self-explain-live.ts` — turn 2 now goes through
  `followUp()`. It was a second `run()`, and the scripted mock read the _first_
  user message, so the demo's own scripting was masking the restart. Live, the
  why-question used to arrive with no subject.
- `docs-next/content/docs/build/conversations.mdx` — the conversation, the two
  doors, what travels on a checkpoint, and the three things that look like
  conversation memory and are not (`identity`, memory recall, the trace).

### Migration

Additive except for the three refusals, and all three fire on code that was
already wrong:

| if you…                                                         | you now get                                      | do this                                                   |
| --------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| call `run()` twice expecting continuity                         | the same behavior as before (a new conversation) | `followUp(message)` or `run({ message, continueFrom })`   |
| overlap two `run()` calls on one agent                          | `RunInFlightError`                               | await the first, or build a second agent                  |
| send a message while a pause is open                            | `PendingQuestionError`                           | `resume(checkpoint, decision)`, or `abandonPause()` first |
| call `.system()` twice                                          | build-time throw                                 | join the strings, or `.steering()` / `.configure()`       |
| continue a stored conversation on a differently-**named** agent | `ConversationMismatchError`                      | continue it on the agent whose id recorded it             |

`checkpoint()` payloads written by 9.1.0 and earlier continue to work; they
simply carry no `identity` or `agent`, which is the honest answer for a
conversation stored before either existed.

## [9.1.0] - 2026-08-08

**The index stops half-reading a chunk and calling it success.**

Round three of the same production field report. `indexCorpus` defaulted its
`maxChunkChars` — how much of a chunk the embedder actually reads — to **2,000
characters for every embedder**, because that is the measured cliff of the
on-device `localEmbedder`. The integration was running `byHeading({ maxChars:
2500 })` against an embedder whose real window is 8,192 tokens. Result:
**6 of 26 chunks embedded CLIPPED** — indexed by their opening, stored and
served whole as the passage — so retrieval could not find wording plainly
visible in the `<source>` block the model was shown. Nothing threw. Nothing
scored zero. The box's own two defaults simply disagreed with each other, and
the disagreement was invisible.

### The ceiling is declared by the embedder — `Embedder.maxInputChars`

The number lives where the knowledge is. An indexer's own default is a guess
about a backend it has never met, so it has to be the smallest ceiling any
embedder might have — which then cuts every larger embedder short.

`Embedder` gains an optional `maxInputChars`: the longest input, in
characters, that this embedder represents faithfully. Every shipped embedder
fills it in:

| embedder            | `maxInputChars` | where the number comes from                                    |
| ------------------- | --------------- | -------------------------------------------------------------- |
| `localEmbedder()`   | `2000`          | measured — the default model's 512-wordpiece-token cliff       |
| `openaiEmbedder()`  | `32000`         | the documented 8,191-token window, at 4 characters a token     |
| `bedrockEmbedder()` | `32000`         | Titan's documented 8,192-token window, same conversion         |
| `staticEmbedder()`  | `1000000`       | no transformer, so no context window — nothing is ever clipped |
| `mockEmbedder()`    | `1000000`       | reads every character in a loop                                |

`indexCorpus`, `indexFolder` and `indexDocuments` read the embedder's declared
ceiling **in preference to** their own 2,000-character default. An explicit
`maxChunkChars` on the call still wins over both — you are allowed to know your
corpus is denser than the arithmetic assumes. An embedder that declares nothing
gets today's behaviour exactly, unchanged.

Three deliberate limits, stated rather than hidden: the characters-per-token
figure is an **assumption** (4, the English-prose rule of thumb — code, tables
and CJK tokenise denser, which is what `maxChunkChars` is for); a model this
library does not know declares **no** ceiling rather than a guessed one, the
same rule `.dimensions` already applies; and `localEmbedder({ maxInputChars })`
is accepted because the cliff belongs to the **model**, not to the factory.

### Truncation became visible

A run that clipped anything now says so — **once**, on `console.warn`, naming
the count, the ceiling in effect _and where that ceiling came from_, and the
two fixes (re-split smaller, or raise `maxChunkChars`). `IndexReport` gains
**`truncatedCount`** beside the existing `truncated` list: the list is what you
debug with, the count is what you assert on and what a dashboard row can hold.
`indexDocuments` — which returns a count and has no report — warns on the same
terms, with fix advice appropriate to a door that does not split.

The list has been in the report since 8.10.0. Nobody reads a report that says
everything went fine, which is exactly how this survived a week of real
traffic: an invisible failure is indistinguishable from success.

### Behaviour changes

- **A corpus indexed with a hosted embedder and a raised splitter ceiling now
  embeds whole where it used to clip.** Chunk content hashes are unchanged, so
  an incremental re-index will NOT re-embed on its own — force a re-index (or
  change the `embedderId`) if you were affected, since the stored vectors are
  the clipped ones.
- **`console.warn` fires from `indexCorpus` / `indexDocuments`** when something
  was clipped. Runs that clip nothing are as silent as before.
- **`IndexReport` has one more field.** Additive; code reading the report is
  unaffected unless it constructs one.

### Docs

The splitter's `maxChars` and the indexer's `maxChunkChars` are now documented
**together**, on the [indexing](docs-next/content/docs/build/indexing.mdx) page,
in the [RAG guide](docs-next/content/docs/build/rag.mdx), on the
[embedders](docs-next/content/docs/build/embedders.mdx) page and in both
docstrings — because each is safe alone and they only collide when a consumer
raises the splitter's ceiling, which is precisely what the field did.

## [9.0.0] - 2026-08-08

**The 8.x deprecation ledger, executed. Nothing new; nothing behaves
differently. Names that had a replacement now have only the replacement.**

8.0.0 consolidated 26 export subpaths into 10 doors and promised every old path
would keep working for all of 8.x. It did. This release collects on the other
half of that promise: sixteen alias subpaths leave `package.json`, and every
option, string, method and field that shipped an 8.x deprecation notice is
removed with it.

There is no new capability here and no changed behaviour. **If your code has no
deprecation warnings on 8.20.0, it compiles and runs unchanged on 9.0.0.**

### Removed — the sixteen door aliases

Each removed path re-exported the _same symbols_ the door carries, never copies,
so this is a find-and-replace on import lines. No name moved; no name was lost.

| you were importing from                             | import from                |
| --------------------------------------------------- | -------------------------- |
| `agentfootprint/llm-providers`                      | `agentfootprint/providers` |
| `agentfootprint/embedders`                          | `agentfootprint/providers` |
| `agentfootprint/tool-providers`                     | `agentfootprint/providers` |
| `agentfootprint/thinking`                           | `agentfootprint/providers` |
| `agentfootprint/memory-providers`                   | `agentfootprint/memory`    |
| `agentfootprint/observability-providers`            | `agentfootprint/observe`   |
| `agentfootprint/strategies`                         | `agentfootprint/observe`   |
| `agentfootprint/stream`                             | `agentfootprint/observe`   |
| `agentfootprint/status`                             | `agentfootprint/observe`   |
| `agentfootprint/locales`                            | `agentfootprint/observe`   |
| `agentfootprint/debug`                              | `agentfootprint/observe`   |
| `agentfootprint/debug/finders`                      | `agentfootprint/observe`   |
| `agentfootprint/observability/contextError/finders` | `agentfootprint/observe`   |
| `agentfootprint/hosting-providers`                  | `agentfootprint/hosting`   |
| `agentfootprint/injection-engine`                   | `agentfootprint/context`   |
| `agentfootprint/identity`                           | `agentfootprint/security`  |

What ships now is exactly: the root barrel, the ten doors (`/providers`,
`/memory`, `/rag`, `/cache`, `/observe`, `/events`, `/context`, `/resilience`,
`/hosting`, `/security`), one retained alias (`/reliability`, below), and
`./package.json`. `typesVersions` was trimmed in lockstep — a stale row there is
the quiet failure mode where the editor types a path Node refuses.

`test/api-conformance/door-aliases.test.ts` pins the absence of all sixteen and
drives the TypeScript checker over the shipped `.d.ts` files to prove each door
still carries every name it absorbed; `test/api-conformance/subpath-exports.test.ts`
pins the two manifest tables and proves, by object identity, that each absorbed
implementation barrel is served by its door as the same object.

### Removed — options, strings, methods, fields

| removed                                                | replacement                                                                                                                | since                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `AgentBuilder.recorder(rec)`                           | `AgentBuilder.watch(rec)` — same list, same order, same attachment, and variadic                                           | deprecated 8.0.0           |
| `defineSkill({ viaToolName })`                         | drop it — `'read_skill'` is the only activation tool the library builds; gate on a `rule` trigger or a `skillGraph()` edge | deprecated 8.7.0           |
| `skillsFromDir(dir, { viaToolName })`                  | drop it — same reason                                                                                                      | deprecated 8.7.0           |
| `WindowRefusalReason` member `'summary-not-smaller'`   | `'replacement-not-smaller'`                                                                                                | renamed 8.14.0             |
| type `FoldRefusal`                                     | `WindowRefusal`                                                                                                            | renamed 7.17               |
| type `FoldRefusalReason`                               | `WindowRefusalReason`                                                                                                      | renamed 7.17               |
| `WindowStrategy` exported from `agentfootprint/memory` | `MemoryWindowStrategy`                                                                                                     | renamed 7.27.1             |
| `CompactionRecord.foldedStageIds`                      | `WindowRecord.removedStageIds`                                                                                             | family name published 7.17 |
| `CompactionRecord.foldedMessageCount`                  | `WindowRecord.removedMessageCount`                                                                                         | family name published 7.17 |
| `ContextBudgetPressurePayload.capTokens`               | `cap`, read with `unit`                                                                                                    | renamed 8.14.0             |
| `ContextBudgetPressurePayload.projectedTokens`         | `projected`, read with `unit`                                                                                              | renamed 8.14.0             |
| `BudgetPressureRecord.capTokens`                       | `cap`, read with `unit`                                                                                                    | renamed 8.14.0             |
| `BudgetPressureRecord.projectedTokens`                 | `projected`, read with `unit`                                                                                              | renamed 8.14.0             |

Three of those are worth a sentence each, because the _reason_ is the migration:

- **`viaToolName` named a door that was never built.** The evaluator activates
  an `llm-activated` skill by matching `ctx.activatedInjectionIds`, only
  `read_skill` writes that array, and nothing ever read the field. 8.7.0 made a
  non-`'read_skill'` value a mount-time refusal; 9.0.0 deletes the option. Even
  `viaToolName: 'read_skill'` is refused — the option is gone, not narrowed, and
  a caller passing the default is still a caller who believes it does something.
  The **mount** refusal from 8.7.0 stays, because an injection can reach an agent
  without passing through the factory (a hand-built object, or one deserialized
  from an 8.x artifact).
- **`capTokens` / `projectedTokens` asserted a unit the channel does not use.**
  The three context slots emit `agentfootprint.context.budget_pressure` counting
  CHARACTERS, a window strategy emits the same event counting TOKENS, and
  `contextBudget` is on by default — so one subscriber routinely got both, and
  "cap 200" could mean either. 8.14.0 added `unit` + `cap` + `projected` beside
  the old pair; 9.0.0 keeps only the honest three. `cap` / `projected` are now
  **required** on `BudgetPressureRecord` (a record carrying neither pair would be
  a record with no numbers on it); `unit` stays optional there and required on
  the payload, so a third-party slot builder still compiles and a consumer can
  always answer what was counted. The strategy-facing seam
  (`WindowStrategyResult.budgetPressure`) keeps its own `capTokens` spelling on
  purpose — a strategy declares its own `unit`, so there the name is honest.
- **`foldedStageIds` / `foldedMessageCount` were fold-flavoured names on a family
  field.** They live on `WindowRecord`, which every window strategy writes, and
  only one of the three shipped strategies folds anything — so the alias made
  `slidingWindow` and `tokenBudget` read like they were missing a field.

### Three grace errors, deleted in 10.0.0

`AgentBuilder.recorder()`, `defineSkill({ viaToolName })` and
`skillsFromDir(…, { viaToolName })` keep their NAMES for one major as throwing
stubs. Each throws at build/definition time — before any run, so the failure is
deterministic and lands in development — with a message that names the
replacement and says when the signpost comes down.

Deleting the type member alone would have been a silent DOWNGRADE for the two
`viaToolName` cases: an object literal gets an excess-property error, but an
options bag arriving through a variable does not, and the value would then be
_ignored_ where 8.7.0 refused it. So the field is read at run time exactly once
more, to say it is gone.

### Two things deliberately kept

- **`agentfootprint/reliability` survives.** It is the only home of the
  reliability GATE's `CircuitOpenError` — a different class from the provider
  decorator's `CircuitOpenError` that `/resilience` carries, with a different
  constructor and a different `instanceof` answer. Removing the path would not
  rename that class; it would make it unreachable, and a consumer could no
  longer `instanceof`-check the error their own gate throws. The full alias
  discipline still applies to it, scoped to that one exception plus
  `CircuitState`, which is declared in both breaker files as
  `'closed' | 'open' | 'half-open'` — two declarations, one type, pinned as such.
- **`buildRunSteps(events)` survives, still `@deprecated`.** Its deprecation is
  a _preference_, not a migration: live consumers should attach
  `runStepRecorder()` and read `getSteps()` (O(N), the house pattern) instead of
  re-walking an event log (O(N²) across repeated calls). But the shim is the only
  way to build steps from a saved event list — replay, post-hoc analysis, tests —
  and no recorder can do that job, so removing it would delete a capability
  rather than a spelling. It stays until something replaces the use case.

### Two ledger items that needed no work

Named here so the ledger is closed honestly rather than quietly:

- **Typestate builder one-shots.** No `@deprecated` typestate marker exists in
  `src/`. The builder's "set twice" guards (`.compaction()`, `.window()`) are
  live refusals, not deprecations — nothing to remove.
- **Budget-picker ordering.** No deprecated ordering option exists in `src/`.
  `RetrievalEvidence.selectionOrder` is a documented current field, not a
  transitional one — nothing to remove.

### Upgrading

1. Rewrite import lines against the door table above. Nothing else in the file
   changes — every name is the same symbol on the new door.
2. `.recorder(` → `.watch(`.
3. Delete every `viaToolName`.
4. `capTokens` → `cap`, `projectedTokens` → `projected` (and read `unit`);
   `foldedStageIds` → `removedStageIds`, `foldedMessageCount` →
   `removedMessageCount`; `'summary-not-smaller'` → `'replacement-not-smaller'`;
   `FoldRefusal[Reason]` → `WindowRefusal[Reason]`; `WindowStrategy` from
   `agentfootprint/memory` → `MemoryWindowStrategy`.


## Older releases

8.x and earlier: [changelogs/v8-and-earlier.md](changelogs/v8-and-earlier.md).
