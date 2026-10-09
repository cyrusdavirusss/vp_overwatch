/**
 * Real 3D aircraft for the Overwatch tracking view.
 *
 * WHY THIS EXISTS. The tracking view sits ABEAM a contact at a shallow pitch, which is a
 * genuine side elevation — and a flat SVG cannot be one. Every hand-drawn side profile
 * shipped here has been judged "still reads as birdseye" or "reads as a generic twin",
 * because a 2D glyph drawn for a tilted camera has to fake the geometry the camera is
 * actually showing. `gods-eye-view` solves the same problem the honest way: it draws the
 * real glTF airframe whenever the camera is close enough to see it, and falls back to a
 * flat billboard when it is not. This is that idea, scoped to the one view that needs it.
 *
 * THE MODELS are gods-eye-view's own, copied verbatim (CC BY 4.0 — see
 * `public/models/NOTICES.md`). They are metre-scale, glTF +Y-up, origin centred.
 *
 * ORIENTATION IS NOT UNIFORM, and assuming it is, is the classic bug here. gods-eye-view's
 * own README says every airframe is "nose −X", but measured against each type's published
 * span and length, both meshes here carry their FUSELAGE ALONG Z and disagree about which
 * way the nose points. So the axis and the sign are per-model data below, and they were
 * measured rather than assumed (citation2 15.8 x 14.9 against a real 15.9 m span / 14.4 m
 * length; bell206's nose verified visually against a labelled axis helper).
 *
 * WHERE IT IS DRAWN. The canvas is a child of the marker root, NOT of the `.rot` wrapper,
 * and it counter-rotates the map's own bearing. That is deliberate: the map rotates every
 * marker by −bearing, so a canvas that wants to show the world the way the map's camera
 * sees it has to cancel that first. The renderer then reproduces the map camera exactly —
 * same azimuth, same elevation, up = world up — so the airframe sits in the same
 * perspective as the terrain under it instead of being pasted on flat.
 */

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type Aircraft3DRole = 'rotary' | 'fixedwing'

interface ModelSpec {
  url: string
  /**
   * Sign of the axis the NOSE points along, on the model's own X axis.
   *
   * MEASURED, not assumed, and getting it wrong is not subtle: it renders the aircraft
   * END-ON, so the "side elevation" shows the contact's tail. gods-eye-view's README says
   * every mesh is "nose −X" and for once the documentation is right — but their own code
   * carries per-class offsets, so the axis is treated as data here rather than trust.
   *
   * How both values below were established, since a render of the wrong one still looks
   * like a plausible aircraft:
   *   - the height profile along X is ASYMMETRIC and along Z is SYMMETRIC, so the fuselage
   *     runs on X and Z is the span (or rotor diameter);
   *   - at the −X end the cross-section is small and there is no fin; at +X it is tall and
   *     thin (bell206's highest vertices all sit at x ≈ +5.7) — that is the fin and tail
   *     rotor. So −X is the nose.
   * If a replacement mesh is fuselage-on-Z, this is the number to revisit.
   */
  nose: 1 | -1
  /** What the file actually is, for the credit line and for honest reporting. */
  label: string
}

/**
 * Per-role airframe. The fixed wing is a Citation II, chosen as the CLOSEST AVAILABLE
 * silhouette and NOT as a correct one: it is a low-wing business twin with a T-tail, which
 * is the King Air's planform, but its engines are jets. gods-eye-view has no King Air, so
 * this is a stand-in until a real 350 mesh is dropped in — replacing the entry below is the
 * whole integration.
 */
const MODELS: Record<Aircraft3DRole, ModelSpec> = {
  rotary: { url: '/models/bell206.glb', nose: -1, label: 'Bell 206 JetRanger' },
  fixedwing: { url: '/models/citation2.glb', nose: -1, label: 'Cessna Citation II (King Air stand-in)' },
}

const FOV = 30
/** Minimum gap between WebGL draws. 20 fps; see the note in render(). */
const RENDER_MIN_MS = 50
/** Fraction of the frame the airframe fills, leaving headroom for the model's full extent. */
const FILL = 0.82
const DPR = 2

const loader = new GLTFLoader()
const cache = new Map<string, Promise<THREE.Group>>()

function loadModel(spec: ModelSpec): Promise<THREE.Group> {
  const hit = cache.get(spec.url)
  if (hit) return hit
  const p = loader.loadAsync(spec.url).then((g) => {
    g.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.frustumCulled = false
        const mat = m.material as THREE.MeshStandardMaterial
        if (mat) {
          // The map is near-black and the models ship unlit-ish; lift the ambient response
          // so an airframe never renders as a silhouette against the satellite ground.
          mat.envMapIntensity = 0.6
        }
      }
    })
    return g.scene
  })
  cache.set(spec.url, p)
  return p
}

/** What the renderer needs from the map, per frame. */
export interface Aircraft3DFrame {
  /** Map bearing, degrees. The direction that is UP the screen. */
  bearingDeg: number
  /** Map pitch, degrees. 0 = straight down. */
  pitchDeg: number
  /** Contact heading, degrees true. */
  headingDeg: number
}

