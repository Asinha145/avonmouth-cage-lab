# Datum System — Avonmouth Cage Lab

> Reference document for understanding how datum detection, coordinate mapping, layer datums,
> and coupler plate 3D placement all work. Read this before touching any datum, axis, or
> coordinate-related code.

---

## 1. Coordinate Systems

There are **two** coordinate systems in play at all times.

### 1A — IFC Coordinates (millimetres)
What the IFC parser reads. All bar endpoints (`Start_X/Y/Z`, `End_X/Y/Z`) are in IFC mm.

```
IFC-X = east–west (horizontal)
IFC-Y = north–south (horizontal, also wall depth axis)
IFC-Z = vertical (height)
```

### 1B — Engine Coordinates (metres, Y-up)
What Three.js / web-ifc uses in the 3D viewer. Converted at load time:

```
engine_X = IFC_X / 1000
engine_Y = IFC_Z / 1000    ← always vertical (height), regardless of cageAxisName
engine_Z = -IFC_Y / 1000   ← sign flip: IFC-Y increases into wall, engine-Z decreases
```

**Rule:** Never use raw IFC mm in viewer3d.js. Never use engine metres in parser/DXF logic.

---

## 2. Face Separation Axis (`sepAxis`)

**Function:** `_detectFaceSepAxis()` in `main.js`

The key question: *which IFC axis is perpendicular to the cage face plane?*

- Face bars in a single layer (e.g. F1A) all share roughly the same coordinate on the **sep axis**
  (they are in the same plane) but spread wide on the **length axis**.
- Detection: compute the within-layer range on IFC-X and IFC-Y for all face layers.
  The axis with the **smallest** max range is the sep axis.

| `sepAxis` | Face plane perpendicular to | Typical cage type |
|---|---|---|
| `'x'` | IFC-X | Wall cage, face runs in IFC-Y direction |
| `'y'` | IFC-Y | Wall cage, face runs in IFC-X direction |
| `'z'` | IFC-Z | Slab cage (T/B layers only, no F/N) |

**Slab short-circuit:** if the IFC file has T/B layers but no F/N layers → return `'z'` immediately.

**Diagonal detection:** if `min(xMaxRange, yMaxRange) > 500mm` → cage is diagonal → C01 rejected.
See `_isCageDiagonal()` in Section 8.

---

## 3. Cage Datum (`_cageDatum`)

**Function:** `_cageDatum()` in `main.js`

The datum defines `(px=0, pz=0)` — the bottom-left corner of the outer formwork face.
All DXF face-view coordinates and template coordinates are relative to this point,
so both DXF files overlay exactly in AutoCAD.

```
datumPx  =  min of the "long axis" IFC coordinate across all F1A / N1A / T1A / B1A bars
datumPz  =  min IFC-Z across all F1A / N1A / T1A / B1A bars  (= bottom of cage)
```

Which IFC axis is `datumPx`?

| `sepAxis` | `datumPx` axis | `datumPz` axis |
|---|---|---|
| `'x'` | IFC-Y (wall length runs in Y) | IFC-Z |
| `'y'` | IFC-X (wall length runs in X) | IFC-Z |
| `'z'` (slab) | IFC-X | IFC-Y |

**Important:** Only outermost face layers (regex `^[FNTB]1A$`) are used.
Inner layers (F3A, N5A, etc.) can extend slightly beyond the formwork face and would
shift the datum incorrectly.

---

## 4. Face-to-2D Coordinate Mapping (px / pz)

Used in `exportCombinedFaceDXF()` and `_computePlate3DBoxes()`. Both must use identical logic.

```javascript
const zSpan   = max(hole.zMm) - min(hole.zMm);
const useY    = zSpan < 100;               // slab detection: face is horizontal, Z barely changes
const useLongY = sepAxis === 'x' && !useY; // wall w/ sepAxis=x: length runs in IFC-Y
```

Then per hole:
```javascript
px = useLongY ? hole.yMm - datumPx : hole.xMm - datumPx
pz = (useY   ? hole.yMm : hole.zMm) - datumPz
```

Full table:

