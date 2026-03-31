# Output Specification — Avonmouth Cage Lab

> This is the contract. Every output field is defined here with its source, unit, and derivation rule.
> Before implementing any output-touching change, read this file.
> If a request conflicts with this spec, the spec wins — update the spec first, then implement.

---

## 1. Website Display Outputs

### 1.1 Mesh Height Card
| Field | Value | Source | Notes |
|---|---|---|---|
| Height | mm | `_wasm3DDims.edbHeight` (BREP) | Shows "BREP ✓" indicator. Refreshes when BREP loads. Falls back to text-parser `heightAlongAxis()` only if BREP not yet loaded. BREP is authoritative for bent bars (shape codes ≠ 01/21). |

**Critical rule:** Never use text-parser projected height as the final value. For Shape Code 26 bars the parser overestimates by projecting the full cut length along Z. BREP gives the true outer-face span.

### 1.2 Layer Weight Table
| Column | Source | Notes |
|---|---|---|
| Bar weight | `b.Weight ?? b.Formula_Weight ?? 0` per bar | ATK pset `Weight` is authoritative. `Formula_Weight` (geometry estimate) is fallback only. |
| Coupler weight | `_couplerMap` — `c.weight` (ATK Couplers Parts pset, kg) | Shown as `+X.XX cpls` annotation per layer row. |
| Combined weight | bar weight + coupler weight | This is the displayed weight. |
| Total row | Sum of combined weights | Includes `(incl. X kg couplers)` note. |

### 1.3 UDL Display
| Component | Derivation |
|---|---|
| Mesh UDL | `(meshFormulaWeight + couplerMeshWeight) / cageArea` |
| Non-mesh UDL | `(nonMeshFormulaWeight + couplerNonMeshWeight) / cageArea` |

**Note:** UDL uses `Formula_Weight` (geometry) not `Weight` (ATK pset) for the bar component — this is intentional for UDL ratio display, as geometry weight is consistent across all cages regardless of pset completeness. Coupler weight is always from the ATK Couplers Parts pset.

**Coupler split rule:** A coupler is "mesh" if its layer matches `/^[FNBTfnbt]\d+A$/i` (F1A, N1A, T1A, B1A). Everything else (PRL, PRC, VS, HS) is non-mesh.

---

## 2. Wall Cage EDB Outputs (Excel)

| Cell | Parameter | Source | Unit |
|---|---|---|---|
| C33 | Mesh UDL | `(meshW + couplerMeshW) / area` | kN/m² |
| C37 | Non-mesh UDL | `(nonMeshW + couplerNonMeshW) / area` | kN/m² |
| Width | edbWidth | `allBarBbox` (all bar types, BREP) | mm → m |
| Length | edbLength | `meshBbox` (mesh bars only, BREP) | mm → m |
| Height | edbHeight | `meshBbox` (mesh bars only, BREP) | mm → m |

**edbWidth source:** All bars in `barMap` (links + struts define real cross-section). NOT `totalBrepBbox` (which includes coupler head physical extent and would overstate cage width).

---

## 3. Slab Cage EDB Outputs (Excel)

| Cell | Parameter | Source | Unit | Notes |
|---|---|---|---|---|
| H36 | Cage length | `max(Length)` of T2+B2 bars | mm → m | Bar intrinsic Length from pset — NOT world-axis extent |
| I36 | Cage height | `max(Length)` of T1+B1 bars | mm → m | Bar intrinsic Length from pset — NOT world-axis extent |
| J36 | Total weight | `sum(b.Weight ?? b.Formula_Weight ?? 0)` all bars + all coupler heads | tonnes | ATK pset weight authoritative |
| N36 | T1 dominant dia | modal `Size` of T1* bars | mm | |
| O36 | T1 spacing | Y-span of T1-CPLR positions ÷ (count−1) → nearest 5mm | mm | N bars = N−1 gaps |
| P36 | T2 dominant dia | modal `Size` of T2* bars | mm | |
| Q36 | T2 spacing | X-span of T2-CPLR positions ÷ (count−1) → nearest 5mm | mm | N bars = N−1 gaps |
| R36 | T2 bar count | unique T2 X-positions | count | |
| T36 | B1 dominant dia | modal `Size` of B1* bars | mm | |
| U36 | B1 spacing | Y-span of B1-CPLR positions ÷ (count−1) → nearest 5mm | mm | N bars = N−1 gaps |
| V36 | B2 dominant dia | modal `Size` of B2* bars | mm | |
| W36 | B2 spacing | X-span of B2-CPLR positions ÷ (count−1) → nearest 5mm | mm | N bars = N−1 gaps |
| X36 | B2 bar count | unique B2 X-positions | count | |
| Z36 | Mesh-only weight | `sum(b.Weight ?? b.Formula_Weight ?? 0)` T1A+B1A bars + mesh coupler heads | tonnes | ATK pset weight authoritative |

---

## 4. 3D Viewer Layer Groups

