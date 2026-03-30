# C01 Ruleset — Rejection, Warnings, and Void Zone

Defines every condition that triggers a C01 Rejected status, a Warning, or zone-based classification logic. All rules are implemented in `js/ifc-parser.js` and `js/main.js`.

---

## 1. C01 Rejected

A cage is **C01 Rejected** when any one of the four conditions below is true. Rejection blocks all data exports (EDB, Slab EDB, C01 Report).

```
isRejected = unknownCount > 0
          OR missingLayerCount > 0
          OR duplicateCount > 0
          OR missingWeightCount > 0
```

---

### Rule R1 — Unknown Bar Type

| Field | `unknownCount` |
|---|---|
| Threshold | `> 0` |
| Banner reason | "X bar(s) with unrecognised Bar_Type" |
| Detail card | `c01-unknown-card` |

**Condition:** A bar has `Bar_Type === 'Unknown'`.

A bar reaches `Unknown` when none of the classifier conditions in `classifyBars()` match:

| Bar_Type assigned | Conditions |
|---|---|
| Mesh Bar | Has `Avonmouth_Layer_Set` matching F1A or N1A face layer AND shape code or direction places it in the mesh plane |
| Link Bar | Closed stirrup shape code (e.g. C60, C63) |
| Loose Bar | U-bar or straight bar not in a mesh or strut layer |
| Strut Bar | VS or HS layer, or bar running in the cage-width (Y) direction with coupler |
| Preload Bar | Layer starts with PRL or PRC |
| **Unknown** | None of the above match |

Any bar left unclassified = Unknown = immediate rejection.

---

### Rule R2 — Missing Avonmouth Layer

| Field | `missingLayerCount` |
|---|---|
| Threshold | `> 0` |
| Banner reason | "X bar(s) with no Avonmouth layer assignment" |
| Detail card | `c01-missing-layer-card` |

**Condition:** `b.Avonmouth_Layer_Set` is null, undefined, or empty string.

This means the bar has no entry in the Avonmouth pset (`Layer/Set` property). Every bar exported from Tekla for this project must carry a layer assignment — a missing layer indicates an incomplete model.

---

### Rule R3 — Duplicate GlobalIds

| Field | `duplicateCount` |
|---|---|
| Threshold | `> 0` |
| Banner reason | "X duplicate GlobalId(s) detected" |
| Detail card | `c01-dup-card` |

**Condition:** Two or more `IFCREINFORCINGBAR` entities share the same `GlobalId`.

IFC requires GlobalIds to be unique per file. Duplicates indicate a Tekla export error (copy-paste without regenerating GUIDs) and prevent reliable traceability back to the model.

---

### Rule R4 — Missing ATK/ICOS Weight

| Field | `missingWeightCount` |
|---|---|
| Threshold | `> 0` |
| Banner reason | "X bar(s) with no ATK/ICOS weight" |
| Detail card | `c01-weight-card` |

**Condition:** `b.Weight` is null or undefined after checking all psets.

Weight is read from the `ATK Rebar` pset (`Weight` property, IFCMASSMEASURE). If absent, a formula weight (`π × r² × L × 7777`) is attempted. If both are null, the bar has no weight and cannot contribute to the EDB or schedule totals.

> Note: `NominalDiameter` on `IFCREINFORCINGBAR` = coupler nominal size, not the actual rebar diameter. Actual size is always read from the ATK pset.

---

## 2. Warnings

Warnings are **non-blocking** — they do not prevent export. They appear in the yellow warning banner and flag issues that require engineering review.

---

### Warning W1 — PRL/PRC Label Mismatch

| Field | `preloadMisCount` |
|---|---|
| Threshold | `> 0` |
| Banner message | "X preload bar(s) with PRL/PRC label mismatch — review geometry" |
| Detail section | `prl-prc-results` table |

**Condition:** A preload bar's `Avonmouth_Layer_Set` label (PRL or PRC) does not match the label expected from its geometric position.

Expected label is computed by `_classifyPrlPrcBar(bar, zones)` using the cage zone boundaries (see Section 3). A mismatch is counted when:

```
(labelled PRL  AND  expected PRC)
OR
(labelled PRC  AND  expected PRL)
```

Bars whose expected label is `UNKNOWN` (position outside all known zones) are excluded from the mismatch count.

**Sub-classification logic** (in `_classifyPrlPrcBar`):

For bars running in the **cage-length direction** (wx bars, `Dir_X ≈ 1`):

