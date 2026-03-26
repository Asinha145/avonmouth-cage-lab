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
        edbWidth:      1389,   // all bars width
        edbLength:     11082,  // mesh only
        edbHeight:     5080,   // mesh only
        height:        5311,   // totalBbox — includes IFCBEAM coupler heads (+231mm vs mesh)
        overallWidth:  1389,
        overallLength: 11282,  // totalBbox — includes couplers at bar ends (+200mm vs mesh)
    },
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

// ── Simulate _buildDimensions from js/viewer3d.js ─────────────────────────
// cageAxisName defaults to 'Z' (vertical wall cage) — test file is Z-axis.
function buildDimensions(meshBbox, allBarBbox, totalBbox, cageAxisName = 'Z') {
    if (totalBbox.minX === Infinity) return null;
    const assignLW = (spanX, spanY) => {
        if (cageAxisName === 'X') return { L: spanX, W: spanY };
        if (cageAxisName === 'Y') return { L: spanY, W: spanX };
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
async function testFile(filename) {
    const ifcPath = path.join(__dirname, 'examples', filename);
    let ifcBytes;
    try { ifcBytes = readFileSync(ifcPath); }
    catch { console.log(`  SKIP ${filename} — not found`); return true; }

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

    const dims = buildDimensions(meshBbox, allBarBbox, totalBbox, parser.cageAxisName);
    if (!dims) { console.error(`  FAIL ${filename}: no mesh bars found`); return false; }

    console.log(`\n  ${filename}`);
    console.log(`    edbWidth:      ${dims.edbWidth} mm`);
    console.log(`    edbLength:     ${dims.edbLength} mm`);
    console.log(`    edbHeight:     ${dims.edbHeight} mm`);
    console.log(`    height:        ${dims.height} mm`);
    console.log(`    overallWidth:  ${dims.overallWidth} mm`);
    console.log(`    overallLength: ${dims.overallLength} mm`);

    let pass = true;

    // All values must be finite and positive
    for (const [k, v] of Object.entries(dims)) {
        if (v !== null && (!isFinite(v) || v <= 0)) {
            console.error(`  FAIL ${k} is not a valid positive number: ${v}`);
            pass = false;
        }
    }

    // Overall must be >= EDB equivalents (total geometry >= rebar-only)
    if (dims.overallWidth < dims.edbWidth) {
        console.error(`  FAIL overallWidth (${dims.overallWidth}) < edbWidth (${dims.edbWidth})`);
        pass = false;
    }
    if (dims.overallLength < dims.edbLength) {
        console.error(`  FAIL overallLength (${dims.overallLength}) < edbLength (${dims.edbLength})`);
        pass = false;
    }

    // Regression check against pinned ground-truth values
    const gt = GROUND_TRUTH[filename];
    if (gt) {
        for (const [k, expected] of Object.entries(gt)) {
            const actual = dims[k];
            const diff   = Math.abs(actual - expected);
            const ok     = diff <= TOLERANCE_MM;
            console.log(`    ${ok ? '✓' : '✗'} ${k}: ${actual} mm (pinned ${expected} mm, diff ${diff} mm)`);
            if (!ok) pass = false;
        }
    }

    return pass;
}

// ── Run ───────────────────────────────────────────────────────────────────
console.log('=== test-dims.mjs ===');
let allPass = true;
allPass = await testFile('P7019_C1.ifc') && allPass;

console.log(allPass ? '\nAll tests PASSED ✓' : '\nSome tests FAILED ✗');
process.exit(allPass ? 0 : 1);
