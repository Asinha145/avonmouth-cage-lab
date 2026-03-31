# Investigation Cache — P7349 C1.ifc

*Captured 31 Mar 2026. Re-open this before investigating P7349 again.*
*Diagnostic scripts are in `C:/Users/ashis/avonmouth-de-tool/`*

---

## File Identity

| Field | Value |
|---|---|
| Pour | 7349 |
| Cage | C1 |
| File (sample copy) | `C:/Users/ashis/avonmouth-de-tool/Sample/P7349_C1.ifc` |
| File (downloads) | `C:/Users/ashis/Downloads/P7349 C1.ifc` |
| File size | ~5.52 MB |
| Total IFCREINFORCINGBAR | ~1,195 |
| Total IFCBEAM (coupler heads) | 1,896 |

---

## Wall Geometry & Orientation

| Axis | Meaning | Dimension |
|---|---|---|
| **X** | Wall **thickness** (F-face to N-face) | **1,357 mm** (confirmed Navisworks outer-to-outer) |
| **Y** | Wall **length** (along wall run) | **10,267 mm** |
| **Z** | Wall **height** | — |

- `cageAxisName = 'Y'` (cage runs along Y)
- Face separation axis = **X** (not Y — this caused a bucketing bug now fixed)
- F1A face at X ≈ **1,979,345** mm (BNG easting)
- N1A face at X ≈ **1,980,649** mm (BNG easting)
- Face-to-face (bar centreline to bar centreline) = **1,304 mm**
- Outer formwork offset from bar centreline ≈ **20 mm** each side (bar radius + standoff)
- Outer formwork face-to-face ≈ 1,344 mm ≈ matches 1,357 mm Navisworks (cover variation)

---

## Layer Structure

Wall has **multiple reinforcement layers** in X (depth into wall):

| Layer | X median (approx) | Role |
|---|---|---|
| F1A | 1,979,345 | Front face (F-side) |
| N1A | 1,980,649 | Back face (N-side) |
| N3A | deeper (higher X) | Inner layer |
| F3A | deeper | Inner layer |
| N5A | deepest | Inner layer |
| F5A | deepest | Inner layer |

HS coupler buckets (from diagnostic):
- F1A → 63 HS beams
- N3A → 46 HS beams
- F3A → 26 HS beams
- N5A → 2 HS beams

---

## Key Entity GlobalIds (investigated in detail)

| Role | GlobalId | Entity # | IFC Type |
|---|---|---|---|
| HS1 rebar (00GFGF) | `2V30b8CAWQgCa2A3wDjyH8` | #31746 | IFCREINFORCINGBAR |
| Coupler A — N1A end | `3fsQj3vm51s86JBIjuGSap` | #24655 | IFCBEAM |
| Coupler B — F1A end | `3IAE85PRzDw9CV9QUPOZHd` | #9793 | IFCBEAM |
| N1A reference bar | `2fiaUYCrVFWDx5SgPxyhUM` | #1604 | IFCREINFORCINGBAR |
| F1A reference bar | `2iQ4TGBxnVjdgKslHvZxgn` | #2338 | IFCREINFORCINGBAR |

---

## Rebar #31746 Detail (HS1 — 00GFGF)

```
Layer:        HS1 (Avonmouth pset Layer/Set)
ATK layer:    T1-CPLR
Shape Code:   00GFGF  (straight bar, FEMALE coupler both ends)
Length:       1500 mm
Bar size:     T20 (AG20N couplers)
Number:       22 bars in group (mapped representation)
Weight:       81.4 kg (group)
Coupler type: AG20N / FEMALE both ends / model FPGS2022005

Placement:
  Origin:  X=1,980,750.068  Y=6,237,372.995  Z=17,489.497
  refDir:  (-1, 0, 0)  — runs in -X direction

BREP global bbox:
  X: [1,979,250.07 → 1,980,750.07]  span = 1,500 mm  ← long axis
  Y: [6,238,044.54 → 6,238,064.45]  span = 20 mm     ← cross-section (hexagonal)
  Z: [17,405.50    → 17,428.50   ]  span = 23 mm     ← cross-section

Bar runs from F1A end (X=1,979,250) to N1A end (X=1,980,750).
```

---

## Coupler Geometry — Ground Truth

### Rule (confirmed from BREP + Navisworks measurement)

```
Placement origin  =  inner face of coupler  (bar-connection end, INSIDE cage)
Free end          =  origin + refDir × coupler_length  (PROTRUDING end, outside face)
Coupler length    =  110 mm  (ATK EMBEDMENTS 'LENGTH' pset)
Coupler OD        =  31 mm   (ATK EMBEDMENTS 'HEIGHT' pset — AG20N)
ATK Coord Point   =  origin + refDir × 55  (midpoint — cross-check only)
```

### Coupler A (#24655) — N1A face end

```
Origin:     X=1,980,640.068  Y=6,238,054.495  Z=17,416.997
refDir:     (+1, 0, 0)
Free end X: 1,980,640.068 + 110 = 1,980,750.068

N1A bar centre X:           1,980,649.070
Free end → N1A bar:         101.0 mm  (from bar centreline)
Minus outer face offset ~20mm  →  pop-out = 81 mm  ✓  (confirmed Navisworks)

ATK Coordinate Point X:     1,980,695.1  (midpoint, = origin + 55 = 1,980,695.1 ✓)
```

### Coupler B (#9793) — F1A face end

