# Lessons — Avonmouth Cage v2

---

## Never Assume a Spatial Default — Derive It From Geometry (Apr 2026)

**Mistake:** `Datum_Side` dropdown was hardcoded to `'left'` on the grounds that
`_cageDatum()` always picks `Math.min(...)` (the minimum-coordinate end). Shipped
as "always left" without checking whether the minimum-coordinate end is actually the
physical left when viewed from the front.

**Why it was wrong:** "Left" and "right" depend on the viewing direction, which depends
on which way the N face (Near face) is pointing in BNG space. A cage whose N face is on
the west side of the wall is viewed looking eastward — in that view, min IFC-X is to
your RIGHT, not your left. Hardcoding 'left' silently gives the wrong default for any
cage of that orientation.

**Root cause pattern:** Spatial defaults that appear correct on the development test
cage can be wrong for cages with a different orientation. This is the same class of
mistake as the H36/I36 axis-extent bug and the `cageAxisName` proxy bug — encoding an
orientation assumption instead of deriving the answer from the data.

**Rule:** Any UI default or auto-filled value that depends on cage orientation or
geometry **must** be computed from the IFC bar data, not assumed. Specifically:
- Left/right, top/bottom, near/far → derive from face layer positions in IFC space
- "Viewing direction" when facing the N face → compare avg IFC face-axis of N1A vs F1A
- Never substitute "it worked on my test cage" for a proper geometric derivation

**Correct implementation — `_detectDatumSide()`:**

| `sepAxis` | Face comparison | Viewing direction | min-coord end |
|---|---|---|---|
| `'x'` | N1A +X of F1A | looking west | min IFC-Y = **LEFT** |
| `'x'` | N1A −X of F1A | looking east | min IFC-Y = **RIGHT** |
| `'y'` | N1A +Y of F1A | looking south | min IFC-X = **RIGHT** |
| `'y'` | N1A −Y of F1A | looking north | min IFC-X = **LEFT** |
| `'z'` | T1A top face | plan view (N up) | min IFC-X = **LEFT** |

**Verified on all 3 reference cages** before shipping — all gave LEFT for different
geometric reasons, not by coincidence.

---

## Axis-Extent vs Bar-Role Dimension Bug (H36/I36 — March 2026)

**Mistake:** When computing slab cage dimensions H36 (length) and I36 (height), the implementation used X/Y world-coordinate extents of all mesh bars instead of deriving from the specific bar roles (T1/T2/B1/B2) defined in the spec.

**What the spec said:**
- T1/B1 bars = height-direction bars → their bar length = cage height (I36)
- T2/B2 bars = length-direction bars → their bar length = cage length (H36)

**What was coded:**
```javascript
// WRONG — axis-dependent, breaks on rotated cages
const lenMm = Math.max(...allX) - Math.min(...allX);  // H36 from X-axis extent
const hgtMm = Math.max(...allY) - Math.min(...allY);  // I36 from Y-axis extent
```

**Why it wasn't caught:** The test cage happened to be oriented with T2 bars running along X and T1 bars running along Y. The axis-extent approach gave numerically correct results for that specific orientation. A differently-oriented cage would have produced silently wrong values.

**Root cause pattern:** "Brittle orientation assumption" — the implementation accidentally encoded a spatial assumption (which world axis aligns with which semantic dimension) instead of deriving the answer from the bar role specification.

**Rule:** When the spec defines a dimension via a named bar role (T1, T2, F1A, etc.), derive that dimension from `.Length` (or equivalent intrinsic property) of those specific bars. NEVER use world-axis coordinate extents as a proxy.

**Correct code:**
```javascript
const maxLen = bs => bs.length ? Math.max(...bs.map(b => b.Length || 0)) : 0;
const lenMm = maxLen([...t2, ...b2]);    // H36 — T2/B2 bar lengths = cage length
const hgtMm = maxLen([...t1all, ...b1all]); // I36 — T1/B1 bar lengths = cage height
```

**Why this works:** Bar `Length` is an intrinsic property read from the IFC pset. It does not depend on which axis the bar happens to run along in world space.

