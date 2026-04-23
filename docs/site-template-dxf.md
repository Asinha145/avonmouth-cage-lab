# Site Template DXF — Specification & Status

> Combined orthographic face elevation + coupler plate template for site use.
> Gives fixing crews exact distances from the wall end to each coupler plate position.

---

## What It Produces

A single AC1009 DXF file (`A4080-EXP-XX-AF-DR-MA-20{last4}.dxf`) with one section per
face that has VS/HS coupler holes. For P7349: F1A section and N1A section,
stacked vertically in one file, with an A4080 title block at the base.

Each section overlays:

| Layer | Colour | Contents |
|---|---|---|
| `BARS` | White (7) | BREP bar hull outlines — real bar geometry (not centrelines) |
| `HOLES` | Red (1) | Coupler hole circles — coupler OD + 2mm tolerance (BYLOR-filtered: connected_rebar must exist + be VS/HS) |
| `PLATE_OUTLINE` | Blue (5) | Plate rectangles — 25mm clearance from outermost hole edge |
| `DIMS` | Grey (8) | Overall span dims + per-hole tick marks + **chain dimensions from datum rebar fixed ends** |
| `TEXT` | White (7) | Section title, plate IDs ({prod}-{cage}-{face}-{type}-{id}), datum note |
| `TITLE_BLOCK` | White (7) | A4080 border, cells, drawing number, scale, date |

---

## Pipeline

```
IFC file
  ├─ Text parser (ifc-parser.js)
  │    └─ allData — bar layer assignments + endpoints
  │         └─ _cageDatum()         → shared {datumPx, datumPz}
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

## Chain Dimensions (NEW — 24 Apr 2026)

Each face section now includes **incremental dimension chains from the datum rebar fixed end** to each coupler hole position.

### Design

- **Per-layer chains**: VS1 gets its own dimension chain, VS2 another, HS1 another, etc.
- **First dimension**: From the datum bar endpoint (`_getDatumBarEnds()` result) to the first hole in that layer
- **Incremental dims**: Between consecutive holes (hole[n-1] → hole[n])
- **Axis**: VS holes use VDIM (vertical axis, pz); HS holes use HDIM (horizontal axis, px)
- **Offset**: Each layer's chain is staggered by 20mm to avoid overlap
- **Activation**: Uses previously dead code `_getDatumBarEnds(faceName, datumSide, heightSide, sepAxis, useLongY, useY, datumPx, datumPz)` which finds the nearest endpoint of each datum bar (VS and HS) in the crossing region

### Example (F1A section, datum side = left, height = bottom)

```
VS1 holes at pz: [1000, 2050, 3100]
  VDIM: vBarEndPz → 1000    label: 1000
  VDIM: 1000 → 2050        label: 1050
  VDIM: 2050 → 3100        label: 1050

HS1 holes at px: [500, 2000, 3500]
  HDIM: hBarEndPx → 500     label: 500
  HDIM: 500 → 2000          label: 1500
  HDIM: 2000 → 3500         label: 1500