export interface Aircraft3DView {
  canvas: HTMLCanvasElement
  /** Attach the canvas at a known on-screen size and start looking right. */
  render: (frame: Aircraft3DFrame) => void
  dispose: () => void
}

/**
 * Build a view for one airframe. Resolves once the mesh is loaded; the canvas exists
 * immediately so the caller can mount it without waiting.
 */
export async function createAircraft3D(role: Aircraft3DRole): Promise<Aircraft3DView> {
  const spec = MODELS[role]
  const source = await loadModel(spec)
  const model = source.clone(true)

  const canvas = document.createElement('canvas')
  canvas.className = 'vp-ac-3d'
  canvas.width = 512
  canvas.height = 512

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(DPR)
  renderer.setSize(512 / DPR, 512 / DPR, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const scene = new THREE.Scene()
  scene.add(model)

  // Held on the camera's own frame below, so the airframe is lit from the upper-left of the
  // SCREEN whatever the map bearing is. Fixed world-space lights would leave a north-facing
  // contact in shadow at some bearings and blown out at others.
  const hemi = new THREE.HemisphereLight(0xdfe8f5, 0x1a2028, 1.25)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(0xffffff, 2.1)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x9fd0ff, 0.85)
  scene.add(rim)

  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  const centre = new THREE.Vector3()
  box.getCenter(centre)
  // Fit the FRAME to the airframe's longest horizontal axis, not to its bounding sphere.
  // A sphere fit is bearing-independent but far too loose on a long, thin aircraft: it
  // measures the diagonal, so a 15.8 m aeroplane rendered into a square frame occupied
  // barely half its width. The extent can never exceed the longest axis in ANY rotation,
  // so using it directly is safe as well as tighter.
  const radius = Math.max(size.x, size.z, size.y) / 2

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, radius * 200)
  const dist = (radius / FILL) / Math.tan((FOV * Math.PI / 180) / 2)

  const D2R = Math.PI / 180
  /** World direction for a compass azimuth (0 = north), in three's X-east / −Z-north frame. */
  const dir = (az: number, v: THREE.Vector3) => v.set(Math.sin(az), 0, -Math.cos(az))

  const tmpUp = new THREE.Vector3()
  const tmpOut = new THREE.Vector3()
  const tmpRight = new THREE.Vector3()
  let lastCss = 0
  let lastDrawMs = 0

  const render = (frame: Aircraft3DFrame) => {
    // 20 fps, not the display rate. The airframe is a small object on a moving map and the
    // ground underneath it is what carries the sense of motion, so a full WebGL render every
    // frame bought nothing visible and cost real time in the app's worst-measured path. The
    // caller still updates the canvas transform every frame, so the airframe's on-screen
    // rotation stays smooth even though its shading refreshes at 20 Hz.
    const nowMs = performance.now()
    if (nowMs - lastDrawMs < RENDER_MIN_MS) return
    lastDrawMs = nowMs

    const bearing = frame.bearingDeg
    const elevation = (90 - frame.pitchDeg) * D2R

    // Match the backing store to the CSS size the stylesheet actually gives the canvas —
    // the frame is `clamp(150px, 46vmin, 460px)` so it is viewport-relative, and a fixed
    // backing store would either blur on a big screen or waste fill on a small one.
    const css = Math.round(canvas.clientWidth)
    if (css > 0 && css !== lastCss) {
      lastCss = css
      renderer.setPixelRatio(DPR)
      renderer.setSize(css, css, false)
    }

    // The map's screen-up is the world azimuth equal to the bearing.
    dir(bearing * D2R, tmpUp)
    // Screen-out is up x world-up, which gives the camera's horizontal offset direction.
    tmpRight.copy(tmpUp).cross(new THREE.Vector3(0, 1, 0)).normalize()
    tmpOut.copy(tmpRight).cross(tmpUp).normalize()

    camera.position.copy(tmpUp).multiplyScalar(-dist * Math.cos(elevation))
    camera.position.addScaledVector(new THREE.Vector3(0, 1, 0), dist * Math.sin(elevation))
    camera.up.set(0, 1, 0)
    camera.lookAt(0, 0, 0)

    // Nose onto the contact's heading. Rotating about Y maps the model's own forward axis
    // onto the wanted compass direction; the sign flips with which way the mesh's nose
    // points, which is why it is per-model data and not a constant.
    const h = frame.headingDeg * D2R
    model.rotation.y = spec.nose === -1 ? (-Math.PI / 2 - h) : (Math.PI / 2 - h)
    model.position.set(-centre.x, -centre.y, -centre.z)

    // Key and rim in the camera's frame: up-left of the screen, and behind-right.
    key.position.copy(camera.position)
      .addScaledVector(tmpUp, dist * 0.9)
      .addScaledVector(tmpRight, -dist * 0.9)
      .addScaledVector(new THREE.Vector3(0, 1, 0), dist * 0.7)
    rim.position.copy(camera.position)
      .addScaledVector(tmpUp, -dist * 0.5)
      .addScaledVector(tmpRight, dist * 1.1)

    renderer.render(scene, camera)
  }

  return {
    canvas,
    render,
    dispose: () => {
      renderer.dispose()
      scene.remove(model)
      canvas.remove()
    },
  }
}