| `sepAxis` | `useY` | `useLongY` | `px` source | `pz` source |
|---|---|---|---|---|
| `'x'` | false (wall) | true  | `IFC-Y − datumPx` | `IFC-Z − datumPz` |
| `'y'` | false (wall) | false | `IFC-X − datumPx` | `IFC-Z − datumPz` |
| `'z'` | true (slab)  | false | `IFC-X − datumPx` | `IFC-Y − datumPz` |

**If these equations differ between DXF and 3D boxes → plates will appear offset in the viewer.**

---

## 5. px/pz → Engine 3D Conversion

Used in `_computePlate3DBoxes()` to position plates in the BREP viewer.

```
sepAxis = 'x'  (face ⊥ IFC-X):
    engine-x = IFC-X / 1000             ← face plane constant (thickness axis)
    engine-y = (datumPz + pz) / 1000    ← height
    engine-z = -(datumPx + px) / 1000   ← length (IFC-Y → engine-Z with sign flip)
    box size: sx = THICK, sy = pzSize/1000, sz = pxSize/1000

sepAxis = 'y'  (face ⊥ IFC-Y):
    engine-x = (datumPx + px) / 1000    ← length
    engine-y = (datumPz + pz) / 1000    ← height
    engine-z = -IFC-Y / 1000            ← face plane constant (thickness axis)
    box size: sx = pxSize/1000, sy = pzSize/1000, sz = THICK

sepAxis = 'z'  (slab, face ⊥ IFC-Z):
    engine-x = (datumPx + px) / 1000    ← IFC-X direction
    engine-y = IFC-Z / 1000             ← face plane constant (thickness axis)
    engine-z = -(datumPz + pz) / 1000   ← IFC-Y direction with sign flip
    box size: sx = pxSize/1000, sy = THICK, sz = pzSize/1000
```

`THICK = 10 / 1000 metres` (10mm plate thickness).

---

## 6. Layer Datum Markers (`_computeLayerDatums`)

**Function:** `_computeLayerDatums()` in `main.js`
**Viewer call:** `viewer3d.setLayerDatumMarkers(results)` → orange spheres

Each face mesh layer (F1A, F3A, N1A, N3A, T1A, B1A, …) gets one orange datum marker
at the **nearest VS/HS bar crossing** — i.e. where the innermost vertical and horizontal
grid bars cross near the datum corner.

### 6A — Bar Splitting per layer

Bars must be split into two perpendicular groups (VS = vertical/y-running, HS = horizontal/x-running):

| `sepAxis` | VS group | HS group | VS position axis | HS position axis |
|---|---|---|---|---|
| `'x'` | `Orientation === 'Vertical'` | `Orientation === 'Horizontal'` | `mid(b, 'Y')` (IFC-Y) | `mid(b, 'Z')` (IFC-Z) |
| `'y'` | `Orientation === 'Vertical'` | `Orientation === 'Horizontal'` | `mid(b, 'X')` (IFC-X) | `mid(b, 'Z')` (IFC-Z) |
| `'z'` (slab) | `\|Dir_Y\| > \|Dir_X\|` | `\|Dir_X\| > \|Dir_Y\|` | `mid(b, 'X')` (IFC-X) | `mid(b, 'Y')` (IFC-Y) |

**Slab note:** All slab bars have `Orientation='Horizontal'` — cannot use Orientation to split.
Must use `Dir_Y` vs `Dir_X` dominance instead.

### 6B — Grid bar filtering

Drop bars shorter than 50% of group median — removes bent end bars, hairpins, U-bars that
don't span the full mesh face and would bias the datum inward.

### 6C — Stagger cluster grouping

Bars with the same `Stagger_Cluster_ID` are grouped and their positions averaged.
This prevents double-counting stagger pairs and ensures the datum sits on the bar centreline,
not offset to one of the stagger positions.

### 6D — Nearest unit selection

`nearestV` = cluster with minimum VS position (min IFC-Y or IFC-X depending on axis)
`nearestH` = cluster with minimum HS position (always min IFC-Z for walls; min IFC-Y for slabs)

### 6E — Face coordinate

Averaged `Start_X / End_X` (for sepAxis='x': IFC-X), or equivalent, across all bars in that
layer gives the face plane constant coordinate.

### 6F — Engine coordinate output

