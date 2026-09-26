/**
 * The redirect sign-in mounted as an app mounts it, against the fake browser
 * IdP, plus a fetch-driven "browser" that follows the flow and keeps cookies.
 */

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import {
  memorySessions,
  memorySignIns,
  nodeHost,
  signInDoor,
  standingAgent,
  type IngressRecord,
  type MemorySignIns,
  type SignInDoor,
  type SignInDoorOptions,
} from '../../src/hosting/index.js';
import { oidcIdentity, oidcSignIn, type OidcSignInOptions } from '../../src/identity.js';
import {
  fakeBrowserIdp,
  type FakeBrowserIdp,
} from '../adapters/identity/conformance/fakeBrowserIdp.js';

export interface MountedRedirect {
  readonly url: string;
  readonly port: number;
  readonly idp: FakeBrowserIdp;
  readonly door: SignInDoor;
  readonly store: MemorySignIns;
  readonly records: IngressRecord[];
  close(): Promise<void>;
}

export async function mountRedirect(
  extra: {
    signIn?: Partial<OidcSignInOptions>;
    door?: Partial<SignInDoorOptions>;
    idpHost?: string;
    appHost?: string;
    /** Authenticate with the IdP's registered private key (private_key_jwt) instead of the secret. */
    privateKey?: boolean;
    extraRoutes?: (path: string) => string | undefined;
  } = {},
): Promise<MountedRedirect> {
  const idp = await fakeBrowserIdp({ ...(extra.idpHost !== undefined && { host: extra.idpHost }) });
  const port = await freePort();
  const appHost = extra.appHost ?? '127.0.0.1';
  const publicUrl = `http://${appHost}:${port}`;
  idp.allowRedirect(`${publicUrl}/auth/callback`);
  const verifier = oidcIdentity({
    issuer: idp.issuer,
    audience: idp.audience,
    userIdClaim: 'oid',
    requiredScope: idp.scope,
    allowedClients: [idp.clientId],
    allowLoopbackHttp: true,
  });
  const store = memorySignIns({ warn: () => undefined });
  const door = signInDoor({
    redirect: oidcSignIn({
      verifier,
      clientId: idp.clientId,
      credential:
        extra.privateKey === true
          ? { kind: 'private-key', pem: idp.clientKeyPem }
          : { kind: 'secret', secret: idp.clientSecret },
      scope: `openid ${idp.scope}`,
      displayNameClaim: 'name',
      allowLoopbackHttp: true,
      ...extra.signIn,
    }),
    verify: verifier.verify,
    store,
    publicUrl,
    production: false,
    ...extra.door,
  });
  const records: IngressRecord[] = [];
  const host = nodeHost({
    port,
    hostname: '127.0.0.1',
    allowedHosts: [`${appHost}:${port}`, `127.0.0.1:${port}`],
    signIn: door.hostSignIn,
    onUnhandled: (req, res) => {
      void door.handle(req, res).then((handled) => {
        if (handled) return;
        const page = extra.extraRoutes?.((req.url ?? '').split('?')[0] ?? '');
        if (page === undefined) return void res.writeHead(404).end();
        res.writeHead(200, { 'content-type': 'text/html' }).end(page);
      });
    },
  });
  const handle = await standingAgent({
    agent: Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).build(),
    sessions: memorySessions(),
    host,
    identity: door.identity,
    onIngressDecision: (r) => records.push(r),
  });
  await host.serveConversations((conversation) => {
    conversation.onFrame((frame) => conversation.send(`echo:${frame}`));
  });
  return {
    url: publicUrl,
    port,
    idp,
    door,
    store,
    records,
    close: async () => {
      await handle.close();
      await idp.close();
    },
  };
}

async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      server.close(() => resolve(address.port));
    });
  });
}

/** A cookie jar for one "browser". */
export class Jar {
  readonly cookies = new Map<string, string>();
  take(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = (pair as string).indexOf('=');
      const name = (pair as string).slice(0, eq);
      const value = (pair as string).slice(eq + 1);
      if (/Max-Age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

export interface FlowResult {
  /** The callback's answer. */
  readonly status: number;
  readonly location: string | null;
  readonly referrerPolicy: string | null;
  readonly setCookies: string[];
  readonly jar: Jar;
  /** The authorization request the IdP saw. */
  readonly authorize: URLSearchParams | undefined;
}

/**
 * Sign in as `user` through the whole redirect flow, as a browser would:
 * GET /auth/login → the IdP's form → POST it → back to /auth/callback.
 */
export async function browserSignIn(
  app: MountedRedirect,
  user: string,
  options: {
    returnTo?: string;
    jar?: Jar;
    tamper?: (callback: URL) => URL;
    /** Arrive at the callback in ANOTHER browser: no cookies (login forgery). */
    otherBrowser?: boolean;
  } = {},
): Promise<FlowResult> {
  const jar = options.jar ?? new Jar();
  const start = await fetch(
    `${app.url}/auth/login${
      options.returnTo === undefined ? '' : `?returnTo=${encodeURIComponent(options.returnTo)}`
    }`,
    { redirect: 'manual', headers: { cookie: jar.header() } },
  );
  jar.take(start);
  const authorizeUrl = start.headers.get('location') as string;
  const page = await fetch(authorizeUrl, { redirect: 'manual' });
  const html = await page.text();
  const authorize = app.idp.lastAuthorize;
  let back: URL;
  if (page.status === 302) {
    back = new URL(page.headers.get('location') as string);
  } else {
    const form = new URLSearchParams();
    for (const m of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
      form.set(
        m[1] as string,
        (m[2] as string).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))),
      );
    }
    form.set('user', user);
    const posted = await fetch(new URL('/realm/login', authorizeUrl), {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    back = new URL(posted.headers.get('location') as string);
  }
  if (options.tamper !== undefined) back = options.tamper(back);
  const callback = await fetch(back, {
    redirect: 'manual',
    headers: options.otherBrowser === true ? {} : { cookie: jar.header() },
  });
  jar.take(callback);
  return {
    status: callback.status,
    location: callback.headers.get('location'),
    referrerPolicy: callback.headers.get('referrer-policy'),
    setCookies: callback.headers.getSetCookie(),
    jar,
    authorize,
  };
}
