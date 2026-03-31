# Template DXF — Formwork Face Plate Template

Generates a dimensioned DXF drawing of each formwork face plate showing the exact positions and sizes of VS/HS strut coupler holes. Derived directly from IFCBEAM placement coordinates in the IFC file.

---

## What It Produces

A flat 2D DXF (AutoCAD R12 / AC1009) showing one labelled section per formwork face (F1A, N1A, T1A, etc.):

- One circle per VS/HS strut coupler hole, sized at coupler OD + 2mm
- Each hole labelled `{CAGE_REF}-CPLR-NNN` (sequential, sorted by px then pz)
- Plate outlines with 25mm edge clearance from nearest hole edge
- Overall dimension lines (length × width mm) per plate
- Section headers and title block

**DXF layers:**

| Layer | Contents |
|---|---|
| `PLATE_OUTLINE` | Plate rectangles |
| `HOLES` | Coupler hole circles |
| `TEXT` | Labels, plate IDs, section headers |
| `DIMS` | Span and clearance dimension lines |

---

## Pipeline Overview

```
IFC text
  └─ _parseIFCBeamHoles()   → [{xMm, yMm, zMm, holeDia, layer}, ...]  (VS/HS only)
        └─ _bucketHolesByFace()  → { 'F1A': [...], 'N1A': [...], ... }
              └─ per face: derive px, pz → _computePlates()  → vsPlates, hsPlates
                    └─ drawPlates() → DXF emit
```

---

## Step 1 — Parsing Holes (`_parseIFCBeamHoles`)

### Why IFCBEAM, Not Bar Positions

VS/HS strut bars run perpendicular to the face. Their rebar start/end coordinates do not reliably give hole positions. The IFCBEAM entity (physical coupler head) is placed at the exact global position on the face.

### Placement Chain

```
IFCBEAM → IFCLOCALPLACEMENT([$ or #N], #axId)
                ↓
          IFCAXIS2PLACEMENT3D(#cpId, ...)
                ↓
          IFCCARTESIANPOINT((X_global, Y_global, Z_global))  ← absolute BNG mm
```

Tekla encodes global BNG coordinates directly in the CartesianPoint regardless of whether `IFCLOCALPLACEMENT` has a parent ref (`#N`) or `$`. No parent chain walk needed.

**Regex must handle both:**
```javascript
/#(\d+)=IFCLOCALPLACEMENT\([^,)]*,#(\d+)\)/g   // [^,)]* matches $ or #14 or #3417
```

### Hole Size

`holeDia = IFCBEAM ATK EMBEDMENTS pset HEIGHT + 2mm`

Do not use bar `Size` (rebar diameter). Use the coupler body OD.

| Coupler | HEIGHT (OD) | Hole dia |
|---|---|---|
| AG20N | 31mm | **33mm** |
| AG25  | 38mm | **40mm** |
| AG32N | 47mm | **49mm** |
| AG40N | 61mm | **63mm** |

### Layer Filter

Only beams where Avonmouth pset `Layer/Set` matches `/^[VH]S/i` (VS1, VS2, HS1, HS2, etc.) are included. Face mesh bars (F1A, N1A), preload bars (PRL, PRC) are excluded.

### Performance

An `entityMap = new Map()` is built in one `matchAll` pass at function entry. All subsequent pset/placement lookups use this map in O(1). Do **not** call `new RegExp(#N=...)` per lookup — it scans the full file each time and locks the main thread on files ≥1MB.

---

## Step 2 — Face Bucketing (`_bucketHolesByFace` + `_detectFaceSepAxis`)

### Face Separation Axis Detection

`_detectFaceSepAxis()` determines which IFC axis separates the F/N (or T/B) face layers.

**Algorithm:** Compare the maximum within-layer spread on X vs Y across all face layers from `allData`. Face bars are tightly clustered on the separation axis (all F1A bars share approximately the same depth-in-wall X) and spread the full cage length on the other axis.

```javascript
const maxRange = (key) => Math.max(...layers.map(pts => {
    const vals = pts.map(p => p[key]).filter(v => v != null).sort((a,b) => a-b);
    return vals.length >= 2 ? vals[vals.length-1] - vals[0] : 0;
}));
return maxRange('x') < maxRange('y') ? 'x' : 'y';   // smallest max-range = sep axis
```