**Guard checklist — apply to any new cell derivation:**
1. Does the spec name a bar role for this value? (T1, T2, F1A, VS1, etc.)
2. If yes → derive from `.Length` or pset property of those bars
3. If using coordinate extents → document explicitly *why* and only for geometry that is inherently positional (e.g., cage overall bounding box, not "length of bar type X")
4. Cross-check output against a known cage with a different orientation, not just the development test cage

---

## BREP Height vs Text Parser Height — Bent Bars (March 2026)

**Mistake:** Assumed BREP height < text parser height was physically impossible (barMap mismatch
causing bbox shrinkage). Concluded the text parser's 5800mm was correct and BREP's 5779mm was wrong.

**What actually happened:** The mesh bars on cage 1704 are Shape Code 26 (Z/S cranked bars) with
horizontal legs at top and bottom. The text parser computes `End_Z = Start_Z + Dir_Z × Length` —
treating every bar as if it runs straight for its full cut length. For a 5800mm cut bar with
horizontal legs of Dim_B=395mm + Dim_C=1100mm, the actual vertical contribution is less than 5800mm.
The BREP correctly rendered the bent geometry and gave the true outer-face height of 5779mm.

**Rule:** BREP height is authoritative. Trust it over the text parser height when bars have
shape codes other than 01/21 (straight). The text parser's length-projected height is only
accurate for perfectly straight bars.

**Diagnostic check:** If `BREP_height < text_parser_height`, check:
1. Are all bars streamed? (`notStreamed.length === 0` ✓)
2. Are BREP spans < bar lengths? (yes → bars are bent, BREP is correct)
3. If BREP height > text parser: something is wrong (barMap mismatch or placement error)

**Key verification for 1704:**
- All 327 parser bars ARE streamed (notStreamed = 0)
- Bar 2782: Shape Code 26, Dir_Z=1, Length=5800 → text parser End_Z=33860, BREP top=33839
- Gap of 21mm = horizontal leg reducing vertical extent
- BREP 5779mm is the correct cage height

---

## Three-Bbox Dimension Architecture (March 2026)

**Mistake (prior code):** Single `brepBbox` used for all dimensions, with `if (bar && Bar_Type==='Mesh')`
guard. This caused two problems:
1. Any bar missing from barMap silently shrank the bbox below the centreline span (impossible physically)
2. The `allBrepBbox` used `if (bar)` — IFCBEAM coupler entities are not in barMap, so they were
   excluded from "all bars" bbox

**Rule:** Always maintain three separate bboxes in `StreamAllMeshes`:

| bbox | Gate | Purpose |
|---|---|---|
| `meshBbox` | `bar && bar.Bar_Type === 'Mesh'` | EDB length + height (mesh cage body) |
| `allBarBbox` | `bar` (any type) | EDB width (full cross-section incl. links/struts) |
| `totalBrepBbox` | None — unconditional | Overall dims + height display (true outer envelope) |

**EDB dimension rules:**
- `edbWidth` = all bars (links/struts define the real wall cross-section the cage occupies)
- `edbLength` = mesh bars only (cage length = mesh face extent)
- `edbHeight` = mesh bars only (cage height = mesh face extent)
- `height / overallWidth / overallLength` = totalBrepBbox (no barMap dependency)

---

## cageAxisName Must Be Passed to loadIFC() (March 2026)

**Mistake:** `_buildDimensions()` used `Math.min/max(spanX, spanZ)` heuristic to assign length vs
width. This is brittle for near-square cages and doesn't use the semantic information the parser
already computed.

**Rule:** Pass `cageAxisName` from `parser.cageAxisName` to `viewer.loadIFC(arrayBuffer, barMap, cageAxisName)`.
In `_buildDimensions(cageAxisName)`, use `assignLW(spanX, spanY)`:
- `'X'` → spanX = length, spanY = width
- `'Y'` → spanY = length, spanX = width
- `'Z'` → vertical cage, both horizontal → fallback to min/max (still fine for typical rectangular plan)

---

## IFCBEAM Coupler Heads — Not in barMap → Appeared as 'Unknown' (March 2026)

**Mistake:** `StreamAllMeshes` fell through to `groupKey = 'Unknown'` for IFCBEAM entities because `barMap.get(eid)` returns null for them (barMap only holds IFCREINFORCINGBAR).

