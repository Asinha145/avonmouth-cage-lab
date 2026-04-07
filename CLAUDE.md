# avonmouth-cage-lab — Context Map

## One-Line Summary
Sandbox / active development fork of cage-v2. Coupler geometry, template DXF, face-view DXF, combined site-template DXF, multi-vendor IFC support. **cage-v2 is source of truth — cherry-pick only, never wholesale merge.**

---

## File Map

| File | Lines | Purpose |
|---|---|---|
| `js/ifc-parser.js` | 1043 | IFC text parser — entity/pset extraction, bar resolution (placement chain → xyz), classification, cage-axis detection, stagger clustering, coupler head extraction, C01 rejection |
| `js/viewer3d.js` | 682 | Three.js + web-ifc WASM renderer — BREP streaming, three-bbox computation, layer groups, 3D datum markers, plate boxes, orbit controls |
| `js/main.js` | 3327 | UI orchestration (65+ functions) — file upload, parser→viewer pipeline, stats, tables, filtering/pagination, all export functions, EDB generation, step detection, PRL/PRC validation, datum side detection |
| `index.html` | — | Entry point — upload form, 3D viewer, result cards, export buttons, EDB inputs, filter panels |
| `css/style.css` | — | All styling (no framework) |
| `test-dims.mjs` | — | Regression test — 5 dimension assertions on P7019_C1.ifc |
| `diag-template-dxf.mjs` | — | Node.js: loads P7349_C1.ifc, validates 74 VS + 49 HS holes from `_parseIFCBeamHoles()` + `_computePlates()` |
| `docs/c01-ruleset.md` | — | **Authoritative** C01 rejection/warning/zone rules — read before changing rejection logic |
| `docs/template-dxf.md` | — | Template DXF algorithm spec: plate banding, hole grouping, orientation detection, face auto-detection |
| `docs/datum.md` | — | Cage datum computation: why BNG origin is wrong, how `_cageDatum()` works |
| `tasks/output-spec.md` | — | **Contract** for every output field (EDB cells, DXF entities, CSV columns) — read before changing any export |
| `tasks/lessons.md` | — | Bug post-mortems and corrective rules — read at session start |

**Reference test cages (do not rename/delete):** `test-cages/1613_2HD70719AC1.ifc`, `test-cages/P7349_C1.ifc`, `test-cages/RF35_C01.ifc`

**Ignore:** `node_modules/`, `lib/web-ifc*.js`, `lib/*.wasm`, `*.dxf` (root, generated), `templates/*.xlsx`/`.xlsm` (gitignored, proprietary), `.aidesigner/`, `.agents/`, `.claude/`

---

## Data Flow

```
IFC file upload
  → FileReader (text + ArrayBuffer — two separate reads)
  → IFCParser.parseFile()          [ifc-parser.js]
      build entity/pset/relationship indexes
      → extractReinforcementBars()  bar objects (50+ properties each)
      → resolveAllPositions()        walk IFCLOCALPLACEMENT chain
      → classifyBars()               Mesh / Strut / Preload / Link / Unknown
      → detectCageAxis()             unique-perpendicular-positions ratio
      → tagStaggerClusters()         average-linkage, 100mm threshold
      → computeRejectionStatus()     C01 flags
      Output: allData[] (bars) + _couplerMap + cageAxisName + rejection flags
  → displayResults()               [main.js]
      stat cards, dimension boxes, C01 banners, layer weight table
      detect slab vs wall cage (_isSlabCage)
      populate face-view dropdown
  → Viewer3D.loadIFC(arrayBuffer)  [viewer3d.js — async]
      StreamAllMeshes → three bboxes → datum markers → render
      Output: _wasm3DDims {edbWidth, edbLength, edbHeight, overallHeight, overallWidth, overallLength}
  → applyFilters() / renderTable() [main.js]
      allData[] → filteredData[] → paginated rows
  → exports (gated by _parserRejected):
      exportCSV()             CSV bar schedule
      exportXLSX()            Excel (stats + layer table + bar list)
      exportEDB('ubars'|'struts')   Wall cage EDB
      exportSlabEDB()         Slab cage EDB
      exportCageReport()      C01 report PDF
      exportTemplateDXF()     VS/HS plate layout DXF
      exportFaceViewDXF()     Bar outlines DXF (per face layer)
      exportCombinedFaceDXF() Site template (600mm spacing)
```

**Key state variables (main.js):**
- `allData[]` — full bar array from parser (constant per file)
- `filteredData[]` — search/filter subset
- `_wasm3DDims` — BREP dimensions (overrides parser bbox)
- `_couplerMap` — Map<expressID, {layer, weight}> for IFCBEAM coupler heads
- `_parserRejected` — C01 gate (blocks all exports)
- `_isSlabCage` — gates wall vs slab EDB buttons
- `_rawIfcText` — retained for DXF generation

---

## Key Architecture

### Three-Bbox System (LOCKED)

| Bbox | Gate | Used for |
|---|---|---|
| `meshBbox` | `Bar_Type === 'Mesh'` only | EDB length & height |
| `allBarBbox` | any bar in barMap | EDB width |
| `totalBrepBbox` | all BREP geometry unconditionally | Display height/width/length |

**Never consolidate.** Coupler heads and struts extend beyond core mesh in different dimensions.

### Cage-Axis Detection
Unique-perpendicular-positions ratio per axis. Highest ratio = long axis. Works on X/Y/Z-running and slab cages. **Never revert to weighted span.**

