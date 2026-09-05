'use client'

/**
 * VP Overwatch — authenticated tracked-aircraft dashboard.
 * Polls /api/dashboard/aircraft every 3s (session cookie), renders each of the
 * four aircraft with a distinct live/stale/unavailable/unresolved state, and
 * dead-reckons live positions between polls. Opt-in location sharing drives
 * per-user proximity alerts (30km enter / 33km exit). Zero ADS-B Exchange calls
 * from the browser. Non-alarmist wording throughout.
 */
import { useCallback, useEffect, useState } from 'react'
import { useDashboardAircraft, type DashboardAircraft } from '@/hooks/useDashboardAircraft'

function readCsrf(): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(/(?:^|;\s*)vp_csrf=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

const STATE_STYLE: Record<string, { label: string; color: string }> = {
  live_airborne: { label: 'AIRBORNE', color: '#00d4ff' },
  live_ground: { label: 'ON GROUND', color: '#5BD68A' },
  stale: { label: 'STALE', color: '#E8B923' },
  unavailable: { label: 'NO SIGNAL', color: '#8892a0' },
  unresolved: { label: 'UNRESOLVED', color: '#FF4757' },
}

function Chip({ state }: { state: string }) {
  const s = STATE_STYLE[state] ?? STATE_STYLE.unavailable
  return (
    <span style={{ color: s.color, border: `1px solid ${s.color}`, borderRadius: 4, padding: '1px 6px', fontSize: 11, letterSpacing: '0.08em' }}>
      {s.label}
    </span>
  )
}

function fmt(n: number | null, digits = 0, unit = ''): string {
  if (n === null) return '—'
  return `${n.toFixed(digits)}${unit}`
}

export default function DashboardPage() {
  const [me, setMe] = useState<{ id: number; email: string } | null | undefined>(undefined)
  const { snapshot, loading, unauthenticated, error, interpolatedPosition } = useDashboardAircraft()
  const [, setTick] = useState(0)
  const [locStatus, setLocStatus] = useState<string>('')
  const [events, setEvents] = useState<any[]>([])

  // 1s ticker so dead-reckoned positions visibly advance between 3s polls.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const loadMe = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
      const d = await r.json()
      setMe(d.user ?? null)
    } catch { setMe(null) }
  }, [])
  useEffect(() => { loadMe() }, [loadMe])

  const loadAlerts = useCallback(async () => {
    const r = await fetch('/api/alerts', { cache: 'no-store', credentials: 'same-origin' })
    if (r.ok) { const d = await r.json(); setEvents(d.events ?? []) }
  }, [])
  useEffect(() => { if (me) loadAlerts() }, [me, loadAlerts])

  const shareLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocStatus('Geolocation unavailable on this device.'); return }
    setLocStatus('Requesting location…')
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const res = await fetch('/api/location/current', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrf() },
        body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      })
      if (res.ok) {
        const d = await res.json()
        setLocStatus(`Location shared. Proximity alerts active. ${d.proximityEvents?.length ? `(${d.proximityEvents.length} in range now)` : ''}`)
        loadAlerts()
      } else {
        setLocStatus('Could not save location.')
      }
    }, () => setLocStatus('Location permission denied — proximity alerts paused.'))
  }, [loadAlerts])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'x-csrf-token': readCsrf() } })
    setMe(null)
  }, [])

  if (me === undefined) return <Shell><p style={{ color: '#8892a0' }}>Loading…</p></Shell>
  if (me === null || unauthenticated) return <Shell><AuthForm onAuthed={loadMe} /></Shell>

  return (
    <Shell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, letterSpacing: '0.1em', margin: 0 }}>VP·OVERWATCH — TRACKED AIRCRAFT</h1>
          <p style={{ color: '#8892a0', fontSize: 12, margin: '4px 0 0' }}>
            Feed: {snapshot?.providerStatus ?? '—'} · updated every 3s · {me.email}
          </p>
        </div>
        <button onClick={logout} style={btn}>Sign out</button>
      </div>

      {loading && !snapshot && <p style={{ color: '#8892a0' }}>Loading feed…</p>}
      {error && <p style={{ color: '#E8B923', fontSize: 12 }}>Feed hiccup: {error} (retrying)</p>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#8892a0', fontSize: 11, letterSpacing: '0.08em' }}>
            <th style={th}>REG</th><th style={th}>TYPE</th><th style={th}>STATE</th>
            <th style={th}>ALT</th><th style={th}>SPD</th><th style={th}>AGE</th><th style={th}>POSITION (live)</th>
          </tr>
        </thead>
        <tbody>
          {(snapshot?.aircraft ?? []).map((a: DashboardAircraft) => {
            const p = interpolatedPosition(a)
            return (
              <tr key={a.registration} style={{ borderTop: '1px solid #1c2230' }}>
                <td style={td}><strong>{a.registration}</strong></td>
                <td style={{ ...td, color: '#8892a0' }}>{a.description}</td>
                <td style={td}><Chip state={a.state} /></td>
                <td style={td}>{fmt(a.altitudeMetres, 0, ' m')}</td>
                <td style={td}>{fmt(a.groundSpeedKt, 0, ' kt')}</td>
                <td style={td}>{a.positionAgeSeconds === null ? '—' : `${Math.round(a.positionAgeSeconds)}s`}</td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: a.state === 'live_airborne' ? '#00d4ff' : '#8892a0' }}>
                  {p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 20, padding: 12, border: '1px solid #1c2230', borderRadius: 6 }}>
        <button onClick={shareLocation} style={{ ...btn, borderColor: '#00d4ff', color: '#00d4ff' }}>
          Share my location for proximity alerts
        </button>
        <p style={{ color: '#8892a0', fontSize: 12, marginTop: 8 }}>{locStatus}</p>
        <p style={{ color: '#5b6472', fontSize: 11, marginTop: 4 }}>
          Alerts are opt-in. “No signal” means only that tracking telemetry wasn’t received — it does not indicate any incident.
        </p>
      </div>

      <h2 style={{ fontSize: 13, letterSpacing: '0.1em', color: '#8892a0', marginTop: 24 }}>YOUR RECENT ALERTS</h2>
      {events.length === 0 ? <p style={{ color: '#5b6472', fontSize: 12 }}>None yet.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, fontSize: 12 }}>
          {events.slice(0, 20).map((e, i) => (
            <li key={i} style={{ padding: '6px 0', borderTop: '1px solid #1c2230', color: '#c3ccd8' }}>
              <span style={{ color: '#8892a0' }}>{new Date(e.occurred_at).toLocaleString()} · {e.event_type}</span><br />{e.message}
            </li>
          ))}
        </ul>
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0A0B0D', color: '#e6ebf2', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '24px 16px', maxWidth: 900, margin: '0 auto' }}>
      {children}
    </div>
  )
}

