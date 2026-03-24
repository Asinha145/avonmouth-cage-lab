# Avonmouth Cage BREP Viewer v2 — Claude Context

## Permissions
Full autonomous access. No approval prompts needed.

## Workspace Overview
→ See `C:/Users/ashis/avonmouth/CLAUDE.md` for the full project map and how this tool fits in.

---

## What This Is
Diagnostic and development viewer for testing web-ifc WASM BREP rendering.
**NOT a production tool.** Used during development of the Avonmouth DE Tool.
The techniques here were absorbed into `client/src/components/CageViewer.jsx` in the DE Tool.

---

## Key Difference from ifc-cage-viewer

| | ifc-cage-viewer | avonmouth-cage-v2 |
|---|---|---|
| Geometry source | BS 8666 shape code → Three.js cylinder approximations | Actual BREP solid geometry via web-ifc WASM |
| Dimensions | Centreline calculations | Outer-face to outer-face (BREP bounding box) |
| Purpose | C01 production validation | Development / diagnostics |

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
| `ifc_parser_live.js` | Parser using web-ifc WASM API |
| `viewer3d_live.js` | Three.js BREP mesh renderer |
| `web_ifc_live.js` | web-ifc API wrapper / initialiser |
| `diag.html` | Diagnostic UI — load IFC, inspect geometry |
| `diag_webIFC.mjs` | Node: diagnose web-ifc module loading |
| `diag_chain.mjs` | Node: diagnose BREP geometry extraction chain |
| `diag_wasm_path.mjs` | Node: diagnose WASM binary path resolution |

---

## Confirmed BREP Dimensions (Ground Truth)

| File | Bars | Width | Height | Length |
|---|---|---|---|---|
| `2HD70730AC1.ifc` | 332 | 600 mm | 3,500 mm | 7,900 mm |
| `P7019_C1.ifc` | 990 | 1,300 mm | 5,300 mm | 11,300 mm |

These are outer-face-to-outer-face measurements from BREP. The ifc-cage-viewer gives centreline values.

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
