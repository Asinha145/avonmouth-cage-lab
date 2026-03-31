# Face View DXF Export

## B — DXF Face View (`js/main.js`)

- [ ] Add `exportFaceViewDXF(faceLayerName)` function
- [ ] Guard: return if no data loaded
- [ ] Default faceLayerName to first detected face layer if not supplied
- [ ] Get sepAxis from `_detectFaceSepAxis()`
- [ ] Filter vertBars (F1A layer) and horizBars (all /^HS/i layers)
- [ ] Project to 2D, normalise to origin
- [ ] Build AC1009 DXF: VERT layer (yellow) + HORIZ layer (blue), LINE entities, TEXT label
- [ ] Trigger download as `{cageRef}-{faceLayerName}-view.dxf`

## UI (`index.html` + `js/main.js`)

- [ ] Add hidden `#face-view-section` with face dropdown + DXF button to index.html
- [ ] Populate dropdown and show section after cage loads
- [ ] Wire DXF button click handler

## Notes

- sepAxis='x': px=yMm, pz=zMm | sepAxis='y': px=xMm, pz=zMm | sepAxis='z': px=xMm, pz=yMm
- All HS layers included (HS1, HS2, HS3...) — they all cross the face as horizontal lines
- Follow exact emit pattern from exportTemplateDXF. AC1009, INSUNITS=4 (mm).
- face-view-section hidden until face layers detected after load
