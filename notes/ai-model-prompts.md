# 3D aircraft prompts for an AI mesh generator

Two jobs. Everything here is written so the result drops straight into
`Tactical/public/models/` and the only code change needed is the file name.

Target generators: Meshy, Tripo, Rodin (Hyper3D), Luma Genie, Hunyuan3D, TRELLIS.
All of them take a *description*, not a spec sheet — so each prompt is in two parts:
a description to paste as-is, and a technical block to keep for whoever/whatever
post-processes the export.

---

## 1. PRIMARY — Beechcraft King Air 350ER (replaces the Citation II stand-in)

### Paste this into the generator

```
A Beechcraft King Air 350ER twin turboprop aircraft, side-on three-quarter view,
in flight with landing gear fully retracted. Low-mounted straight wing, two
PT6A turboprop engines in long nacelles slung under the wing with the nacelles
extending well forward of the wing leading edge, each driving a four-blade
propeller. Distinctive T-tail: the horizontal stabiliser is mounted at the very
top of the swept vertical fin, not partway down. Long pressurised fuselage with a
rounded nose, a swept windscreen, a row of small round cabin windows, and a
pencil-thin tail cone. White upper fuselage with a dark blue flash along the
lower fuselage, dark blue tail fin with a white stripe. Clean, untextured-looking
low-poly game asset, hard-edged panel lines, no landing gear, no weapon pylons,
no radar dome. Neutral pose, wings level, nose clear of the tail, engine
propellers modelled as four separate blades in a static position.
```

### Keep this for the export step

| Requirement | Value | Why |
|---|---|---|
| Format | `.glb` (single self-contained binary glTF) | The loader is `GLTFLoader.loadAsync()`; no sidecar `.bin`/textures |
| Up axis | Y-up | three.js default |
| Nose axis | −Z **or** +Z — say which | The code has a per-model `nose` sign; it is measured, not assumed |
| Origin | Bounding-box centre at (0,0,0) | The renderer re-centres, but a centred origin avoids a scale surprise |
| Scale | Real-world **metres** (length ≈ 14.2 m, span ≈ 17.7 m, tail height ≈ 4.4 m) | The renderer fits by bounding sphere, so scale only matters for honesty |
| Triangles | 15k–40k | It is drawn once, at up to ~460 px — but it is a browser |
| Textures | PBR base-colour / metallic-roughness / normal, each ≤ 1024 px, embedded | |
| Gear | **Retracted / absent** — this is an in-flight view only | A parked reference photo has gear down; that is the detail NOT to copy |
| Materials | Named, and ideally a single shared material per airframe | A future pass tints the airframe by status |
| Props | Four blades per engine, modelled as separate blades | They read as a propeller only if they are geometry, not texture |

### What killed the hand-drawn version — do not repeat it

The SVG side profile shipped twice and failed both times for the same reason: at
the size it is drawn, a **second engine is invisible in a true side view**, because
the far nacelle hides behind the fuselage. Drawing a second one at the same size
made it read as a four-engine aircraft. A real mesh does not have this problem —
the far nacelle and its propeller are simply *there*, in perspective. That is the
entire reason for going 3D.

---

## 2. SECONDARY — the rotary airframes

The current mesh (a Bell 206 JetRanger) reads correctly as a helicopter but it is a
light single-turbine type. The role's airframes are heavier. Two options, in order
of how much it would improve the view:

**A. Sikorsky UH-60 Black Hawk** — what `lib/markers.ts` already documents the role as.

```
A Sikorsky UH-60 Black Hawk military utility helicopter, side-on three-quarter
view, in flight with wheels retracted. Slab-sided box cabin with a flat raked
windscreen and a blunt nose, large sliding door on the side, big rectangular
cabin window aft of a smaller cockpit window. Long tail boom that rises steadily
aft into a tall angular vertical pylon, with a four-blade tail rotor mounted high
on the pylon and a stabilator across the boom root. Four-blade main rotor seen
side-on as a shallow coned disc. Two turboshaft engines in faired cowlings on the
cabin roof behind the rotor mast. Dark olive-drab scheme. Low-poly game asset,
hard panel lines, no external stores, no door gunners, no radar dome.
```

**B. Leonardo AW139** — the medium twin the police actually operate most of (POL30/POL31).

```
A Leonardo AW139 medium twin-engine helicopter, side-on three-quarter view, in
flight. Sleek rounded nose with a large wraparound windscreen and a long row of
big cabin windows, deep glazed cockpit. Long tapering tail boom into a swept
vertical fin with a four-blade tail rotor. Five-blade main rotor seen side-on as
a shallow coned disc. Two turboshaft engines in a low fairing on the cabin roof
behind the rotor mast. Skid landing gear, two struts per side. White and dark blue
police scheme with no lettering. Low-poly game asset, hard panel lines, no
external stores, no FLIR ball, no searchlight.
```

### Same technical block as above, plus

- **Main rotor**: five blades for the AW139, four for the UH-60. The renderer draws
  the rotor as static geometry in the disc plane, so blade count is a visible
  identifier — get it right.
- **Livery**: **no lettering, no roundels, no unit markings.** Text baked into a
  texture becomes garbage at the size it is drawn, and it is the one thing that
  makes a generated asset look generated.

---

## 3. How to check what you got back, before handing it over

The two things that have already gone wrong with third-party meshes:

```bash
# Is it really self-contained, and how big?
gltf-transform inspect model.glb      # or: npx @gltf-transform/cli inspect model.glb

# Which axis is the fuselage actually on? Do NOT trust the README.
# Measured against published dimensions: a Citation II is 14.4 m long with a
# 15.9 m span, and the shipped mesh measured 15.8 (x) x 14.9 (z) — so the
# fuselage runs along Z, not X, whatever the documentation claimed.
```

Then confirm the nose direction by eye against a labelled axis helper
(`THREE.AxesHelper`, red +X, green +Y, blue +Z) rendered from a known camera. It is
a two-minute check and it is the difference between an aircraft that flies
forwards and one that flies tail-first.
