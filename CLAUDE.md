# Avonmouth Cage BREP Viewer v2 — Claude Context

## Permissions
Full autonomous access. No approval prompts needed.

## Workspace Overview
→ See `C:/Users/ashis/avonmouth/CLAUDE.md` for the full project map and how this tool fits in.

---

## What This Is
IFC cage 3D viewer + dimension engine using web-ifc WASM BREP geometry.
Produces EDB-quality cage dimensions (edbWidth, edbLength, edbHeight) and overall cage envelope
dimensions (height, overallWidth, overallLength) from actual solid geometry — not shape-code
centreline approximations.

---

## Key Difference from ifc-cage-viewer

| | ifc-cage-viewer | avonmouth-cage-v2 |
|---|---|---|
| Geometry source | BS 8666 shape code → Three.js cylinder approximations | Actual BREP solid geometry via web-ifc WASM |
| Dimensions | Centreline calculations | Outer-face to outer-face (BREP bounding box) |
| Purpose | C01 production validation | Dimension engine + 3D viewer |

---

## Tech Stack
- **web-ifc v0.0.77** (`lib/web-ifc-api-iife.js` + `lib/web-ifc.wasm`)
- Vanilla JS, no build step, browser-only
- Three.js via CDN
- Node.js `.mjs` diagnostic scripts (run locally for debugging)

---

## Coordinate Conversion (web-ifc → Three.js)
IFC is mm Z-up. web-ifc converts to metres Y-up:
```
engine_X =  IFC_X / 1000
engine_Y =  IFC_Z / 1000   ← IFC Z becomes Three.js Y
engine_Z = −IFC_Y / 1000   ← IFC Y becomes Three.js Z (negated)
```

---

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Main BREP viewer entry point |
| `js/ifc-parser.js` | IFC text parser — bar extraction, pset mapping, cage axis detection |
| `js/viewer3d.js` | Three.js BREP mesh renderer + dimension engine |
| `js/main.js` | UI controller — wires parser → viewer → EDB export |
| `test-dims.mjs` | Node: regression test — run before every git push |
| `diag.html` | Diagnostic UI — load IFC, inspect geometry |
| `diag_webIFC.mjs` | Node: diagnose web-ifc module loading |
| `diag_chain.mjs` | Node: diagnose BREP geometry extraction chain |

---

## Dimension System Architecture (`js/viewer3d.js`)

Three bounding boxes are maintained during `StreamAllMeshes`:

| bbox | Populated by | Provides |
|---|---|---|
| `meshBbox` | Mesh bars only (`Bar_Type === 'Mesh'`) | `edbLength`, `edbHeight` |
| `allBarBbox` | All bars in barMap (any type) | `edbWidth` |
| `totalBrepBbox` | ALL geometry vertices, no barMap gate | `height`, `overallWidth`, `overallLength` |

`_buildDimensions(cageAxisName)` returns:

| Field | Source | Used by |
|---|---|---|
| `edbWidth` | allBarBbox — all bars cross-section | Excel/EDB cage width |
| `edbLength` | meshBbox — mesh cage only | Excel/EDB cage length |
| `edbHeight` | meshBbox — mesh cage only | Excel/EDB cage height + pallet/bespoke (H19) |
| `height` | totalBrepBbox | Website display |
| `overallWidth` | totalBrepBbox | Website display |
| `overallLength` | totalBrepBbox | Website display |

`cageAxisName` ('X'/'Y'/'Z' from `parser.cageAxisName`) is passed to `loadIFC()` and used
to definitively assign length vs width axes — no brittle min/max heuristic.

### Why totalBrepBbox (not allBarBbox) for overall dims
`allBarBbox` has a `if (bar)` gate — IFCBEAM coupler entities are not in barMap and would be
excluded. `totalBrepBbox` has zero barMap dependency so it always gives the true outer envelope
including couplers.

### BREP height vs text parser height
**BREP is more accurate for bent bars.** The text parser computes `End_Z = Start_Z + Dir_Z × Length`,
treating every bar as straight. For bent bars (e.g. Shape Code 26 Z-bars), the horizontal legs
reduce the actual vertical contribution. The BREP correctly renders the bent geometry and gives
the true outer-face cage height.

