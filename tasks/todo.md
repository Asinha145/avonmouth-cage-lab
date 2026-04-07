# Cage Lab — Task Log

## Status: Session 2 complete (01 Apr 2026)

---

## A — Face View DXF (`exportFaceViewDXF`) ✅ (31 Mar 2026)

- [x] Add `exportFaceViewDXF(faceLayerName)` function
- [x] Guard: return if no data loaded
- [x] Default faceLayerName to first detected face layer if not supplied
- [x] Get sepAxis from `_detectFaceSepAxis()`
- [x] BREP path: `getFaceLayerVertexClouds()` → convex hull per bar → LINE entities
- [x] Centreline fallback: bar start/end from `allData` if BREP not loaded
- [x] Project to 2D using shared datum from `_cageDatum()`
- [x] Build AC1009 DXF: BARS layer, CRLF endings
- [x] Trigger download as `{cageRef}-{faceLayerName}-view.dxf`
- [x] Button disabled until BREP loads (timing fix)

---

## B — Datum Fix (`_cageDatum`) ✅ (31 Mar 2026)

- [x] Investigate IFC `IFCAXIS2PLACEMENT3D` placement chain — confirmed all at (0,0,0)
- [x] Identify cage BNG origin `#22 = (1979628.891, 6241885.262, 19259.997)` — not suitable as drawing datum (pz all-negative)
- [x] Implement `_cageDatum()` using outermost face layer (F1A+N1A) bar centreline endpoints
- [x] datumPx=6,237,394 datumPz=12,864 for P7349 → F1A face view 0–10,325 × 0–5,250mm ✓
- [x] Apply to `exportFaceViewDXF` — replaces `Math.min(BREP vertex cloud)`
- [x] Apply to `exportTemplateDXF` — replaces `globalMinY` + per-face `minP`
- [x] Apply to `diag-faceview-brep.mjs` local test script
- [x] Document in `docs/datum.md`

---

## C — Combined Site Template DXF (`exportCombinedFaceDXF`) ✅ (31 Mar 2026)

- [x] One section per face with VS/HS holes (F1A + N1A for P7349)
- [x] Sections stacked vertically, 600mm gap
- [x] BARS layer (green): BREP convex hull bar outlines using `getFaceLayerVertexClouds()`
- [x] HOLES layer (red): coupler hole circles at face coords using shared datum
- [x] PLATE_OUTLINE layer (blue): plate rectangles computed from `_computePlates()` at face coords
- [x] DIMS layer (grey): overall span dimensions + per-hole tick marks
- [x] TEXT layer (white): section title (Scale 1:15), plate IDs, datum note
- [x] AC1009 DXF: real mm coordinates, CRLF endings
- [x] New UI button "📐 Site Template DXF" — disabled until BREP loads
- [x] Logic validated: VS hole px=5202 pz=1700 within face bounds ✓

---

## D — Documentation ✅ (31 Mar 2026)

- [x] `docs/datum.md` — IFC placement chain investigation, datum fix rationale
- [x] `docs/site-template-dxf.md` — full spec, pipeline, verified output, commits

---

## E — A4080 Title Block ✅ (01 Apr 2026)

- [x] A0 landscape (1189 × 841 mm), 100 mm tall title block strip at drawing base
- [x] Border lines and cell geometry extracted from user-provided DXF, scaled ×15 into model space
- [x] Drawing number: `A4080-EXP-XX-AF-DR-MA-20{last4}` — dynamic from cageRef
- [x] Scale field: `1:15`, date field from `new Date()`
- [x] TITLE_BLOCK layer added (6th layer in TABLES section)
- [x] Download filename changed to `A4080-EXP-XX-AF-DR-MA-20{last4}.dxf`
- [ ] Title block fields to complete once confirmed: project name, originator logo, DRAWN/CHECKED/APPROVED names, Purpose of Issue / Status
- [ ] Test output in AutoCAD — confirm bar outlines + holes overlay at correct positions

---

## F — 3D Viewer Enhancements ✅ (01 Apr 2026)

### F1 — Perspective / Orthographic Camera Toggle ✅
- [x] Both `PerspectiveCamera` and `OrthographicCamera` created at init
- [x] Ortho frustum sized from orbit radius: `halfH = radius * tan(fov/2)`, `halfW = halfH * aspect`
- [x] Toggle button "Persp" in viewer header (before ⚙ Layers) — swaps between modes
- [x] `toggleCameraMode()` in `viewer3d.js` — swaps `this.camera`, calls `_applyOrbit()`
- [x] `_onResize()` and `_applyOrbit()` both updated for ortho frustum sync
- [x] viewcube selector scoped to `.viewcube-btn[data-view]` to exclude camera-mode-btn

### F2 — Red Datum Sphere ✅
- [x] Small red sphere (0xff2222) at cage datum corner: `(tb.minX, tb.minY, tb.maxZ)`
- [x] Size = `_sceneSize() * 0.004` (scene diagonal × 0.4%) — not scene radius
- [x] `_sceneSize()` excludes datum markers from bbox to avoid self-referential sizing
- [x] Added in `_fitCamera()` after camera positioned

