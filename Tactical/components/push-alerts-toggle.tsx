'use client'

/**
 * Enable/disable browser push alerts for this account.
 *
 * The status line is deliberately honest about WHY it is off, because the three reasons
 * look identical to a user and only one of them is their fault:
 *   - the server has no VAPID keys        -> "not available on this server"
 *   - the browser cannot do push          -> "this browser can't"
 *   - permission was refused              -> "you blocked notifications for this site"
 * Each is a different sentence and a different fix, so the component says which.
 *
 * CSRF: the app uses double-submit — the readable vp_csrf cookie echoed into the
 * x-csrf-token header. Sent only on the POST, never on the GET.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ensurePushSubscription, existingPushSubscription, dropPushSubscription,
  pushSupported,
} from '@/lib/push-client'

type State = 'loading' | 'unavailable' | 'off' | 'on' | 'busy'

function csrfToken(): string {
  const m = /(?:^|;\s*)vp_csrf=([^;]+)/.exec(document.cookie)
  return m ? decodeURIComponent(m[1]) : ''
}

export function PushAlertsToggle() {
  const [state, setState] = useState<State>('loading')
  const [note, setNote] = useState<string>('')
  const [vapid, setVapid] = useState<string | null>(null)
  const [serverCan, setServerCan] = useState<boolean>(true)
  const [subscribed, setSubscribed] = useState<boolean>(false)

  const load = useCallback(async () => {
    const support = pushSupported()
    try {
      const r = await fetch('/api/alerts/settings', { cache: 'no-store', credentials: 'same-origin' })
      if (!r.ok) { setState('unavailable'); setNote('sign in to manage alerts'); return }
      const d = await r.json()
      const srvPush = d?.channelsAvailable?.push !== false
      setServerCan(srvPush)
      setVapid(d?.vapidPublicKey ?? null)
      const local = await existingPushSubscription()
      const stored = d?.hasPushSubscription === true
      setSubscribed(Boolean(stored && local))
      if (!support.ok) { setState('unavailable'); setNote(support.reason); return }
      if (!srvPush) { setState('unavailable'); setNote('the server has no push keys configured'); return }
      if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setState('unavailable'); setNote('notifications are blocked for this site in your browser'); return
      }
      setState(stored && local ? 'on' : 'off')
      setNote(stored && local ? '' : 'this device is not receiving push alerts')
    } catch (e: any) {
      setState('unavailable'); setNote(e?.message || 'could not read alert settings')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const enable = async () => {
    if (!vapid) { setNote('the server did not supply a VAPID public key'); return }
    setState('busy'); setNote('asking the browser…')
    const res = await ensurePushSubscription(vapid)
    if (!res.ok) { setState('off'); setNote(res.reason); return }
    const post = await fetch('/api/alerts/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ pushEnabled: true, pushSubscription: res.subscription }),
    })
    if (!post.ok) {
      const d = await post.json().catch(() => ({}))
      setState('off'); setNote(d?.message || d?.error || `the server refused it (HTTP ${post.status})`); return
    }
    setState('on'); setSubscribed(true); setNote('')
  }

  const disable = async () => {
    setState('busy'); setNote('')
    await dropPushSubscription()
    const post = await fetch('/api/alerts/settings', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ pushEnabled: false, pushSubscription: null }),
    })
    if (!post.ok) {
      const d = await post.json().catch(() => ({}))
      setState('on'); setNote(d?.message || d?.error || `could not turn it off (HTTP ${post.status})`); return
    }
    setState('off'); setSubscribed(false); setNote('push alerts are off')
  }

  const busy = state === 'busy'
  const on = state === 'on'

  return (
    <div
      className="rounded-md border px-3 py-2"
      style={{ borderColor: 'var(--line-1, #263746)', background: 'var(--ink-1, #101A24)' }}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void (on ? disable() : enable())}
          disabled={busy || state === 'unavailable' || state === 'loading'}
          className="font-mono text-[10px] tracking-[0.12em] uppercase px-2 py-1 rounded border disabled:opacity-50"
          style={{
            borderColor: on ? 'var(--vp-amber)' : 'var(--blue)',
            color: on ? 'var(--vp-amber)' : 'var(--blue)',
            background: 'transparent',
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'working…' : on ? 'push alerts: on — click to stop' : 'enable push alerts'}
        </button>
        <span className="font-mono text-[10px] text-[var(--text-3,#667582)]">
          {state === 'loading' ? 'checking…' : note}
        </span>
      </div>
      {state === 'unavailable' && !serverCan && (
        <p className="mt-1 font-mono text-[9px] text-[var(--text-3,#667582)] leading-relaxed">
          Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server to switch this on.
        </p>
      )}
      {subscribed && (
        <p className="mt-1 font-mono text-[9px] text-[var(--text-3,#667582)]">
          Alerts arrive as browser notifications, including while this tab is closed.
        </p>
      )}
    </div>
  )
}