**Rule:** Always check `couplerMap.get(eid)` after a barMap miss before falling back to 'Unknown'. IFCBEAM entities carry their own `Avonmouth.Layer/Set` pset — the same parser machinery (`extractProperties`) reads it correctly. There is no need to follow the `Bylor.connected_rebar` link; the layer on the IFCBEAM itself is authoritative.

**Why:** Without this, coupler heads fill the 'Unknown' section of the layer filter and their weight is silently omitted from every weight total.

---

## Weight Source Priority: ATK pset `Weight` > `Formula_Weight` (March 2026)

**Mistake:** `extractSlabData` used `Formula_Weight` (geometry estimate: π×r²×L×7777 kg/m³) for J36 (total weight) and Z36 (mesh weight). The website layer weight table has always used `Weight` (ATK/ICOS pset). This caused a ~96 kg discrepancy for cage 672 (10319.1 kg on website vs 10223 kg in EDB).

**Rule:** Always use `b.Weight ?? b.Formula_Weight ?? 0` everywhere a bar weight is needed. `Weight` is the authoritative ATK pset value. `Formula_Weight` is a geometry fallback — only valid when the ATK pset is absent.

**Why:** The two values diverge for any bar where ATK's measured/recorded weight differs from the geometry calculation (density assumption, coupler offsets, etc.).

---

## Spacing Formula: N bars vs N-1 gaps (March 2026)

**Mistake:** Spacing was computed as `span / N` (treating N as the number of gaps) when it should be `span / (N-1)` (N bars create N-1 gaps between them).

**Rule:** Spacing = (farthest position − nearest position) / (count − 1), then round to nearest 5mm.

**Why it matters:** With 24 bars spanning 4805mm: `4805/24 = 200mm` (appeared correct by coincidence), `4805/23 = 208.9 → 210mm` (correct). On other cages the coincidence would not hold.

---

## IFCLOCALPLACEMENT — Never Assume `$` (Absolute) First Arg (March 2026)

**Mistake:** `_parseIFCBeamHoles` only collected placements matching `IFCLOCALPLACEMENT($, #axId)` — the `$` meaning no parent (absolute global). This returned 0 beam positions for RF35 C01 because all 224 IFCBEAM placements there use a parent ref: `IFCLOCALPLACEMENT(#14, #axId)`.

**Root cause pattern:** Developed and tested against one cage (1613) where Tekla happened to export absolute placements. A different Tekla export version/setting uses relative placements throughout.

**Rule:** Always match `IFCLOCALPLACEMENT` with any first argument:
```javascript
// Wrong — only matches absolute
/#(\d+)=IFCLOCALPLACEMENT\(\$,#(\d+)\)/g

// Correct — matches $ or any parent ref
/#(\d+)=IFCLOCALPLACEMENT\([^,)]*,#(\d+)\)/g
```

**Why it still works:** Tekla always encodes the element's **global BNG coordinates** directly in its own `IFCAXIS2PLACEMENT3D → IFCCARTESIANPOINT`, regardless of whether there is a parent placement. No matrix chain walk is needed.

**Diagnostic checklist when a parser returns 0 beam positions:**
1. Count raw `IFCBEAM` entities — are they present at all?
2. Survey `IFCLOCALPLACEMENT` first-arg patterns — any `#N` instead of `$`?
3. Check one CartesianPoint manually — are the coords plausibly global (BNG scale)?
4. If yes to 2 and 3 — broaden the regex to `[^,)]*`.

**Reference:** `docs/ifc-entity-investigation.md` — full methodology and diagnostic script template.

---

## VS/HS Plate Orientation — Never Hardcode Long Axis (March 2026)

**Mistake:** `_computePlates` hardcoded `bandAndGroup(vsHoles, 'px', 'pz')` — always treating Z as the long axis for VS plates. This was correct for wall cages (VS struts run up the wall height = many unique Z positions) but wrong for roof/slab cages where VS struts run horizontally across the slab span = many unique X positions, all at the same Z.

**Root cause pattern:** Same brittle orientation assumption as the H36/I36 axis bug — the algorithm encoded a spatial assumption (VS long axis = IFC-Z) instead of deriving it from the actual data distribution.

