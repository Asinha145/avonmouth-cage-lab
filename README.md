# IFC Rebar Analyzer v2

Browser-based tool for analysing reinforcement bar cages exported from ATK/Tekla as IFC2X3 files. Built for the **Avonmouth Dock Wall** project (LOR/Bylor JV).

Drop an IFC file in. Get stats, weights, layer breakdown, and a solid 3D preview — all without installing anything.

---

## What it does

- **Parses IFC** bar data: shape codes, layers, weights, dimensions
- **3D cage preview** using solid BREP geometry from the IFC file (not approximated shapes)
- **C01 acceptance check**: rejects cages with unknown bars, missing layers, duplicate IDs, or missing weights
- **Stagger clustering**: counts ring bars correctly even when they're split into multiple IFC entities at lapping zones
- **Step detection**: flags vertical bars at the same plan position with different top levels (15–300mm range)
- **Weight table** by Avonmouth layer, UDL factor (non-mesh ÷ mesh), diameter summaries
- **CSV export** with all bar data, coordinates, cage axis, cluster IDs

---

## How to run locally

```bash
python -m http.server 8000
# then open http://localhost:8000
```

The WASM file has to be served over HTTP — it won't work from `file://`. The same restriction applies to most modern browser APIs.

---

## How the 3D preview works

The old version approximated bar shapes from shape codes (00, 11, 13, 21, 36…) using BS 8666 geometry formulas. This caused a series of bugs:

- **Wrong matrix column** — some IFC files stored bars along local X, others along local Z. Needed per-file detection.
- **Shape 21 dimension assignment** — the "leg" dimension was mapped to the wrong axis for some files.
- **New shape codes** — every new shape (12, 26, 36) needed a separate formula.

v2 drops all of that. The IFC file already contains the tessellated solid mesh (`IFCFACETEDBREP`) — written by Tekla/ATK at export time. This version uses **web-ifc** (a C++ IFC parser compiled to WebAssembly) to read that mesh directly. No shape code inference. No axis detection. The geometry is just there.

The 3D dimensions (Width × Length × Height) now come from the bounding box of the actual BREP vertices, not from centreline positions plus estimated half-diameters.

---

## Files

```
index.html            — main page
css/style.css         — all styling
js/
  ifc-parser.js       — IFC text parser: metadata, validation, stats, clustering
  viewer3d.js         — web-ifc WASM wrapper: BREP geometry → Three.js scene
  main.js             — UI, stat blocks, table, export
lib/
  web-ifc-api-iife.js — web-ifc browser bundle (v0.0.77)
  web-ifc.wasm        — compiled C++ IFC engine (~1.8 MB)
examples/
  P165_C2.txt         — 409-bar cage, C01 accepted
  P7019_C1.ifc        — 990-bar cage, C01 accepted
```

---

## Milestones

### v1 — Core Analyser (13 Mar 2026)
First working release. IFC text parser, 3D BREP viewer via web-ifc WASM, C01 acceptance check, weight table, CSV export. No shape-code geometry approximation — reads Tekla's own tessellated solids directly.

### v2 — EDB + C01 Validation System (17 Mar 2026)
Full Excel EDB template output (`.xlsm`). Wall thickness auto-fill from BREP. PRL/PRC mismatch detection — flags bars where the geometry label contradicts the layer label and highlights them in the 3D viewer. Step detection for vertical bars at the same plan position. Bracing bar lookup table. C01 report export. EDB gated behind C01 approval.

### v3 — Multi-Vendor + Slab Cage Support (20–25 Mar 2026)
Parser extended to handle ICOS and INGEROP IFC exports (spaced format, different pset naming). Slab/roof cage auto-detection (T1A/B1A layers). Slab EDB with T1/T2/B1/B2 bar-role dimension derivation. UDL and weight attribution using ATK pset `Weight` over geometry-estimated `Formula_Weight`. Three-bbox dimension architecture separating mesh, all-bars, and total envelopes.

### v4 — IFCBEAM Coupler Head System (26–27 Mar 2026)
Full support for IFCBEAM coupler head entities. Coupler heads identified by `Bylor.connected_rebar` and `Avonmouth.Layer/Set` pset — displayed in the 3D viewer under their correct layer, not as "Unknown". BREP bounding box used as authoritative cage height (correctly handles Shape Code 26 cranked bars where text-parser projection overestimates height). Three-zone spatial classifier replaces AABB check for PRL/PRC face assignment. Coupler head weight attribution via ATK pset.

### v5 — Template DXF Fabrication Output (30 Mar 2026)
Generates a dimensioned DXF plate template showing the exact hole positions for VS/HS strut coupler penetrations through the formwork face. Full auto-detection pipeline:
- IFCBEAM positions parsed directly from raw IFC text (handles both absolute `$` and relative `#N` parent placements)
- VS and HS plates generated separately with independent orientation detection
- Plate long axis auto-detected from hole distribution (wall cage VS → Z axis; slab cage VS → X axis)
- Face plane auto-detected (wall cage → X-Z; slab cage → X-Y using Y as second axis)
- Face name (`F1A`, `T1A`, etc.) derived by Y/Z proximity of face layer bars to coupler holes — detection axis itself determined from layer naming (F/N → wall → compare Y; T/B → slab → compare Z)
- Greedy band-and-group algorithm respects 2000mm max length and 300mm max width constraints with 25mm edge clearance
- VS/HS layer counts shown as bar count only (coupler is part of the bar unit, not a separate item)

---

## Changelog

