import assert from 'node:assert/strict';
import { scryptSync, timingSafeEqual } from 'node:crypto';

import { NIKI_DEMO_PASSWORD, NIKI_DEMO_PASSWORD_HASH } from './demo-student-password.ts';

assert.equal(NIKI_DEMO_PASSWORD, 'niki-demo-2027');
assert.match(NIKI_DEMO_PASSWORD_HASH, /^scrypt:v1:[^:]+:[0-9a-f]+$/);
assert.equal(verifyStudentPassword(NIKI_DEMO_PASSWORD, NIKI_DEMO_PASSWORD_HASH), true);
assert.equal(verifyStudentPassword('wrong-password', NIKI_DEMO_PASSWORD_HASH), false);

function verifyStudentPassword(password: string, passwordHash: string): boolean {
  const [scheme, version, salt, expectedHex] = passwordHash.split(':');
  if (scheme !== 'scrypt' || version !== 'v1' || !salt || !expectedHex) return false;

  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
