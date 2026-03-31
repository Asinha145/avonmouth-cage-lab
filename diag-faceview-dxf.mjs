/**
 * diag-faceview-dxf.mjs — Generate face view DXF locally from P7349_C1.ifc
 *
 * Ports exportFaceViewDXF logic from main.js as a standalone Node.js script.
 * Writes DXF to P7349_C1-F1A-view.dxf and prints structural diagnostics.
 *
 * Run:  node diag-faceview-dxf.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IFC_PATH  = 'C:/Users/ashis/avonmouth-de-tool/Sample/P7349_C1.ifc';
const FACE      = 'F1A';

// ── Load ifc-parser.js in VM sandbox ────────────────────────────────────────
const sandbox = {
    window: {}, globalThis: {}, self: {}, console,
    Math, Object, Array, Map, Set, Promise, Error, TypeError, Uint8Array,
    Float32Array, Float64Array, Int32Array, Uint32Array, Int8Array, JSON,
    Number, String, Boolean, Symbol, Proxy, Reflect, isNaN, isFinite,
    parseFloat, parseInt,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
createContext(sandbox);
runInContext(readFileSync(path.join(__dirname, 'js', 'ifc-parser.js'), 'utf8'), sandbox, { timeout: 10000 });
const IFCParser = sandbox.IFCParser;

// ── Parse IFC ────────────────────────────────────────────────────────────────
console.log(`Reading ${IFC_PATH} ...`);
const ifcText = readFileSync(IFC_PATH, 'utf8');
const parser  = new IFCParser();
const allData = await parser.parseFile(ifcText);
console.log(`Parsed ${allData.length} bars`);

// ── detectFaceSepAxis (ported from main.js) ──────────────────────────────────
function detectFaceSepAxis(allData) {
    const faceRe = /^[FNTB]\d/i;
    const layerCoords = {};
    for (const bar of allData) {
        const layer = bar.Avonmouth_Layer_Set;
        if (!layer || !faceRe.test(layer)) continue;
        const x = bar.Start_X, y = bar.Start_Y;
        if (x == null && y == null) continue;
        if (!layerCoords[layer]) layerCoords[layer] = [];
        layerCoords[layer].push({ x, y });
    }
    const hasFN = Object.keys(layerCoords).some(l => /^[FN]\d/i.test(l));
    const hasTB = Object.keys(layerCoords).some(l => /^[TB]\d/i.test(l));
    if (hasTB && !hasFN) return 'z';
    const layers = Object.values(layerCoords);
    const maxRange = key => Math.max(...layers.map(pts => {
        const vals = pts.map(p => p[key]).filter(v => v != null).sort((a, b) => a - b);
        return vals.length >= 2 ? vals[vals.length - 1] - vals[0] : 0;
    }));
    return maxRange('x') < maxRange('y') ? 'x' : 'y';
}

const sepAxis = detectFaceSepAxis(allData);
console.log(`sepAxis: ${sepAxis}`);

// ── Filter face bars ─────────────────────────────────────────────────────────
const bars = allData.filter(b => b.Avonmouth_Layer_Set === FACE && b.Start_X != null);
console.log(`${FACE} bars: ${bars.length}`);

if (!bars.length) { console.error('No bars found — check layer name'); process.exit(1); }

// ── Project to 2D ────────────────────────────────────────────────────────────
const projectBar = bar => {
    if (sepAxis === 'x') return { x1: bar.Start_Y, z1: bar.Start_Z, x2: bar.End_Y, z2: bar.End_Z };
    if (sepAxis === 'y') return { x1: bar.Start_X, z1: bar.Start_Z, x2: bar.End_X, z2: bar.End_Z };
    /* z */              return { x1: bar.Start_X, z1: bar.Start_Y, x2: bar.End_X, z2: bar.End_Y };
};
const projected = bars.map(projectBar);

// ── Normalise ────────────────────────────────────────────────────────────────
const allPx = projected.flatMap(p => [p.x1, p.x2]).filter(v => v != null);
const allPz = projected.flatMap(p => [p.z1, p.z2]).filter(v => v != null);
const minPx = Math.min(...allPx), maxRawPx = Math.max(...allPx);
const minPz = Math.min(...allPz), maxRawPz = Math.max(...allPz);
const px = v => (v ?? 0) - minPx;
const pz = v => (v ?? 0) - minPz;
const drawW = maxRawPx - minPx, drawH = maxRawPz - minPz;
console.log(`Drawing extent: ${drawW.toFixed(0)} mm wide × ${drawH.toFixed(0)} mm tall`);
console.log(`px range: [${minPx.toFixed(0)}, ${maxRawPx.toFixed(0)}]`);
console.log(`pz range: [${minPz.toFixed(0)}, ${maxRawPz.toFixed(0)}]`);

