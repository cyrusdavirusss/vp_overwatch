/**
 * One-click unsubscribe, landing from an alert email.
 *
 * Stateful sessions are deliberately not required here: the link carries a signed
 * token (lib/alerts/tokens.ts). That scopes it to exactly one action, expires, and
 * cannot be replayed against anything else.
 *
 * Scope note: this stops EMAIL only. It does not silently kill someone's texts and
 * calls — those are separate consents, and an email unsubscribe that also stops
 * phone calls would surprise the person who did it. The page says so, and the SMS
 * route is the inbound STOP.
 */
export const dynamic = 'force-dynamic'

import { verifyToken } from '@/lib/alerts/tokens.ts'
import { revokeConsent } from '@/lib/alerts/store.ts'

function page(title: string, detail: string, status = 200): Response {
  const html = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.6 -apple-system,system-ui,sans-serif;margin:0;padding:3rem 1.5rem;background:#0f1115;color:#e6e8eb}
main{max-width:34rem;margin:0 auto}h1{font-size:1.25rem;margin:0 0 .5rem}p{color:#9aa4b2;margin:.5rem 0}</style>
<main><h1>${title}</h1><p>${detail}</p></main>`
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const check = verifyToken(token, 'unsubscribe')

  if (!check.ok) {
    return page('Link not valid', `This unsubscribe link could not be used: ${check.reason}. If you keep receiving email alerts, reply to one of them and ask to be removed.`, 400)
  }

  await revokeConsent(check.userId, 'email', 'email-link-unsubscribe')
  return page('Unsubscribed', 'You will receive no further alert emails. Your texts and calls are unchanged — reply STOP to any text to end those too.')
}
