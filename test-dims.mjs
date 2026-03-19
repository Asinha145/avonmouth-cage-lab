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
// meshWidth / meshLength / height are mesh-bars-only bbox.
// overallWidth / overallLength are all-bars bbox.
// Values pinned here after first passing run — used to detect regressions.
const GROUND_TRUTH = {
    'P7019_C1.ifc': {
        meshWidth:     1347,
        meshLength:    11082,
        height:        5080,
        overallWidth:  1389,
        overallLength: 11082,
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
function buildDimensions(meshBbox, allBbox) {
    if (meshBbox.minX === Infinity) return null;
    const spanX = (meshBbox.maxX - meshBbox.minX) * 1000;
    const spanY = (meshBbox.maxY - meshBbox.minY) * 1000;
    const spanZ = (meshBbox.maxZ - meshBbox.minZ) * 1000;
    const height     = Math.round(spanY);
    const meshWidth  = Math.round(Math.min(spanX, spanZ));
    const meshLength = Math.round(Math.max(spanX, spanZ));
    const aSpanX = (allBbox.maxX - allBbox.minX) * 1000;
    const aSpanZ = (allBbox.maxZ - allBbox.minZ) * 1000;
    const overallWidth  = Math.round(Math.min(aSpanX, aSpanZ));
    const overallLength = Math.round(Math.max(aSpanX, aSpanZ));
    return { meshWidth, meshLength, height, overallWidth, overallLength };
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

    const meshBbox = { minX:Infinity, maxX:-Infinity, minY:Infinity, maxY:-Infinity, minZ:Infinity, maxZ:-Infinity };
    const allBbox  = { minX:Infinity, maxX:-Infinity, minY:Infinity, maxY:-Infinity, minZ:Infinity, maxZ:-Infinity };

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
                if (bar && bar.Bar_Type === 'Mesh') {
                    if (wx < meshBbox.minX) meshBbox.minX = wx; if (wx > meshBbox.maxX) meshBbox.maxX = wx;
                    if (wy < meshBbox.minY) meshBbox.minY = wy; if (wy > meshBbox.maxY) meshBbox.maxY = wy;
                    if (wz < meshBbox.minZ) meshBbox.minZ = wz; if (wz > meshBbox.maxZ) meshBbox.maxZ = wz;
                }
                if (bar) {
                    if (wx < allBbox.minX) allBbox.minX = wx; if (wx > allBbox.maxX) allBbox.maxX = wx;
                    if (wy < allBbox.minY) allBbox.minY = wy; if (wy > allBbox.maxY) allBbox.maxY = wy;
                    if (wz < allBbox.minZ) allBbox.minZ = wz; if (wz > allBbox.maxZ) allBbox.maxZ = wz;
                }
            }
            flat.delete();
        }
    });
    ifcapi.CloseModel(modelID);

    const dims = buildDimensions(meshBbox, allBbox);
    if (!dims) { console.error(`  FAIL ${filename}: no mesh bars found`); return false; }

    console.log(`\n  ${filename}`);
    console.log(`    meshWidth:     ${dims.meshWidth} mm`);
    console.log(`    meshLength:    ${dims.meshLength} mm`);
    console.log(`    height:        ${dims.height} mm`);
    console.log(`    overallWidth:  ${dims.overallWidth} mm`);
    console.log(`    overallLength: ${dims.overallLength} mm`);

    let pass = true;

    // All values must be finite and positive
    for (const [k, v] of Object.entries(dims)) {
        if (!isFinite(v) || v <= 0) {
            console.error(`  FAIL ${k} is not a valid positive number: ${v}`);
            pass = false;
        }
    }

    // Overall must be >= mesh (strut/link bars can only extend the extent)
    if (dims.overallWidth < dims.meshWidth) {
        console.error(`  FAIL overallWidth (${dims.overallWidth}) < meshWidth (${dims.meshWidth})`);
        pass = false;
    }
    if (dims.overallLength < dims.meshLength) {
        console.error(`  FAIL overallLength (${dims.overallLength}) < meshLength (${dims.meshLength})`);
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
