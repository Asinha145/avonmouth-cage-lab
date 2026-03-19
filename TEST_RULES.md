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
| Property | Value |
|---|---|
| meshWidth | 1347 mm |
| meshLength | 11082 mm |
| height | 5080 mm |
| overallWidth | 1389 mm |
| overallLength | 11082 mm |

---

## What each dimension means

| Dimension | Source | Used by |
|---|---|---|
| `overallWidth` | BREP bbox of ALL bars (mesh + strut + link + loose) | Website display (`dim-width`) |
| `overallLength` | BREP bbox of ALL bars | Website display (`dim-length`) |
| `meshWidth` | BREP bbox of Mesh bars only | Excel cage-sequence, EDB autofill |
| `meshLength` | BREP bbox of Mesh bars only | Excel cage-sequence |
| `height` | Mesh bars bbox (IFC Z / web-ifc Y span) | Both |

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