**Physical vs IFC axis for reference:**

| Cage type | Strut | Physical direction | IFC long axis |
|---|---|---|---|
| Wall cage (1613) | VS | Up the wall height | Z (many unique Z) |
| Wall cage (1613) | HS | Along wall length | X (many unique X) |
| Roof/slab cage (RF35) | VS | Across slab span | X (many unique X, Z≈constant) |

**Rule:** Auto-detect long axis per hole group: count unique X positions vs unique Z positions. More unique Z → long=Z (band X, group Z). More unique X → long=X (band Z, group X).

```javascript
function getOrientation(holes) {
    if (!holes.length) return { bandKey: 'px', groupKey: 'pz' };
    const xUniq = new Set(holes.map(h => Math.round(h.px))).size;
    const zUniq = new Set(holes.map(h => Math.round(h.pz))).size;
    return zUniq >= xUniq
        ? { bandKey: 'px', groupKey: 'pz' }   // long=Z (wall cage)
        : { bandKey: 'pz', groupKey: 'px' };   // long=X (roof cage)
}
```

**Why:** A roof cage's "Vertical Struts" are vertical in the cage's local frame, but the cage itself is installed flat — so in global IFC space those struts run horizontally. The bar name VS refers to cage-local orientation, not global orientation.

**Pending improvement:** Replace `Math.round` bucketing with a ±15mm tolerance bucket to handle slight slab inclination or survey tolerances where Z values cluster near-zero but aren't exactly equal.

---

## Slab Cage Template Face Plane — Use X-Y Not X-Z (March 2026)

**Mistake:** `exportTemplateDXF` always mapped `pz = zMm` (IFC-Z), treating every cage as a wall cage where the mesh face is the X-Z plane. For a slab/roof cage the mesh face is the X-Y plane — Z is constant and Y varies across the slab width. This gave plate widths of ~83mm (Z range ≈ 0) instead of the correct ~200mm (Y range = 117mm).

**Rule:** Detect face plane from Z span of all holes:
- Z span ≥ 100mm → wall cage → face plane = X-Z → `pz = zMm`
- Z span < 100mm → slab cage → face plane = X-Y → `pz = yMm`

**Why:** The template plate must match the physical face the formwork sits against. For a slab that face is horizontal (X-Y); for a wall it is vertical (X-Z). Using the wrong axis produces a geometrically meaningless plate.

**Requires:** `yMm` must be passed through `_parseIFCBeamHoles` (add to `.map()` return object).

---

## Face Name Detection — Use Layer Naming Not Coupler Z Span (March 2026)

**Mistake:** Used `zSpan < 100mm` on coupler hole positions to decide whether to compare Y or Z when identifying the face layer. Cage 1704 is a wall cage (F1A/N1A) but all its VS couplers happen to sit at the same Z → zSpan=0 → wrongly classified as slab → Z-based detection → 3528mm dist → wrong answer.

**Rule:** Determine detection axis from face layer naming, not coupler geometry:
- F*/N* layers present → wall cage → faces separated in Y → compare Y
- T*/B* layers present → slab cage → faces separated in Z → compare Z

```javascript
const hasFN = Object.keys(layerCoords).some(l => /^[FN]\d/i.test(l));
const holeMedian = hasFN ? median(holes.map(h => h.yMm)) : median(holes.map(h => h.zMm));
```

**Verified:** 1613 → F1A (79mm), 1704 → F1A (0mm), RF35 → T1A (80mm).

**Why:** Layer naming is the semantic ground truth. Coupler geometry is an accidental consequence of cage orientation — it can mislead.

---

## Slab H36/I36 — `max(Length)` Misses Staggered CPLR Lapper Bars (Apr 2026)

**Mistake:** `extractSlabData` used `max(Length)` of T1+B1 bars for I36 and T2+B2 bars for H36.
For RF16: T1/B1 bars Length=7000mm → I36=7000mm. But B1-CPLR lapper bars start at X=2,009,850
(1,050mm beyond the B1 bar end at 2,008,800), giving a real cage height of 8,050mm.
`max(Length)` returns 7000mm — the lapper bar's shorter length never wins the max.