### F3 — Orange Layer Datum Markers ✅
- [x] `_computeLayerDatums()` in `main.js` — one marker per face mesh layer
- [x] Orange spheres (0xff8c00) at nearest VS/HS bar grid intersection per layer
- [x] `depthTest:false`, `renderOrder:999` — always visible through geometry
- [x] `setLayerDatumMarkers(markers)` in `viewer3d.js` accepts `[{layer, ex, ey, ez}]`
- [x] Median length filter: bars < 50% group median dropped (removes hairpins/bent bars)
- [x] Stagger cluster grouping: `Stagger_Cluster_ID` clusters treated as single logical bar
- [x] Axis mapping fix for `sepAxis='y'` (2HD70706AC1) — `barPxFn` uses IFC-X not IFC-Y
- [x] **Slab support (RF35, 01 Apr 2026):**
  - [x] Regex extended `/^[FNTB]\d+A$/i` — was `/^[FN]\d+A$/i`, missed T/B slab layers
  - [x] For `sepAxis='z'`: split by `|Dir_Y| > |Dir_X|` (y-running, const IFC-X) vs `|Dir_X| > |Dir_Y|` (x-running, const IFC-Y); Vertical/Horizontal split is wrong for slabs (all bars are Horizontal)
  - [x] Engine coord mapping per sepAxis — three explicit cases:
    - `x`: `ex=faceIFC-X/1000, ey=IFC-Z/1000, ez=-IFC-Y/1000`
    - `y`: `ex=IFC-X/1000, ey=IFC-Z/1000, ez=-faceIFC-Y/1000`
    - `z`: `ex=IFC-X/1000, ey=faceIFC-Z/1000, ez=-IFC-Y/1000`

---

## G — Session 3: Datum Controls + Template DXF Round 2 ✅ (07 Apr 2026)

### G1 — Datum Side / Slab Face dropdowns ✅
- [x] `Production_Number` + `Cage_Reference` pre-analysis input fields (HTML + CSS)
- [x] `Datum Side` (Left/Right) dropdown — post-analysis, auto-detected from N1A vs F1A face-axis comparison using BNG orientation rules (`_detectDatumSide()`)
- [x] `Datum Height` (Bottom/Top) dropdown — shown only for slab cages (sepAxis='z'), controls which H-bar crossing to use within each layer (min pz = Bottom, max pz = Top)
- [x] `_computeLayerDatums(datumSide, heightSide)`: removed T/B layer filtering; heightSide now picks nearestH position (min or max); all face layers always get a datum marker
- [x] `_refreshDatumMarkers()` shared handler for both dropdown change events
- [x] `_detectSlabFace()` removed — no longer needed; Datum Height defaults to 'bottom'
- [x] Datum Height dropdown styled to match existing orange-on-dark theme

### G2 — Template DXF Round 2 ✅
- [x] **Separate DXF pages**: each face (F1A, N1A, T1A, B1A) gets its own DXF file; multiple faces packaged as ZIP via `buildZip()` (pure JS CRC32 + stored, no deps); single face → direct DXF download
- [x] **Colours**: added DXF TABLES/LAYER section — `PLATE_OUTLINE` → color 1 (red, prints red); `TEXT`, `DIMS`, `HOLES`, `SCREW_HOLES` → color 7 (white in DWG, black on print)
- [x] **Arial font**: DXF STYLE table entry (`arial.ttf`); all TEXT entities reference it via group code 7
- [x] **Template naming**: `{ProdNum} - {CageRef} - {FaceName}-{Type} - 001` — reads from UI input fields; placed inside plate at font size 1mm; rotated 0° (HS) or 90° (VS); collision-aware: steps 1mm → 0.3mm until text fits without overlapping hole circles or plate bounds
- [x] **Hole annotations**: per-hole coupler labels removed; each unique hole diameter annotated once per plate (`Ø52mm` near first occurrence)
- [x] **Screw holes**: 4× Ø5mm circles at 5mm from each corner per plate (`SCREW_HOLES` layer)
- [x] **Bar-end measurements**: `_getDatumBarEnds()` mirrors `_computeLayerDatums` selection logic; returns closest endpoint of VS bar (→ `vBarEndPz`) and HS bar (→ `hBarEndPx`) in px/pz space; per plate: HDIM from HS bar end to nearest plate horizontal edge + VDIM from VS bar end to nearest plate vertical edge, labelled with absolute mm distance (replaces 25mm clearance dims)

---

## Pending

- [ ] Test template DXF in AutoCAD — confirm colours, screw holes, bar-end dims, ZIP integrity
- [ ] BUG-01: `_cageDatum()` uses `Start_Z/End_Z` for datumPz always; for slabs should use `Start_Y/End_Y` — affects DXF coupler plate positioning, not orange sphere markers
- [ ] N1A face orientation check — may need left-right mirror for "outside N1A" view
- [ ] Title block fields: project name, originator logo, DRAWN/CHECKED/APPROVED names, Purpose of Issue

---

## Commits

| Hash | Description |
|---|---|
| `aa2a1f6` | Face view DXF — BREP + button timing |
| `b9b0362` | Shared datum `_cageDatum()` |
| `0b94eaa` | docs/datum.md |
| `f05386e` | exportCombinedFaceDXF — site template |
| `0cf201a` | docs: site-template-dxf.md + update todo + output-spec |
| `f464e2d` | A4080 title block, persp/ortho toggle, datum sphere |
| `71fbaf9` | Shrink datum sphere to small dot |
| `d19b852` | Orange layer datum markers |
| `bb378eb` | Layer datum: VS/HS crossing validation (superseded) |
| `df40d66` | Layer datum: median length filter for hairpins |
| `1f9aeb3` | Layer datum: stagger cluster grouping |
| `70ff73b` | Layer datum: axis mapping fix for sepAxis=y |
| `ce11f51` | Layer datum: slab support (RF35) — T/B layers, Dir split, per-sepAxis coords |
| `f12d268` | Datum Side auto-detect + lesson (never hardcode spatial defaults) |
| `9d32ae2` | Datum Height (Top/Bottom) dropdown for slab cages only |
| `c2ec593` | fix: Top/Bottom controls H-bar crossing position, not layer filter |
| `adbfcfc` | style: Datum Height dropdown orange-on-dark theme |
| `edf3934` | Template DXF round 2 — naming, colours, holes, screw holes, bar-end dims, ZIP |
