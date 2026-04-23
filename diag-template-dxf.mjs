/**
 * diag-template-dxf.mjs — Generate template DXF locally from P7349_C1.ifc
 *
 * Ports _parseIFCBeamHoles / _bucketHolesByFace / _computePlates from main.js
 * as standalone Node.js functions. Writes DXF to P7349_C1-template-diag.dxf
 * and prints a diagnostic summary.
 *
 * Run:  node diag-template-dxf.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createContext, runInContext } from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IFC_PATH  = 'C:/Users/ashis/avonmouth-de-tool/Sample/P7349_C1.ifc';
const OUT_PATH  = path.join(__dirname, 'P7349_C1-template-diag.dxf');
const MAX_LEN   = 2000;
const MAX_WIDTH = 300;

// ── Load ifc-parser.js in VM sandbox ──────────────────────────────────────
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

// ── Parse IFC ─────────────────────────────────────────────────────────────
console.log(`Reading ${IFC_PATH} ...`);
const ifcText = readFileSync(IFC_PATH, 'utf8');

const parser = new IFCParser();
const allData = await parser.parseFile(ifcText);
const cageAxisName = parser.cageAxisName;
console.log(`cageAxisName = ${cageAxisName}  |  bars = ${allData.length}`);

// ── _parseIFCBeamHoles (ported from main.js, self-contained) ──────────────
function parseIFCBeamHoles(ifcText) {
    const entityMap = new Map();
    for (const m of ifcText.matchAll(/^#(\d+)=(.+)/gm)) entityMap.set(m[1], m[2]);
    const getEntity = id => entityMap.get(String(id)) ?? null;
    const parseCoords = s => [...s.matchAll(/[-+]?\d+\.?\d*(?:[Ee][+-]?\d+)?/g)].map(m => parseFloat(m[0]));

    const absPos = {};
    for (const m of ifcText.matchAll(/#(\d+)=IFCLOCALPLACEMENT\([^,)]*,#(\d+)\)/g)) {
        const [, lpId, axId] = m;
        const ax = getEntity(axId); if (!ax?.includes('IFCAXIS2PLACEMENT3D')) continue;
        const cpId = ax.match(/#(\d+)/)?.[1]; if (!cpId) continue;
        const cp = getEntity(cpId); if (!cp?.includes('IFCCARTESIANPOINT')) continue;
        const inner = cp.match(/\(([^)]+)\)/)?.[1]; if (!inner) continue;
        const c = parseCoords(inner); if (c.length === 3) absPos[lpId] = c;
    }

    const beamOD = {};
    for (const m of ifcText.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\([^;]+;/g)) {
        const rel = m[0];
        const psetId = rel.match(/,#(\d+)\s*\)\s*;/)?.[1]; if (!psetId) continue;
        const pset = getEntity(psetId); if (!pset?.includes('ATK EMBEDMENTS')) continue;
        let od = null;
        for (const pid of [...pset.matchAll(/#(\d+)/g)].map(x => x[1])) {
            const prop = getEntity(pid);
            if (prop?.includes("'HEIGHT'")) { const v = prop.match(/IFCLENGTHMEASURE\(([\d.]+)\)/)?.[1]; if (v) { od = parseFloat(v); break; } }
        }
        if (od === null) continue;
        const mm = rel.match(/,\(([^)]*#[^)]*)\),#\d+\)/); if (!mm) continue;
        for (const b of mm[1].matchAll(/#(\d+)/g)) beamOD[b[1]] = od;
    }

    const beamLayer = {};
    for (const m of ifcText.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\([^;]+;/g)) {
        const rel = m[0];
        const psetId = rel.match(/,#(\d+)\s*\)\s*;/)?.[1]; if (!psetId) continue;
        const pset = getEntity(psetId); if (!pset?.includes("'Avonmouth'")) continue;
        let lv = null;
        for (const pid of [...pset.matchAll(/#(\d+)/g)].map(x => x[1])) {
            const prop = getEntity(pid);
            if (prop?.includes("'Layer/Set'")) { const v = prop.match(/IFCTEXT\('([^']+)'\)/)?.[1]; if (v) { lv = v; break; } }
        }
        if (!lv) continue;
        const mm = rel.match(/,\(([^)]*#[^)]*)\),#\d+\)/); if (!mm) continue;
        for (const b of mm[1].matchAll(/#(\d+)/g)) {
            const e = getEntity(b[1]); if (e?.includes('IFCBEAM(')) beamLayer[b[1]] = lv;
        }
    }

    const beams = [];
    for (const m of ifcText.matchAll(/#(\d+)=IFCBEAM\(([^;]+);/g)) {
        const [, bid, bdata] = m;
        for (const ref of bdata.matchAll(/#(\d+)/g)) {
            if (absPos[ref[1]]) {
                const [bx, by, bz] = absPos[ref[1]];
                beams.push({ xMm: bx, yMm: by, zMm: bz, od: beamOD[bid] ?? null, layer: beamLayer[bid] ?? null });
                break;
            }
        }
    }
    if (beams.length === 0) return [];

    return beams
        .filter(b => b.od !== null && /^[VH]S/i.test(b.layer || ''))
        .map(b => ({ xMm: b.xMm, yMm: b.yMm, zMm: b.zMm, holeDia: b.od + 2, layer: b.layer }));
}

// ── _detectFaceSepAxis (ported from main.js) ──────────────────────────────
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
    if (hasTB && !hasFN) return 'z';
    // Detect by within-layer spread: face bars cluster tightly on the sep axis
    // (all bars in F1A share the same depth-in-wall X, spread wide in Y along wall length).
    // The separation axis is the one with the SMALLEST maximum within-layer range.
    const layers = Object.values(layerCoords);
    const maxRange = (key) => Math.max(...layers.map(pts => {
        const vals = pts.map(p => p[key]).filter(v => v != null).sort((a,b) => a-b);
        return vals.length >= 2 ? vals[vals.length-1] - vals[0] : 0;
    }));
    return maxRange('x') < maxRange('y') ? 'x' : 'y';
}

// ── _bucketHolesByFace (ported from main.js, takes allData) ───────────────
function bucketHolesByFace(holes, allData) {
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

    const sepAxis = detectFaceSepAxis(allData);
    console.log(`  bucketing: sepAxis=${sepAxis}  layers=[${Object.keys(layerCoords).join(', ')}]`);

    const holeVal = h => sepAxis === 'x' ? h.xMm  : sepAxis === 'z' ? h.zMm  : h.yMm;
    const barVal  = p => sepAxis === 'x' ? p.x     : sepAxis === 'z' ? p.z    : p.y;

    if (!Object.keys(layerCoords).length) {
        const vals = holes.map(holeVal);
        const mid = (Math.min(...vals) + Math.max(...vals)) / 2;
        const above = holes.filter(h => holeVal(h) > mid);
        const below = holes.filter(h => holeVal(h) <= mid);
        const result = {};
        if (above.length) result['F1A'] = above;
        if (below.length) result['N1A'] = below;
        return Object.keys(result).length ? result : { 'FACE': holes };
    }

    const median = arr => { const s = [...arr].filter(v => v != null).sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const faceMedians = {};
    for (const [layer, pts] of Object.entries(layerCoords))
        faceMedians[layer] = median(pts.map(barVal));

    console.log('  face medians (sep axis):', Object.entries(faceMedians).map(([l, v]) => `${l}=${v?.toFixed(0)}`).join('  '));

    const buckets = {};
    for (const hole of holes) {
        const val = holeVal(hole);
        let best = null, bestDist = Infinity;
        for (const [layer, med] of Object.entries(faceMedians)) {
            const d = Math.abs(med - val); if (d < bestDist) { bestDist = d; best = layer; }
        }
        if (!buckets[best]) buckets[best] = [];
        buckets[best].push(hole);
    }
    return Object.fromEntries(Object.entries(buckets).filter(([, h]) => h.length > 0));
}

// ── _computePlates (ported from main.js, self-contained) ──────────────────
function computePlates(plotHoles, maxLength, maxWidth) {
    const CLEARANCE = 25;

    function bandAndGroup(holes, bandKey, groupKey) {
        if (!holes.length) return [];
        const sorted = [...holes].sort((a, b) => a[bandKey] - b[bandKey]);
        const bands = [];
        let bnd = [sorted[0]];
        let bMin = sorted[0][bandKey] - sorted[0].holeDia / 2 - CLEARANCE;
        let bMax = sorted[0][bandKey] + sorted[0].holeDia / 2 + CLEARANCE;
        for (let i = 1; i < sorted.length; i++) {
            const h = sorted[i];
            const cMin = Math.min(bMin, h[bandKey] - h.holeDia / 2 - CLEARANCE);
            const cMax = Math.max(bMax, h[bandKey] + h.holeDia / 2 + CLEARANCE);
            if (cMax - cMin > maxWidth) {
                bands.push(bnd); bnd = [h];
                bMin = h[bandKey] - h.holeDia / 2 - CLEARANCE;
                bMax = h[bandKey] + h.holeDia / 2 + CLEARANCE;
            } else { bnd.push(h); bMin = cMin; bMax = cMax; }
        }
        bands.push(bnd);

        const plates = [];
        for (const b of bands) {
            const byG = [...b].sort((a, c) => a[groupKey] - c[groupKey]);
            let grp = [byG[0]];
            let gMin = byG[0][groupKey] - byG[0].holeDia / 2 - CLEARANCE;
            let gMax = byG[0][groupKey] + byG[0].holeDia / 2 + CLEARANCE;
            for (let i = 1; i < byG.length; i++) {
                const h = byG[i], cMax = h[groupKey] + h.holeDia / 2 + CLEARANCE;
                if (cMax - gMin > maxLength) {
                    plates.push(grp); grp = [h];
                    gMin = h[groupKey] - h.holeDia / 2 - CLEARANCE; gMax = cMax;
                } else { grp.push(h); gMax = cMax; }
            }
            plates.push(grp);
        }
        return plates;
    }

    const toPlate = (holes, idx, type) => {
        const minX = Math.min(...holes.map(h => h.px - h.holeDia / 2)) - CLEARANCE;
        const maxX = Math.max(...holes.map(h => h.px + h.holeDia / 2)) + CLEARANCE;
        const minZ = Math.min(...holes.map(h => h.pz - h.holeDia / 2)) - CLEARANCE;
        const maxZ = Math.max(...holes.map(h => h.pz + h.holeDia / 2)) + CLEARANCE;
        return { id: idx + 1, type, holes, minX, maxX, minZ, maxZ,
                 length: +(maxX - minX).toFixed(1), width: +(maxZ - minZ).toFixed(1) };
    };

    const vsHoles = plotHoles.filter(h => /^VS/i.test(h.layer || ''));
    const hsHoles = plotHoles.filter(h => /^HS/i.test(h.layer || ''));

    function getOrientation(holes) {
        if (!holes.length) return { bandKey: 'px', groupKey: 'pz' };
        const xUniq = new Set(holes.map(h => Math.round(h.px))).size;
        const zUniq = new Set(holes.map(h => Math.round(h.pz))).size;
        return zUniq >= xUniq
            ? { bandKey: 'px', groupKey: 'pz' }
            : { bandKey: 'pz', groupKey: 'px' };
    }

    const vsOri = getOrientation(vsHoles);
    const hsOri = { bandKey: 'pz', groupKey: 'px' };   // HS always long=X

    const vsPlates = bandAndGroup(vsHoles, vsOri.bandKey, vsOri.groupKey).map((h, i) => toPlate(h, i, 'VS'));
    const hsPlates = bandAndGroup(hsHoles, hsOri.bandKey, hsOri.groupKey).map((h, i) => toPlate(h, i, 'HS'));

    return { vsPlates, hsPlates };
}

// ── DXF emit helpers ──────────────────────────────────────────────────────
const dxf  = [];
const emit = (...v) => v.forEach(x => dxf.push(String(x)));
const LINE   = (x1,y1,x2,y2,lyr) => emit('0','LINE','8',lyr,'10',x1.toFixed(1),'20',y1.toFixed(1),'30','0.0','11',x2.toFixed(1),'21',y2.toFixed(1),'31','0.0');
const CIRCLE = (cx,cy,r,lyr)     => emit('0','CIRCLE','8',lyr,'10',cx.toFixed(1),'20',cy.toFixed(1),'30','0.0','40',r.toFixed(2));
const TEXT   = (x,y,txt,h,lyr)   => emit('0','TEXT','8',lyr,'10',x.toFixed(1),'20',y.toFixed(1),'30','0.0','40',h.toFixed(1),'1',String(txt));
const HDIM = (x0, x1, y, label) => {
    LINE(x0, y, x1, y, 'DIMS'); LINE(x0, y-4, x0, y+4, 'DIMS'); LINE(x1, y-4, x1, y+4, 'DIMS');
    TEXT((x0+x1)/2 - 4, y+5, String(label), 7, 'DIMS');
};
const VDIM = (x, z0, z1, label) => {
    LINE(x, z0, x, z1, 'DIMS'); LINE(x-4, z0, x+4, z0, 'DIMS'); LINE(x-4, z1, x+4, z1, 'DIMS');
    TEXT(x+5, (z0+z1)/2, String(label), 7, 'DIMS');
};

// ── Main pipeline ─────────────────────────────────────────────────────────
console.log('\nParsing IFCBEAM holes...');
const allHoles = parseIFCBeamHoles(ifcText);
console.log(`  Total VS/HS holes: ${allHoles.length}`);

const layerCounts = {};
allHoles.forEach(h => { layerCounts[h.layer] = (layerCounts[h.layer] || 0) + 1; });
console.log('  By layer:', Object.entries(layerCounts).map(([l, c]) => `${l}=${c}`).join('  '));

const odCounts = {};
allHoles.forEach(h => { odCounts[h.holeDia] = (odCounts[h.holeDia] || 0) + 1; });
console.log('  By hole dia:', Object.entries(odCounts).map(([d, c]) => `dia=${d}mm x${c}`).join('  '));

console.log('\nBucketing by face...');
const faceBuckets = bucketHolesByFace(allHoles, allData);
console.log(`  Faces: ${Object.keys(faceBuckets).join(', ')}`);
for (const [f, h] of Object.entries(faceBuckets)) {
    const lc = {};
    h.forEach(hh => { lc[hh.layer] = (lc[hh.layer] || 0) + 1; });
    console.log(`  ${f}: ${h.length} holes  [${Object.entries(lc).map(([l,c]) => `${l}=${c}`).join(', ')}]`);
}

const globalMinX = Math.min(...allHoles.map(h => h.xMm));
const globalMinY = Math.min(...allHoles.map(h => h.yMm));

console.log('\nComputing plates...');
emit('0','SECTION','2','HEADER','9','$ACADVER','1','AC1009','0','ENDSEC');
emit('0','SECTION','2','ENTITIES');

const COL_MARGIN = 80, DRAW_PAD = 50, PLATE_GAP = 70, LABEL_H = 22;
let baseY = DRAW_PAD;
let totalPlates = 0, totalVS = 0, totalHS = 0;

const drawPlates = (plates, sectionLabel) => {
    if (!plates.length) return;
    TEXT(COL_MARGIN, baseY, `-- ${sectionLabel} --  (${plates.length} plates)`, 13, 'TEXT');
    baseY += 30;
    for (const plate of plates) {
        const ox = COL_MARGIN, oz = baseY;
        LINE(ox,              oz,              ox+plate.length, oz,              'PLATE_OUTLINE');
        LINE(ox+plate.length, oz,              ox+plate.length, oz+plate.width,  'PLATE_OUTLINE');
        LINE(ox+plate.length, oz+plate.width,  ox,             oz+plate.width,  'PLATE_OUTLINE');
        LINE(ox,              oz+plate.width,  ox,             oz,              'PLATE_OUTLINE');
        TEXT(ox, oz+plate.width+6,
            `${plate.type}-PLATE-${String(plate.id).padStart(2,'0')}  ${Math.round(plate.length)} x ${Math.round(plate.width)} mm  (${plate.holes.length} holes)`,
            10, 'TEXT');
        HDIM(ox, ox+plate.length, oz-20, `${Math.round(plate.length)} mm`);
        VDIM(ox-20, oz, oz+plate.width, `${Math.round(plate.width)} mm`);
        for (const h of plate.holes) {
            const hx = ox + (h.px - plate.minX);
            const hz = oz + (h.pz - plate.minZ);
            const r  = h.holeDia / 2;
            CIRCLE(hx, hz, r, 'HOLES');
            TEXT(hx-r, hz+r+3, `P7349-CPLR-${String(h.num).padStart(3,'0')}`, 6, 'TEXT');
        }
        const byPx = [...plate.holes].sort((a, b) => a.px - b.px);
        const byPz = [...plate.holes].sort((a, b) => a.pz - b.pz);
        const lH = byPx[0], rH = byPx[byPx.length-1];
        const bH = byPz[0], tH = byPz[byPz.length-1];
        HDIM(ox,                         ox+(lH.px-plate.minX)-lH.holeDia/2, oz+(lH.pz-plate.minZ), '25');
        HDIM(ox+(rH.px-plate.minX)+rH.holeDia/2, ox+plate.length,           oz+(rH.pz-plate.minZ), '25');
        VDIM(ox+(bH.px-plate.minX), oz,                                      oz+(bH.pz-plate.minZ)-bH.holeDia/2, '25');
        VDIM(ox+(tH.px-plate.minX), oz+(tH.pz-plate.minZ)+tH.holeDia/2,     oz+plate.width,                     '25');
        baseY += plate.width + DRAW_PAD + PLATE_GAP + LABEL_H;
    }
    baseY += 20;
};

for (const [faceName, faceHoles] of Object.entries(faceBuckets)) {
    const faceZ = faceHoles.map(h => h.zMm);
    const zSpan = Math.max(...faceZ) - Math.min(...faceZ);
    const useY  = zSpan < 100;
    const minP  = useY ? Math.min(...faceHoles.map(h => h.yMm)) : Math.min(...faceZ);

    const faceSepAxis = detectFaceSepAxis(allData);
    const useLongY = faceSepAxis === 'x' && !useY;
    console.log(`  face=${faceName}  sepAxis=${faceSepAxis}  zSpan=${zSpan.toFixed(0)}mm  useY=${useY}  useLongY=${useLongY}  holes=${faceHoles.length}`);

    const plotHoles = faceHoles
        .map(h => ({ ...h,
            px: +(useLongY ? h.yMm - globalMinY : h.xMm - globalMinX).toFixed(1),
            pz: +((useY ? h.yMm : h.zMm) - minP).toFixed(1) }))
        .sort((a, b) => a.px !== b.px ? a.px - b.px : a.pz - b.pz);
    plotHoles.forEach((h, i) => { h.num = i + 1; });

    // Print pz distribution for HS holes to check parallel rows
    const hsFaceHoles = plotHoles.filter(h => /^HS/i.test(h.layer || ''));
    const pzVals = [...new Set(hsFaceHoles.map(h => Math.round(h.pz)))].sort((a,b) => a-b);
    console.log(`    HS holes=${hsFaceHoles.length}  unique pz values (${pzVals.length}): [${pzVals.join(', ')}]`);
    const pxVals = [...new Set(hsFaceHoles.map(h => Math.round(h.px)))].sort((a,b) => a-b);
    console.log(`    HS unique px positions (${pxVals.length}): first 10 = [${pxVals.slice(0,10).join(', ')}]  ...last 10 = [${pxVals.slice(-10).join(', ')}]`);

    const { vsPlates, hsPlates } = computePlates(plotHoles, MAX_LEN, MAX_WIDTH);
    totalPlates += vsPlates.length + hsPlates.length;
    totalVS += vsPlates.length; totalHS += hsPlates.length;

    console.log(`    VS plates: ${vsPlates.length}`);
    for (const p of vsPlates) console.log(`      VS-PLATE-${p.id}  ${Math.round(p.length)}x${Math.round(p.width)}mm  ${p.holes.length} holes`);
    console.log(`    HS plates: ${hsPlates.length}`);
    for (const p of hsPlates) console.log(`      HS-PLATE-${p.id}  ${Math.round(p.length)}x${Math.round(p.width)}mm  ${p.holes.length} holes`);

    TEXT(COL_MARGIN, baseY + 15,
        `======  ${faceName} FACE  ======  ${faceHoles.length} holes  |  ${vsPlates.length} VS plates + ${hsPlates.length} HS plates`,
        14, 'TEXT');
    baseY += 40;

    drawPlates(vsPlates, `VS PLATES - Vertical Struts`);
    drawPlates(hsPlates, `HS PLATES - Horizontal Struts`);
    baseY += 30;
}

emit('0','ENDSEC','0','EOF');

writeFileSync(OUT_PATH, dxf.join('\n'), 'utf8');
console.log(`\nWrote DXF: ${OUT_PATH}  (${dxf.length} lines)`);
console.log(`Total: ${totalPlates} plates  (${totalVS} VS + ${totalHS} HS)`);