**Do not use `cageAxisName`** — for P7349 the parser returns `'Z'` (vertical bars dominate the detection), not `'Y'`. This makes `cageAxisName` unreliable as a proxy for wall orientation.

| Cage type | sepAxis | Reason |
|---|---|---|
| P7349 (wall runs in Y) | `'x'` | xMaxRange≈50mm vs yMaxRange≈10,267mm |
| Wall running in X | `'y'` | yMaxRange≈50mm vs xMaxRange≈(wall length) |
| Slab/roof (T/B layers) | `'z'` | T/B present, F/N absent |

### Bucketing

Each hole is assigned to the face layer whose median on `sepAxis` is nearest. All 6 face layers (F1A, F3A, F5A, N1A, N3A, N5A) participate — VS/HS couplers land on the outermost layers (F1A, N1A) since their X positions match the outer face bar X positions.

---

## Step 3 — Coordinate Projection (px, pz)

Per face bucket, holes are projected onto the face plate coordinate system:

| Variable | Wall (faces in X, `sepAxis='x'`) | Slab (`useY=true`) |
|---|---|---|
| `useY` | `false` (Z span > 100mm) | `true` (Z span < 100mm) |
| `useLongY` | `faceSepAxis === 'x' && !useY` = **true** | `false` |
| `px` (long = cage length) | `yMm − globalMinY` | `xMm − globalMinX` |
| `pz` (height / narrow) | `zMm − minFaceZ` | `yMm − minFaceY` |

`useLongY = faceSepAxis === 'x' && !useY` — when faces are in X, length runs in Y.

---

## Step 4 — Plate Computation (`_computePlates`)

### VS Plates

Long axis = pz (Z direction, height). Auto-detected:
```javascript
// More unique pz positions → long=Z (wall); more unique px → long=X (slab)
zUniq >= xUniq ? { bandKey:'px', groupKey:'pz' } : { bandKey:'pz', groupKey:'px' }
```

### HS Plates

Long axis = px (cage length direction). **Hardcoded:**
```javascript
const hsOri = { bandKey:'pz', groupKey:'px' };   // always long=X
```
Auto-detect is unreliable for HS — when few unique pz values (e.g. 2 Z rows), the unique-count comparison breaks down.

### Band-and-Group Algorithm

1. Sort holes by `bandKey` (narrow axis, maxWidth=300mm)
2. Greedily group into bands: expand band until adding next hole would exceed `maxWidth`
3. Within each band, sort by `groupKey` (long axis, maxLength=2000mm)
4. Greedily group into plates: expand plate until exceeding `maxLength`
5. Each plate adds 25mm clearance beyond the outermost hole edge

---

## Step 5 — DXF Emit

DXF format: AC1009 (AutoCAD R12). All coordinates in mm. One section per face, VS plates above HS plates within each section.

Plate label format: `{TYPE}-PLATE-{NN}  {length} x {width} mm  ({N} holes)`
Hole label format: `{CAGE_REF}-CPLR-{NNN}` (sequential per face, sorted px then pz)

---

## P7349 Verified Output (31 Mar 2026)

Wall cage running in Y (10,267mm), thickness 1,357mm (F-face to N-face in X), 162 total VS/HS holes.

| Face | VS holes | HS holes | VS plates | HS plates |
|---|---|---|---|---|
| F1A | 25 | 49 | 2 | 6 |
| N1A | 0 | 88 | 0 | 5 |

**N1A HS plate breakdown:**
- 5 plates, plates 2–4 each have 20 holes (10 × 2 parallel rows at 135mm Z spacing)
- Plate dimensions ≈ 1850×217mm (long in Y/cage-length, short in Z/height)
- `sepAxis='x'`, `useLongY=true`, `px = yMm − globalMinY` ✓

---

## Key Rules (Do Not Change Without Updating This Doc)

1. Face sep axis from `_detectFaceSepAxis()` only — never from `cageAxisName`
2. `useLongY = faceSepAxis === 'x' && !useY` — do not rewrite as `cageAxisName === 'Y'`
3. HS orientation hardcoded `{ bandKey:'pz', groupKey:'px' }` — do not auto-detect
4. entityMap built once at `_parseIFCBeamHoles` entry — never call `new RegExp(#N=...)` per lookup
5. Hole size from IFCBEAM `ATK EMBEDMENTS HEIGHT + 2mm` — not from bar `Size`
6. IFCBEAM position from its own CartesianPoint — not from `connected_rebar` bar position