```
Origin:     X=1,979,360.068  Y=6,238,054.495  Z=17,416.997
refDir:     (-1, 0, 0)
Free end X: 1,979,360.068 - 110 = 1,979,250.068

F1A bar centre X:           1,979,345.468
F1A bar → free end:         95.4 mm  (from bar centreline)
Minus outer face offset ~20mm  →  pop-out = 75 mm  ✓  (confirmed Navisworks)

ATK Coordinate Point X:     1,979,305.1  (midpoint, = origin - 55 = 1,979,305.1 ✓)
```

---

## Shape Code Survey

Only 29 bars carry explicit ATK Shape Code psets (rest use Bylor linkage only):

| Shape Code | Count | Coupler type |
|---|---|---|
| `00GFGF` | 22 | Straight, female both ends |
| `00GMBGF` | ~3 | Male-bolted + female |
| `00GMB` | 1 | Male-bolted single end |
| `00GF` | 1 | Female single end |
| `21DHD` | 48 | U-bar, double-headed |
| `12LGF` | 1 | Lap + female |

**Suffix rule:** GFGF / GMGM / GMBGF → 2 couplers per bar → 2 holes needed.

---

## IFCBEAM Count Cross-Check

| Beams per rebar | Rebars | Total beams | Pattern |
|---|---|---|---|
| 1 | 801 | 801 | Single sleeve or single DHD head |
| 2 | 75 | 150 | Dual sleeve (GFGF/GMGM) |
| 3 | 315 | 945 | 2 sleeves + 1 splice rod (GMBGF) |
| **Total** | **1,191** | **1,896** | ✓ matches file IFCBEAM count |

---

## IFCBEAM Types Breakdown

| Type | Count | Description |
|---|---|---|
| CHS52×16.5 | 656 | DHD headed reinforcement |
| AG40N/PD61×7 | 390 | 40mm female sleeve |
| AG32N/PD47×5 | 279 | 32mm female sleeve |
| AGB40/ROD65 | 218 | 40mm bolted splice rod |
| AG20N/PD31×4 | 165 | 20mm female sleeve (includes #24655, #9793) |
| AGB32/ROD50 | 141 | 32mm bolted splice rod |
| CHS40×13 | 32 | DHD headed (smaller) |
| AG25/AGB25 | 15 | 25mm variants |

---

## IFCLOCALPLACEMENT Pattern

All 224 IFCBEAM placements in P7349 use **relative** placement:
```
IFCLOCALPLACEMENT(#14, #axId)   ← #14 = parent ref (NOT $ absolute)
```
Tekla still encodes **global BNG coordinates** directly in the CartesianPoint regardless.
No parent chain walk needed. Regex must use `[^,)]*` not `\$` for first arg.

---

## Pset Names Present

| Pset | Used for |
|---|---|
| `'ATK EMBEDMENTS'` | Coupler OD (`HEIGHT`), length (`LENGTH`) |
| `'ATK Coordinate Point'` | Coupler midpoint X/Y/Z |
| `'Avonmouth'` | `Layer/Set` (VS1, HS1, F1A, N1A, etc.) |
| `'Bylor'` | `connected_rebar` GlobalId link |
| `'ATK Rebar'` | Shape code, bar size, weight, Dim_X etc. |

---

## Bucketing Fix Applied (31 Mar 2026, corrected same day)

`_bucketHolesByFace` was comparing Y to separate F/N faces. For P7349 faces are in X.

**First attempt (wrong):** Used `cageAxisName === 'Y'` to set sepAxis='x'. This never fired because the parser detects P7349 as `cageAxisName='Z'` (vertical wall bars dominate the axis ratio).

**Correct fix:** `_detectFaceSepAxis()` — compares max within-layer spread on X vs Y. F1A bars are tightly clustered in X (±50mm) but span 10,267mm in Y → xMaxRange (50mm) << yMaxRange (10,267mm) → `sepAxis='x'`. No dependence on `cageAxisName`.

```javascript
const maxRange = (key) => Math.max(...layers.map(pts => {
    const vals = pts.map(p => p[key]).filter(v => v != null).sort((a,b) => a-b);
    return vals.length >= 2 ? vals[vals.length-1] - vals[0] : 0;
}));
return maxRange('x') < maxRange('y') ? 'x' : 'y';
```

**useLongY** in `exportTemplateDXF` similarly fixed: `faceSepAxis === 'x' && !useY` (not `cageAxisName === 'Y'`).

---

## Diagnostic Scripts

All saved in `C:/Users/ashis/avonmouth-de-tool/`:

| Script | What it does |
|---|---|
| `diag-p7349-guids.mjs` | Looks up specific GlobalIds, shape code survey, Bylor linkage cross-check |
| `diag-p7349-brep.mjs` | BREP vertex extraction + global transform for sample beams |
| `diag-p7349-brep2.mjs` | Full BREP bbox in global coords for rebar + both couplers, face plane cross-ref |
| `diag-popup.mjs` | Verifies free-end calc, ATK Coordinate Point cross-check |
| `diag-axes.mjs` | X/Z range of coupler holes for cage 1613 and RF35 |

Run any with: `node <script>.mjs`

---

## Open Questions / Next Steps

- [ ] Shape code suffix → coupler count rule only verified for 29 explicit bars. Bulk of P7349 bars have no explicit shape code pset — coupler count read from Bylor linkage (1/2/3 beams per rebar). Tool handles this correctly implicitly.
- [ ] Template DXF for P7349 now produces 4 face sections. Has not been visually verified against a fabrication drawing.
- [ ] `cageAxisName = 'Z'` edge case (vertical cage) in `_bucketHolesByFace` falls through to `sepAxis = 'y'` — may need review if a vertical cage with F/N layers is encountered.
