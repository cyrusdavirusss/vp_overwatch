/**
 * What's New — the release notes this build shows, and the flag that says whether
 * the operator has already read them.
 *
 * Kept out of the components so the notes are data: adding a release is an entry
 * here plus a version bump, with no UI change.
 *
 * The SEEN flag is keyed by version, so bumping WHATS_NEW_VERSION makes the flag
 * appear again for everyone on their next open — which is the point of a release
 * flag. It is device-local (localStorage), not an account setting: this app has no
 * account to hang it on, and a read receipt is not worth a round trip.
 */

/** Bump this whenever WHATS_NEW gains an entry. */
export const WHATS_NEW_VERSION = '2026-10-overwatch'

export interface WhatsNewEntry {
  /** Short label, rendered in mono caps. */
  title: string
  /** One or two sentences: what it is and how it behaves. */
  body: string
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    title: 'OVERWATCH',
    body:
      'A new orbit view for a ground unit. Select a police unit or a speed camera, then launch Overwatch: the map centres on its reported position, tilts to a low angle and sweeps a slow circle around it, so you can read the ground it is sitting on from every direction. A full circle takes about a minute, and you can still pan and zoom while it runs.',
  },
  {
    title: 'HOLLOW MODELS',
    body:
      'While Overwatch is open, a hollow model of the unit stands on its mark — a patrol car for a police unit, a fixed camera for a speed camera, and a helicopter for a helicopter sighting. The models are drawn as translucent outlines, so the ground stays readable through them.',
  },
  {
    title: 'SATELLITE GROUND',
    body:
      'Overwatch switches the map to satellite imagery for as long as it is open, because the vector views flatten the ground the view exists to look at. Whatever basemap you were on comes back when you close it.',
  },
  {
    title: 'AR SKY MOVED',
    body:
      'AR Sky now sits in the map control cluster alongside the other view controls, instead of a button of its own in the corner.',
  },
  {
    title: 'CLEANER EXIT',
    body:
      'Closing Overwatch flattens the camera and returns it to north, leaving you where you were looking. If there are no ground contacts to orbit, the launch control is disabled and says so rather than doing nothing.',
  },
  {
    title: 'HARDENING',
    body:
      'Stricter security headers, a newer framework release with its known advisories cleared, and a published credential removed from the repository.',
  },
]

const STORAGE_KEY = `vp-whats-new-seen:${WHATS_NEW_VERSION}`

/**
 * Has this device already shown these notes?
 *
 * Returns TRUE when storage is unavailable — a browser with localStorage blocked
 * (private mode, hardened settings) should not be shown the release flag on every
 * single open, and "already seen" is the quieter failure of the two.
 */
export function hasSeenWhatsNew(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return true
  }
}

/** Record that the notes have been shown. Silent when storage is unavailable. */
export function markWhatsNewSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, '1')
  } catch {
    /* no storage: the flag simply reappears next open, which is harmless */
  }
}
