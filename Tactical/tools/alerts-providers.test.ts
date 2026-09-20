// Unit tests for alert provider selection.
// Run: node --experimental-strip-types --test tools/alerts-providers.test.ts
//
// The provider is chosen by env and nothing else, so this pins the selection and
// the per-provider configuration probes — including that an alert email cannot be
// considered sendable without a working unsubscribe URL, on EITHER provider.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  alertProvider, smsConfigured, callConfigured, emailConfigured, channelUnavailableReason,
} from '../lib/alerts/channels.ts'

const KEYS = [
  'ALERT_PROVIDER', 'ALERT_PUBLIC_URL', 'ALERT_EMAIL_FROM',
  'SENDGRID_API_KEY', 'MAILGUN_API_KEY', 'MAILGUN_DOMAIN',
  'SINCH_SERVICE_PLAN_ID', 'SINCH_API_TOKEN', 'SINCH_SMS_BASE_URL',
  'SINCH_PROJECT_ID', 'SINCH_KEY_ID', 'SINCH_KEY_SECRET', 'SINCH_NUMBER',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER',
]

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const k of KEYS) saved[k] = process.env[k]
  try {
    for (const k of KEYS) delete process.env[k]
    for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v
    fn()
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

test('the provider defaults to twilio so an existing deployment is untouched', () => {
  withEnv({}, () => assert.equal(alertProvider(), 'twilio'))
  withEnv({ ALERT_PROVIDER: 'sinch' }, () => assert.equal(alertProvider(), 'sinch'))
  withEnv({ ALERT_PROVIDER: 'nonsense' }, () => assert.equal(alertProvider(), 'twilio'))
})

test('twilio credentials do not configure a sinch deployment', () => {
  withEnv({
    ALERT_PROVIDER: 'sinch',
    TWILIO_ACCOUNT_SID: 'AC', TWILIO_AUTH_TOKEN: 't', TWILIO_PHONE_NUMBER: '+61',
  }, () => {
    assert.equal(smsConfigured(), false, 'sinch sms is unconfigured by twilio creds')
    assert.equal(callConfigured(), false)
  })
})

test('sinch sms and voice are configured independently', () => {
  withEnv({
    ALERT_PROVIDER: 'sinch',
    SINCH_SERVICE_PLAN_ID: 'plan', SINCH_API_TOKEN: 'tok', SINCH_SMS_BASE_URL: 'https://au.sms.api.sinch.com',
  }, () => {
    assert.equal(smsConfigured(), true)
    assert.equal(callConfigured(), false, 'sms credentials must not imply voice')
    assert.match(String(channelUnavailableReason('call')), /sinch/i)
  })
  withEnv({
    ALERT_PROVIDER: 'sinch',
    SINCH_PROJECT_ID: 'p', SINCH_KEY_ID: 'k', SINCH_KEY_SECRET: 's', SINCH_NUMBER: '+61',
  }, () => {
    assert.equal(callConfigured(), true)
    assert.equal(smsConfigured(), false, 'voice credentials must not imply sms')
  })
})

test('an alert email needs a way out, on either provider', () => {
  withEnv({
    ALERT_PROVIDER: 'sinch', MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'd', ALERT_EMAIL_FROM: 'a@b.c',
  }, () => assert.equal(emailConfigured(), false, 'no ALERT_PUBLIC_URL means no unsubscribe URL'))

  withEnv({
    ALERT_PROVIDER: 'sinch', MAILGUN_API_KEY: 'k', MAILGUN_DOMAIN: 'd', ALERT_EMAIL_FROM: 'a@b.c',
    ALERT_PUBLIC_URL: 'https://example.com',
  }, () => assert.equal(emailConfigured(), true))

  withEnv({
    ALERT_PROVIDER: 'twilio', SENDGRID_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.c',
    ALERT_PUBLIC_URL: 'https://example.com',
  }, () => assert.equal(emailConfigured(), true))

  withEnv({
    ALERT_PROVIDER: 'twilio', SENDGRID_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.c',
  }, () => assert.equal(emailConfigured(), false))
})
