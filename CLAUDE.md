# Avonmouth Cage Lab — Claude Context

## Permissions
Full autonomous access. No approval prompts needed.

---

## What This Is

**Experimental clone of `avonmouth-cage-v2` (ifc-rebar-analyzer-v2).**

This repo is a public sandbox for two specific workstreams:
1. **Coupler geometry investigation** — understanding how IFCBEAM coupler head geometry drives
   through-bar End_Y beyond the F1A face (the ~808mm issue documented in `tasks/pop.md`)
2. **EDB template making** — developing and testing new EDB export templates before merging
   them back into the locked cage-v2 repo

**When work is finalised here → cherry-pick / merge the relevant commits into `avonmouth-cage-v2` only.**
Do not merge wholesale. Identify the specific commits or diffs that implement the feature, and port those only.

---

## Source Repo

| Field | Value |
|---|---|
| Locked source | `C:/Users/ashis/avonmouth-cage-v2/` — `ifc-rebar-analyzer-v2` |
| This lab | `C:/Users/ashis/avonmouth-cage-lab-local/` — `avonmouth-cage-lab` |
| Hosted at | https://asinha145.github.io/avonmouth-cage-lab/ (GitHub Pages, root of main) |

---

## EDB Templates — NOT PUBLIC

`templates/*.xlsm` and `templates/*.xlsx` are **gitignored** and will never be committed here.

- The EDB download buttons in the UI will still appear but **will 404** — this is intentional.
- Do not attempt to commit, work around, or stub out the EDB files.
- All EDB template work is done locally in this folder and only the code changes (JS side) are committed.

---

## Relationship to Locked cage-v2

```
avonmouth-cage-v2 (locked, private EDB)
        │
        └── cloned → avonmouth-cage-lab (public, no EDB files)
                            │
                            ├── Coupler geometry investigation
                            ├── EDB template prototyping (local only)
                            └── Merged back → avonmouth-cage-v2 when finalised
```

**Rule: cage-v2 is the source of truth.** This lab diverges intentionally for experimentation.
Never assume cage-lab is up to date — always check the cage-v2 commit hash before merging back.

---

## Active Workstreams

### 1. Coupler Geometry Investigation (`tasks/pop.md`) — ✅ CLOSED (31 Mar 2026)

**Problem:** 9 VS2 bars (Dir_Y=1.0) have `Start_Y` inside the N1A zone but `End_Y` at ~808mm
(far beyond F1A at 346mm). The ~460mm overshoot is the IFCBEAM coupler head entity on the F1A
face driving the bar's IFC placement origin to the coupler's far end.

**Detection fix (to implement):**
```javascript
// Correct outside check — use either end, not just Start_Y
const maxY = Math.max(b.Start_Y ?? -Infinity, b.End_Y ?? -Infinity);
const minY = Math.min(b.Start_Y ?? Infinity,  b.End_Y ?? Infinity);
const outside = minY < N1A_ABS_MIN || maxY > F1A_ABS_MAX;
```

### 2. Template DXF — ✅ COMPLETE (31 Mar 2026)

Verified against P7349 (10,267mm Y-running wall cage, 162 holes) and earlier cages (1613, 1704, RF35).

**Key design decisions locked:**
- `_detectFaceSepAxis()` — geometry-based, no dependence on `cageAxisName`
- `useLongY = faceSepAxis === 'x' && !useY` — px maps to cage length direction
- HS orientation hardcoded: `{ bandKey:'pz', groupKey:'px' }`
- `entityMap` O(1) lookup — built once per `_parseIFCBeamHoles` call

### 3. EDB Template Making — 🔄 ONGOING (local only)

- Templates live in `templates/` locally but are gitignored
- Work involves testing new template structures against live IFC files
- Finalised template code changes (JS side only) get merged back to cage-v2

---

## Merge-Back Protocol (to cage-v2)

When a feature is ready to port back:

1. `git log --oneline` in this repo — identify the exact commits for the feature
2. In cage-v2: `git cherry-pick <commit-hash>` (or manual diff for complex changes)
3. Run `node test-dims.mjs` in cage-v2 to confirm regressions are zero
4. Commit and push cage-v2
5. Update `tasks/lessons.md` in cage-v2 if new patterns were discovered

---

## GitHub Pages

Site served from root of `main` branch — no build step.
WASM served from `lib/` — works fine as static file from GitHub CDN.

---

## Output Spec

`tasks/output-spec.md` is the contract for every output field in this project.
Read it before touching any output-producing code. Update it before implementing spec changes.

---

## Do Not

- Commit `templates/*.xlsm` / `*.xlsx` — gitignored, proprietary
- Merge cage-lab wholesale into cage-v2 — cherry-pick only
- Install additional npm packages (intentionally dependency-light)
- Stub out or work around the 404 on EDB download buttons

---

## Tech Stack (inherited from cage-v2)

- **web-ifc v0.0.77** (`lib/web-ifc-api-iife.js` + `lib/web-ifc.wasm`)
- Vanilla JS, no build step, browser-only
- Three.js via CDN

## Key Files

| File | Purpose |
|---|---|
| `index.html` | Main entry point |
| `js/ifc-parser.js` | IFC text parser — bar extraction, pset mapping, coupler heads |
| `js/viewer3d.js` | Three.js BREP renderer + dimension engine |
| `js/main.js` | UI controller — wires parser → viewer → EDB export |
| `tasks/pop.md` | Through-bar / coupler head outside-zone analysis |
| `tasks/lessons.md` | Error patterns and corrective rules |