**Rule:** Use coordinate extent per face (Start+End positions of all role bars including CPLR variants),
then max across faces:
```javascript
const extentMm = (bs, axis) => {
    const vals = bs.flatMap(b => [b[`Start_${axis}`], b[`End_${axis}`]]).filter(v => v != null && isFinite(v));
    return vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : 0;
};
const hgtMm = Math.max(extentMm(t1all, hgtAxis), extentMm(b1all, hgtAxis));
const lenMm = Math.max(extentMm(t2, lenAxis), extentMm(b2, lenAxis));
```

**Why max per face, not combined?** T2 and B2 bars are on opposite slab faces — their Y positions are
offset by the slab face separation (~25mm). Combining them inflates the length by that offset.
Computing per face and taking the max avoids this while still capturing genuine stagger within a face.

**Axis mapping:** `cageAxisName='X'` → T1/B1 run along X (hgtAxis='X'), T2/B2 run along Y (lenAxis='Y').
Reverse for `cageAxisName='Y'`.

---

## Template DXF — yMid Filter Silently Drops Multi-Face Couplers (March 2026)

**Mistake:** `_parseIFCBeamHoles` filtered by `yMm > yMid` to select the "F1A face". For P7349 (a multi-layer wall cage with F1A, F3A, N1A, N3A, N5A, F5A faces), 118 of 162 VS/HS holes were silently dropped — only 44 survived. No warning was shown.

**Root cause:** `yMid` was a blunt global midpoint of all IFCBEAM Y values. For complex cages with couplers penetrating multiple mesh faces at different depths, any single threshold drops all but one face.

**Rule:** Never filter coupler holes by yMid. Instead:
1. `_parseIFCBeamHoles` returns ALL VS/HS holes (no Y filter)
2. `_bucketHolesByFace` assigns each hole to its nearest face layer by proximity (Y for wall F/N cages, Z for slab T/B cages)
3. `exportTemplateDXF` loops over face buckets and draws a separate labelled section per face

**Why this matters:** Every face with couplers needs its own formwork template plate. Silently dropping a face means those holes never get drilled — a physical fabrication error.

**Verified P7349:** Old tool: 44 HS holes (F1A face only). New tool: 162 holes across F1A, N3A, F3A, N5A — 4 separate template sections.

---

## Face Bucketing — Separation Axis Must Follow cageAxisName (March 2026)

**Mistake:** `_bucketHolesByFace` always used Y to separate F/N face layers. P7349 is a wall cage running in Y (length=10.267m in Y, thickness=1.357m in X). F1A and N1A bars are at different X values, same Y range — comparing Y medians bucketed all couplers to one face.

**Confirmed by BREP:** HS1 coupler origins at X=1,980,640 (N1A side, 9mm from N1A bar at X=1,980,649) and X=1,979,360 (F1A side, 15mm from F1A bar at X=1,979,345). Free ends (origin + refDir × 110mm) at X=1,980,750 and X=1,979,250 give pop-outs of 81mm and 75mm from the respective face bar outer faces — confirmed against Navisworks measurement.

**Rule:** Derive face separation axis from `cageAxisName`:
- `cageAxisName = 'Y'` → wall runs in Y → faces separated in **X** → compare `xMm` / `Start_X`
- `cageAxisName = 'X'` → wall runs in X → faces separated in **Y** → compare `yMm` / `Start_Y`
- T/B slab layers → always **Z**

**Also:** IFCBEAM placement origin = inner face of coupler (bar-connection end). Protruding free end = origin + refDir × coupler length. ATK Coordinate Point property = coupler midpoint = origin + refDir × length/2 (cross-check only).

---

## Template DXF — px Axis Wrong for Wall Cages With Faces in X (March 2026)

**Mistake (v1):** `px = h.xMm - globalMinX` always. For P7349 (wall runs in Y, faces in X), every hole on a given face has the same IFC-X ≈ 1,979,360 → all holes get `px=0`. Plate appears as a single vertical line.

