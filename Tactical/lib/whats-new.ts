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
export const WHATS_NEW_VERSION = '2026-10-rotational-view-2'

export interface WhatsNewEntry {
  /** Short label, rendered in mono caps. */
  title: string
  /** One or two sentences: what it is and how it behaves. */
  body: string
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    title: 'ROTATIONAL SATELLITE VIEW',
    body:
      'A new way to see where a ground unit actually is. Select a police unit or a speed camera and launch Overwatch: the map switches to satellite imagery, tilts down to a shallow angle so you are looking ACROSS the ground instead of straight down at it, and slowly sweeps a full circle around the unit — about a minute per revolution.',
  },
  {
    title: 'WHY IT TURNS',
    body:
      'A flat, top-down map hides everything that explains a position: which way a camera actually faces, what stands between a car and the road, how the ground falls away around it. Turning the view through a full circle at a low angle shows you each of those in turn, so you can work out what the unit can see and what it cannot. It only drives the bearing, so you can pan and zoom the whole time without fighting it for the camera.',
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
    title: 'HELICOPTERS HOLD STEADY',
    body:
      'A helicopter no longer turns its nose to follow its track while it moves. The rotor keeps spinning and its sensor cone keeps sweeping, but the airframe itself stays put — at a three-second refresh the heading is noisy, and a contact that wheeled around on every update read as twitchy rather than informative. Position and the sensor cone are the things worth watching.',
  },
  {
    title: 'THE SAME BAR EVERYWHERE',
    body:
      'The top bar is now identical on every device and every screen size. It no longer drops counters on a small screen or crowds them on a large one, and it always fits the width it is given, so the same information is in the same place whether you are on a phone, a tablet or a desktop.',
  },
  {
    title: 'LANDSCAPE KEEPS THE CONTROLS',
    body:
      'Turning your phone sideways no longer clears the interface away. The header, the ON AIR strip, the control cluster and the status bar all stay on screen at half size, so the map still gets its room while everything else stays within reach. The map itself, and the units sitting on it, keep their full size.',
  },
  {
    title: 'OVERWATCH ON AIRCRAFT',
    body:
      'Overwatch can now open on an aircraft as well as a ground unit. Pick a contact, launch it, and the view holds a fixed bearing and tracks the aircraft as it travels, on the same satellite ground. It deliberately does not rotate: a helicopter is already moving, and circling something in motion just means chasing it. The button tells you which of the two it will do.',
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
