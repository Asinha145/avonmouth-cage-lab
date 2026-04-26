# avonmouth-cage-lab — Context Map

## 0. Behavioral Guidelines — Reduce Common LLM Coding Mistakes

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- Remove imports/variables/functions that YOUR changes made unused (don't remove pre-existing dead code).
- **The test:** Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.
- "Add validation" → Write tests for invalid inputs, then make them pass
- "Fix the bug" → Write a test that reproduces it, then make it pass
- "Refactor X" → Ensure tests pass before and after

---

## One-Line Summary
Sandbox / active development fork of cage-v2. Three-stage UI (passcode → production-number → datum gate). Coupler geometry, template DXF, site-template DXF with chain dimensions, COG DXF export, face-view DXF, multi-vendor IFC support. **cage-v2 is source of truth — cherry-pick only, never wholesale merge.**

---

## File Map

| File | Lines | Purpose |
|---|---|---|
| `js/ifc-parser.js` | 1043 | IFC text parser — entity/pset extraction, bar resolution (placement chain → xyz), classification, cage-axis detection, stagger clustering, coupler head extraction (BYLOR connected-rebar filtering), C01 rejection, cage-reference extraction |
| `js/viewer3d.js` | 682 | Three.js + web-ifc WASM renderer — BREP streaming, three-bbox computation, layer groups, 3D datum markers, COG sphere, plate boxes, orbit controls |
| `js/main.js` | 3500+ | UI orchestration (70+ functions) — passcode gate, production-number validation, cage-reference auto-extraction, datum gate (Set/Reset), file upload, parser→viewer pipeline, stats, tables, filtering/pagination, all export functions (CSV, XLSX, EDB wall, EDB slab, C01 report, template DXF, site template DXF, face view DXF, COG DXF), step detection, PRL/PRC validation, datum side detection, datum bar end extraction |
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
Page Load
  → Passcode gate (sessionStorage check; 4286 to unlock)
  → Locked state: upload form hidden, exports hidden

IFC file upload + Production Number (mandatory)
  → Cage Viewer button enabled (file + production-number both filled)
  → Production Number stored in _productionNumber global
  → Cage Reference auto-extracted from IFC Avonmouth pset (or filename fallback)
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
      StreamAllMeshes → three bboxes → COG sphere → datum markers → render
      Output: _wasm3DDims {edbWidth, edbLength, edbHeight, overallHeight, overallWidth, overallLength, cog: {ifcX, ifcY, ifcZ, heightFromBase, totalWeight, barsUsed}}
  → Datum gate appears
      _brepReady = true → Datum Side dropdown + Height (for slab) + "Set Datum" button shown
      All exports disabled (locked icon) until "Set Datum" clicked
  → User selects Datum Side (+ Height for slab) + clicks "Set Datum"
      _datumSet = true → all exports unlocked, confirmed notice shown
      "Reset Datum" button shown (resets _datumSet = false, re-locks exports, re-shows datum markers at initial position)
  
  → applyFilters() / renderTable() [main.js]
      allData[] → filteredData[] → paginated rows
  
  → exports (gated by _datumSet AND _parserRejected):
      exportCSV()             CSV bar schedule
      exportXLSX()            Excel (stats + layer table + bar list)
      exportEDB('ubars'|'struts')   Wall cage EDB
      exportSlabEDB()         Slab cage EDB
      exportCageReport()      C01 report PDF
      exportTemplateDXF()     VS/HS plate layout DXF (+ center Ø5mm hole if plate > 500mm)
      exportFaceViewDXF()     Bar outlines DXF (per face layer, BREP)
      exportCombinedFaceDXF() Site template DXF (BREP bars + coupler holes + chain dims from datum end per layer)
      exportCOGDXF()          COG DXF (external face BREP + COG marker + H/V dims from datum end)
```

**Key state variables (main.js):**
- `_productionNumber` — production number entered before Cage Viewer (mandatory)
- `_cageReference` — cage reference auto-extracted from IFC Avonmouth pset (or filename fallback)
- `_datumSet` — true after user clicks "Set Datum"; false after "Reset Datum" or processFile() start
- `_brepReady` — true after BREP loads; gates datum block visibility
- `allData[]` — full bar array from parser (constant per file)
- `filteredData[]` — search/filter subset
- `_wasm3DDims` — BREP dimensions (edbWidth, edbLength, edbHeight, cog, etc.)
- `_couplerMap` — Map<expressID, {layer, weight}> for IFCBEAM coupler heads (BYLOR-filtered)
- `_parserRejected` — C01 gate (blocks EDB/report exports)
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

### Cage-Axis Detection (Parser Only)
The parser's `detectCageAxis()` computes `cageAxisName` (X/Y/Z) using unique-perpendicular-positions ratio per axis. This is used **only as an informational label** (CSV/Excel/badge display). 

**Do not use `cageAxisName` for dimension-driving logic.** The parser's ratio heuristic is unreliable for horizontal-axis detection — P7349 returns 'Z' (vertical bars dominate the ratio) even though the cage runs in Y, forcing `_buildDimensions()` to fall back to dumb max/min heuristics.

See "Face Separation Axis Detection (LOCKED)" below for the correct approach.

### Stagger Clustering
1. Split into Z-bands (500mm tolerance) — prevents bottom/top mesh mixing
2. Average-linkage clustering on (dPerp, dZ) within each band
3. Merge threshold: `dPerp < 20mm AND dZ < 100mm`
Validated: 47→16 clusters on reference cage. Do not change thresholds without full regression.

### Weight Priority
`pset Weight > formula weight (π×r²×L×7777) > 0`
Pset authoritative. Formula for fallback/UDL only. Never use formula for cage totals.

### Face Separation Axis Detection (LOCKED) — Replaces cageAxisName
`_detectFaceSepAxis()` — geometry-based detection, not a heuristic. Compares max within-layer spread on X vs Y across all face layers (F/N or T/B):
- Face bars are tightly clustered on the **separation axis** (F1A all bars at X±50mm)
- Face bars spread the full cage length on the **other horizontal axis** (Y±10,267mm)
- Returns `'x'`, `'y'`, or `'z'` (slab, no horizontal separation)

**Critical:** All dimension-driving and coordinate-projection logic calls this function. Never substitute `cageAxisName`. The parser's ratio-based axis detection is unreliable for horizontal geometry — it gets dominated by vertical-bar counts.

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
- **Dimension logic drives off `_detectFaceSepAxis()` output, never `cageAxisName`** — cageAxisName is informational only
- Slab cage axis detection uses **T2/B2 bar direction vectors** (sum |Dir_X| vs |Dir_Y|), not cageAxisName
- Every new feature must handle all three `sepAxis` cases (`'x'`, `'y'`, `'z'`)
- H36/I36 slab EDB cells from bar `Length` property — never from world-axis coordinate extents

### Three-Stage UI Flow (LOCKED)

**Stage 1: Passcode Gate**
- Passcode: `'4286'` (change before production deploy)
- Stores unlock in `sessionStorage` — persists until browser closed
- Only thing visible on page load: passcode card

**Stage 2: Upload + Production Number**
- After unlock, upload form visible
- "Cage Viewer" button disabled until BOTH file + production number filled
- Cage Reference auto-populated from `parser.cageReference` (extracted from IFC Avonmouth pset, case-insensitive keys: Building, Pour, Site, Cage)
- If extraction fails: Cage Reference input is editable + warning indicator

**Stage 3: Datum Gate**
- After BREP loads (3D viewer rendered): datum block appears
- Datum Side dropdown auto-detected from geometry (`_detectDatumSide()`)
- For slab cages (sepAxis === 'z'): additional Datum Height dropdown (Top/Bottom)
- All 8 export buttons disabled (locked icon) until "Set Datum" clicked
- User selects datum side and clicks "Set Datum" → `_datumSet = true` → exports unlock
- "Reset Datum" button becomes visible; clicking it re-locks exports + re-shows datum markers at initial position

**Secondary Gates (stacked on datum gate):**
- C01 rejection: EDB + Report buttons stay disabled even if datum set
- VSHS presence: Template DXF button stays disabled if cage has no VS/HS bars
- Slab/wall: Slab EDB button only visible for slab cages

### DXF Export Architecture

Three DXF types, each using `_cageDatum()` as shared origin:

| Export | Content | BREP | Datum | Filename |
|---|---|---|---|---|
| Template DXF | Plate layout (VS/HS holes + centerline outlines) | LINE diagram (bar endpoints) | Via coord transform | `{prodNum}-{cageRef}-template.dxf` |
| Site Template DXF | Full BREP + coupler holes + dimension chains from datum end per rebar layer | BREP convexHull2D (full geometry) | Subtracted from coords | `{prodNum}-{cageRef}-site-template.dxf` |
| Face View DXF | Single face BREP outline only (debug) | BREP convexHull2D | Subtracted from coords | `{cageRef}-{faceName}.dxf` |
| COG DXF | External face BREP + COG marker circle + H/V dims from datum bar end | BREP convexHull2D | Subtracted from coords + used for dim origin | `{prodNum}-{cageRef}-COG.dxf` |

All use same DXF 2D helpers: `LINE(x0, z0, x1, z1, layer)`, `CIRCLE(x, z, r, layer)`, `TEXT(x, z, str, h, layer)`, `HDIM(x0, x1, z, label)`, `VDIM(x, z0, z1, label)`.

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
3. **Three-Stage UI Refactor** — COMPLETE 24 Apr 2026. Passcode → Production Number → Datum Gate. Cage Reference auto-extraction from IFC.
4. **BYLOR Coupler Hole Filtering** — COMPLETE 24 Apr 2026. Template DXF filters couplers via `connected_rebar` pset property + layer validation (VS/HS only).
5. **DXF Improvements** — COMPLETE 24 Apr 2026:
   - Template DXF: center Ø5mm mounting hole when plate > 500mm (either dimension)
   - Site Template DXF: removed CPLR text labels, BARS layer green→white, added plate naming format, activated chain dimensions from datum rebar fixed ends per layer
   - COG DXF: new export with external face BREP, COG marker circle, H/V dimensions from datum bar end
6. **EDB template making** — ONGOING (local only, templates gitignored)

---

## Relationship to cage-v2

- cage-lab is the **sandbox**; cage-v2 is **locked/production**
- Cherry-pick specific commits from cage-lab → cage-v2 when stable
- `main.js` is 3327 lines here vs 1869 in cage-v2 — significant divergence
- GitHub Pages served from root of `main` (no build step)
