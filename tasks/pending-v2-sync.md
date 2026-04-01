# Pending V2 Sync — Features in Lab Not Yet in V2

> V2 last commit: `866bcc6` (01 Apr 2026).
> Completed ports → see `tasks/archive.md`.
> Priority: ⭐⭐⭐ = port now | ⭐⭐ = port next | ⭐ = low priority

---

## ACTION REQUIRED — Revert broken Template DXF from V2

V2 commit `a14c47e` added a Template DXF that is silently broken for most real cages.
**Revert it before porting the correct version from lab.**

Known failures in V2's current template:
- Returns 0 holes for any cage with relative IFCLOCALPLACEMENT (RF35, newer Tekla exports)
- O(n²) performance — `new RegExp(id)` scan per entity lookup
- Single face only (F1A hardcoded) — N1A holes never generated
- Y-always bucketing — wrong face for P7349-type cages (faces in X, not Y)
- `px = xMm` always — plates appear as a vertical line for P7349-type
- Slab face plane always X-Z — plate width ≈ 0mm for slab cages

**Revert command:** `git revert a14c47e` in V2, then port the correct version below.

---

## GROUP 1 — Template DXF Correct Port (after revert above)

All of these replace V2's broken template with the lab's validated version.
Port together as a single PR — they are interdependent.

| # | What | Lab commit | Effort |
|---|---|---|---|
| 1 | IFCBEAM relative placement regex | `ba1738b` | 1 line |
| 2 | O(1) entity lookup (Map, not RegExp) | `73a4f80` | ~15 lines |
| 3 | `_detectFaceSepAxis()` geometry-based | `5348543` | ~25 lines |
| 4 | `_bucketHolesByFace` sep axis fix | `193198a` | ~10 lines |
| 5 | Multi-face template sections per face | `3bf4727` | ~40 lines |
| 6 | `useLongY` px axis fix | `a6ef581` | ~5 lines |
| 7 | Slab face plane: X-Y not X-Z | `578b066` | ~5 lines |
| 8 | VS/HS plate auto-detect long axis | `64ed523`+ | ~20 lines |
| 9 | `_cageDatum()` shared datum | `b9b0362` | ~25 lines |
| 10 | Conditional template button (VS/HS only) | `ab6fcfa` | 3 lines |

---

## GROUP 2 — Bug Fixes (independent of template, port any time)

| # | What | Lab commit | Effort |
|---|---|---|---|
| 11 | C01 reject diagonal cage | `a9bbf2c` | ~35 lines in main.js |
| 12 | `_computePlates` 15mm tolerance bucket | `ebf09b8` | 2 chars — only if/when template is ported |

Note: Items #5, #8 from dead `_detectFaceName` and Unknown masking already done in `866bcc6`.

---

## GROUP 3 — 3D Viewer Enhancements (additive, no regressions)

| # | What | Lab commits | Effort |
|---|---|---|---|
| 13 | Red datum sphere | `71fbaf9` | ~20 lines viewer3d.js |
| 14 | Orange layer datum markers | `d19b852`→`ce11f51` | ~120 lines main.js + viewer3d.js |
| 15 | Coupler plates as 3D solids | `ab6fcfa` | ~80 lines main.js + viewer3d.js |

---

## GROUP 4 — Large DXF Exports (port last, after template is stable)

| # | What | Lab commits | Notes |
|---|---|---|---|
| 16 | Site Template DXF + A4080 title block | `f05386e`+ | Requires Group 1 first |
| 17 | Face View DXF (debug) | `aa2a1f6`+ | Lower priority |