| Bar's Y position | Expected label |
|---|---|
| Inside interior void — `voidMinY < y < voidMaxY` | **PRC** (ties the concrete core) |
| Inside F1A face zone — `f1a.minY ≤ y ≤ f1a.maxY` | **PRL** (preload in face mesh) |
| Inside N1A face zone — `n1a.minY ≤ y ≤ n1a.maxY` | **PRL** (preload in face mesh) |
| Outside all zones | **UNKNOWN** (not counted as mismatch) |

For bars running in the **height direction** (wz bars, `Dir_Z ≈ 1`):

| Condition | Expected label |
|---|---|
| Predominantly vertical (`az > ax && az > ay`) | **PRC** |

For **other directions** (wy bars, diagonal):

| Condition | Expected label |
|---|---|
| Predominantly Y (`ay > ax && az`) | **UNKNOWN** |

> `Start_Y` is used for wx bars (justified because `Start_Y ≈ End_Y` for cage-length-running bars — they do not traverse the cage width).

---

### Warning W2 — Preload Bar Outside Mesh Envelope with Coupler

| Field | `outsidePreloadCount` |
|---|---|
| Threshold | `> 0` |
| Banner message | "X preload bar(s) outside mesh envelope — should be Strut Bar (VS/HS)" |

**Condition:** All four criteria must be true:

1. Bar has `Start_Y` coordinate
2. Bar's full Y extent lies **outside** the mesh envelope:
   ```
   lo = min(Start_Y, End_Y)
   hi = max(Start_Y, End_Y)
   outside = (hi > outerMaxY) OR (lo < outerMinY)
   ```
   where `outerMinY = min(f1a.minY, n1a.minY)` and `outerMaxY = max(f1a.maxY, n1a.maxY)`
3. Bar's layer has at least one associated coupler head (IFCBEAM) in `couplerMap`
4. Bar's layer is **not** already a VS or HS layer

**Why this matters:** Any bar that sits entirely beyond the cage envelope and carries a coupler head is physically a strut bar — it connects the cage to external reinforcement. Labelling it PRL or PRC is a Tekla modelling error.

> Through-bars (e.g. N1-CPLR-L type) that have `Start_Y` inside the cage but `End_Y` far beyond F1A are correctly detected by the `max(Start_Y, End_Y)` check. A `Start_Y`-only check would miss them.

---

## 3. Void Zone

The **void** is the interior cavity between the two mesh faces (N1A and F1A). It is not a status — it is a geometric region used to classify PRL/PRC bars and validate cage structure.

---

### Zone Boundaries

Computed by `_computeMeshFaceZones()` from all bars with `Avonmouth_Layer_Set === 'F1A'` or `'N1A'` and a known `Start_Y`.

Each face extent = centreline positions ± bar radius (`Size / 2`):

```
face.minY = min over all face bars of (Start_Y - Size/2,  End_Y - Size/2)
face.maxY = max over all face bars of (Start_Y + Size/2,  End_Y + Size/2)
```

The four zone boundaries:

| Zone | minY | maxY |
|---|---|---|
| N1A face | `n1a.minY` | `n1a.maxY` |
| Interior void | `min(f1a.maxY, n1a.maxY)` | `max(f1a.minY, n1a.minY)` |
| F1A face | `f1a.minY` | `f1a.maxY` |
| Full envelope | `min(f1a.minY, n1a.minY)` | `max(f1a.maxY, n1a.maxY)` |

Zones are **infinite in IFC-X (length) and IFC-Z (height)** — bounded only in IFC-Y (width).

If `voidMinY ≥ voidMaxY` the mesh faces overlap, which indicates a malformed export. Zone-dependent logic returns `null` and warnings are suppressed.

---

### Void Zone for Cage 1613 (2HD70719AC1) — Reference Values

| Zone | Y relative (mm) | Thickness |
|---|---|---|
| N1A Near Face | 0 – 82 | 82 mm |
| Interior Void | 82 – 239 | 157 mm |
| F1A Far Face | 239 – 321 | 82 mm |
| Full envelope | 0 – 321 | 321 mm |

---

### How Zones Are Used

| Feature | Uses zones |
|---|---|
| PRL/PRC expected-label classification | Y position vs void / face zones |
| W2 outside-bar detection | `outerMinY` / `outerMaxY` envelope check |
| Template DXF face filter | Y midpoint of all IFCBEAM positions |
| Step detection | Stagger cluster Z bands (separate from Y zones) |

---

## 4. Status Summary

| Status | Blocking | Trigger |
|---|---|---|
| **C01 Rejected** | Yes — disables all exports | Any of R1–R4 |
| **Warning** | No | Any of W1–W2 |
| **Pass (no banner)** | — | All R rules = 0, all W rules = 0 |

A cage can show warnings and still be C01 Accepted. A cage that is C01 Rejected may also have warnings, but the rejection banner takes precedence.
