# Pending Sync: cage-lab → avonmouth-cage-v2

Changes completed in cage-lab that have NOT yet been pushed to v2.
Update this file as each item is ported. Last v2 commit: `30ac9d4` (27 Mar 2026).

---

## 1. VS/HS Count Fix — viewer shows bar count only ✅ PORTED TO V2 (31 Mar 2026, commit `cee6800`)
**File:** `js/main.js` → `_buildViewerCheckboxes`
**Change:** For VS/HS layers, show rebar count only (not rebar + coupler). Coupler is 1:1 with bar — showing both doubled the count. RF35 VS was showing 120, now 60.
```javascript
const count = /^[VH]S/i.test(key) ? rebarCount : rebarCount + couplerCount;
```

---

## 2. IFCLOCALPLACEMENT Relative Placement Fix
**File:** `js/main.js` → `_parseIFCBeamHoles`
**Change:** Broadened regex from `\(\$,` to `\([^,)]*,` to handle both absolute (`$`) and relative (`#N`) first arguments. RF35 was returning 0 holes without this.

---

## 3. Orientation Auto-Detect for Template Plates
**File:** `js/main.js` → `_computePlates` / `getOrientation()`
**Change:** Counts unique X vs Z positions per hole group to auto-detect long axis. Wall VS → long=Z; Slab VS → long=X. Fixes RF35 producing 30 single-hole plates instead of 3×20.

---

## 4. Slab Face Plane Fix (X-Y not X-Z)
**File:** `js/main.js` → `exportTemplateDXF`
**Change:** Detects Z span of holes per face. Z span < 100mm → slab cage → use Y as second axis (`pz = yMm`). RF35 plates: 83mm wide → 200mm wide.

---

## 5. Face Name Auto-Detection
**File:** `js/main.js` → `_detectFaceName()`
**Change:** New function. Uses layer naming (F/N present → wall → compare Y; T/B → slab → compare Z) to find which face layer is nearest to the coupler holes. Replaces hardcoded 'F1A'.
**Verified:** 1613 → F1A, 1704 → F1A, RF35 → T1A.

---

## 6. Multi-Face Template (yMid filter removal + _bucketHolesByFace)
**File:** `js/main.js` → `_parseIFCBeamHoles`, `_bucketHolesByFace()`, `exportTemplateDXF`
**Change:** Removed yMid filter that silently dropped holes on all but one face. Added `_bucketHolesByFace` which assigns every hole to its nearest face layer. `exportTemplateDXF` now loops over face buckets and draws a separate labelled section per face.
**Impact:** P7349 old: 44 holes (F1A only). New: 162 holes across F1A, N3A, F3A, N5A — 4 sections.

---

## 7. Face Bucketing Axis Fix (geometry-based, NOT cageAxisName)
**File:** `js/main.js` → `_detectFaceSepAxis()` (new), `_bucketHolesByFace`
**Change:** Was comparing Y to separate F/N faces. P7349 wall runs in Y so faces are in X — but `cageAxisName` for P7349 is `'Z'` (not 'Y'), so a `cageAxisName === 'Y'` guard never fires.
**Correct approach:** `_detectFaceSepAxis()` compares max within-layer spread on X vs Y. F1A bars cluster at X±50mm, spread 10,267mm in Y → `sepAxis='x'`. No dependence on `cageAxisName`.

---

## 8. px Axis Fix — useLongY from faceSepAxis
**File:** `js/main.js` → `exportTemplateDXF`
**Change:** `useLongY = faceSepAxis === 'x' && !useY` (was `cageAxisName === 'Y' && !useY`). For P7349, this ensures `px = yMm` (cage Y length), not `xMm` (wall thickness direction, only 2 discrete values).

---

## 9. HS Plate Orientation Hardcoded
**File:** `js/main.js` → `_computePlates`
**Change:** `hsOri = { bandKey:'pz', groupKey:'px' }` always. Removed auto-detect for HS. HS struts are always horizontal along cage length — auto-detect was unreliable when px was previously broken (only 2 unique values → xUniq=1 → wrongly chose long=Z).

---

## 10. entityMap Performance Fix
**File:** `js/main.js` → `_parseIFCBeamHoles`
**Change:** One-pass `Map` build at function entry replaces per-call `new RegExp(#N=...)` lookups. Was O(n) per lookup scanning the full file — caused "page not responding" on P7349 (5.5MB, thousands of IFCBEAM pset chain lookups). Now O(1) per lookup after one O(n) build.

---

## 11. Progress Bar for Large Files
**File:** `js/main.js` → `exportTemplateDXF`
**Change:** Function is now `async`. Uses `showProgress()` / `updateProgress()` and `yield_ = () => new Promise(r => setTimeout(r, 0))` between stages. UI stays responsive on files >1MB. Progress stages: parse (0%), bucket (55%), compute plates (70%), build DXF (85%), save (98%), done (100%).
