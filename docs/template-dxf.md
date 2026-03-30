# Template DXF — F1A Face Elevation

Generates a DXF drawing of the F1A end-plate showing strut bar coupler holes with correct positions and sizes, derived directly from IFC geometry.

---

## What It Produces

A flat 2D DXF (AutoCAD R12 / AC1009) of the F1A face plate as seen in elevation:

- **X axis** = IFC-X (cage length direction)
- **Y axis** = IFC-Z (cage height direction)
- One circle per VS/HS strut coupler hole
- Each hole labelled `{CAGE_REF}-CPLR-SID-NNN`
- Border, title block, span dimensions, X/Z tick marks

**Layers in the DXF:**

| Layer | Contents |
|---|---|
| `PLATE_OUTLINE` | Drawing border and title separator |
| `HOLES` | Coupler hole circles |
| `TEXT` | Title block text and hole labels |
| `DIMS` | Span dimensions and tick marks |

---

## How Hole Positions Are Determined

Hole positions come from **IFCBEAM placement coordinates**, not from bar `startX`/`startZ`.

### Why IFCBEAM, Not Bar Placement

VS/HS strut bars (N1-CPLR-L type) run in the IFC-Y direction. Their IFC placement origin is at the N1A face end, meaning `startX`/`startZ` is correct in X and Z but does not represent where the coupler sits. The IFCBEAM entity (the physical coupler head) is placed at the correct global position on the F1A face.

### Placement Chain

```
IFCBEAM → IFCLOCALPLACEMENT($, axis_id)
                ↓
          IFCAXIS2PLACEMENT3D(cp_id, ...)
                ↓
          IFCCARTESIANPOINT((X, Y, Z))   ← absolute global mm
```

`IFCLOCALPLACEMENT($, ...)` — the `$` (no parent) means absolute global coordinates in BNG-offset mm.

- **Hole X** = IFCBEAM global X − min X of all F1A strut couplers
- **Hole Z** = IFCBEAM global Z − min Z of all F1A strut couplers

---

## How Hole Sizes Are Determined

Hole diameter = **IFCBEAM HEIGHT** (coupler body OD) **+ 2 mm** tolerance.

Source: `ATK EMBEDMENTS` property set on each IFCBEAM → `HEIGHT` property (IFCLENGTHMEASURE).

Do **not** use bar rebar diameter (`Size`) or the FPGS code second field — those are the rebar size, not the coupler OD.

### Coupler Model → OD → Hole Size

| Coupler model | IFCBEAM HEIGHT (OD) | Hole diameter |
|---|---|---|
| AG16 | 25 mm | **27 mm** |
| AG20N | 31 mm | **33 mm** |
| AG25 | 38 mm | **40 mm** |
| AG32N | 47 mm | **49 mm** |

---

## Face Filter — F1A Only

Each cage has couplers on both faces (N1A and F1A). The template shows F1A only.

**Filter:** IFCBEAM Y > midpoint of (min coupler Y, max coupler Y)

For cage 1613 (2HD70719AC1):
- N1A couplers: Y ≈ 6,009,939–6,009,982 mm
- F1A couplers: Y ≈ 6,010,217–6,010,261 mm
- Midpoint: Y = 6,010,100 mm

The IFCBEAM is placed ~10 mm inside the F1A outer face plate. The coupler body then projects outward through and beyond the face plate.

---

## Layer Filter — VS/HS Strut Bars Only

The cage contains many IFCBEAM couplers beyond the strut bars (slab connection bars, preload bars, end bars). Only VS/HS strut couplers appear in the template.

**Filter:** Avonmouth pset `Layer/Set` property on the IFCBEAM matches `/^[VH]S/i`

| Layer/Set value | Included |
|---|---|
| VS1, VS2, VS3 | ✅ strut bars |
| HS1, HS2 | ✅ strut bars |
| F1A, N1A | ❌ face mesh bars |
| PRL, PRC | ❌ preload bars |

For cage 1613 this yields **38 strut holes** from 238 total IFCBEAM couplers.

---

## IFC Property Chain Summary

```
IFCBEAM
 ├─ ATK EMBEDMENTS pset → HEIGHT = coupler OD (mm)
 ├─ Avonmouth pset      → Layer/Set = VS1 / VS2 / HS1 etc.
 └─ IFCLOCALPLACEMENT($, ...) → X, Y, Z (absolute global mm)
```

> **Note on `connected_rebar`:** The Bylor pset on IFCBEAM has a `connected_rebar` property pointing to the associated CPLR bar GlobalId. This link is a Tekla batch-reference — the referenced bar may be at a different X,Z location. Do not use `connected_rebar` to derive hole position; always read the IFCBEAM's own placement.

---

## Implementation

### cage-lab / cage-v2 (client-side, browser)

`js/main.js` — two functions:

| Function | Purpose |
|---|---|
| `_parseIFCBeamHoles(ifcText)` | Parses raw IFC text; returns `[{xMm, zMm, holeDia}]` |
| `exportTemplateDXF()` | Calls parser, builds DXF string, triggers browser download |

Raw IFC text is stored in `_rawIfcText` when the file is loaded in `processFile()`. No re-read required at export time.

Button: `#export-template-dxf-btn` — shown for wall cages, hidden for slab cages.

### de-tool (server-side, Node/Express)

`server/routes/projects.js` — `GET /:id/template-drawing`

| Function | Purpose |
|---|---|
| `parseIFCBeamHoles(ifcText)` | Same algorithm; reads IFC from `file.stored_path` |
| Route handler | Streams DXF as `application/dxf` attachment |

---

## Output Spec

| Field | Value |
|---|---|
| DXF version | AC1009 (AutoCAD R12) |
| Units | mm |
| Origin | Bottom-left of coupler extent (min X, min Z) |
| Border margin | 100 mm each side |
| Title block height | 70 mm |
| Hole label format | `{CAGE_REF}-CPLR-SID-NNN` (sequential, sorted left→right, bottom→top) |
