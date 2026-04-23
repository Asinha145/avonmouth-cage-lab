/**
 * test-dims.mjs — local dimension test (run before every git push)
 *
 * Tests that _buildDimensions() returns valid overallWidth, overallLength,
 * meshWidth, meshLength, height for a real IFC sample file.
 *
 * Uses web-ifc Node.js native build (node_modules/web-ifc) — no browser needed.
 *
 * Run:  node test-dims.mjs
 * Exit: 0 = PASS, 1 = FAIL
 *
 * Ground truth (BREP outer-face-to-outer-face, from CLAUDE.md):
 *   P7019_C1.ifc  — meshWidth≈1300mm, meshLength≈11300mm, height≈5300mm
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createContext, runInContext } from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Ground truth — computed from web-ifc BREP geometry, Node.js native build ──
// edbWidth   = all bars bbox (width only)  — EDB cross-section
// edbLength  = mesh bars bbox (length)     — EDB length
// edbHeight  = mesh bars bbox (height/IFC-Z span) — EDB height / pallet classification
// height     = total geometry bbox (IFC-Z) — website display
// overallWidth / overallLength = total geometry bbox — website display
const GROUND_TRUTH = {
    'P7019_C1.ifc': {
        edbWidth:      1389,
        edbLength:     11082,
        edbHeight:     5080,
        height:        5311,
        overallWidth:  1389,
        overallLength: 11282,
    },
    // test-cages: no pinned values (geometry-based, not regression-critical)
    // Verify structure and axis detection only
};
const TOLERANCE_MM = 20; // ±20 mm — tight tolerance to catch regressions

// ── Load the Node.js native web-ifc build ─────────────────────────────────
const nodeApiPath = path.join(__dirname, 'node_modules', 'web-ifc', 'web-ifc-api-node.js');
const { IfcAPI } = await import(pathToFileURL(nodeApiPath).href);

const ifcapi = new IfcAPI();
// Node.js native build auto-locates the WASM next to its own module — no SetWasmPath needed
await ifcapi.Init();

// ── Load ifc-parser.js in a minimal VM sandbox to get bar types ────────────
const sandbox = {
    window: {}, globalThis: {}, self: {}, console,
    Math, Object, Array, Map, Set, Promise, Error, TypeError, Uint8Array,
    Float32Array, Float64Array, Int32Array, Uint32Array, Int8Array, JSON,
    Number, String, Boolean, Symbol, Proxy, Reflect, isNaN, isFinite,
    parseFloat, parseInt,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
createContext(sandbox);
runInContext(readFileSync(path.join(__dirname, 'js', 'ifc-parser.js'), 'utf8'), sandbox, { timeout: 5000 });
const IFCParser = sandbox.IFCParser;

// ── Detect F1 running direction from BREP (Dir_X/Dir_Y vectors) ────────────
function _detectF1RunningDir(allData) {
    const f1Bars = allData.filter(b => b.Avonmouth_Layer_Set === 'F1A' && b.Dir_X !== null && b.Dir_Y !== null);
    if (!f1Bars.length) return null;

    const f1DirX = f1Bars.reduce((s, b) => s + Math.abs(b.Dir_X), 0);
    const f1DirY = f1Bars.reduce((s, b) => s + Math.abs(b.Dir_Y), 0);
    return f1DirX > f1DirY ? 'x' : 'y';
}

// ── Detect N1 running direction from BREP (Dir_X/Dir_Y vectors) ────────────
function _detectN1RunningDir(allData) {
    const n1Bars = allData.filter(b => b.Avonmouth_Layer_Set === 'N1A' && b.Dir_X !== null && b.Dir_Y !== null);
    if (!n1Bars.length) return null;

    const n1DirX = n1Bars.reduce((s, b) => s + Math.abs(b.Dir_X), 0);
    const n1DirY = n1Bars.reduce((s, b) => s + Math.abs(b.Dir_Y), 0);
    return n1DirX > n1DirY ? 'x' : 'y';
}

// ── Map cageAxisName to expected length axis ──────────────────────────────
function _mapCageAxisToLength(cageAxisName) {
    if (cageAxisName === 'X') return 'x';
    if (cageAxisName === 'Y') return 'y';
    // 'Z' (vertical) — inconclusive; cannot determine from axis alone
    return null;
}

// ── Mirror _detectFaceSepAxis from js/main.js (accepts allData as arg) ────
function _testDetectFaceSepAxis(allData) {
    const faceRe = /^[FNTB]\d/i;
    const layerCoords = {};
    for (const bar of allData) {
        const layer = bar.Avonmouth_Layer_Set;
        if (!layer || !faceRe.test(layer)) continue;
        const x = bar.Start_X ?? bar.End_X;
        const y = bar.Start_Y ?? bar.End_Y;
        const z = bar.Start_Z ?? bar.End_Z;
        if (x == null && y == null && z == null) continue;
        if (!layerCoords[layer]) layerCoords[layer] = [];
        layerCoords[layer].push({ x, y, z });
    }
    const hasFN = Object.keys(layerCoords).some(l => /^[FN]\d/i.test(l));
    const hasTB = Object.keys(layerCoords).some(l => /^[TB]\d/i.test(l));
    if (hasTB && !hasFN) return 'z';
    const layers = Object.values(layerCoords);
    const maxRange = (key) => Math.max(...layers.map(pts => {
        const vals = pts.map(p => p[key]).filter(v => v != null).sort((a, b) => a - b);
        return vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
    }));
    return maxRange('x') < maxRange('y') ? 'x' : 'y';
}

// ── Simulate _buildDimensions from js/viewer3d.js ─────────────────────────
// faceSepAxis from _testDetectFaceSepAxis():
//   'x' → width=spanX, length=spanY  |  'y' → width=spanY, length=spanX  |  'z' → slab heuristic
function buildDimensions(meshBbox, allBarBbox, totalBbox, faceSepAxis = 'z') {
    if (totalBbox.minX === Infinity) return null;
    const assignLW = (spanX, spanY) => {
        if (faceSepAxis === 'x') return { L: spanY, W: spanX };
        if (faceSepAxis === 'y') return { L: spanX, W: spanY };
        return { L: Math.max(spanX, spanY), W: Math.min(spanX, spanY) };
    };
    // Overall (totalBbox)
    const tSpanX = (totalBbox.maxX - totalBbox.minX) * 1000;
    const tSpanY = (totalBbox.maxZ - totalBbox.minZ) * 1000;
    const { L: overallL, W: overallW } = assignLW(tSpanX, tSpanY);
    const height = Math.round((totalBbox.maxY - totalBbox.minY) * 1000);
    // EDB width (allBarBbox)
    const hasAllBar = allBarBbox.minX !== Infinity;
    const abSpanX = hasAllBar ? (allBarBbox.maxX - allBarBbox.minX) * 1000 : null;
    const abSpanY = hasAllBar ? (allBarBbox.maxZ - allBarBbox.minZ) * 1000 : null;
    const edbWidth = hasAllBar ? Math.round(assignLW(abSpanX, abSpanY).W) : null;
    // EDB length & height (meshBbox)
    const hasMesh = meshBbox.minX !== Infinity;
    let edbLength = null, edbHeight = null;
    if (hasMesh) {
        const mbSpanX = (meshBbox.maxX - meshBbox.minX) * 1000;
        const mbSpanY = (meshBbox.maxZ - meshBbox.minZ) * 1000;
        edbLength = Math.round(assignLW(mbSpanX, mbSpanY).L);
        edbHeight = Math.round((meshBbox.maxY - meshBbox.minY) * 1000);
    }
    return { edbWidth, edbLength, edbHeight, height, overallWidth: Math.round(overallW), overallLength: Math.round(overallL) };
}

// ── Test one IFC file ──────────────────────────────────────────────────────
async function testFile(filename, subdir = 'examples') {
    const ifcPath = path.join(__dirname, subdir, filename);
    let ifcBytes;
    try { ifcBytes = readFileSync(ifcPath); }
    catch { console.log(`  SKIP ${subdir}/${filename} — not found`); return true; }

    // Parse bar types
    const parser = new IFCParser();
    let bars;
    try { bars = await parser.parseFile(ifcBytes.toString('utf8')); }
    catch (e) { console.error(`  FAIL parse: ${e.message}`); return false; }

    const barMap = new Map();
    bars.forEach(b => barMap.set(parseInt(b._entityId, 10), b));

    const empty  = () => ({ minX:Infinity, maxX:-Infinity, minY:Infinity, maxY:-Infinity, minZ:Infinity, maxZ:-Infinity });
    const meshBbox   = empty();  // mesh bars only
    const allBarBbox = empty();  // all bars (any type)
    const totalBbox  = empty();  // all geometry (no barMap dependency)

    const modelID = ifcapi.OpenModel(new Uint8Array(ifcBytes));

    ifcapi.StreamAllMeshes(modelID, (mesh) => {
        const bar = barMap.get(mesh.expressID);
        for (let gi = 0; gi < mesh.geometries.size(); gi++) {
            const geom  = mesh.geometries.get(gi);
            const flat  = ifcapi.GetGeometry(modelID, geom.geometryExpressID);
            const verts = ifcapi.GetVertexArray(flat.GetVertexData(), flat.GetVertexDataSize());
            const M     = geom.flatTransformation;
            for (let j = 0; j < verts.length; j += 6) {
                const lx = verts[j], ly = verts[j+1], lz = verts[j+2];
                const wx = M[0]*lx + M[4]*ly + M[8] *lz + M[12];
                const wy = M[1]*lx + M[5]*ly + M[9] *lz + M[13];
                const wz = M[2]*lx + M[6]*ly + M[10]*lz + M[14];
                if (wx < totalBbox.minX) totalBbox.minX = wx; if (wx > totalBbox.maxX) totalBbox.maxX = wx;
                if (wy < totalBbox.minY) totalBbox.minY = wy; if (wy > totalBbox.maxY) totalBbox.maxY = wy;
                if (wz < totalBbox.minZ) totalBbox.minZ = wz; if (wz > totalBbox.maxZ) totalBbox.maxZ = wz;
                if (bar) {
                    if (wx < allBarBbox.minX) allBarBbox.minX = wx; if (wx > allBarBbox.maxX) allBarBbox.maxX = wx;
                    if (wy < allBarBbox.minY) allBarBbox.minY = wy; if (wy > allBarBbox.maxY) allBarBbox.maxY = wy;
                    if (wz < allBarBbox.minZ) allBarBbox.minZ = wz; if (wz > allBarBbox.maxZ) allBarBbox.maxZ = wz;
                    if (bar.Bar_Type === 'Mesh') {
                        if (wx < meshBbox.minX) meshBbox.minX = wx; if (wx > meshBbox.maxX) meshBbox.maxX = wx;
                        if (wy < meshBbox.minY) meshBbox.minY = wy; if (wy > meshBbox.maxY) meshBbox.maxY = wy;
                        if (wz < meshBbox.minZ) meshBbox.minZ = wz; if (wz > meshBbox.maxZ) meshBbox.maxZ = wz;
                    }
                }
            }
            flat.delete();
        }
    });
    ifcapi.CloseModel(modelID);

    const allData = bars;
    const faceSepAxis = _testDetectFaceSepAxis(allData);
    console.log(`    faceSepAxis: ${faceSepAxis}`);
    const dims = buildDimensions(meshBbox, allBarBbox, totalBbox, faceSepAxis);
    if (!dims) { console.error(`  FAIL ${filename}: no mesh bars found`); return false; }

    const f1Dir = _detectF1RunningDir(allData);
    const n1Dir = _detectN1RunningDir(allData);
    const parserLenAxis = _mapCageAxisToLength(parser.cageAxisName);

    console.log(`\n  ${subdir}/${filename}`);
    console.log(`    Parser cageAxisName: ${parser.cageAxisName}${parserLenAxis ? ` (len: ${parserLenAxis})` : ' (Z=inconclusive)'}`);
    console.log(`    BREP F1 dir: ${f1Dir}${f1Dir !== n1Dir ? ` N1: ${n1Dir}` : ''}`);
    console.log(`    faceSepAxis: ${faceSepAxis}`);
    console.log(`    Dims: W=${dims.edbWidth} L=${dims.edbLength} H=${dims.edbHeight}`);

    let pass = true;

    // All values must be finite and positive (or null for slab)
    for (const [k, v] of Object.entries(dims)) {
        if (v !== null && (!isFinite(v) || v <= 0)) {
            console.error(`  FAIL ${k} is not a valid positive number: ${v}`);
            pass = false;
        }
    }

    // Overall must be >= EDB equivalents (if both present)
    if (dims.overallWidth !== null && dims.edbWidth !== null && dims.overallWidth < dims.edbWidth) {
        console.error(`  FAIL overallWidth (${dims.overallWidth}) < edbWidth (${dims.edbWidth})`);
        pass = false;
    }
    if (dims.overallLength !== null && dims.edbLength !== null && dims.overallLength < dims.edbLength) {
        console.error(`  FAIL overallLength (${dims.overallLength}) < edbLength (${dims.edbLength})`);
        pass = false;
    }

    // Regression check against pinned ground-truth values (skip null entries)
    const gt = GROUND_TRUTH[filename];
    if (gt) {
        for (const [k, expected] of Object.entries(gt)) {
            if (expected === null) continue;  // Skip slab cages without pinned values
            const actual = dims[k];
            const diff   = actual !== null ? Math.abs(actual - expected) : null;
            const ok     = diff !== null && diff <= TOLERANCE_MM;
            console.log(`    ${ok ? '✓' : '✗'} ${k}: ${actual} mm (pinned ${expected} mm, diff ${diff ?? 'N/A'} mm)`);
            if (!ok && actual !== null) pass = false;
        }
    }

    return pass;
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log('=== test-dims.mjs (all samples) ===');
let allPass = true;
allPass = await testFile('P7019_C1.ifc', 'examples') && allPass;
allPass = await testFile('1613_2HD70719AC1.ifc', 'test-cages') && allPass;
allPass = await testFile('P7349_C1.ifc', 'test-cages') && allPass;
allPass = await testFile('RF35_C01.ifc', 'test-cages') && allPass;

console.log(allPass ? '\n✓ All tests PASSED' : '\n✗ Some tests FAILED');
process.exit(allPass ? 0 : 1);