### Stagger Clustering
1. Split into Z-bands (500mm tolerance) — prevents bottom/top mesh mixing
2. Average-linkage clustering on (dPerp, dZ) within each band
3. Merge threshold: `dPerp < 20mm AND dZ < 100mm`
Validated: 47→16 clusters on reference cage. Do not change thresholds without full regression.

### Weight Priority
`pset Weight > formula weight (π×r²×L×7777) > 0`
Pset authoritative. Formula for fallback/UDL only. Never use formula for cage totals.

### Face Separation Axis Detection (LOCKED)
`_detectFaceSepAxis()` — geometry-based, not from `cageAxisName`. Compares max within-layer spread on X vs Y: face bars cluster tightly on separation axis.
**All functions using face coordinates must call this. Never use `cageAxisName` for face operations.**

### PRL/PRC Zone Classification
Three-zone spatial classifier (not AABB):
- F1A zone: `Y < F1A_ABS_MIN`
- Void zone: between F1A and N1A minimums
- N1A zone: `Y > N1A_ABS_MIN`
Zone boundaries computed from actual bar positions, never hardcoded.

### Cage Datum
`_cageDatum()` — per-face-layer datum from that layer's own VS/HS bar crossing.
**Never use BNG global origin. Never mix bars from F1A into F3A datum. One datum per layer.**

### Datum Side Detection
`_detectDatumSide()` — compares N1A vs F1A face positions on separation axis, applies BNG geographic orientation (IFC-X = easting) to resolve left/right.
**Never default to `'left'` without this calculation.**

### C01 Rejection Gate (Binary)
```
isRejected = unknownCount > 0
          OR missingLayerCount > 0
          OR duplicateCount > 0
          OR missingWeightCount > 0
          OR diagonal installation
```
All-or-nothing. No partial exports. Warnings (yellow banner) are non-blocking.

### Coordinate System
```
IFC mm (Z-up, BNG-offset) → web-ifc WASM (metres, Y-up):
  engine_X =  IFC_X / 1000
  engine_Y =  IFC_Z / 1000
  engine_Z = −IFC_Y / 1000
Never modify.
```

### Multi-Vendor Support
Parser handles ATK, ICOS, INGEROP IFC formats (different pset names, spaced tokens). `isVendorRebar` check gates bar extraction. **Never assume ATK-only.**

---

## Commands

```bash
npm install                     # web-ifc Node.js native (test-only)
node test-dims.mjs              # regression test (run before every git push)
node diag-template-dxf.mjs     # generate + validate template DXF from P7349_C1.ifc
python -m http.server 8000      # local dev server (WASM needs HTTP, not file://)
```

**Test ground-truth (P7019_C1.ifc, ±20mm):** edbWidth: 1389mm | edbLength: 11082mm | edbHeight: 5080mm

**Three reference cages for full regression (must pass all three):**

| Cage | sepAxis | File |
|---|---|---|
| 1613 (2HD70719AC1) | `'y'` — IFC-X running wall | `test-cages/1613_2HD70719AC1.ifc` |
| P7349 C1 | `'x'` — IFC-Y running wall | `test-cages/P7349_C1.ifc` |
| RF35 C01 | `'z'` — slab, T/B only | `test-cages/RF35_C01.ifc` |

---

## Locked Constraints

- No build step — vanilla JS
- No npm packages beyond web-ifc
- No CSS framework
- Three-bbox model — never consolidate
- C01 all-or-nothing — no partial exports
- Pset weight authoritative — formula is fallback only
- `tasks/output-spec.md` is the contract — read before changing any export
- `templates/*.xlsm` gitignored — never commit, local-only
- Every new feature must handle all three `sepAxis` cases (`'x'`, `'y'`, `'z'`)
- H36/I36 slab EDB cells from bar `Length` property — never from world-axis coordinate extents

---

## Entry Points for Common Tasks

| Task | Where to start |
|---|---|
| New rejection rule | `js/ifc-parser.js:computeRejectionStatus()` — check `docs/c01-ruleset.md` first |
| New EDB field | `js/main.js:extractSlabData()` / `extractWallData()` — check `tasks/output-spec.md` first |
| New dimension | `js/viewer3d.js:_buildDimensions()` → update `test-dims.mjs` |
| Template DXF changes | `js/main.js:_parseIFCBeamHoles()` + `_computePlates()` — check `docs/template-dxf.md` first |
| Face view DXF | `js/main.js:exportFaceViewDXF()` |
| Site template DXF | `js/main.js:exportCombinedFaceDXF()` — check `docs/site-template-dxf.md` first |
| Bar classification | `js/ifc-parser.js:classifyBars()` |
| New vendor support | extend `isVendorRebar` in `js/ifc-parser.js` |

---

## Merge-Back Protocol (to cage-v2)

1. `git log --oneline` — identify exact commits for the feature
2. In cage-v2: `git cherry-pick <commit-hash>` (or manual diff for complex changes)
3. `node test-dims.mjs` in cage-v2 — confirm zero regressions
4. Commit and push cage-v2
5. Update `tasks/lessons.md` in cage-v2 if new patterns were discovered

---

## Active Workstreams

1. **Coupler geometry investigation** (`tasks/pop.md`) — CLOSED 31 Mar 2026
2. **Template DXF** — COMPLETE 31 Mar 2026. Verified on P7349, 1613, 1704, RF35 (162 holes).
3. **EDB template making** — ONGOING (local only, templates gitignored)

---

## Relationship to cage-v2

- cage-lab is the **sandbox**; cage-v2 is **locked/production**
- Cherry-pick specific commits from cage-lab → cage-v2 when stable
- `main.js` is 3327 lines here vs 1869 in cage-v2 — significant divergence
- GitHub Pages served from root of `main` (no build step)
