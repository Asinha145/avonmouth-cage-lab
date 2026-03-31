# Bars Popping Outside Mesh Zones — 1704 (2HD70730AC2) ✅ CLOSED (31 Mar 2026)

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

| Layer | Count | Dir | Bar_Type | Correct type |
|---|---|---|---|---|
| VS2 | 15 | X / diagonal | Strut Bar | ✅ correct |
| VS1 | 4 | X | Strut Bar | ✅ correct |
| HS4 | 5 | Z (vertical) | Strut Bar | ✅ correct |
| PRC | 1 | Z (vertical) | Preload Bar | ⚠️ should be Strut Bar (VS or HS) |

These are short bars that sit entirely beyond the F1A outer face.
The 1 PRC bar is mislabelled — any bar outside the mesh envelope with a coupler attached is a strut bar.

**Implemented (cage-lab):** `_computeOutsidePreloadBars()` in `js/main.js` detects PRC/PRL bars
whose Y extent is beyond `outerMaxY` or before `outerMinY`. Count surfaced in the warning banner:
*"X preload bar(s) outside mesh envelope — should be Strut Bar (VS/HS)"*

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

## Template Drawing — Coupler Geometry Findings

### CPLR Bar Types on VS/HS Layers

The cage-v2 parser reclassifies coupler extension bars to VS/HS layers. Two sub-types exist:

| Name pattern | Runs in | Coupler face | Example Y span (1613) |
|---|---|---|---|
| `F1-CPLR-L` / `F2-CPLR-L` | IFC-X (along cage length) | F1A face | constant Y ≈ F1A face position |
| `N1-CPLR-L` / `N2-CPLR-L` | IFC-Y (cage width) | N1A face | Start_Y = N1A, End_Y = far beyond F1A |

### Face Filter — F1A Template Must Only Use F1/F2-CPLR Bars

F1A face template holes must come from **F1-CPLR and F2-CPLR bars only**.
N1/N2-CPLR bars are on the opposite face — including them doubles the hole count with wrong X positions.

Filter: `bar.Name matches /^F[12]-CPLR/i`

### Coupler Position Along Bar (End_Y not Start_Y)

For N1-CPLR-L bars (running in IFC-Y):
- `Start_Y` ≈ N1A face outer edge
- `End_Y` ≈ far beyond F1A face
- **IFCBEAM (physical coupler head) is placed near End_Y** — ~10mm inside the F1A outer face (cage 1613: F1A outer Y≈6,010,260.5, AG16 coupler Y=6,010,250.0 → 10.5mm inside)

**Note:** The `connected_rebar` link on IFCBEAM (Bylor pset) points to the N1-CPLR-L bar by GlobalId, but the bar's IFC placement origin can be at a different X,Z (Tekla exports a batch-reference, not a co-located link). Do not use `connected_rebar` for X,Z hole position — read directly from IFCBEAM placement coordinates.

For F1-CPLR-L bars (running in IFC-X):
- Bar Y is constant at the F1A face position
- **IFCBEAM X,Z matches bar Start_X, Start_Z exactly** — hole position from `startX`, `startZ` is correct

### Hole Position — Use IFCBEAM X, Z Directly

**Do NOT derive hole X,Z from bar `startX`/`startZ`** — the VS/HS parser returns the IFC placement origin which may be at either face or mid-bar. Use the IFCBEAM's own absolute placement coordinates:
- Hole X = IFCBEAM placement X (absolute, then subtract cage origin)
- Hole Z = IFCBEAM placement Z (absolute, then subtract cage origin)
- Filter to F1A face: Y > midpoint of (min coupler Y, max coupler Y)

For cage 1613: F1A couplers have Y ≈ 6,010,217–6,010,260.5; N1A couplers Y ≈ 6,009,939.5–6,009,982. Midpoint = 6,010,100mm.

**Implemented (de-tool):** `parseIFCBeamHoles()` in `server/routes/projects.js` — builds placement lookup from IFC raw text, filters to F1A face, returns `{xMm, zMm, holeDia}`.

### Hole Size — Use IFCBEAM HEIGHT/WIDTH + 2mm

Do NOT use `bar.Size + 2mm` (rebar diameter). Use the **coupler body OD from IFCBEAM** + 2mm:

| Coupler model | IFCBEAM HEIGHT/WIDTH (OD) | Hole dia |
|---|---|---|
| AG16  | 25mm | **27mm** |
| AG20N | 31mm | **33mm** |
| AG25  | 38mm | **40mm** |
| AG32N | 47mm | **49mm** |

Source: `HEIGHT` or `WIDTH` property on the IFCBEAM entity (Tekla Reinforcement pset).
Chain: `IFCBEAM.connected_rebar` → CPLR bar → `source_global_id` → VS strut body.

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

## Resolution ✅

Both issues are resolved in `js/main.js`:

**Through-bars (9 VS2):** `_computeMislabelledOutsideBars()` uses `Math.min(b.Start_Y, b.End_Y)` / `Math.max(b.Start_Y, b.End_Y)` to test both endpoints against the mesh envelope — so bars with `Start_Y` inside but `End_Y` far beyond are correctly caught.

**Mislabelled preload bar (1 PRC):** Same function flags non-VS/HS bars outside the envelope whose layer has coupler heads. Surfaced in the warning banner as *"X preload bar(s) outside mesh envelope — should be Strut Bar (VS/HS)"*.
