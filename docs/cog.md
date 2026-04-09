# COG — Centre of Gravity

## Purpose

The COG is computed for **transport** only — not for the installed position.
During transport, PRL/PRC bars are slid inside the cage so nothing protrudes.
The COG drives lifting point design and rigging balance checks.

---

## What is Displayed

A **gold sphere** rendered at the COG position in the 3D viewer (always visible, `depthTest: false`).
A **"COG Height"** dim box shows how far above the cage base the COG sits (mm).
Full IFC X/Y/Z coordinates and total weight are logged to the browser console.

---

## Algorithm

### 1. BREP Solid Centroid (per bar)

Uses the **divergence theorem** on the triangulated solid mesh streamed by web-ifc.
Exact for any bar shape — straight, L-bar, U-bar, link, 3D bend — no shape-code inference needed.

For each triangle `(v0, v1, v2)` in the mesh:
```
cross    = v1 × v2
sv       = dot(v0, cross) / 6          // signed volume of tetrahedron with origin
centroid += sv × (v0 + v1 + v2) / 4   // volume-weighted centroid contribution
```
`bar_centroid = Σ(centroid) / Σ(sv)`

### 2. Mass-Weighted Cage COG

```
COG = Σ(Formula_Weight_i × centroid_i) / Σ(Formula_Weight_i)
```

`Formula_Weight` = `π × r² × L × 7777 kg/m³` — always computed from bar geometry.
Bars with no `Formula_Weight` (missing Size or Length) are skipped.

### 3. Coordinate System

web-ifc streams geometry in metres, Y-up:
```
engine_X = IFC_X / 1000
engine_Y = IFC_Z / 1000   ← vertical axis (height)
engine_Z = -IFC_Y / 1000
```

COG `heightFromBase` = `(cog.ey − meshBbox.minY) × 1000` mm.

IFC display coordinates:
```
IFC_X =  cog.ex × 1000
IFC_Y = -cog.ez × 1000
IFC_Z =  cog.ey × 1000
```

---

## PRL/PRC Transport Correction

### Why

The IFC records PRL and PRC bars in their **site (installed) position**.
For transport they are slid inside the cage. The transport COG must reflect this.

### Bar Types

| Layer prefix | Orientation | Slide axis |
|---|---|---|
| `PRL*` | Horizontal — runs along cage length | Length axis (engine X or Z) |
| `PRC*` | Vertical — runs along cage height | Height axis (engine Y) |

### Slide Rule

**PRL — length axis:**
- Length axis = whichever horizontal mesh span is larger: `(maxX−minX)` vs `(maxZ−minZ)`
- If bar's far end > mesh face → slide bar **left** until far end is flush with mesh face
- If bar's near end < mesh face → slide bar **right** until near end is flush with mesh face

**PRC — height axis:**
- If bar's top end > mesh top → slide bar **down** until top end meets mesh top
- If bar's bottom end < mesh bottom → slide bar **up** until bottom end meets mesh bottom

### Implementation Detail

Two-pass approach (required because `meshBbox` is still being built during streaming):

1. **During `StreamAllMeshes`**: PRL/PRC centroid is computed but pushed to `_preloadPending[]` — not accumulated yet
2. **After `CloseModel`**: `meshBbox` is complete — each pending bar's endpoints (from text parser `Start_X/Y/Z`, `End_X/Y/Z`) are checked against the mesh envelope, slide delta applied to the BREP centroid, then folded into the main COG sums

Bar endpoints from the text parser are converted to engine coords for the comparison:
```javascript
s_ex = Start_X / 1000,  s_ey = Start_Z / 1000,  s_ez = -Start_Y / 1000
e_ex = End_X   / 1000,  e_ey = End_Z   / 1000,  e_ez = -End_Y   / 1000
```

Slide amount per bar is logged to console: `[COG] PRL slid -320mm: PRL1`

### What Does NOT Change

- The 3D render — bars are not moved in the viewer
- The IFC data — no modification to bar coordinates
- Y/Z position of PRL bars (they stay in the same void, depth-wise)
- X position of PRC bars

---

## Code Locations

| What | File | Notes |
|---|---|---|
| BREP centroid + stream accumulation | `js/viewer3d.js` — inside `StreamAllMeshes` callback | After `allPos`/`allIdx` built |
| PRL/PRC slide correction | `js/viewer3d.js` — after `CloseModel` | Uses `meshBbox` + text parser endpoints |
| COG sphere placement | `js/viewer3d.js` — `_addCOGMarker()` | Called after `_fitCamera()` |
| Dims return (incl. `cog`) | `js/viewer3d.js` — `_buildDimensions()` | Adds `heightFromBase`, `ifcX/Y/Z` |
| Dim box update | `js/main.js` — `_updateDimBoxesFromBREP()` | Sets `#dim-cog-height` |
| Dim box HTML | `index.html` | `id="dim-cog-height"` |

---

## Known Limitations / Future Work

- **PRL bars longer than the cage**: if `barMax − barMin > meshMax − meshMin` the bar is longer than the cage and cannot be fully slid inside. Current code applies the far-end correction only — the near end may still protrude. In practice this should not occur.
- **PRC height axis**: uses `meshBbox.minY/maxY` (mesh bars only). If PRC bars extend into slab slabs beyond the mesh, this is correct behaviour — but verify on slab cages.
- **No visual correction**: the gold COG sphere reflects the transport position but the bars in the viewer remain in their IFC (site) position. A future enhancement could render PRL/PRC in their transport position.
- **DXF annotation**: S5-equivalent — mark the COG point on a cage elevation DXF with dimension lines to both ends. Not yet implemented.
