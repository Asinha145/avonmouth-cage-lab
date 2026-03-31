# Cage Datum — Investigation & Findings

## IFC Placement Chain

All `IFCREINFORCINGBAR` entities in P7349_C1.ifc share a single object placement:

```
#13 = IFCLOCALPLACEMENT(#14, #21)
#21 = IFCAXIS2PLACEMENT3D(#22, #23, #24)
#22 = IFCCARTESIANPOINT((1979628.891, 6241885.262, 19259.997))   ← BNG mm
#23 = IFCDIRECTION((-1., 0., 0.))   ← local Z = -global X
#24 = IFCDIRECTION(( 0., 0.,-1.))   ← local X = -global Z
```

`#22` is the Tekla cage reference point in British National Grid millimetres.
The parent chain (`#14` → `#15` → `#16`) is trivially at `(0,0,0)` — Tekla
encodes all bar coordinates as absolute BNG mm directly in each element's
CartesianPoint. No parent chain walk is needed.

---

## Why #22 Is Not Used as the Drawing Datum

Using `#22` directly gives:

| Coordinate | BNG origin subtracted | Result |
|---|---|---|
| px (IFC-Y) | 6241885.262 | −4491 to +5834 mm (mixed sign) |
| pz (IFC-Z) | 19259.997   | −6395 to −1146 mm (all negative) |

The placement origin sits in the **middle** of the cage length in Y, and
**above** the cage in Z (the cage bars are at 12865–18114 mm while the
placement origin is at 19260 mm). This is a Tekla survey registration
point, not the formwork corner.

---

## Chosen Datum — `_cageDatum()`

**Source:** outermost face layer bar centreline endpoints from the text parser
(`allData`), filtered to `/^[FNTB]1A$/i` (F1A + N1A for wall; T1A + B1A for slab).

**Why outermost only:** Inner mesh layers (F3A, N3A, F5A, N5A) can extend
further in the length direction than the outer formwork face. Including them
shifts the datum by up to 651 mm for P7349, giving a false offset on the
F1A face view.

**P7349 result:**

| Variable | Value | Meaning |
|---|---|---|
| `datumPx` | 6,237,394.025 mm (IFC-Y) | Left end of cage face in Y |
| `datumPz` | 12,863.997 mm (IFC-Z)    | Bottom of cage (construction joint level) |
| F1A px range | 0 → 10,325 mm | Full cage length |
| F1A pz range | 0 → 5,250 mm  | Full cage height |

---

## Axis Convention (sepAxis = 'x' for P7349)

| DXF axis | IFC axis | Direction |
|---|---|---|
| px (horizontal) | IFC-Y | Cage length — wall runs in Y |
| pz (vertical)   | IFC-Z | Cage height — vertical |
| Dropped axis    | IFC-X | Face-normal (wall thickness) |

For `sepAxis='y'`: px = IFC-X, pz = IFC-Z.
For `sepAxis='z'` (slab): px = IFC-X, pz = IFC-Y.

---

## Problem Fixed

Previously `exportFaceViewDXF` and `exportTemplateDXF` used different origins:

| Function | Origin source | Risk |
|---|---|---|
| Face view | `Math.min(BREP vertex cloud Y)` | Bar radius (12–25 mm) offset from centreline |
| Template  | `Math.min(VS/HS hole Y)`         | Hole positions sit inboard of bar ends |

Overlaying the two DXFs in AutoCAD produced a positional error equal to the
difference between the BREP vertex min and the hole min.

**Fix (commit `b9b0362`):** Both functions call `_cageDatum()` and subtract
the same `datumPx` / `datumPz`. Origin is now F1A+N1A bar centreline minimum
— consistent, deterministic, and matches the physical formwork corner.

---

## Reference

- IFC file: `C:/Users/ashis/avonmouth-de-tool/Sample/P7349_C1.ifc`
- Cage placement entity: `#13=IFCLOCALPLACEMENT(#14,#21)`
- BNG origin entity: `#22=IFCCARTESIANPOINT((1979628.891,6241885.262,19259.997))`
- Implementation: `_cageDatum()` in `js/main.js` (before `exportFaceViewDXF`)