**Mistake (v2 — same session):** Fixed with `useLongY = cageAxisName === 'Y' && !useY`. But the parser detects P7349 as `cageAxisName='Z'` (vertical bars dominate the detection ratio — see *Face Sep Axis Detection* lesson below). So the guard never fired.

**Root cause:** Both attempts relied on `cageAxisName` to infer which IFC axis represents wall length. `cageAxisName` is unreliable for this — it reflects bar direction dominance, not wall orientation.

**Correct rule:** Derive the face separation axis from face layer geometry (`_detectFaceSepAxis`). If `faceSepAxis='x'` (faces apart in X), then wall length runs in Y → `useLongY=true`. If `faceSepAxis='y'`, length is in X → `useLongY=false`. Slab (`useY=true`) always uses xMm regardless.

```javascript
const faceSepAxis = _detectFaceSepAxis();
const useLongY = faceSepAxis === 'x' && !useY;
px: +(useLongY ? h.yMm - globalMinY : h.xMm - globalMinX).toFixed(1)
```

**Why `!useY` guard:** Slab face plane is X-Y; `pz` already uses `yMm`. Using `yMm` for `px` too would collapse both axes.

---

## Face Sep Axis Detection — Geometry-Based, Not cageAxisName (March 2026)

**Problem:** `_bucketHolesByFace` originally used `cageAxisName === 'Y'` to set `sepAxis='x'`. For P7349 the parser returns `cageAxisName='Z'` (wall's vertical bars dominate the detection), so `sepAxis` defaulted to `'y'` → wrong bucketing (holes spread to inner layers F3A/N3A instead of outer F1A/N1A).

**Root cause:** `cageAxisName` is the axis along which the most unique bar positions exist when looking perpendicular — dominated by vertical bars in a wall cage. It is NOT reliable as a proxy for wall orientation.

**Correct approach:** Compare the **within-layer spread** on each axis across all face layers. Face bars in the same layer are tightly clustered on the separation axis (e.g. all F1A bars share X≈1,979,345 ± 50mm) but spread wide on the length axis (full 10,267mm in Y). The separation axis = axis with the smallest maximum within-layer range.

```javascript
const maxRange = (key) => Math.max(...layers.map(pts => {
    const vals = pts.map(p => p[key]).filter(v => v != null).sort((a,b) => a-b);
    return vals.length >= 2 ? vals[vals.length-1] - vals[0] : 0;
}));
return maxRange('x') < maxRange('y') ? 'x' : 'y';
```

**P7349 result:** xMaxRange ≈ 50mm (all F1A/N1A bars tightly clustered in X within each layer), yMaxRange ≈ 10,267mm (bars spread along wall length). 50 < 10,267 → `sepAxis='x'` ✓

**Why median comparison fails:** Layer Y-medians differ by up to 2,197mm (inner layers have bars at different Y distributions) — more than the 1,304mm X-spread between face layers. Median comparison would incorrectly choose Y.

---

## Template DXF — HS Plate Orientation Must Be Hardcoded (March 2026)

**Mistake:** `_computePlates` used `getOrientation(hsHoles)` (auto-detect from unique X vs Z count) for HS plates. When `px` was broken (all zeros), `xUniq=1` and `zUniq=many`, so HS incorrectly got `long=Z` — producing tall thin plates stacked vertically instead of wide horizontal plates.

**Rule:** HS struts are always horizontal along the cage length → plate long axis is always X (horizontal). Hardcode:
```javascript
const hsOri = { bandKey: 'pz', groupKey: 'px' };  // HS always long=X
```

VS struts keep auto-detect: `long=Z` for wall cages, `long=X` for slab cages (where VS run horizontally in global space).

**Physical rule:**
- VS plates: long axis = Z (height direction) on wall cages, long axis = X on slab cages — auto-detect handles both.
- HS plates: long axis = X (length direction) always — hardcode, no auto-detect needed.

---

## P7349 Coupler Pop-Out — Confirmed Against Face Geometry (March 2026)

**Finding:** All 162 VS/HS couplers in P7349 sit at exactly two IFC-X positions: ~1,979,360 (F face) and ~1,980,640 (N face). They pop through the **outermost** mesh faces only (F1A and N1A) — no couplers at intermediate layers (F3A, F5A, N3A, N5A).

**Pop-out geometry (AG20N, 110mm barrel):**
- F face: origin 36mm inside F1A outer face → free end 74mm beyond F1A outer face
- N face: origin 32mm inside N1A outer face → free end 78mm beyond N1A outer face

**Rule:** Every VS/HS coupler barrel starts within the face bar's cross-section zone and protrudes outward through the formwork face. The formwork hole is what the template DXF is generating.

**Cache note:** The pre-fix diagnostic in `docs/cache-p7349-c1.md` recorded F1A=63, N3A=46, F3A=26, N5A=2 — this was from Y-based bucketing (old bug) which split holes by Y position into 4 groups. The correct X-based result is F1A=74, N1A=88.

**VS1 asymmetry:** All 25 VS1 couplers are on the F face only (zero on N face) — VS1 struts in P7349 are single-ended on the F1A side.

---

## Slab Bars Cannot Be Split by Orientation Field (Apr 2026)

**Mistake:** `_computeLayerDatums` split bars into two grid groups using `Orientation === 'Vertical'` vs `'Horizontal'`. For slab cages (RF35, `sepAxis='z'`), every bar is classified `'Horizontal'` by the parser (`|Dir_Z| < 0.5` for all). The Vertical group was always empty → function returned 0 markers for all T/B layers.

**Rule:** For `sepAxis='z'` (slab), split by `|Dir_Y| > |Dir_X|` (y-running, fixed at IFC-X) vs `|Dir_X| > |Dir_Y|` (x-running, fixed at IFC-Y). `Dir_X`, `Dir_Y`, `Dir_Z` are stored on all bar objects and are always available.

**Why:** `Orientation` is computed from `|Dir_Z| >= 0.5`. Slab bars are horizontal in global IFC space, so `Dir_Z ≈ 0` for all of them — both grid directions are "Horizontal". The two mesh directions must instead be distinguished by which horizontal axis they run along.

---

## Layer Datum Engine Coord Mapping Must Be Explicit Per sepAxis (Apr 2026)

**Mistake:** `_computeLayerDatums` used `faceX = mean IFC-X` for the face-plane constant coordinate and plugged it directly as `ex = faceX/1000` for all sepAxis cases. For `sepAxis='y'` (face plane ⊥ IFC-Y), the face constant coordinate is IFC-Y — which must become `ez = -faceCoord/1000`, not `ex`.

**Engine coordinate mapping (IFC → Three.js):**
- `engine-x = IFC-X / 1000`
- `engine-y = IFC-Z / 1000`
- `engine-z = -IFC-Y / 1000`

**Rule:** For each sepAxis, derive three components explicitly:

| sepAxis | face constant | vBars const axis → engine | hBars const axis → engine |
|---|---|---|---|
| `x` | IFC-X → `ex` | IFC-Y → `ez = -IFC-Y/1000` | IFC-Z → `ey` |
| `y` | IFC-Y → `ez` | IFC-X → `ex` | IFC-Z → `ey` |
| `z` (slab) | IFC-Z → `ey` | IFC-X (y-running) → `ex` | IFC-Y (x-running) → `ez` |

Never shortcut by using the "nearest V bar's IFC-Y" — for `sepAxis='y'` that IFC-Y is the face constant, not a bar-specific position. Use the face coordinate formula directly.

---

## Slab Layer Datum — Skip Stagger Clustering in `_computeLayerDatums` (Apr 2026)

**Mistake:** `_computeLayerDatums` used `groupBars()` (stagger cluster averaging) for all `sepAxis` cases, including slabs. For RF35 (`sepAxis='z'`), the parser assigns ALL y-running bars in a layer (e.g. all 31 B1A y-running bars) to a single `Stagger_Cluster_ID` (e.g. `B1A_H24`). `groupBars()` collapses them into one cluster and averages their IFC-X positions → returns the slab centroid (~2,026,572mm) instead of the nearest bar edge (~2,023,558mm). Orange datum sphere appeared 3m+ away from the slab corner.

**Why the parser clusters all y-running bars together:** The stagger clustering algorithm groups bars at the same structural position along the cage axis (IFC-Y for RF35). All y-running bars have the same IFC-Y midpoint (they run the full slab span), so they all fall in one cluster.

**Rule:** For `sepAxis='z'` (slab), bypass stagger clustering in `_computeLayerDatums`:
```javascript
if (sepAxis === 'z') {
    vUnits = vBars.map(b => ({ pos: vPosFn(b) }));
    hUnits = hBars.map(b => ({ pos: hPosFn(b) }));
} else {
    vUnits = groupBars(vBars).map(...);
    hUnits = groupBars(hBars).map(...);
}
```

**Why stagger clustering is still correct for walls:** Wall ring bars at the same structural Z position stagger by ±33mm. Averaging the pair gives the true centreline — the datum sits exactly between them. This logic does not apply to slab bars.

---

## Top/Bottom Dropdown — Controls Bar Crossing Position, Not Layer Filter (Apr 2026)

**Mistake:** The Datum Height (Top/Bottom) dropdown was initially wired to filter which *face layers* to show datum markers for (Top → T1A layers only, Bottom → B1A layers only). The user corrected this.

**What it should do:** Top/Bottom selects the **H-bar crossing position within each layer** — the same way Left/Right selects the V-bar crossing position. Both dropdowns control *where on the mesh* the datum sits, not *which layers* participate.

- `Bottom` → pick the HS bar with minimum pz (nearest to the geometric bottom of the cage)
- `Top` → pick the HS bar with maximum pz (nearest to the geometric top of the cage)

**All face layers (T1A, B1A, F1A, N1A, F3A…) always get their own datum marker.** No layer should ever be suppressed by these controls.

**Rule:** Any dropdown that says "Left/Right/Top/Bottom" in the datum context controls the *position of the crossing point within each layer*, not which layers are active. Filtering layers by position is a design smell — it loses information and confuses the user.

**Parallel with Left/Right:**
```javascript
// Left/Right → VS bar selection
const nearestV = datumSide === 'right'
    ? vUnits.reduce((best, u) => u.pos > best.pos ? u : best, { pos: -Infinity })
    : vUnits.reduce((best, u) => u.pos < best.pos ? u : best, { pos:  Infinity });

// Bottom/Top → HS bar selection (same pattern)
const nearestH = heightSide === 'top'
    ? hUnits.reduce((best, u) => u.pos > best.pos ? u : best, { pos: -Infinity })
    : hUnits.reduce((best, u) => u.pos < best.pos ? u : best, { pos:  Infinity });
```

---

## Datum Sphere Size — Use Scene Diagonal, Not Orbit Radius (Apr 2026)

**Mistake:** Initial datum sphere radius = `orbitRadius * 0.018` where orbitRadius ≈ 16.5 m → sphere diameter ≈ 600 mm. Visible as a large red ball on screen ("like a football").

**Rule:** Size visual markers relative to `_sceneSize()` (scene bounding box diagonal), not orbit radius. `_sceneSize() * 0.004` gives ≈ 46 mm for a typical cage — a visible dot without obscuring geometry.

**Also:** `_sceneSize()` must exclude datum markers themselves from the bbox calculation, otherwise the first marker inflates the "scene size" and the second marker gets sized larger, creating a positive feedback loop.

---

## LB Coupler Holes — Position Gate Only (Apr 2026)

**Rule:** Filter LB IFCBEAM by CartesianPoint position on the face separation axis.
- `beamVal < meshMin || beamVal > meshMax` on `sepAxis` → outside the void → valid hole ✅
- Otherwise → inside the cage void → exclude ❌

VS/HS keep unconditional inclusion — always through-face by engineering convention.

**Do not use zAxis barrel direction as a filter gate.** The barrel direction is useful for classifying hole type (VS-like vs HS-like) but not for deciding inclusion. An LB beam outside the void is through-face regardless of its barrel direction encoding in the IFC.

**Deviation warning:** We spent several commits using barrel direction as the primary gate after finding mixed zDir values in 2HL10712AC1 (60 LB beams, zDir ∈ {(1,0,0),(−1,0,0),(0,1,0),(0,0,1)}). This was wrong — it caused correct through-face holes to be excluded when their origin was inside the mesh. The position-outside-void rule is the correct and stable discriminant.

---
