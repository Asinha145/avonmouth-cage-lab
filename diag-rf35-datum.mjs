/**
 * diag-rf35-datum.mjs — Diagnose datum detection for RF35 C01.ifc
 *
 * Run: node diag-rf35-datum.mjs
 *
 * Prints:
 *   - sepAxis detected
 *   - face layers found and their coord ranges
 *   - _cageDatum() result (datumPx, datumPz)
 *   - _computeLayerDatums() result per layer (orange sphere engine coords)
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load ifc-parser.js in a minimal VM sandbox ────────────────────────────
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

// ── Load RF35 ─────────────────────────────────────────────────────────────
const ifcPath = 'C:/Users/ashis/Downloads/RF35 C01.ifc';
const ifcText = readFileSync(ifcPath, 'utf8');
console.log(`Loaded: ${ifcPath}`);

const parser = new IFCParser();
const allData = await parser.parseFile(ifcText);
console.log(`Total bars parsed: ${allData.length}`);

// ── Replicate _detectFaceSepAxis ──────────────────────────────────────────
function detectFaceSepAxis(allData) {
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

    console.log(`\n── Face layers found: ${Object.keys(layerCoords).sort().join(', ')}`);
    console.log(`   hasFN=${hasFN}  hasTB=${hasTB}`);

    if (hasTB && !hasFN) {
        console.log('   → Short-circuit to sepAxis=z (slab: T/B only, no F/N)');
        return 'z';
    }

    const layers = Object.values(layerCoords);
    const maxRange = (key) => Math.max(...layers.map(pts => {
        const vals = pts.map(p => p[key]).filter(v => v != null).sort((a, b) => a - b);
        return vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
    }));

    const rx = maxRange('x');
    const ry = maxRange('y');
    console.log(`   maxRange IFC-X across layers: ${Math.round(rx)} mm`);
    console.log(`   maxRange IFC-Y across layers: ${Math.round(ry)} mm`);

    // Per-layer detail
    for (const [layer, pts] of Object.entries(layerCoords)) {
        const xs = pts.map(p => p.x).filter(v => v != null).sort((a, b) => a - b);
        const ys = pts.map(p => p.y).filter(v => v != null).sort((a, b) => a - b);
        const zs = pts.map(p => p.z).filter(v => v != null).sort((a, b) => a - b);
        const r = arr => arr.length >= 2 ? Math.round(arr[arr.length - 1] - arr[0]) : 'n/a';
        console.log(`   ${layer.padEnd(6)}: X-range=${r(xs).toString().padStart(8)}mm  Y-range=${r(ys).toString().padStart(8)}mm  Z-range=${r(zs).toString().padStart(8)}mm  (${pts.length} bars)`);
    }

    const sepAxis = rx < ry ? 'x' : 'y';
    console.log(`   → sepAxis='${sepAxis}' (smallest max range wins)`);
    return sepAxis;
}

// ── Replicate _cageDatum ──────────────────────────────────────────────────
function cageDatum(allData, sepAxis) {
    const faceBars = allData.filter(b => b.Avonmouth_Layer_Set && /^[FNTB]1A$/i.test(b.Avonmouth_Layer_Set));
    console.log(`\n── _cageDatum(): outermost face bars (F1A/N1A/T1A/B1A): ${faceBars.length}`);
    const layers = [...new Set(faceBars.map(b => b.Avonmouth_Layer_Set))];
    console.log(`   Layers included: ${layers.join(', ')}`);

    if (!faceBars.length) { console.log('   WARNING: no face bars found → datum (0,0)'); return { datumPx: 0, datumPz: 0 }; }

    const pxVals = faceBars.flatMap(b =>
        sepAxis === 'x' ? [b.Start_Y, b.End_Y] : [b.Start_X, b.End_X]
    ).filter(v => v != null);
    const pzVals = faceBars.flatMap(b => [b.Start_Z, b.End_Z]).filter(v => v != null);

    const datumPx = Math.min(...pxVals);
    const datumPz = Math.min(...pzVals);

    console.log(`   datumPx axis: ${sepAxis === 'x' ? 'IFC-Y' : 'IFC-X'} → datumPx = ${Math.round(datumPx)} mm`);
    console.log(`   datumPz axis: IFC-Z (always) → datumPz = ${Math.round(datumPz)} mm`);
    console.log(`   NOTE: for slab (sepAxis='z'), datumPz should be min IFC-Y — check if this is correct!`);

    return { datumPx, datumPz };
}

// ── Replicate _computeLayerDatums ─────────────────────────────────────────
function computeLayerDatums(allData, sepAxis) {
    const faceLayerRe = /^[FNTB]\d+A$/i;
    const layers = [...new Set(
        allData.filter(b => b.Avonmouth_Layer_Set && faceLayerRe.test(b.Avonmouth_Layer_Set))
               .map(b => b.Avonmouth_Layer_Set)
    )];

    const median = arr => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const mid = (b, axis) => {
        if (axis === 'X') return ((b.Start_X ?? 0) + (b.End_X ?? 0)) / 2;
        if (axis === 'Y') return ((b.Start_Y ?? 0) + (b.End_Y ?? 0)) / 2;
        return ((b.Start_Z ?? 0) + (b.End_Z ?? 0)) / 2;
    };

    let _soloIdx = 0;
    const groupBars = barList => {
        const map = new Map();
        for (const b of barList) {
            const k = b.Stagger_Cluster_ID || `__s${_soloIdx++}`;
            if (!map.has(k)) map.set(k, []);
            map.get(k).push(b);
        }
        return [...map.values()];
    };

    console.log(`\n── _computeLayerDatums() (orange spheres):`);
    const results = [];
    for (const layer of layers.sort()) {
        const bars = allData.filter(b => b.Avonmouth_Layer_Set === layer);

        let vRaw, hRaw, vPosFn, hPosFn;
        if (sepAxis === 'z') {
            vRaw   = bars.filter(b => Math.abs(b.Dir_Y ?? 0) > Math.abs(b.Dir_X ?? 0));
            hRaw   = bars.filter(b => Math.abs(b.Dir_X ?? 0) > Math.abs(b.Dir_Y ?? 0));
            vPosFn = b => mid(b, 'X');
            hPosFn = b => mid(b, 'Y');
        } else {
            vRaw   = bars.filter(b => b.Orientation === 'Vertical');
            hRaw   = bars.filter(b => b.Orientation === 'Horizontal');
            vPosFn = b => sepAxis === 'x' ? mid(b, 'Y') : mid(b, 'X');
            hPosFn = b => mid(b, 'Z');
        }

        if (!vRaw.length || !hRaw.length) {
            console.log(`   ${layer}: SKIP — vRaw=${vRaw.length} hRaw=${hRaw.length}`);
            continue;
        }

        const vMed  = median(vRaw.map(b => b.Length ?? 0));
        const hMed  = median(hRaw.map(b => b.Length ?? 0));
        const vBars = vRaw.filter(b => (b.Length ?? 0) >= vMed * 0.5);
        const hBars = hRaw.filter(b => (b.Length ?? 0) >= hMed * 0.5);

        const vUnits = groupBars(vBars).map(grp => ({ pos: grp.reduce((s, b) => s + vPosFn(b), 0) / grp.length }));
        const hUnits = groupBars(hBars).map(grp => ({ pos: grp.reduce((s, b) => s + hPosFn(b), 0) / grp.length }));

        const nearestV = vUnits.reduce((best, u) => u.pos < best.pos ? u : best, { pos: Infinity });
        const nearestH = hUnits.reduce((best, u) => u.pos < best.pos ? u : best, { pos: Infinity });

        const faceAxisChar = sepAxis === 'x' ? 'X' : sepAxis === 'y' ? 'Y' : 'Z';
        const faceVals = [...vBars, ...hBars]
            .flatMap(b => [b[`Start_${faceAxisChar}`], b[`End_${faceAxisChar}`]])
            .filter(v => v != null);
        const faceCoord = faceVals.length ? faceVals.reduce((s, v) => s + v, 0) / faceVals.length : 0;

        let ex, ey, ez;
        if (sepAxis === 'x') {
            ex = faceCoord / 1000; ey = nearestH.pos / 1000; ez = -nearestV.pos / 1000;
        } else if (sepAxis === 'y') {
            ex = nearestV.pos / 1000; ey = nearestH.pos / 1000; ez = -faceCoord / 1000;
        } else {
            ex = nearestV.pos / 1000; ey = faceCoord / 1000; ez = -nearestH.pos / 1000;
        }

        console.log(`   ${layer.padEnd(6)}: vsPos=${Math.round(nearestV.pos).toString().padStart(8)}mm  hsPos=${Math.round(nearestH.pos).toString().padStart(8)}mm  face=${Math.round(faceCoord).toString().padStart(8)}mm`);
        console.log(`          → engine (ex=${ex.toFixed(3)}, ey=${ey.toFixed(3)}, ez=${ez.toFixed(3)}) m`);
        results.push({ layer, ex, ey, ez });
    }
    return results;
}

// ── Run ───────────────────────────────────────────────────────────────────
const sepAxis = detectFaceSepAxis(allData);
const datum   = cageDatum(allData, sepAxis);
const markers = computeLayerDatums(allData, sepAxis);

console.log(`\n── Summary:`);
console.log(`   sepAxis  = '${sepAxis}'`);
console.log(`   datumPx  = ${Math.round(datum.datumPx)} mm  (IFC-${sepAxis === 'x' ? 'Y' : 'X'})`);
console.log(`   datumPz  = ${Math.round(datum.datumPz)} mm  (IFC-Z — WARNING: should be IFC-Y for slab!)`);
console.log(`   Orange spheres: ${markers.length} layers`);
