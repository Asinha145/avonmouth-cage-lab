# Archive — Completed V2 Syncs

> Items that have been ported from cage-lab to V2 and are fully live.
> Read this before proposing work to V2 — do not re-implement what is already done.

---

## Synced to V2 — March / April 2026

### Perspective / Orthographic Camera Toggle
- **V2 commit:** `6f0db9a`
- **What:** `toggleCameraMode()` in viewer3d.js. Ortho frustum sized from orbit radius.
  "Persp" button in viewer header.
- **Lab origin:** `f464e2d` (implemented separately in V2, not ported from lab)

### VS/HS Layer Count — Bar Count Only
- **V2 commit:** `cee6800`
- **What:** Layer filter shows bar count only, not bars + couplers.

### BS 8666:2020 Bar Shape Lookup
- **V2 commit:** `f8a7d93`, `e7ea009`
- **What:** Full Table 3 lookup replacing crude shape guesser. Bar shape column shows
  code + name (e.g. "00 — Straight").

### Remove Coupler Weight
- **V2 commit:** `30ac9d4`
- **What:** Coupler weight removed from layer table, UDL, and EDB outputs entirely.

### Template DXF — F1A Face (OLD — broken, to be reverted)
- **V2 commit:** `a14c47e`
- **Status:** ⚠️ THIS IS THE OLD BROKEN VERSION. Known issues:
  - `_parseIFCBeamHoles` uses `new RegExp(id)` per call — O(n²), slow on large IFC
  - `IFCLOCALPLACEMENT\(\$,...)` only — returns 0 holes for relative placements (RF35, newer Tekla exports)
  - Single face only (F1A hardcoded) — misses N1A, T1A, B1A
  - Y-always bucketing — wrong for cages where faces are separated in X (P7349 type)
  - `px = xMm` always — plates appear as a vertical line for P7349 type cages
- **Action:** Revert `a14c47e` from V2, then port the correct multi-face version from lab
  (cage-lab commits `5348543`, `193198a`, `3bf4727`, `a6ef581`, `578b066`, `73a4f80`, `ba1738b`)
  as a single clean replacement when ready.

### Unknown Group Fix + Z_BAND Comment
- **V2 commit:** `866bcc6` (01 Apr 2026)
- **What:**
  - `viewer3d.js`: entities in neither barMap nor couplerMap route to `'Unknown'` (red)
    instead of silently joining `'Coupler Head'` (gray, invisible).
  - `main.js`: corrected misleading comment — `DZ_MAX=100mm` and `Z_BAND=500mm`
    are two distinct constants.

---

## Still Pending in V2 — see `pending-v2-sync.md`
