// Pure auth-crypto tests. Run: node --experimental-strip-types --test tools/auth-crypto.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashPassword, verifyPassword, newSessionToken, hashToken,
  constantTimeEqual, isValidEmail, passwordPolicyError,
} from '../lib/auth/crypto.ts'

test('hashPassword/verifyPassword round-trips; wrong password rejected', () => {
  const { hash, salt } = hashPassword('correct horse battery staple')
  assert.equal(verifyPassword('correct horse battery staple', hash, salt), true)
  assert.equal(verifyPassword('wrong password entirely', hash, salt), false)
})

test('salts are random → same password yields different hashes', () => {
  const a = hashPassword('same-password-123')
  const b = hashPassword('same-password-123')
  assert.notEqual(a.hash, b.hash)
  assert.notEqual(a.salt, b.salt)
})

test('session token: only its hash is storable; hash is deterministic', () => {
  const { token, tokenHash } = newSessionToken()
  assert.equal(token.length, 64)          // 32 bytes hex
  assert.equal(tokenHash, hashToken(token))
  assert.notEqual(token, tokenHash)
})

test('constantTimeEqual: equal vs unequal, length-safe', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true)
  assert.equal(constantTimeEqual('abc', 'abd'), false)
  assert.equal(constantTimeEqual('abc', 'abcd'), false)
})

test('email + password policy validation', () => {
  assert.equal(isValidEmail('a@b.co'), true)
  assert.equal(isValidEmail('nope'), false)
  assert.equal(passwordPolicyError('short'), 'Password must be at least 10 characters.')
  assert.equal(passwordPolicyError('a-long-enough-password'), null)
})