### 30 Mar 2026
- **Template DXF — face name auto-detection**: `_detectFaceName` uses Y/Z proximity of mesh face bars to coupler holes. Detection axis driven by layer naming (F/N → wall → Y; T/B → slab → Z). Verified against 1613, 1704, RF35.
- **Template DXF — face plane fix**: Slab cage holes lie in X-Y plane (Z constant). `pz` now maps from IFC-Y not IFC-Z when Z span < 100mm. RF35 plates: 83mm wide → 200mm wide.
- **Template DXF — orientation auto-detect**: `getOrientation()` counts unique X vs Z positions per hole group. Wall VS → long=Z; Slab VS → long=X. Fixes RF35 producing 30 single-hole plates instead of 3×20.
- **IFCBEAM placement fix**: `_parseIFCBeamHoles` regex broadened from `\(\$,` to `\([^,)]*,` — handles both absolute (`$`) and relative (`#N`) IFCLOCALPLACEMENT first arguments. Fixes RF35 returning 0 holes.
- **VS/HS count display**: Layer checkbox panel now shows bar count only for VS/HS layers (coupler is 1:1 with bar — not a separate unit). Was showing 120 for RF35 VS, now shows 60.
- **Separate VS/HS plates**: VS and HS holes grouped and plated independently with correct long-axis orientation.
- **Template DXF for all cage types**: Removed wall-only gate; template works for wall and slab cages.
- **Coupler weight removed**: Coupler weight stripped from layer table, UDL, and EDB outputs — was double-counting (ATK pset weight already includes the coupler).
- **JS syntax fix**: Duplicate `const pct` declaration after coupler weight removal caused silent SyntaxError killing all DOMContentLoaded listeners (file upload broken on GitHub Pages).

### 27 Mar 2026
- **Weight source fix**: `extractSlabData` switched to `b.Weight ?? b.Formula_Weight`. ATK pset weight is authoritative; geometry formula is fallback only. Eliminated ~96 kg discrepancy on cage 672.
- **Cage-lab public repo initialised**: Stripped EDB templates; public lab split from private cage-v2.

### 26 Mar 2026
- **BREP height authoritative**: Mesh height display uses BREP bbox, not text-parser projection. For Shape Code 26 (cranked) bars the text parser overestimates height by the horizontal leg lengths.
- **Three-zone PRL/PRC classifier**: Replaced AABB check with F1A / void / N1A zone classifier derived from actual mesh bar Y positions.
- **Three-bbox dimension architecture**: `meshBbox`, `allBarBbox`, `totalBrepBbox` maintained separately. EDB width from all bars; EDB length/height from mesh bars; display height from unconditional BREP envelope.
- **Coupler head layer association**: IFCBEAM entities now shown under their Avonmouth layer in viewer and weight table, not as "Unknown".

### 17–25 Mar 2026
- **Slab cage support**: Auto-detects T1A/B1A. Slab EDB derives H36/I36 from T2/B2 and T1/B1 bar lengths (not axis extents — avoids brittle orientation assumption).
- **Spacing formula fix**: `span / (N-1)` not `span / N`. 24 bars over 4805mm: 200mm (wrong) → 210mm (correct).
- **Multi-vendor parser**: ICOS and INGEROP IFC format support (spaced tokens, different pset naming).
- **EDB system**: Full Excel output, wall thickness auto-fill, UDL, diameter summaries, C01 gate.
- **Step detection, stagger clustering, PRL/PRC mismatch**.

### 13 Mar 2026
- Initial release: IFC parser, BREP 3D viewer, C01 check, weight table, CSV export.

---

## Mistakes I made building this (so I remember)

**S14 — Wrong bar direction column**
I was extracting bar direction as column 0 of the rotation matrix. Some IFC files from ATK stored bars along local Z (column 2). Fixed it with a per-template detection hack. Then v2 made it irrelevant — BREP doesn't need the direction vector at all.

**S17 — Per-template axis detection**
Built a cache that read the BREP end-cap face to decide if the template's long axis was X or Z. This is the kind of thing you spend three hours on and then wish you'd just read the actual geometry to begin with.

**S18 — Shape 21/36 dimension assignment**
For U-bars (shape 21) I had Dim_A as the leg and Dim_B as the cross. Some ATK exports had it the other way. Ended up with bars rendered inside-out. Fixed it by comparing against the actual BREP output from web-ifc. Classic case of guessing something the file already knew.

**Stagger clustering — Z_BAND value**
The clustering algorithm splits bars into height zones before running the average-linkage merger. I initially documented this threshold as 1000mm then corrected to 100mm. The DZ_MAX (maximum Z difference to merge two stagger segments) is 100mm. The Z_BAND (gap between height zones) is 500mm in the final parser code.

**Shape code suffix order**
Griptech coupler suffixes like `GF/GM` (slash notation) need to be matched before `GF` and `GM` separately — otherwise the slash version never gets detected. Spent longer on this than I should have.

**Reading the same file twice**
The browser's `FileReader` can't seek — once you read a file as text you can't go back and read it as `ArrayBuffer` from the same event. Had to read it twice: once as text for the IFC parser, once as ArrayBuffer for the WASM engine. Works fine, just not obvious.

---

## Coordinate system

IFC files use BNG-offset project coordinates in mm, Z-up.

web-ifc converts to Y-up metres for Three.js:
- engine_X = IFC_X / 1000
- engine_Y = IFC_Z / 1000
- engine_Z = −IFC_Y / 1000

The parser (`ifc-parser.js`) works in raw IFC mm throughout.

---

## Cage sizes confirmed from BREP

| File | Bars | Width | Height | Length |
|------|------|-------|--------|--------|
| 2HD70730AC1.ifc | 332 | 600 mm | 3,500 mm | 7,900 mm |
| P7019_C1.ifc | 990 | 1,300 mm | 5,300 mm | 11,300 mm |

---

*Avonmouth Dock Wall · LOR/Bylor JV · 2026*
