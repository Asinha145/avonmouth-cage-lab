# Pending V2 Sync — Features in Lab Not in V2

> V2 last code commit: `6f0db9a` (Persp/Ortho toggle).
> Everything below is in cage-lab but not in V2.
> Priority: ⭐⭐⭐ = port now (bugs/silent failures) | ⭐⭐ = port soon | ⭐ = low value

---

## GROUP 1 — Template DXF Critical Fixes (V2 template is broken without these)

### ⭐⭐⭐ IFCBEAM relative placement fix
- **Lab commit:** `ba1738b`
- **What:** `_parseIFCBeamHoles` regex changed from `IFCLOCALPLACEMENT\(\$,...)` to
  `IFCLOCALPLACEMENT\([^,)]*,...)` — matches both absolute (`$`) and relative (`#N`) parents.
- **Impact:** V2 returns 0 coupler holes for any cage where Tekla exported relative
  placements (e.g. RF35 and newer exports). Template DXF silently produces no holes.
- **V2 file:** `js/ifc_parser_live.js` or `js/main.js` — one regex change.

### ⭐⭐⭐ O(1) entity lookup in `_parseIFCBeamHoles`
- **Lab commit:** `73a4f80`
- **What:** Builds a `Map<id, line>` once in one pass, then all lookups are O(1).
  Was previously running a new regex scan over the full 5MB file for every entity lookup.
- **Impact:** For P7349 (162 couplers) the old V2 code does ~162 × full-file scans.
  On a large IFC this makes template generation take 30–60 seconds.
- **V2 file:** `js/main.js` — `_parseIFCBeamHoles` rewrite.

### ⭐⭐⭐ Geometry-based face separation axis (`_detectFaceSepAxis`)
- **Lab commit:** `5348543`
- **What:** Replaces `cageAxisName === 'Y'` heuristic with within-layer spread geometry.
  For P7349, `cageAxisName='Z'` (vertical bars dominate) but faces are separated in X.
  The heuristic was silently wrong → wrong bucketing → all holes on one face.
- **Impact:** V2 template for any cage where cageAxisName ≠ expected puts all holes
  in one face section. Silent data error.
- **V2 file:** `js/main.js` — new `_detectFaceSepAxis()` function + update callers.

### ⭐⭐⭐ `_bucketHolesByFace` using sep axis not cageAxisName
- **Lab commit:** `193198a`
- **What:** Holes bucketed to face layers using `_detectFaceSepAxis()` result, not
  `cageAxisName`. For P7349 this was bucketing all holes to the wrong face.
- **V2 file:** `js/main.js` — `_bucketHolesByFace` function.

### ⭐⭐⭐ Multi-face template sections (one per face)
- **Lab commit:** `3bf4727`
- **What:** `exportTemplateDXF` loops over `faceBuckets` and generates a separate
  stacked section per face. V2 only ever generates F1A.
- **Impact:** For P7349 (F1A + N1A) V2 generates half a template. N1A 88 HS holes missing.
- **V2 file:** `js/main.js` — major refactor of `exportTemplateDXF`.

### ⭐⭐⭐ Template DXF for Y-axis wall cages (`useLongY` fix)
- **Lab commit:** `a6ef581`
- **What:** `px = xMm - globalMinX` always was wrong for cages where wall length runs in Y.
  Added `useLongY = faceSepAxis === 'x' && !useY` → `px = yMm - datumPx` when needed.
- **Impact:** For any cage with faces in X (P7349 type), all holes have the same X → plate
  appears as a single vertical line.
- **V2 file:** `js/main.js` — `exportTemplateDXF` px calculation.

### ⭐⭐⭐ Slab cage face plane fix (X-Y not X-Z)
- **Lab commit:** `578b066`
- **What:** For slab cages (T/B layers), template maps `pz = yMm` not `pz = zMm` because
  the mesh face is horizontal (X-Y plane). V2 always uses zMm → plate width ≈ 0mm for slabs.
- **V2 file:** `js/main.js` — `useY = zSpan < 100` condition + `pz` assignment.

### ⭐⭐⭐ VS/HS plate auto-detect long axis
- **Lab commits:** `64ed523`, `aa1dd43`
- **What:** `getOrientation()` counts unique X vs Z positions and picks long axis accordingly.
  Wall cages: long=Z. Slab cages: long=X (VS struts run horizontally in global space).
  V2 hardcoded long=Z for VS always → slab VS plates wrong shape.
- **V2 file:** `js/main.js` — `_computePlates` / `getOrientation`.

### ⭐⭐ Face name detection — layer naming over Z span
- **Lab commit:** `f18e909`
- **What:** Whether to compare Y or Z to identify face layer now derived from presence of
  F/N vs T/B layer names, not from coupler Z span heuristic.
- **V2 file:** `js/main.js` — `_detectFaceName` / `_bucketHolesByFace`.

---

## GROUP 2 — Bug Fixes (correctness / silent failures)

### ⭐⭐⭐ C01 reject diagonal cage installations
- **Lab commit:** `a9bbf2c`
- **What:** `_isCageDiagonal()` — if `min(xMaxRange, yMaxRange) > 500mm` across face layers,
  cage is rejected with specific reason. Prevents silent wrong DXF/EDB output.
