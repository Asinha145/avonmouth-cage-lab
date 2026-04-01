# Pending V2 Sync — Features in Lab Not in V2

> `avonmouth-cage-lab` (lab) is the active development repo.
> `avonmouth-cage-v2` (V2) is marked Final/Locked but may need selective backport if
> V2's 3D viewer or DXF features are ever reactivated.
>
> This file tracks what lab has developed that V2 does not currently have.

---

## 3D Viewer Enhancements

### Red Datum Sphere
- **Status:** Lab only (`d19b852`, `71fbaf9`)
- **What:** Small red sphere at cage datum corner `(tb.minX, tb.minY, tb.maxZ)`
- **Size:** `_sceneSize() * 0.004` — 0.4% of scene diagonal, not scene radius
- **Files:** `js/viewer3d.js` — `_addDatumMarker()`, `_sceneSize()`
- **V2 has:** Nothing equivalent

### Orange Layer Datum Markers
- **Status:** Lab only (`d19b852` → `ce11f51`)
- **What:** Orange spheres at nearest VS/HS bar grid intersection per face mesh layer
- **Features:** Median length filter (hairpin removal), stagger cluster grouping, per-sepAxis coordinate mapping, slab T/B support
- **Files:** `js/main.js` — `_computeLayerDatums()`; `js/viewer3d.js` — `setLayerDatumMarkers()`
- **V2 has:** Nothing equivalent

### Perspective / Orthographic Toggle
- **Status:** In both (`f464e2d` in lab, `6f0db9a` in V2 — implemented separately in V2)
- **Action required:** None — V2 already has this

---

## DXF Exports

### Face View DXF (`exportFaceViewDXF`)
- **Status:** Lab only (`aa2a1f6`)
- **What:** Orthographic face elevation — BREP convex hull bar outlines for a single face layer
- **Files:** `js/main.js`
- **V2 has:** Nothing equivalent

### Site Template DXF (`exportCombinedFaceDXF`)
- **Status:** Lab only (`f05386e`, `f464e2d`)
- **What:** Combined AC1009 DXF — BARS + HOLES + PLATE_OUTLINE + DIMS + TEXT + TITLE_BLOCK
- **Features:** A4080 title block, 1:15 scale, multi-face stacked sections
- **Files:** `js/main.js`
- **V2 has:** `exportTemplateDXF()` only (standalone plate template, no BREP bar outlines)

---

## Shared Infrastructure

### `_cageDatum()`
- **Status:** Lab only (`b9b0362`)
- **What:** Shared datum from outermost face layer bar endpoints — eliminates per-export minXY
- **V2 has:** Each export computed its own `globalMinX`/`globalMinY` independently

### `_detectFaceSepAxis()` — Slab Support
- **Status:** V2 has a version; lab version extended to return `'z'` for slab cages
- **What:** For T/B face layers (roof slab), sepAxis = 'z'; wall cages return 'x' or 'y'
- **Action:** If V2 ever needs slab template DXF, backport the `'z'` branch

### `_computeLayerDatums()` — Per-sepAxis Mapping
- **Status:** Lab only
- **What:** Handles all three sepAxis cases including slab. V2's axis mapping was only coded for wall cages.
- **Key fix (01 Apr 2026):** For `sepAxis='z'`, bars classified by `Dir_Y` vs `Dir_X` dominance (not Orientation='Vertical'/'Horizontal', which is always Horizontal for slab bars)

---

## Summary Table

| Feature | Lab | V2 | Port needed? |
|---|---|---|---|
| Red datum sphere | ✅ | ✗ | If V2 viewer ever updated |
| Orange layer datum markers | ✅ | ✗ | If V2 viewer ever updated |
| Persp/ortho toggle | ✅ | ✅ | No — already in V2 |
| Face View DXF | ✅ | ✗ | If V2 needs DXF output |
| Site Template DXF | ✅ | ✗ | If V2 needs DXF output |
| A4080 title block | ✅ | ✗ | If V2 needs DXF output |
| `_cageDatum()` | ✅ | ✗ | If V2 needs aligned DXF |
| `_detectFaceSepAxis()` with 'z' | ✅ | partial | If V2 needs slab DXF |
| `_computeLayerDatums()` | ✅ | ✗ | If V2 viewer ever updated |
