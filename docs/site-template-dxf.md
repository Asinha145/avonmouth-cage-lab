# Site Template DXF — Specification & Status

> Combined orthographic face elevation + coupler plate template for site use.
> Gives fixing crews exact distances from the wall end to each coupler plate position.

---

## What It Produces

A single AC1009 DXF file (`{cageRef}-site-template.dxf`) with one section per
face that has VS/HS coupler holes. For P7349: F1A section and N1A section,
stacked vertically in one file.

Each section overlays:

| Layer | Colour | Contents |
|---|---|---|
| `BARS` | Green (3) | BREP bar hull outlines — real bar geometry (not centrelines) |
| `HOLES` | Red (1) | Coupler hole circles — coupler OD + 2mm tolerance |
| `PLATE_OUTLINE` | Blue (5) | Plate rectangles — 25mm clearance from outermost hole edge |
| `DIMS` | Grey (8) | Overall span dims + per-hole tick marks with mm labels |
| `TEXT` | White (7) | Section title, plate IDs, datum note |

---

## Pipeline

```
IFC file
  ├─ Text parser (ifc-parser.js)
  │    └─ allData — bar layer assignments + endpoints
  │         └─ _cageDatum()        → shared {datumPx, datumPz}
  │         └─ _detectFaceSepAxis() → 'x' | 'y' | 'z'
  │         └─ _parseIFCBeamHoles() → VS/HS hole positions
  │              └─ _bucketHolesByFace() → { F1A: [...], N1A: [...] }
  │                   └─ _computePlates() → vsPlates, hsPlates
  │
  └─ BREP (web-ifc WASM via viewer3d.js)
       └─ getFaceLayerVertexClouds(faceName) → vertex clouds per bar
            └─ convexHull2D() → projected bar outlines
```

Both paths subtract the same `_cageDatum()` origin → exact overlay.

---

## Coordinate System

| Variable | Formula | P7349 value |
|---|---|---|
| `datumPx` | `min(Start_Y, End_Y)` of F1A+N1A bars | 6,237,394 mm (IFC-Y) |
| `datumPz` | `min(Start_Z, End_Z)` of F1A+N1A bars | 12,864 mm (IFC-Z) |
| `px` axis | IFC-Y − datumPx (cage length) | 0 → 10,325 mm |
| `pz` axis | IFC-Z − datumPz (cage height) | 0 → 5,250 mm |

See `docs/datum.md` for full IFC placement investigation.

**Scale note:** Coordinates stored at real IFC mm (1:1). Title states "Scale 1:15".
Set plot scale to 1:15 in AutoCAD when printing. At 1:15:
- Width: 10,325 ÷ 15 = **688 mm** on paper
- Height per section: 5,250 ÷ 15 = **350 mm** on paper
- Fits on **A1 landscape** (841 × 594 mm) with two stacked sections.

---

## DXF Structure

```
HEADER   — AC1009, INSUNITS=4 (mm)
TABLES   — LTYPE (CONTINUOUS) + 5 LAYERs
BLOCKS   — empty (required by AC1009)
ENTITIES — all geometry
  [F1A section]
    BARS:           72 LINE sequences (hull edges)
    HOLES:          74 CIRCLE entities
    PLATE_OUTLINE:  8 plate rectangles (2 VS + 6 HS)
    DIMS:           overall span + per-hole ticks
    TEXT:           title + datum note + plate labels
  [600mm gap]
  [N1A section]
    BARS:           71 LINE sequences
    HOLES:          88 CIRCLE entities
    PLATE_OUTLINE:  5 plate rectangles (0 VS + 5 HS)
    DIMS + TEXT
EOF
```

---

## Verified Output — P7349_C1 (31 Mar 2026)

| Face | Bars | VS holes | HS holes | VS plates | HS plates |
|---|---|---|---|---|---|
| F1A | 72 | 25 | 49 | 2 | 6 |
| N1A | 71 | 0 | 88 | 0 | 5 |

Datum px=6,237,394 pz=12,864 — consistent across both BARS and HOLES layers.
Sample VS hole: px=5,202 pz=1,700 — within face bounds (0–10,325 × 0–5,250) ✓

---

## Plate Rules (inherited from template DXF)

| Rule | Value |
|---|---|
| Max plate length | 2000 mm |
| Max plate width | 300 mm |
| Edge clearance | 25 mm from outermost hole edge |
| VS plate orientation | Auto-detect: long = Z (height) for wall, long = X for slab |
| HS plate orientation | Hardcoded long = px (cage length direction) |
| Hole size | Coupler body OD (IFCBEAM `ATK EMBEDMENTS HEIGHT`) + 2 mm |

---

## UI

Button: **📐 Site Template DXF** in the Face View section.
- Disabled until BREP geometry finishes loading (same timing as Face View DXF button).
- Downloads `{cageRef}-site-template.dxf`.
- Requires: cage loaded + 3D view rendered.

Debug button (single face): **📐 Face View DXF** — BREP bar outlines only, no holes.

---

## Key Functions (`js/main.js`)

| Function | Role |
|---|---|
| `_cageDatum()` | Shared datum from F1A+N1A bar endpoints. Committed b9b0362. |
| `exportCombinedFaceDXF()` | Main combined export. Committed f05386e. |
| `exportFaceViewDXF(face)` | Single-face BREP bar outlines only (debug). |
| `exportTemplateDXF()` | Standalone plate template (hole layout, stacked plate diagrams). |
| `getFaceLayerVertexClouds(layer)` | `js/viewer3d.js` — BREP vertex extraction per layer. |

---

## Commits

| Hash | Description |
|---|---|
| `aa2a1f6` | Initial face view DXF with BREP convex hull + button timing fix |
| `b9b0362` | Shared datum fix — `_cageDatum()` aligns face view and template |
| `0b94eaa` | `docs/datum.md` — IFC placement investigation |
| `f05386e` | `exportCombinedFaceDXF()` — combined site template DXF |

---

## Pending / Next Steps

- [ ] Test `P7349_C1-site-template.dxf` in AutoCAD — confirm bar outlines and holes overlay correctly
- [ ] Verify N1A face orientation (currently same left-right as F1A — may need mirror for "viewed from outside N1A")
- [ ] Add drawing border / title block matching A4080-EXP-XX-HS-DR-MA series format
- [ ] Consider adding bar diameter labels on each BARS hull outline