// ── Sample projected coords ──────────────────────────────────────────────────
console.log('\nFirst 3 projected bars (normalised):');
projected.slice(0, 3).forEach((p, i) => {
    console.log(`  [${i}] (${px(p.x1).toFixed(1)}, ${pz(p.z1).toFixed(1)}) → (${px(p.x2).toFixed(1)}, ${pz(p.z2).toFixed(1)})`);
});

// ── Build DXF ────────────────────────────────────────────────────────────────
const dxf  = [];
const emit = (...v) => v.forEach(x => dxf.push(String(x)));

const LINE = (x1, z1, x2, z2, lyr) =>
    emit('0','LINE','8',lyr,
         '10',x1.toFixed(3),'20',z1.toFixed(3),'30','0.000',
         '11',x2.toFixed(3),'21',z2.toFixed(3),'31','0.000');

const TEXT = (x, z, txt, h, lyr) =>
    emit('0','TEXT','8',lyr,
         '10',x.toFixed(3),'20',z.toFixed(3),'30','0.000',
         '40',h.toFixed(3),'1',String(txt));

// HEADER — minimal, ACADVER only
emit('0','SECTION',
     '2','HEADER',
     '9','$ACADVER',
     '1','AC1009',
     '9','$INSUNITS',
     '70','4',
     '0','ENDSEC');

// TABLES — LTYPE + LAYER (AC1009 requires LTYPE before LAYER)
emit('0','SECTION',
     '2','TABLES',
     // LTYPE table with CONTINUOUS entry
     '0','TABLE',
     '2','LTYPE',
     '70','1',
     '0','LTYPE',
     '2','CONTINUOUS',
     '70','0',
     '3','Solid line',
     '72','65',
     '73','0',
     '40','0.0',
     '0','ENDTAB',
     // LAYER table
     '0','TABLE',
     '2','LAYER',
     '70','2',
     '0','LAYER',
     '2','BARS',
     '70','0',
     '62','2',
     '6','CONTINUOUS',
     '0','LAYER',
     '2','TEXT',
     '70','0',
     '62','7',
     '6','CONTINUOUS',
     '0','ENDTAB',
     '0','ENDSEC');

// BLOCKS section (required by some AutoCAD versions, can be empty)
emit('0','SECTION',
     '2','BLOCKS',
     '0','ENDSEC');

// ENTITIES
emit('0','SECTION',
     '2','ENTITIES');

for (const p of projected) {
    if (p.x1 == null || p.z1 == null) continue;
    LINE(px(p.x1), pz(p.z1), px(p.x2), pz(p.z2), 'BARS');
}

TEXT(0, drawH + 40, `P7349_C1  |  ${FACE}  |  ${bars.length} bars  [centreline]`, 18, 'TEXT');

emit('0','ENDSEC',
     '0','EOF');

// ── Write file ───────────────────────────────────────────────────────────────
const content = dxf.join('\r\n') + '\r\n';   // CRLF — required by AutoCAD AC1009
const outPath = path.join(__dirname, `P7349_C1-${FACE}-view.dxf`);
writeFileSync(outPath, content, 'utf8');

console.log(`\nDXF written: ${outPath}`);
console.log(`Lines: ${dxf.length}  |  Entities: ${projected.filter(p => p.x1 != null).length} LINE + 1 TEXT`);
console.log(`File size: ${(content.length / 1024).toFixed(1)} KB`);

// ── Structural validation ────────────────────────────────────────────────────
console.log('\n── DXF structure check ──');
const lines = content.split('\r\n');
let sectionCount = 0, lineCount = 0, textCount = 0;
for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === '0' && lines[i+1].trim() === 'SECTION') sectionCount++;
    if (lines[i].trim() === '0' && lines[i+1].trim() === 'LINE')    lineCount++;
    if (lines[i].trim() === '0' && lines[i+1].trim() === 'TEXT')    textCount++;
}
console.log(`  Sections: ${sectionCount} (expected 4: HEADER, TABLES, BLOCKS, ENTITIES)`);
console.log(`  LINE entities: ${lineCount}`);
console.log(`  TEXT entities: ${textCount}`);

// Print first 60 lines of DXF for inspection
console.log('\n── First 60 lines of DXF ──');
lines.slice(0, 60).forEach((l, i) => console.log(`${String(i+1).padStart(3)}: ${l}`));
