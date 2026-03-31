# Test Rules — avonmouth-cage-v2

## Rule: Always test locally before pushing to GitHub

Before running `git push`, you must run the test suite and confirm all tests pass.

```bash
node test-dims.mjs
# or
npm test
```

**Expected output:**
```
All tests PASSED ✓
```

**Do not push if any test shows FAILED ✗.**

---

## What the test checks

`test-dims.mjs` loads `examples/P7019_C1.ifc` through the web-ifc Node.js native build,
classifies bars via `js/ifc-parser.js`, and verifies:

| Check | What it catches |
|---|---|
| All 5 dimension values are finite and positive | NaN / Infinity / undefined — e.g. wrong property name in return object |
| `overallWidth >= meshWidth` | Logic inversion — overall must never be smaller than mesh-only |
| `overallLength >= meshLength` | Same, for length axis |
| Pinned mm values ±20mm | Regressions in bbox computation or coordinate conversion |

### Pinned values (P7019_C1.ifc)

These match the `GROUND_TRUTH` object in `test-dims.mjs`:

| Property | Value | Source |
|---|---|---|
| `edbWidth` | 1389 mm | `allBarBbox` — all bar types (includes struts) |
| `edbLength` | 11082 mm | `meshBbox` — mesh bars only |
| `edbHeight` | 5080 mm | `meshBbox` — mesh bars only |
| `height` | 5311 mm | `totalBrepBbox` — all geometry unconditional |
| `overallWidth` | 1389 mm | `totalBrepBbox` |
| `overallLength` | 11282 mm | `totalBrepBbox` — includes coupler heads at bar ends |

---

## What each dimension means

| Dimension | Source bbox | Gate | Used by |
|---|---|---|---|
| `overallWidth` | `totalBrepBbox` | None — unconditional | Website display |
| `overallLength` | `totalBrepBbox` | None — unconditional | Website display |
| `edbWidth` | `allBarBbox` | Any bar in `barMap` | EDB width cell |
| `edbLength` | `meshBbox` | `Bar_Type === 'Mesh'` | EDB length cell |
| `edbHeight` | `meshBbox` | `Bar_Type === 'Mesh'` | EDB height cell, height card |
| `height` | `totalBrepBbox` | None — unconditional | Website overall height |

Note: `totalBrepBbox` > `allBarBbox` ≥ `meshBbox` — each bbox is a progressively tighter filter. Overall values include coupler heads protruding beyond bar body ends.

---

## Setup (first time only)

```bash
npm install        # installs web-ifc Node.js native build for testing
```

`node_modules/` is in `.gitignore` — never commit it.

---

## Adding new test cases

1. Add the IFC file to `examples/`
2. Run `node test-dims.mjs` once to get the actual values
3. Add the pinned ground-truth values to `GROUND_TRUTH` in `test-dims.mjs`
4. Re-run to confirm ✓

---

## Files involved

| File | Role |
|---|---|
| `test-dims.mjs` | The test script |
| `js/viewer3d.js` | The file actually loaded by `index.html` — edit this, not `viewer3d_live.js` |
| `js/ifc-parser.js` | The parser loaded by `index.html` — edit this, not `ifc_parser_live.js` |
| `js/main.js` | Main app logic |

> **Important:** `viewer3d_live.js` and `ifc_parser_live.js` in the root are NOT loaded
> by `index.html`. Always edit the files inside `js/`.
