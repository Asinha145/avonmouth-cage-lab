# Pending V2 Sync — Features in Lab Not in V2

> `avonmouth-cage-lab` (lab) is the active development repo.
> `avonmouth-cage-v2` (V2) is marked Final/Locked.
> This file tracks everything lab has that V2 does not, with a porting priority rating.
>
> Priority: ⭐⭐⭐ = port now | ⭐⭐ = port when V2 is next touched | ⭐ = low value for V2

---

## Bug Fixes / Correctness (port these — they fix silent wrong behaviour)

### ⭐⭐⭐ Dead `_detectFaceName()` deleted
- **Lab commit:** `ebf09b8`
- **What:** 31-line dead function that used Y-always face detection (the old bug). Removed.
- **V2 has:** Check if V2 still has this function — if so, delete it.

### ⭐⭐⭐ `'Unknown'` group no longer masked as `'Coupler Head'`
- **Lab commit:** `ebf09b8`
- **What:** In `StreamAllMeshes`, entities in neither barMap nor couplerMap now route to
  `'Unknown'` (red danger signal) instead of silently joining `'Coupler Head'` (gray, invisible).
- **V2 file:** `js/viewer3d_live.js` — one line change in groupKey fallback.
- **Why port:** V2's unknown entity masking is the same bug — any unhandled IFC entity
  type is invisible in the layer filter.

### ⭐⭐⭐ `_computePlates` — 15mm tolerance bucket for slab inclination
- **Lab commit:** `ebf09b8`
- **What:** `getOrientation()` now buckets hole positions to 15mm grid
  (`Math.round(h/15)`) instead of 1mm. Prevents slab holes at near-equal Z
  from being miscounted as unique positions and misclassifying plate orientation.
- **V2 file:** `js/main.js` — two character change inside `getOrientation`.

### ⭐⭐⭐ C01 rejection for diagonal cage installations
- **Lab commit:** `a9bbf2c`
- **What:** `_isCageDiagonal()` detects when F/N face layers are not axis-aligned.
  If `min(xMaxRange, yMaxRange) > 500mm` across face layers → C01 rejected with
  specific reason text. EDB/export buttons gated same as other rejection causes.
- **V2 file:** `js/main.js` — new `_isCageDiagonal()` + 3-line change in `displayResults()`.
- **Why port:** V2 processes the same IFC files. A diagonal cage would silently produce
  wrong template/EDB outputs without this guard.

---

## 3D Viewer Enhancements

### ⭐⭐ Red Datum Sphere
- **Lab commits:** `d19b852`, `71fbaf9`
- **What:** Small red sphere (0xff2222) at cage datum corner `(tb.minX, tb.minY, tb.maxZ)`.
  Size = `_sceneSize() * 0.004` (scene diagonal × 0.4%).
- **V2 files:** `js/viewer3d_live.js` — `_addDatumMarker()`, `_sceneSize()`
- **V2 has:** Nothing equivalent

### ⭐⭐ Orange Layer Datum Markers
- **Lab commits:** `d19b852` → `ce11f51`
- **What:** Orange spheres at nearest VS/HS bar grid intersection per face mesh layer.
  Median filter (removes hairpins), stagger cluster grouping, all sepAxis cases incl. slab.
- **V2 files:** `js/main.js` — `_computeLayerDatums()`; `js/viewer3d_live.js` — `setLayerDatumMarkers()`
- **V2 has:** Nothing equivalent

### ⭐⭐ Coupler Plates as 3D Solids
- **Lab commit:** `ab6fcfa`
- **What:** VS plates (blue) and HS plates (cyan), 10mm thick BoxGeometry, 50% transparent.
  Placed automatically after BREP loads. Coordinate mapping matches DXF export exactly.
- **V2 files:** `js/main.js` — `_computePlate3DBoxes()`; `js/viewer3d_live.js` — `setPlateBoxes()`
- **V2 has:** Nothing equivalent

### ⭐⭐⭐ Perspective / Orthographic Toggle
- **Status:** Already in V2 (`6f0db9a`) — no action needed.

---

## DXF Exports (lab-only, V2 has none of these)

### ⭐ Face View DXF (`exportFaceViewDXF`)
- **Lab commit:** `aa2a1f6`
- **What:** Orthographic face elevation — BREP convex hull bar outlines for a single face layer.
- **Port priority:** Low — debug tool mainly useful during cage-lab development.

### ⭐⭐ Site Template DXF (`exportCombinedFaceDXF`)
- **Lab commits:** `f05386e`, `f464e2d`, `994cd93`
- **What:** Combined AC1009 DXF — BARS + HOLES + PLATE_OUTLINE + DIMS + TEXT + TITLE_BLOCK.
  A4080 title block, 1:15 scale, one section per face.
- **V2 has:** `exportTemplateDXF()` only (plate template, no BREP bar outlines, no title block).
- **Port priority:** Medium — V2 users would benefit but it requires BREP to be loaded first.

---

## Shared Infrastructure

### ⭐⭐⭐ `_cageDatum()`
- **Lab commit:** `b9b0362`
- **What:** Shared datum from outermost face layer bar endpoints. Both bar outlines and
  hole positions subtract the same origin → exact DXF overlay.
- **V2 has:** Each export computes its own `globalMinX/Y` independently.

### ⭐⭐ `_detectFaceSepAxis()` — slab 'z' branch
- **Lab commit:** `ce11f51`
- **What:** Returns `'z'` for T/B slab layers (was 'x'/'y' only).
- **V2 has:** The function exists but returns only 'x' or 'y'.

### ⭐⭐ `_computeLayerDatums()` — slab + all sepAxis
- **Lab commit:** `ce11f51`
- **What:** Full per-sepAxis engine coord mapping. Slab bars split by Dir_Y vs Dir_X.
- **V2 has:** Nothing equivalent.

### ⭐⭐ Conditional Template DXF button
- **Lab commit:** `ab6fcfa`
- **What:** Button only shown when `_couplerMap` has VS/HS entries. Hidden on rejection.
- **V2 has:** Button always shown (even for cages with no couplers).

---

## Summary — Recommended Port Order

| Priority | Feature | Lab commit | V2 effort |
|---|---|---|---|
| ⭐⭐⭐ NOW | Delete dead `_detectFaceName()` | `ebf09b8` | 1 min — grep + delete |
| ⭐⭐⭐ NOW | Fix Unknown→Coupler Head masking | `ebf09b8` | 1 line in `viewer3d_live.js` |
| ⭐⭐⭐ NOW | `_computePlates` 15mm bucket | `ebf09b8` | 2 chars in `main.js` |
| ⭐⭐⭐ NOW | C01 reject diagonal cage | `a9bbf2c` | ~35 lines in `main.js` |
| ⭐⭐⭐ NOW | `_cageDatum()` | `b9b0362` | ~25 lines in `main.js` |
| ⭐⭐ NEXT | Red datum sphere | `71fbaf9` | ~20 lines in `viewer3d_live.js` |
| ⭐⭐ NEXT | Orange layer datum markers | `ce11f51` | `_computeLayerDatums` + viewer method |
| ⭐⭐ NEXT | Coupler plates 3D | `ab6fcfa` | `_computePlate3DBoxes` + viewer method |
| ⭐⭐ NEXT | Site Template DXF | `f05386e`+ | Large — port last |
| ⭐⭐ NEXT | Conditional template button | `ab6fcfa` | 3 lines in `displayResults` |
| ⭐ LATER | Face View DXF (debug) | `aa2a1f6` | Medium |