Example: 1704 cage (2HD70730AC2):
- Text parser: 5800mm (bar cut length projected along Z — OVERESTIMATES for bent bars)
- BREP: 5779mm (actual outer-face geometry — CORRECT)

## Confirmed BREP Dimensions (Ground Truth)

| File | edbWidth | edbLength | edbHeight | height (total) | overallLength (total) |
|---|---|---|---|---|---|
| `P7019_C1.ifc` | 1,389 mm | 11,082 mm | 5,080 mm | 5,311 mm | 11,282 mm |
| `2HD70730AC2.ifc` (1704) | 439 mm | 6,500 mm | 5,779 mm | 5,779 mm | 6,665 mm |

`total` dims include IFCBEAM couplers. EDB dims are rebar only.

---

## Running Diagnostics
```bash
# From this folder — diagnose why web-ifc WASM fails to load
node diag_webIFC.mjs

# Trace the geometry extraction pipeline
node diag_chain.mjs path/to/cage.ifc

# Check WASM binary path resolution
node diag_wasm_path.mjs
```

---

## Relationship to Other Projects
- `ifc-cage-viewer` → C01 validation (separate, do not merge)
- `avonmouth-de-tool` → absorbed these BREP techniques into `CageViewer.jsx`
- This folder is safe to use for isolated WASM experiments without affecting production code

---

---

## Slab Cage Support (T1A / B1A)

Slab cages have only T1A and B1A mesh layers (no F1A / N1A). Detected by `IFCParser.isSlabCage(bars)`.

### ATK_Layer_Name roles for slab cages

| ATK_Layer_Name | Mesh Face | Physical role | Runs along |
|---|---|---|---|
| T1 / T1-CPLR | T1A | **Height**-direction bars | cage height axis |
| T2 / T2-CPLR | T1A | **Length**-direction bars | cage length axis |
| B1 / B1-CPLR | B1A | Height-direction bars | cage height axis |
| B2 / B2-CPLR | B1A | Length-direction bars | cage length axis |

### EDB cell derivation rules

| Cell | Parameter | Derived from |
|---|---|---|
| H36 | Cage length | `max(Length)` of **T2+B2** bars |
| I36 | Cage height | `max(Length)` of **T1+B1** bars |
| J36 | Total weight (T) | sum `Formula_Weight` all bars ÷ 1000 |
| N36 | T1 dominant dia | modal `Size` of T1* bars |
| O36 | T1 spacing | Y-span of T1-CPLR positions ÷ (count−1) → nearest 5mm |
| P36 | T2 dominant dia | modal `Size` of T2* bars |
| Q36 | T2 spacing | X-span of T2-CPLR positions ÷ (count−1) → nearest 5mm |
| R36 | T2 bar count | unique T2 X-positions |
| T36 | B1 dominant dia | modal `Size` of B1* bars |
| U36 | B1 spacing | Y-span of B1-CPLR positions ÷ (count−1) → nearest 5mm |
| V36 | B2 dominant dia | modal `Size` of B2* bars |
| W36 | B2 spacing | X-span of B2-CPLR positions ÷ (count−1) → nearest 5mm |
| X36 | B2 bar count | unique B2 X-positions |
| Z36 | Mesh-only weight (T) | sum T1A+B1A `Formula_Weight` ÷ 1000 |

### ⚠ Critical implementation rule

**Always derive H36/I36 from bar `Length` property of the named layer, NOT from world-axis coordinate extents.**

```javascript
// WRONG — orientation-dependent, silently breaks on rotated cages
const lenMm = Math.max(...allX) - Math.min(...allX);

// CORRECT — orientation-independent
const lenMm = Math.max(...t2b2bars.map(b => b.Length || 0));  // H36
const hgtMm = Math.max(...t1b1bars.map(b => b.Length || 0));  // I36
```

See `tasks/lessons.md` for the full post-mortem.

---

## Lessons File

`tasks/lessons.md` — error patterns and corrective rules. Read before touching `extractSlabData()`.

---

## Do Not
- Deploy this folder or expose it via a server
- Use this as the source of bar geometry dimensions in production reports
- Install additional npm packages here (it is intentionally dependency-light)
