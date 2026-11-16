import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { validateHandle } from './protocol.mjs';
import {
  digest,
  root,
  sha256,
  source,
  setup,
  request,
  handle,
  refuses,
} from './protocol-fixture.mjs';

for (const caseId of ['source-online', 'source-offline', 'consumer-online', 'consumer-offline']) {
  test(`valid install handle binds ${caseId}`, () => {
    const req = request(caseId),
      value = handle(req);
    assert.equal(validateHandle(value, req), value);
  });
}

for (const [name, change] of [
  [
    'wrong protocol',
    (r) => {
      r.protocol += '.unknown';
    },
  ],
  [
    'wrong source',
    (r) => {
      r.source.head = 'f'.repeat(40);
    },
  ],
  [
    'wrong case',
    (r) => {
      r.caseId = 'source-offline';
    },
  ],
  [
    'wrong root',
    (r) => {
      r.rootRealPath = resolve(root, 'other');
    },
  ],
  [
    'failed install',
    (r) => {
      r.installExitCode = 1;
    },
  ],
  [
    'dev included',
    (r) => {
      r.policy.omitDev = false;
    },
  ],
  [
    'scripts enabled',
    (r) => {
      r.policy.scripts = true;
    },
  ],
  [
    'peer waiver',
    (r) => {
      r.policy.peers = 'legacy';
    },
  ],
  [
    'wrong offline mode',
    (r) => {
      r.policy.offline = true;
    },
  ],
  [
    'wrong cache',
    (r) => {
      r.cache.realPath = resolve(root, 'other-cache');
    },
  ],
  [
    'wrong cache family',
    (r) => {
      r.cache.family = 'consumer';
    },
  ],
  [
    'bad setup digest',
    (r) => {
      r.setup.lockSha256 = 'bad';
    },
  ],
  [
    'unknown oracle',
    (r) => {
      r.expectedContext = '0.1.1';
    },
  ],
  [
    'missing graph proof',
    (r) => {
      delete r.proofRefs.graph;
    },
  ],
]) {
  test(`handle refuses ${name}`, () => {
    const req = request(),
      value = handle(req);
    change(value.receipt);
    refuses(() => validateHandle(value, req));
  });
}

test('consumer archive cannot be missing, replaced or relabelled', () => {
  for (const change of [
    (r) => {
      r.contextArtifact = null;
    },
    (r) => {
      r.contextArtifact.sha256 = 'f'.repeat(64);
    },
    (r) => {
      r.contextArtifact.sourceVersion = '15.0.0-rc.0';
    },
  ]) {
    const req = request('consumer-online'),
      value = handle(req);
    change(value.receipt);
    refuses(() => validateHandle(value, req));
  }
});

test('handle rejects missing, fake and accessor guards without calling them', () => {
  const req = request();
  refuses(() => validateHandle({ receipt: handle(req).receipt }, req));
  refuses(() => validateHandle({ ...handle(req), verify: { passed: true } }, req));
  let reads = 0;
  const value = handle(req);
  Object.defineProperty(value, 'verify', {
    enumerable: true,
    get() {
      reads++;
      return () => {};
    },
  });
  refuses(() => validateHandle(value, req));
  assert.equal(reads, 0);
});

test('source texts retain their actual length rather than using the path limit', () => {
  const req = request();
  req.originalManifestText = ' '.repeat(5000) + '{}';
  req.originalLockText = ' '.repeat(10000) + '{}';
  validateHandle(handle(req), req);
});

test('archive source versions require their own bounded value', () => {
  const req = request('consumer-online');
  req.contextArtifact.sourceVersion = 'v'.repeat(128);
  validateHandle(handle(req), req);
  for (const sourceVersion of ['', 'v'.repeat(129)]) {
    req.contextArtifact.sourceVersion = sourceVersion;
    refuses(() => validateHandle(handle(req), req));
  }
});
