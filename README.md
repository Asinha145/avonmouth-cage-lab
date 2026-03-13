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
