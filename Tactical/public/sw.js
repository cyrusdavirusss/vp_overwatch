/*
 * VP-Overwatch service worker.
 *
 * WHY THIS FILE EXISTS: push notifications are impossible without it. The server half
 * (VAPID keys, sendPush, an honest delivery ledger) was already built, but a browser
 * cannot even CREATE a push subscription unless a service worker is registered — so
 * nothing could ever receive one. This is the missing receiving end.
 *
 * Scope note: it deliberately does no caching. This app fetches live telemetry and must
 * never serve a stale aircraft position from a cache, so there is no fetch handler here
 * at all. Only push, and only the click that follows.
 */

self.addEventListener('install', (event) => {
  // Take over immediately: a subscriber who just enabled alerts should not have to close
  // every tab before the first alert can arrive.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  // The payload is written by lib/alerts/channels.ts::sendPush as { title, body, data }.
  // A push with no payload is legal (some browsers send a bare tick), so fall back to a
  // generic line rather than throwing inside the handler and dropping the notification.
  let payload = { title: 'VP-OVERWATCH', body: 'New alert', data: {} }
  try {
    if (event.data) payload = { ...payload, ...event.data.json() }
  } catch {
    try { payload.body = event.data ? event.data.text() : payload.body } catch { /* keep fallback */ }
  }

  event.waitUntil((async () => {
    const tag = payload.data && payload.data.announcementId
      ? `announcement-${payload.data.announcementId}`
      : (payload.data && payload.data.dedupKey) || undefined
    await self.registration.showNotification(payload.title || 'VP-OVERWATCH', {
      body: payload.body || '',
      // Reusing the tag replaces an earlier copy of the SAME alert instead of stacking
      // duplicates when a client reconnects and the push service retries.
      tag,
      renotify: Boolean(tag),
      data: payload.data || {},
      badge: '/icon-192.png',
      icon: '/icon-192.png',
      // A police-proximity alert is worth waking a phone for; an announcement is not.
      requireInteraction: payload.data && payload.data.level === 'critical',
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL('/', self.location.origin).href
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Focus an existing tab if there is one: opening a second copy of a map that is
    // already on screen is not what a click means.
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) { await c.focus(); return }
    }
    await self.clients.openWindow(target)
  })())
})

// A browser may rotate or drop a push subscription (cleared site data, provider change).
// The page re-subscribes on its next visit via lib/push-client.ts; log it here so the
// event is at least visible rather than silently swallowed.
self.addEventListener('pushsubscriptionchange', (event) => {
  console.warn('[sw] push subscription changed; the app will re-subscribe on next visit')
})
