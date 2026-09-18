/**
 * Browser-side push plumbing.
 *
 * THREE THINGS THIS HAS TO GET RIGHT, each of which fails confusingly otherwise:
 *
 *  1. The service worker must be registered before a subscription can exist at all —
 *     `registration.pushManager.subscribe()` throws without one. That is why /sw.js
 *     exists and why this is the only entry point to subscribing.
 *  2. The VAPID public key must be handed over as a Uint8Array. Passing the base64url
 *     string that the server holds throws `InvalidCharacterError` in Chrome, and the
 *     error says nothing about the encoding being the problem.
 *  3. Permission is a three-state value, not a boolean: 'default' means the user has
 *     never been asked, 'denied' means they said no and asking again does nothing. The
 *     caller needs to distinguish these to say something true in the UI.
 */

export type PushSupport =
  | { ok: true }
  | { ok: false; reason: string }

export function pushSupported(): PushSupport {
  if (typeof window === 'undefined') return { ok: false, reason: 'not a browser context' }
  if (!('serviceWorker' in navigator)) return { ok: false, reason: 'this browser has no service worker support' }
  if (!('PushManager' in window)) return { ok: false, reason: 'this browser has no Push API support' }
  if (!('Notification' in window)) return { ok: false, reason: 'this browser has no Notification support' }
  return { ok: true }
}

/** Chrome demands a Uint8Array here; a base64 string is rejected with a cryptic error. */
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  // `register()` resolves before the worker is active; pushManager needs it ready.
  await navigator.serviceWorker.ready
  return reg
}

/** The subscription already on this browser, in the JSON shape the server stores. */
export async function existingPushSubscription(): Promise<PushSubscriptionJSON | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    if (!reg) return null
    const sub = await reg.pushManager.getSubscription()
    return sub ? (sub.toJSON() as PushSubscriptionJSON) : null
  } catch {
    return null
  }
}

/**
 * Register, ask permission, and subscribe — in that order, because each step can fail
 * independently and the caller deserves to know which one did.
 */
export async function ensurePushSubscription(
  vapidPublicKey: string,
): Promise<{ ok: true; subscription: PushSubscriptionJSON } | { ok: false; reason: string }> {
  const support = pushSupported()
  if (!support.ok) return { ok: false, reason: support.reason }
  if (!vapidPublicKey) return { ok: false, reason: 'the server has no VAPID public key configured' }

  try {
    const reg = await registerServiceWorker()
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        // Chrome refuses a subscription without this flag; the flag exists to promise
        // every push is shown to the user, which is exactly what /sw.js does.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      })
    }
    return { ok: true, subscription: sub.toJSON() as PushSubscriptionJSON }
  } catch (e: any) {
    const name = e?.name || ''
    if (name === 'NotAllowedError') return { ok: false, reason: 'permission was refused for this site' }
    if (name === 'AbortError') return { ok: false, reason: 'the browser could not reach its push service' }
    return { ok: false, reason: e?.message || 'subscribing failed' }
  }
}

/** Forget the browser-side subscription entirely (the caller also clears it server-side). */
export async function dropPushSubscription(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/')
    const sub = reg ? await reg.pushManager.getSubscription() : null
    return sub ? await sub.unsubscribe() : true
  } catch {
    return false
  }
}
