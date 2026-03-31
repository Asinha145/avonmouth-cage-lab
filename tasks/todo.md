# Face View & Site Template DXF — Task Log

## Status: ✅ COMPLETE (31 Mar 2026)

---

## A — Face View DXF (`exportFaceViewDXF`) ✅

- [x] Add `exportFaceViewDXF(faceLayerName)` function
- [x] Guard: return if no data loaded
- [x] Default faceLayerName to first detected face layer if not supplied
- [x] Get sepAxis from `_detectFaceSepAxis()`
- [x] BREP path: `getFaceLayerVertexClouds()` → convex hull per bar → LINE entities
- [x] Centreline fallback: bar start/end from `allData` if BREP not loaded
- [x] Project to 2D using shared datum from `_cageDatum()`
- [x] Build AC1009 DXF: BARS layer, CRLF endings
- [x] Trigger download as `{cageRef}-{faceLayerName}-view.dxf`
- [x] Button disabled until BREP loads (timing fix)

## B — Datum Fix (`_cageDatum`) ✅

- [x] Investigate IFC `IFCAXIS2PLACEMENT3D` placement chain — confirmed all at (0,0,0)
- [x] Identify cage BNG origin `#22 = (1979628.891, 6241885.262, 19259.997)` — not suitable as drawing datum (pz all-negative)
- [x] Implement `_cageDatum()` using outermost face layer (F1A+N1A) bar centreline endpoints
- [x] datumPx=6,237,394 datumPz=12,864 for P7349 → F1A face view 0–10,325 × 0–5,250mm ✓
- [x] Apply to `exportFaceViewDXF` — replaces `Math.min(BREP vertex cloud)`
- [x] Apply to `exportTemplateDXF` — replaces `globalMinY` + per-face `minP`
- [x] Apply to `diag-faceview-brep.mjs` local test script
- [x] Document in `docs/datum.md`

## C — Combined Site Template DXF (`exportCombinedFaceDXF`) ✅

- [x] One section per face with VS/HS holes (F1A + N1A for P7349)
- [x] Sections stacked vertically, 600mm gap
- [x] BARS layer (green): BREP convex hull bar outlines using `getFaceLayerVertexClouds()`
- [x] HOLES layer (red): coupler hole circles at face coords using shared datum
- [x] PLATE_OUTLINE layer (blue): plate rectangles computed from `_computePlates()` at face coords
- [x] DIMS layer (grey): overall span dimensions + per-hole tick marks
- [x] TEXT layer (white): section title (Scale 1:15), plate IDs, datum note
- [x] AC1009 DXF: real mm coordinates, CRLF endings
- [x] New UI button "📐 Site Template DXF" — disabled until BREP loads
- [x] Logic validated: VS hole px=5202 pz=1700 within face bounds ✓

## D — Documentation ✅

- [x] `docs/datum.md` — IFC placement chain investigation, datum fix rationale
- [x] `docs/site-template-dxf.md` — full spec, pipeline, verified output, commits

---

## Commits

| Hash | Description |
|---|---|
| `aa2a1f6` | Face view DXF — BREP + button timing |
| `b9b0362` | Shared datum `_cageDatum()` |
| `0b94eaa` | docs/datum.md |
| `f05386e` | exportCombinedFaceDXF — site template |

---

## Pending

- [ ] Test in AutoCAD — confirm bar outlines + holes overlay at correct positions
- [ ] N1A face orientation check — may need left-right mirror for "outside N1A" view
- [x] Drawing border + title block — A0 landscape 1:15, BS 1192 layout, drawing ref A4080-EXP-XX-AF-DR-MA-20{last4}
- [ ] Title block fields to update once DWG template accessible: project name, originator logo, checked/approved names
- [ ] Bar diameter labels on BARS hull outlines (optional)
