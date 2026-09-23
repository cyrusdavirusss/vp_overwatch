// Reversible field encryption — the helper that keeps subscriber phone numbers
// readable only to the server.
//
// It exists because hashing is not an option here: a number has to be recovered
// to be dialled. The properties that matter are (a) the ciphertext does not
// contain the plaintext, (b) the same input encrypts differently every time, so a
// database or snapshot leak cannot be attacked by matching repeated values, and
// (c) a tampered or unreadable value fails CLOSED (null) instead of returning
// something the caller might dial.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encryptField, decryptField } from '../lib/auth/crypto.ts'

const NUMBER = '+61412345678'

test('a stored value round-trips', () => {
  assert.equal(decryptField(encryptField(NUMBER)), NUMBER)
})

test('the ciphertext is versioned and does not contain the plaintext', () => {
  const ct = encryptField(NUMBER)
  assert.ok(ct.startsWith('v1.'), `expected a v1. prefix, got ${ct.slice(0, 8)}`)
  assert.equal(ct.includes(NUMBER), false)
  assert.equal(ct.includes('412345678'), false)
})

test('the same value encrypts differently every time (fresh IV per write)', () => {
  const a = encryptField(NUMBER)
  const b = encryptField(NUMBER)
  assert.notEqual(a, b)
  assert.equal(decryptField(a), NUMBER)
  assert.equal(decryptField(b), NUMBER)
})

test('nothing, an empty value and a plaintext passthrough all behave', () => {
  assert.equal(decryptField(null), null)
  assert.equal(decryptField(undefined), null)
  assert.equal(decryptField(''), null)
})

test('a tampered or malformed value fails closed with null', () => {
  const ct = encryptField(NUMBER)
  const parts = ct.split('.')
  // Flip a byte of the ciphertext: the GCM auth tag must reject it.
  const tampered = `${parts[0]}.${parts[1]}.${parts[2]}.${parts[3].slice(0, -2)}AA`
  assert.equal(decryptField(tampered), null)
  assert.equal(decryptField('v1.not-a-real-iv.tag.ct'), null)
  assert.equal(decryptField('garbage'), null)
  assert.equal(decryptField('v2.future.format.value'), null)
})
