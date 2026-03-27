# Bars Popping Outside Mesh Zones — 1704 (2HD70730AC2)

## Context

Three spatial zones are defined from the F1A/N1A mesh face Y extents (IFC-Y = width axis):

| Zone | Y relative (mm) | Thickness |
|---|---|---|
| N1A Near Face | 0 – 82 | 82mm |
| Interior Void | 82 – 274 | 192mm |
| F1A Far Face | 274 – 346 | 72mm |

Zones are **infinite in IFC-X (length) and IFC-Z (height)** — bounded only in IFC-Y (width).

---

## Bars Outside All Zones — Total 34

### Group 1 — Short bars at Y_rel = 423mm (77mm beyond F1A)

| Layer | Count | Dir | Bar_Type |
|---|---|---|---|
| VS2 | 15 | X / diagonal | Strut Bar |
| VS1 | 4 | X | Strut Bar |
| HS4 | 5 | Z (vertical) | Strut Bar |
| PRC | 1 | Z (vertical) | Preload Bar |

These are short bars that sit entirely beyond the F1A outer face.

### Group 2 — Through-bars (VS2, 9 bars)

**The coupler head issue.**

- `Dir_Y = 1.0` — run in the IFC-Y (width) direction
- `Start_Y_rel` ≈ 8–87mm (start **inside** N1A face zone)
- `End_Y_rel` ≈ 803–812mm (end **far beyond** F1A — ~460mm past the outer face)

These bars physically span from the N1A side all the way through the cage and project ~460mm beyond F1A. The parser reads `Start_Y` from within the N1A zone, so a Start_Y-only zone check **misses** them — they appear "inside" when they are actually through-bars that exit the cage entirely.

**Root cause:** Coupler head geometry. The bar's IFC placement origin is near the N1A face but its End point (driven by coupler attachment on the F1A side) shoots far beyond.

**Detection fix (not yet implemented):** Check `max(Start_Y, End_Y)` against `F1A_ABS_MAX` — if either end exceeds the zone boundary, the bar is outside.

```javascript
// Correct outside check (use either end, not just Start_Y)
const maxY = Math.max(b.Start_Y ?? -Infinity, b.End_Y ?? -Infinity);
const minY = Math.min(b.Start_Y ?? Infinity,  b.End_Y ?? Infinity);
const outside = minY < N1A_ABS_MIN || maxY > F1A_ABS_MAX;
```

---

## Bars Fully Inside Void (expected, not outside)

| eid | Layer | Y_rel | Dir | Note |
|---|---|---|---|---|
| 15726 | VS2 | 168mm | X | Horizontal spacer in void |
| 2076 | HS4 | 134mm | X | Horizontal spacer in void |

---

## PRL/PRC Classifier Note

The `_classifyPrlPrcBar()` function uses `Start_Y` only for wx bars, justified by the comment `// wx bars: Start_Y ≈ End_Y`. This is valid for PRL/PRC preload bars (which run in X or Z, not Y). The through-bar issue does not affect PRL/PRC classification — it affects VS/HS strut bar detection only.

---

## TODO — Coupler Head Fix

The through-bars' extreme `End_Y` (~808mm) is almost certainly the IFC position of the coupler head attached to the F1A face. The bar body ends at the F1A face (~346mm) but the coupler entity drives `End_Y` to ~808mm.

When tackling the coupler issue:
1. Identify which IFC entity (IFCBEAM or IFCREINFORCINGBAR property) drives `End_Y` to 808mm
2. Determine whether `End_Y` should be clamped to the bar body length or read from a different pset
3. Cross-check against BREP geometry — the BREP through-bar length vs the text parser length