```
sepAxis = 'x':   ex = faceCoord/1000,  ey = hsPos/1000,   ez = -vsPos/1000
sepAxis = 'y':   ex = vsPos/1000,      ey = hsPos/1000,   ez = -faceCoord/1000
sepAxis = 'z':   ex = vsPos/1000,      ey = faceCoord/1000, ez = -hsPos/1000
```

Result pushed to: `[{ layer, ex, ey, ez }, ...]`

---

## 7. Red Datum Sphere (`_addDatumMarker`)

**Function:** `viewer3d._addDatumMarker()`
**Position:** `(totalBrepBbox.minX, totalBrepBbox.minY, totalBrepBbox.maxZ)` in engine coords

Why `maxZ`? Because `engine-Z = -IFC_Y / 1000` — the minimum IFC-Y (datum start of cage)
maps to the **maximum** engine-Z.

This sphere marks the global cage origin (bottom corner of the cage), derived from the
BREP bounding box — not the IFC parser. It does not depend on barMap or couplerMap.

Size: `_sceneSize() × 0.004` — scales with the cage so it's always visible but not huge.

---

## 8. Diagonal Cage Detection (`_isCageDiagonal`)

**Function:** `_isCageDiagonal()` in `main.js`
**Wired in:** `displayResults()` — diagonal → C01 rejected, all export buttons hidden

Logic: for wall cages (F/N layers exist), compute the maximum within-layer spread on
both IFC-X and IFC-Y across all F/N face layers.

```
maxRange('x') = max across all face layers of (max IFC-X − min IFC-X within layer)
maxRange('y') = max across all face layers of (max IFC-Y − min IFC-Y within layer)
diagonal = min(maxRange('x'), maxRange('y')) > 500 mm
```

Threshold reasoning:
- Axis-aligned cage: tight axis ≈ 50–200mm (bar cover + tolerance)
- 45° diagonal: tight axis ≈ wall_length / √2 → thousands of mm
- 500mm gives headroom over any real measurement scatter in an aligned cage

Slab cages (T/B only, no F/N) are excluded — diagonal slab is out of scope.

---

## 9. End-to-End Data Flow

```
IFC file loaded
    │
    ├─► ifc-parser.js  →  allData[] (bars with IFC mm coords, Layer, Dir, Length, Weight…)
    │
    ├─► _detectFaceSepAxis()  →  'x' | 'y' | 'z'
    │
    ├─► _isCageDiagonal()     →  reject if diagonal
    │
    ├─► _cageDatum()          →  { datumPx, datumPz } in IFC mm
    │
    ├─► _computeLayerDatums() →  [{ layer, ex, ey, ez }] in engine metres
    │       └─► viewer3d.setLayerDatumMarkers()  →  orange spheres in 3D viewer
    │
    ├─► viewer3d._addDatumMarker()  →  red sphere at (minX, minY, maxZ) from BREP bbox
    │
    ├─► _parseIFCBeamHoles()       →  raw hole positions (IFC mm)
    │       └─► _bucketHolesByFace()  →  holes grouped by face layer
    │               └─► _computePlates()  →  VS/HS plate groups (2D px/pz)
    │                       └─► _computePlate3DBoxes()  →  [{ cx,cy,cz,sx,sy,sz }]
    │                               └─► viewer3d.setPlateBoxes()  →  blue/cyan solids
    │
    └─► exportCombinedFaceDXF()
            ├─► px/pz mapping (same equations as _computePlate3DBoxes)
            ├─► VS/HS face elevation bars
            ├─► coupler hole circles + numbering
            └─► plate schedule section per face
```

---

## 10. Known Issues / Bugs to Fix

### BUG-01 — `_cageDatum()` wrong `datumPz` for slab (`sepAxis='z'`)
*Status:* Pending fix

**Problem:** Line 1677 always uses `[b.Start_Z, b.End_Z]` for `pzVals` regardless of `sepAxis`.
For slabs, `pz` maps to IFC-Y (second horizontal axis), so `datumPz` must be `min IFC-Y`.
Current code gives `datumPz = min IFC-Z` (the elevation ≈ 27,388mm for RF35) instead of
`min IFC-Y` (≈ 6,208,400mm). Any coupler hole `pz = h.yMm - datumPz` is therefore ~6.18m off.