```

All dimensions appear at fixed offset distances (30mm outside plate cluster for VS, 50mm below datum point for HS) to ensure visibility.

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
TABLES   — LTYPE (CONTINUOUS) + 6 LAYERs (BARS, HOLES, PLATE_OUTLINE, DIMS, TEXT, TITLE_BLOCK)
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
  [TITLE_BLOCK]
    A0 border (1189×841 mm × 15 = 17,835 × 12,615 mm model space)
    Cell geometry scaled from A4080 DXF template
    Drawing number: A4080-EXP-XX-AF-DR-MA-20{last4}
    Scale: 1:15 | Date: auto
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

## Title Block — A4080 Format

Drawing border is A0 landscape (1189 × 841 mm) scaled ×15 into model space.
Title block strip is 100 mm tall at the base of the drawing (pz = 0 to -1500 in model space).

| Field | Value |
|---|---|
| Drawing number | `A4080-EXP-XX-AF-DR-MA-20{last4}` |
| Scale | `1:15` |
| Date | `new Date()` — auto at export time |
| Originator | A4080 / EXP |
| Project ref | from cageRef |

**Pending fields** (to fill once DWG template confirmed):
- Project name full text
- Originator logo area
- DRAWN / CHECKED / APPROVED names
- Purpose of Issue / Status code

---

## UI

Button: **📐 Site Template DXF** in the Face View section.
- Disabled until BREP geometry finishes loading (same timing as Face View DXF button).
- Downloads `A4080-EXP-XX-AF-DR-MA-20{last4}.dxf`.
- Requires: cage loaded + 3D view rendered.

Debug button (single face): **📐 Face View DXF** — BREP bar outlines only, no holes.

---

## Key Functions (`js/main.js`)

| Function | Role |
|---|---|
| `_cageDatum()` | Shared datum from outermost face layer bar endpoints. |
| `_detectFaceSepAxis()` | Geometry-based: 'x', 'y', or 'z' (slab). |
| `_getDatumBarEnds()` | Returns `{ hBarEndPx, vBarEndPz }` — fixed endpoints of datum VS and HS bars (used by chain dims). |
| `_parseIFCBeamHoles()` | Extracts coupler holes + BYLOR filtering (connected_rebar must exist + be VS/HS layer). |
| `exportCombinedFaceDXF()` | Main combined export with title block + chain dimensions. |
| `exportFaceViewDXF(face)` | Single-face BREP bar outlines only (debug). |
| `exportTemplateDXF()` | Standalone plate template (hole layout, stacked plate diagrams). |
| `exportCOGDXF()` | COG export: external face BREP + COG marker + H/V dims from datum end. |
| `getFaceLayerVertexClouds(layer)` | `js/viewer3d.js` — BREP vertex extraction per layer. |

---

## Commits

| Hash | Description |
|---|---|
| `aa2a1f6` | Initial face view DXF with BREP convex hull + button timing fix |
| `b9b0362` | Shared datum fix — `_cageDatum()` aligns face view and template |
| `0b94eaa` | `docs/datum.md` — IFC placement investigation |
| `f05386e` | `exportCombinedFaceDXF()` — combined site template DXF |
| `0cf201a` | docs: site-template-dxf.md + update todo + output-spec |
| `f464e2d` | A4080 title block, persp/ortho toggle, datum sphere |

---

## Commits (Recent)

| Hash | Description | Date |
|---|---|---|
| `8067718` | DXF improvements: template center hole, site template dims & cosmetics, COG export | 24 Apr 2026 |
| `97b7100` | Fix: define prodNum and cageRef in exportCombinedFaceDXF | 24 Apr 2026 |
| `7fa236b` | Fix: remove duplicate cageRef definition | 24 Apr 2026 |
| `22cc55b` | Update COG DXF to use BREP geometry instead of line diagrams | 24 Apr 2026 |

---

## Pending / Next Steps

- [x] Chain dimensions from datum rebar fixed ends per layer — DONE 24 Apr 2026
- [x] BARS layer color green → white — DONE 24 Apr 2026
- [x] Remove CPLR text labels — DONE 24 Apr 2026
- [x] BYLOR coupler filtering (connected_rebar + VS/HS layer check) — DONE 24 Apr 2026
- [x] Template DXF center mounting hole — DONE 24 Apr 2026
- [x] COG DXF export — DONE 24 Apr 2026
- [ ] Test chain dimensions in real cages (verify stagger offset, label readability)
- [ ] Test `A4080-EXP-XX-AF-DR-MA-20xxxx.dxf` in AutoCAD — confirm bar outlines and holes overlay correctly
- [ ] Verify N1A face orientation (currently same left-right as F1A — may need mirror for "viewed from outside N1A")
- [ ] Fill in title block fields: project name, originator logo, DRAWN/CHECKED/APPROVED, Purpose of Issue
- [ ] Bar diameter labels on each BARS hull outline (optional)