- **V2 file:** `js/main.js` — new function + 3 lines in `displayResults`.

### ⭐⭐⭐ `_computePlates` 15mm tolerance bucket
- **Lab commit:** `ebf09b8` (from PR#1)
- **What:** `Math.round(h/15)` instead of `Math.round(h)` — prevents near-equal slab Z
  positions from being overcounted as unique and misclassifying plate orientation.
- **V2 file:** `js/main.js` — 2 chars in `getOrientation`.

### ⭐⭐⭐ Dead `_detectFaceName()` deleted
- **Lab commit:** `ebf09b8` (from PR#1)
- **What:** 31-line dead function using Y-always approach, never called. Misleading if
  someone tries to use it in future.
- **V2 file:** `js/main.js` — delete the function.

### ⭐⭐⭐ `'Unknown'` group not masked as `'Coupler Head'`
- **Lab commit:** `ebf09b8` (from PR#1)
- **What:** Entities in neither barMap nor couplerMap now route to `'Unknown'` (red signal)
  instead of silently joining `'Coupler Head'` (gray, invisible in layer filter).
- **V2 file:** `js/viewer3d_live.js` — 1 line in groupKey fallback.

### ⭐⭐⭐ Shared datum `_cageDatum()`
- **Lab commit:** `b9b0362`
- **What:** Both bar outlines and hole positions subtract the same computed origin →
  face view and template DXF overlay exactly. V2 computes independent minX/Y per export.
- **V2 file:** `js/main.js` — new `_cageDatum()` function + update export callers.

---

## GROUP 3 — 3D Viewer Enhancements (additive, no regressions)

### ⭐⭐ Red datum sphere
- **Lab commits:** `d19b852`, `71fbaf9`
- **What:** Red dot at cage datum corner. `_sceneSize() * 0.004`.
- **V2 files:** `js/viewer3d_live.js`

### ⭐⭐ Orange layer datum markers
- **Lab commits:** `d19b852` → `ce11f51`
- **What:** Orange spheres at nearest VS/HS bar crossing per face layer.
  Median filter, stagger clusters, all sepAxis cases.
- **V2 files:** `js/main.js` + `js/viewer3d_live.js`

### ⭐⭐ Coupler plates as 3D solids
- **Lab commit:** `ab6fcfa`
- **What:** VS/HS plates as 10mm BoxGeometry, blue/cyan, 50% transparent.
- **V2 files:** `js/main.js` + `js/viewer3d_live.js`

---

## GROUP 4 — DXF Exports (large, lab-only)

### ⭐⭐ Site Template DXF with A4080 title block
- **Lab commits:** `f05386e`, `f464e2d`, `994cd93`
- **What:** Full combined DXF — BREP bar outlines + holes + plates + dims + title block.
- **V2 has:** `exportTemplateDXF` only (no bar outlines, no title block).

### ⭐ Face View DXF (debug)
- **Lab commit:** `aa2a1f6`+
- **What:** Single-face BREP bar hull outlines as DXF.

### ⭐⭐ Conditional template DXF button
- **Lab commit:** `ab6fcfa`
- **What:** Button only visible when VS/HS couplers exist in couplerMap.
- **V2 file:** 3 lines in `displayResults`.

---

## Recommended Port Order for V2

### Batch 1 — Port now (all in Group 1 + Group 2: template fixes + bugs)
These fix silent wrong behaviour in V2's existing Template DXF. Small isolated changes.

| # | What | Lab commit | Effort |
|---|---|---|---|
| 1 | IFCBEAM relative placement regex | `ba1738b` | 1 line |
| 2 | O(1) entity lookup | `73a4f80` | ~15 lines |
| 3 | `_detectFaceSepAxis()` geometry-based | `5348543` | ~25 lines |
| 4 | `_bucketHolesByFace` sep axis fix | `193198a` | ~10 lines |
| 5 | Multi-face template sections | `3bf4727` | ~40 lines |
| 6 | `useLongY` px axis fix | `a6ef581` | ~5 lines |
| 7 | Slab face plane (X-Y not X-Z) | `578b066` | ~5 lines |
| 8 | VS/HS plate auto-detect long axis | `64ed523`+ | ~20 lines |
| 9 | C01 diagonal rejection | `a9bbf2c` | ~35 lines |
| 10 | 15mm plate bucket | `ebf09b8` | 2 chars |
| 11 | Delete dead `_detectFaceName` | `ebf09b8` | delete 31 lines |
| 12 | Unknown group masking fix | `ebf09b8` | 1 line |
| 13 | `_cageDatum()` shared datum | `b9b0362` | ~25 lines |

### Batch 2 — Port next (3D viewer enhancements)
| # | What | Lab commit | Effort |
|---|---|---|---|
| 14 | Red datum sphere | `71fbaf9` | ~20 lines |
| 15 | Orange layer datum markers | `ce11f51` | ~120 lines |
| 16 | Coupler plates 3D | `ab6fcfa` | ~80 lines |
| 17 | Conditional template button | `ab6fcfa` | 3 lines |

### Batch 3 — Port last (large DXF work)
| # | What | Effort |
|---|---|---|
| 18 | Site Template DXF + title block | Large — port whole function |
| 19 | Face View DXF | Medium |
