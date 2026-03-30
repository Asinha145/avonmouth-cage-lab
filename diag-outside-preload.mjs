/**
 * diag-outside-preload.mjs
 *
 * Tests the mislabelled-outside-bars logic from _computeMislabelledOutsideBars().
 * Flags bars that are:
 *   - outside the mesh envelope (using min/max of Start_Y and End_Y)
 *   - on a layer that has coupler heads
 *   - NOT already a VS or HS layer
 *
 * VS/HS bars outside with couplers = correct strut bars, not flagged.
 * LK1 and other bars outside without couplers = acceptable, not flagged.
 *
 * Usage:  node diag-outside-preload.mjs <path-to-ifc>
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ifcPath = process.argv[2];
if (!ifcPath) { console.error('Usage: node diag-outside-preload.mjs <path-to.ifc>'); process.exit(1); }

// ── Load ifc-parser.js in VM sandbox ──────────────────────────────────
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

// ── Parse ──────────────────────────────────────────────────────────────
const ifcText = readFileSync(ifcPath, 'utf8');
const parser = new IFCParser();
const allData = await parser.parseFile(ifcText);
const couplerMap = parser.couplerMap;

console.log(`\nParsed: ${path.basename(ifcPath)}`);
console.log(`Total bars: ${allData.length}  |  Coupler heads: ${couplerMap.size}`);

// ── Zone helpers ───────────────────────────────────────────────────────
function computeMeshFaceZones(bars) {
    const f1aBars = bars.filter(b => b.Avonmouth_Layer_Set === 'F1A' && b.Start_Y != null);
    const n1aBars = bars.filter(b => b.Avonmouth_Layer_Set === 'N1A' && b.Start_Y != null);
    if (!f1aBars.length || !n1aBars.length) return null;
    const faceExtent = bs => {
        let minY = Infinity, maxY = -Infinity;
        bs.forEach(b => {
            const r = (b.Size || 0) / 2;
            minY = Math.min(minY, b.Start_Y - r, (b.End_Y ?? b.Start_Y) - r);
            maxY = Math.max(maxY, b.Start_Y + r, (b.End_Y ?? b.Start_Y) + r);
        });
        return { minY, maxY };
    };
    const f1a = faceExtent(f1aBars);
    const n1a = faceExtent(n1aBars);
    const voidMinY = Math.min(f1a.maxY, n1a.maxY);
    const voidMaxY = Math.max(f1a.minY, n1a.minY);
    if (voidMinY >= voidMaxY) return null;
    return { f1a, n1a, void: { minY: voidMinY, maxY: voidMaxY } };
}

// ── Run ────────────────────────────────────────────────────────────────
const zones = computeMeshFaceZones(allData);
if (!zones) { console.log('\nCould not compute mesh face zones.'); process.exit(0); }

const outerMinY = Math.min(zones.f1a.minY, zones.n1a.minY);
const outerMaxY = Math.max(zones.f1a.maxY, zones.n1a.maxY);

// Layers with coupler heads
const couplerLayers = new Set();
couplerMap.forEach(c => { if (c.layer) couplerLayers.add(c.layer); });

const isVsHs = layer => /^[VH]S/i.test(layer || '');

console.log('\n── Mesh zones ─────────────────────────────────────────────────');
console.log(`  N1A face:  ${zones.n1a.minY.toFixed(1)} → ${zones.n1a.maxY.toFixed(1)} mm`);
console.log(`  Void:      ${zones.void.minY.toFixed(1)} → ${zones.void.maxY.toFixed(1)} mm`);
console.log(`  F1A face:  ${zones.f1a.minY.toFixed(1)} → ${zones.f1a.maxY.toFixed(1)} mm`);
console.log(`  Envelope:  ${outerMinY.toFixed(1)} → ${outerMaxY.toFixed(1)} mm`);

console.log(`\n── Layers with coupler heads (${couplerLayers.size}) ─────────────────────────`);
[...couplerLayers].sort().forEach(l => console.log(`  ${l}`));

// All bars outside envelope — full breakdown
console.log('\n── All bars outside envelope (min/max Start_Y+End_Y) ───────────');
const byGroup = {};
allData.forEach(b => {
    if (b.Start_Y == null) return;
    const lo = Math.min(b.Start_Y, b.End_Y ?? b.Start_Y);
    const hi = Math.max(b.Start_Y, b.End_Y ?? b.Start_Y);
    if (hi <= outerMaxY && lo >= outerMinY) return;
    const hasCoupler = couplerLayers.has(b.Avonmouth_Layer_Set);
    const vshs = isVsHs(b.Avonmouth_Layer_Set);
    const flag = hasCoupler && !vshs ? '⚠️  WARN' : (hasCoupler && vshs ? '✅ strut' : '   —   ');
    const key = `${b.Avonmouth_Layer_Set} (${b.Bar_Type})`;
    if (!byGroup[key]) byGroup[key] = { count: 0, flag, hasCoupler, vshs };
    byGroup[key].count++;
});
Object.entries(byGroup).sort().forEach(([k, v]) =>
    console.log(`  ${v.count.toString().padStart(3)}x  ${k.padEnd(30)} coupler=${v.hasCoupler ? 'yes' : 'no'}  vshs=${v.vshs}  ${v.flag}`)
);

// Flagged bars (the actual warning output)
const flagged = allData.filter(b => {
    if (b.Start_Y == null) return false;
    const lo = Math.min(b.Start_Y, b.End_Y ?? b.Start_Y);
    const hi = Math.max(b.Start_Y, b.End_Y ?? b.Start_Y);
    if (hi <= outerMaxY && lo >= outerMinY) return false;
    if (!couplerLayers.has(b.Avonmouth_Layer_Set)) return false;
    if (isVsHs(b.Avonmouth_Layer_Set)) return false;
    return true;
});

console.log(`\n── WARNING bars — outside + coupler + not VS/HS: ${flagged.length} ──────────────`);
if (flagged.length === 0) {
    console.log('  None.');
} else {
    flagged.forEach(b => {
        const lo = Math.min(b.Start_Y ?? 0, b.End_Y ?? b.Start_Y ?? 0);
        const hi = Math.max(b.Start_Y ?? 0, b.End_Y ?? b.Start_Y ?? 0);
        const side = hi > outerMaxY
            ? `${(hi - outerMaxY).toFixed(1)}mm beyond F1A outer`
            : `${(outerMinY - lo).toFixed(1)}mm before N1A outer`;
        console.log(`  layer=${b.Avonmouth_Layer_Set}  type=${b.Bar_Type}  Y=[${lo.toFixed(1)}, ${hi.toFixed(1)}]  → ${side}`);
        console.log(`    ⚠️  should be Strut Bar (VS/HS)`);
    });
}

console.log(`\n── Warning banner would show: "${flagged.length} bar${flagged.length !== 1 ? 's' : ''} outside mesh envelope — should be Strut Bar (VS/HS)"`);