**Fix:** Branch `pzVals` on `sepAxis`:
```javascript
const pzVals = faceBars.flatMap(b =>
    sepAxis === 'z' ? [b.Start_Y, b.End_Y] : [b.Start_Z, b.End_Z]
).filter(v => v != null);
```

**Affected:** `_computePlate3DBoxes()`, `exportCombinedFaceDXF()` for slab cages.
Orange datum spheres (`_computeLayerDatums`) are **not** affected — they don't use `datumPz`.

### BUG-03 — Slab layer datum: stagger clustering collapsed all y-running bars to centroid
*Status:* **Fixed** — `main.js` `_computeLayerDatums()`, slab branch bypasses `groupBars()`

**Problem:** Parser assigns all y-running bars in a slab layer to a single `Stagger_Cluster_ID`
(they all run the full cage-axis span so they cluster at the same IFC-Y position). `groupBars()`
averaged all 31 B1A y-running bar IFC-X positions → centroid 2,026,572mm instead of first bar
2,023,558mm. Orange sphere appeared 3m inside the slab rather than at the datum corner.

**Fix:** For `sepAxis='z'`, use each bar individually: `vUnits = vBars.map(b => ({ pos: vPosFn(b) }))`.

---

### BUG-02 — Layers with only VS or only HS bars get no datum marker
*Status:* Known / by design — but worth documenting

**Observed cases:**
- P7349 **F5A / N5A**: 0 Vertical bars, 18 Horizontal only → no marker (skipped correctly)
- P406  **F3A**: 53 Vertical bars, 0 Horizontal → no marker (skipped correctly)

The `continue` path in `_computeLayerDatums()` is the correct response — do not fabricate a
crossing for a layer that has only one bar direction. If these layers need markers in future,
the fix is to establish a fallback position (e.g. project onto the F1A datum line), not to
cross-contaminate bars between layers.

---

## 11. Per-Layer Datum Isolation Rule

**Rule:** The orange datum sphere for each face layer is the nearest VS/HS bar crossing
computed **from that layer's bars only**.

| Layer | Bars used |
|---|---|
| F1A | F1A bars only |
| F3A | F3A bars only |
| N1A | N1A bars only |
| … | … |

Never include bars from another layer in a layer's datum calculation. If F3A bars are
mixed with F1A bars, the "nearest crossing" shifts to the F1A corner (which has different
grid positions), placing the F3A orange sphere at the wrong physical location.

The current `_computeLayerDatums()` loop correctly does:
```javascript
const bars = allData.filter(b => b.Avonmouth_Layer_Set === layer);
```
Any refactor of this function must preserve this per-layer isolation.

---

## 11. Quick Reference — Function Locations

| Function | File | Purpose |
|---|---|---|
| `_detectFaceSepAxis()` | `main.js` | Returns `'x'/'y'/'z'` — which axis face is perpendicular to |
| `_isCageDiagonal()` | `main.js` | Returns `true` if cage not axis-aligned → C01 reject |
| `_cageDatum()` | `main.js` | Returns `{ datumPx, datumPz }` in IFC mm |
| `_computeLayerDatums()` | `main.js` | Returns `[{ layer, ex, ey, ez }]` in engine metres |
| `_computePlate3DBoxes()` | `main.js` | Returns `[{ cx,cy,cz,sx,sy,sz,type,face }]` in engine metres |
| `exportCombinedFaceDXF()` | `main.js` | Generates face elevation + template DXF |
| `_parseIFCBeamHoles()` | `main.js` | Extracts coupler positions from raw IFC text |
| `_bucketHolesByFace()` | `main.js` | Groups holes by face layer name |
| `_computePlates()` | `main.js` | Groups holes into VS/HS plate groups |
| `setLayerDatumMarkers()` | `viewer3d.js` | Places orange spheres at layer datum crossings |
| `setPlateBoxes()` | `viewer3d.js` | Places blue/cyan plate solids in 3D scene |
| `_addDatumMarker()` | `viewer3d.js` | Places red datum sphere at global cage origin |
| `_sceneSize()` | `viewer3d.js` | Returns scene diagonal (metres) — used for sphere radius |
