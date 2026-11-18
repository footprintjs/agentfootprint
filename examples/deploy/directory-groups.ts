/** Offline proof of any-one directory group admission; no live directory. */
import assert from 'node:assert/strict';
import { directoryPasswords, type Directory } from '../../src/doors/security.js';
import { isCliEntry, printResult, type ExampleMeta } from '../helpers/cli.js';

export const meta: ExampleMeta = {
  id: 'deploy/directory-groups',
  title: 'One directory check for several access groups',
  group: 'deploy',
  description:
    'A synthetic directory proves admission through the second required group with one bind and one membership search.',
  defaultInput: '',
  providerSlots: [],
  tags: ['deploy', 'identity', 'security'],
};

export async function run(_input: string): Promise<string> {
  const first = 'CN=Readers,OU=Groups,DC=corp,DC=example';
  const second = 'CN=Operators,OU=Groups,DC=corp,DC=example';
  const entry = {
    dn: 'CN=Alice,OU=People,DC=corp,DC=example',
    objectGUID: Buffer.from('00112233445566778899aabbccddeeff', 'hex'),
    displayName: 'Alice',
  };
  let binds = 0,
    membershipSearches = 0;
  const directory: Directory = {
    async open() {
      let bound = false;
      return {
        async bind(name, password) {
          binds++;
          bound = name === 'alice@corp.example' && password === 'synthetic-password';
          return bound ? 'ok' : 'invalid';
        },
        async whoAmI() {
          return bound ? 'u:CORP\\alice' : '';
        },
        async search(base, filter, scope) {
          if (!bound) return [];
          if (scope === 'sub') return [entry];
          membershipSearches++;
          assert.equal(base, entry.dn);
          // This explicitly synthetic account belongs only to Operators.
          return filter.includes(`(memberOf:1.2.840.113556.1.4.1941:=${second})`) ? [entry] : [];
        },
        async close() {},
      };
    },
  };
  // #region directory-groups
  const checker = directoryPasswords({
    directory,
    domain: 'corp.example',
    netbiosDomain: 'CORP',
    baseDn: 'DC=corp,DC=example',
    requiredGroup: [first, second],
  });
  const person = await checker.check('alice', 'synthetic-password');
  // #endregion directory-groups
  assert.ok(person);
  assert.equal(binds, 1);
  assert.equal(membershipSearches, 1);
  assert.equal(await checker.check('alice', 'wrong'), undefined);
  assert.equal(binds, 2);
  assert.equal(membershipSearches, 1);
  return 'Synthetic admission: second group matched; one bind and one membership search.';
}

if (isCliEntry(import.meta.url))
  run('')
    .then(printResult)
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
