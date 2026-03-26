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

## Spacing Formula: N bars vs N-1 gaps (March 2026)

**Mistake:** Spacing was computed as `span / N` (treating N as the number of gaps) when it should be `span / (N-1)` (N bars create N-1 gaps between them).

**Rule:** Spacing = (farthest position − nearest position) / (count − 1), then round to nearest 5mm.

**Why it matters:** With 24 bars spanning 4805mm: `4805/24 = 200mm` (appeared correct by coincidence), `4805/23 = 208.9 → 210mm` (correct). On other cages the coincidence would not hold.

---