| groupKey | What it contains | Colour |
|---|---|---|
| `bar.Avonmouth_Layer_Set` (e.g. 'F1A') | All IFCREINFORCINGBAR in that layer | Layer colour |
| `coupler.layer` (e.g. 'F1A') | IFCBEAM couplers with that layer pset | Same as layer colour |
| `'Coupler Head'` | IFCBEAM couplers with no layer pset | Gray `0x888888` |
| `'PRL/PRC Mismatch'` | Bars where PRL/PRC classifier disagrees | Distinct mismatch colour |
| `'Unknown'` | Any entity with no barMap and no couplerMap entry | Should be empty — investigate if populated |

**Rule:** 'Unknown' appearing in the layer filter is always a bug. It means an IFC entity type is not handled. Investigate before shipping.

---

## 5. Dimension System — Source of Truth

| Dimension | bbox | Gate | Output fields |
|---|---|---|---|
| edbLength | `meshBbox` | `bar.Bar_Type === 'Mesh'` | Excel cage length |
| edbHeight | `meshBbox` | `bar.Bar_Type === 'Mesh'` | Excel cage height, height card |
| edbWidth | `allBarBbox` | `bar` (any type in barMap) | Excel cage width |
| height | `totalBrepBbox` | None — unconditional | Website overall height |
| overallLength | `totalBrepBbox` | None — unconditional | Website overall length |
| overallWidth | `totalBrepBbox` | None — unconditional | Website overall width |

---

## 6. Template DXF Output ✅ COMPLETE (31 Mar 2026)

See `docs/template-dxf.md` for full specification.

| Field | Value |
|---|---|
| Format | AC1009 (AutoCAD R12), mm units |
| Faces | One section per face: F1A, N1A (wall); T1A, B1A (slab) |
| Hole size | Coupler OD (`ATK EMBEDMENTS HEIGHT`) + 2mm tolerance |
| Plate constraint | Max 2000mm length × 300mm width |
| Edge clearance | 25mm from nearest hole edge to plate edge |
| VS plate orientation | Long = Z (height) for wall cages, auto-detect |
| HS plate orientation | Long = px (cage length), hardcoded |
| px axis | `yMm − datumPx` via `_cageDatum()` (was `globalMinY`) |
| pz axis | `zMm − datumPz` via `_cageDatum()` (was per-face `minP`) |
| Face sep axis | From `_detectFaceSepAxis()` — geometry-based, not `cageAxisName` |

**Datum fix (commit b9b0362):** `globalMinY` and per-face `minP` replaced with `_cageDatum()` so template and face view share the same coordinate origin.

**Verified output — P7349:** F1A=74 holes (25 VS + 49 HS, 8 plates), N1A=88 holes (5 HS plates, ~20 holes = 10+10 parallel rows, ~1850×217mm).

---

## 7. Site Template DXF ✅ COMPLETE (31 Mar 2026)

See `docs/site-template-dxf.md` for full specification.

Combined orthographic face elevation + coupler plate template for site use.

| Field | Value |
|---|---|
| Format | AC1009 (AutoCAD R12), real mm coordinates |
| Scale | 1:15 stated in title block — set plot scale in AutoCAD |
| Faces | One section per face with VS/HS holes — F1A + N1A for P7349 |
| BARS layer | BREP convex hull bar outlines (green, colour 3) |
| HOLES layer | Coupler hole circles at face coords (red, colour 1) |
| PLATE_OUTLINE | Plate rectangles from `_computePlates()` at face coords (blue, colour 5) |
| DIMS layer | Overall span + per-hole tick marks (grey, colour 8) |
| Datum | `_cageDatum()` — shared across BARS and HOLES, exact overlay |
| Paper size | A1 landscape at 1:15 (688mm wide × ~700mm tall for two sections) |

**Verified — P7349:** F1A 72 bars + 74 holes, N1A 71 bars + 88 holes. Datum px=6,237,394 pz=12,864. VS hole px=5,202 pz=1,700 within bounds ✓

---

## 8. Active Lab Workstreams (outputs not yet finalised)

### 8.1 Coupler Geometry — Outside-Zone Detection
**Target output:** Correct `outside` flag on each bar using both endpoints.
```javascript
// To implement in zone classification
const maxY = Math.max(b.Start_Y ?? -Infinity, b.End_Y ?? -Infinity);
const minY = Math.min(b.Start_Y ?? Infinity,  b.End_Y ?? Infinity);
const outside = minY < N1A_ABS_MIN || maxY > F1A_ABS_MAX;
```
**Affected output:** Zone report, bar outside-zone count (currently 25 detected, 34 actual).
**Do not merge back to cage-v2 until the 9 through-bars are correctly classified.**

### 8.2 EDB Template Making
**Target:** New or revised EDB template file(s) in `templates/` (local only — gitignored).
Any JS-side changes that support the new template → must be spec'd here before implementation.
Template structure changes must not alter existing cell references for H36–Z36 without a spec update.

---

## Drift Rules (enforced by Claude)

If a request would:
- Change a weight source from `Weight` to `Formula_Weight` without justification → **blocked**
- Use world-axis extents for H36/I36 instead of bar `Length` → **blocked, redirect to spec**
- Add a new output field without adding it to this spec first → **spec updated first, then coded**
- Change an EDB cell reference without a structural reason → **ask why before touching**
- Make 'Unknown' acceptable in the layer filter → **rejected, must be investigated**
