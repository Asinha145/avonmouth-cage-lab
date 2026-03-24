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

## Spacing Formula: N bars vs N-1 gaps (March 2026)

**Mistake:** Spacing was computed as `span / N` (treating N as the number of gaps) when it should be `span / (N-1)` (N bars create N-1 gaps between them).

**Rule:** Spacing = (farthest position − nearest position) / (count − 1), then round to nearest 5mm.

**Why it matters:** With 24 bars spanning 4805mm: `4805/24 = 200mm` (appeared correct by coincidence), `4805/23 = 208.9 → 210mm` (correct). On other cages the coincidence would not hold.

---
