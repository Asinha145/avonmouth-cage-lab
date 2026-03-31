# Lessons — Avonmouth Cage v2

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