function AuthForm({ onAuthed }: { onAuthed: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.message ?? d.error ?? 'Failed'); return }
      onAuthed()
    } catch { setErr('Network error') } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 360, margin: '10vh auto' }}>
      <h1 style={{ fontSize: 18, letterSpacing: '0.1em' }}>VP·OVERWATCH</h1>
      <p style={{ color: '#8892a0', fontSize: 12 }}>{mode === 'login' ? 'Sign in' : 'Create an account'} to view tracked aircraft.</p>
      <input type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} autoComplete="email" />
      <input type="password" required placeholder="password (min 10 chars)" value={password} onChange={(e) => setPassword(e.target.value)} style={input} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
      {err && <p style={{ color: '#FF4757', fontSize: 12 }}>{err}</p>}
      <button type="submit" disabled={busy} style={{ ...btn, width: '100%', borderColor: '#00d4ff', color: '#00d4ff' }}>
        {busy ? '…' : mode === 'login' ? 'Sign in' : 'Register'}
      </button>
      <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} style={{ ...btn, width: '100%', marginTop: 8, border: 'none', color: '#8892a0' }}>
        {mode === 'login' ? 'Need an account? Register' : 'Have an account? Sign in'}
      </button>
    </form>
  )
}

const btn: React.CSSProperties = { background: 'transparent', border: '1px solid #2a3242', color: '#e6ebf2', borderRadius: 4, padding: '8px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }
const input: React.CSSProperties = { display: 'block', width: '100%', boxSizing: 'border-box', background: '#12151b', border: '1px solid #2a3242', color: '#e6ebf2', borderRadius: 4, padding: '10px 12px', margin: '8px 0', fontFamily: 'inherit' }
const th: React.CSSProperties = { padding: '6px 8px' }
const td: React.CSSProperties = { padding: '8px' }
