**Support** — the config chooser: a deployment's `IDENTITY_*` settings in, one
strategy out, or a boot refusal naming the key. It decides who may call the
door; it composes nothing a model reads.

## What it reads / what it writes
Reads an `IdentityConfig` (or `IDENTITY_*` environment variables) and the app's
`production` flag. Writes the boot banner lines; never a secret.

## The one law here
Config errors refuse at boot, outages answer 503, and production names its
strategy — even `open`. A key this release does not read is refused by name,
never ignored (`vocabulary.ts · KEYS_IN_A_LATER_RELEASE`).

```ts
const choice = await identityFromConfig(identityConfigFromEnv(process.env), {
  production: process.env.NODE_ENV === 'production',
});
for (const line of choice.banner) console.log(line);
await standingAgent({ agent, sessions, host, identity: choice.identity });
```

## Files
- `vocabulary.ts` — the five strategy names and every config key, this
  release's and later ones'.
- `config.ts` — `IdentityConfig`, `IdentityConfigError`, `identityConfigFromEnv`.
- `choose.ts` — `identityFromConfig` and the banner.
