'use client'

/**
 * TermsGate — the entry notice shown before someone uses the map.
 *
 * Summarises the legal position in plain language and requires an explicit
 * acknowledgement before the map is usable. The full text lives at /terms and is
 * always linked from the bottom-left corner afterwards, so the notice stays
 * reachable rather than being a one-time thing nobody can find again.
 *
 * Acknowledgement is stored in localStorage against TERMS_VERSION. Bump that
 * string whenever the terms change materially and everyone is asked again.
 *
 * Deliberately not dismissable with Escape or a backdrop click: the whole point
 * is an explicit acknowledgement. Anyone who disagrees can simply leave.
 */
import { useEffect, useRef, useState } from 'react'

/** Bump to re-prompt every visitor after a material change to the terms. */
export const TERMS_VERSION = '2026-09-15'
const STORAGE_KEY = 'vp-terms-accepted'

type GateState = 'unknown' | 'pending' | 'accepted'

export function TermsGate() {
  const [state, setState] = useState<GateState>('unknown')
  const acceptRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    try {
      setState(localStorage.getItem(STORAGE_KEY) === TERMS_VERSION ? 'accepted' : 'pending')
    } catch {
      // Storage unavailable (private mode, blocked cookies): show the notice.
      setState('pending')
    }
  }, [])

  useEffect(() => {
    if (state === 'pending') acceptRef.current?.focus()
  }, [state])

  const accept = () => {
    try { localStorage.setItem(STORAGE_KEY, TERMS_VERSION) } catch { /* best effort */ }
    setState('accepted')
  }

  // Before we know, render nothing — avoids flashing the gate at returning users.
  if (state === 'unknown') return null

  return (
    <>
      {state === 'pending' && (
        <div className="vp-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="vp-terms-title">
          <div
            className="vp-modal"
            style={{ width: 'min(540px, calc(100vw - 24px))', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="vp-modal-header" style={{ flexShrink: 0 }}>
              <div className="vp-modal-title" id="vp-terms-title">BEFORE YOU USE THIS SITE</div>
              <div className="vp-modal-subtitle">Public awareness · independent · not an official source</div>
            </div>

            <div className="vp-modal-body" style={{ overflowY: 'auto', flex: 1 }}>
              <p style={{ fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.8)', margin: '0 0 14px' }}>
                VP-Overwatch is an <strong>independent community project</strong>. It republishes aircraft and traffic
                data that is <strong>already publicly broadcast</strong>, so people in Victoria can see what police
                aircraft are doing above their state. That is its entire purpose.
              </p>

              <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderLeft: '3px solid #3b82f6', borderRadius: 6, padding: '12px 14px', background: 'rgba(59,130,246,0.06)', marginBottom: 14 }}>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.8)' }}>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Not affiliated with Victoria Police</strong> or any government agency, emergency service, or
                    aircraft operator. Nothing here is official information.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>It can be wrong.</strong> Positions may be delayed, missing, or out by hundreds of metres, and
                    aircraft can be misidentified. Do not use it for navigation, safety, or anything that matters.
                  </li>
                  <li style={{ marginBottom: 8 }}>
                    <strong>Use it lawfully.</strong> Not to harass or locate anyone, not to interfere with or evade
                    police or emergency operations, and not for any offence. Access is rate-limited and may be withdrawn.
                  </li>
                  <li>
                    <strong>Your privacy.</strong> No account needed. Location is asked for only with your permission, and
                    for anonymous visitors it is coarsened to roughly 110 m before being stored — used only to centre the
                    map&apos;s data lookups.
                  </li>
                </ul>
              </div>

              <p style={{ fontSize: 12, lineHeight: 1.6, color: 'rgba(255,255,255,0.5)', margin: '0 0 4px' }}>
                Full detail — acceptable use, data accuracy, community submissions, privacy, liability and jurisdiction
                (Victoria, Australia):
              </p>
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: '#3b82f6' }}
              >
                Read the full terms of use →
              </a>
            </div>

            <div className="vp-modal-footer" style={{ flexShrink: 0 }}>
              <button className="vp-modal-submit" onClick={accept} ref={acceptRef} style={{ width: '100%' }}>
                I understand — continue to the map
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Always-available link, so the notice is reachable after accepting. */}
      <a
        href="/terms"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          position: 'fixed', left: 8, bottom: 6, zIndex: 90,
          fontFamily: "'Space Mono', monospace", fontSize: 9, letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.35)', textDecoration: 'none',
        }}
      >
        TERMS
      </a>
    </>
  )
}
