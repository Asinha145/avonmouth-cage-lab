/**
 * diag-faceview-brep.mjs — Generate face view DXF using real BREP geometry
 *
 * Replicates the full browser pipeline in Node.js:
 *   1. Load ifc-parser.js → get allData (bar layer assignments)
 *   2. Load web-ifc native → StreamAllMeshes → replicate layerGroups
 *   3. Extract F1A vertex clouds → project to 2D → convex hull per bar
 *   4. Emit AC1009 DXF with CRLF line endings
 *
 * Run:  node diag-faceview-brep.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createContext, runInContext } from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IFC_PATH  = 'C:/Users/ashis/avonmouth-de-tool/Sample/P7349_C1.ifc';
const FACE      = 'F1A';

// ── 1. Load ifc-parser.js in VM sandbox ──────────────────────────────────────
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

const ifcText = readFileSync(IFC_PATH, 'utf8');
const parser  = new IFCParser();
const allData = await parser.parseFile(ifcText);
console.log(`Text parser: ${allData.length} bars`);

// Build barMap: expressID → bar
const barMap = new Map();
allData.forEach(b => { if (b._entityId != null) barMap.set(parseInt(b._entityId, 10), b); });
console.log(`barMap: ${barMap.size} entries`);

// ── 2. Load web-ifc native + stream meshes → layerGroups ────────────────────
const nodeApiPath = path.join(__dirname, 'node_modules', 'web-ifc', 'web-ifc-api-node.js');
const { IfcAPI } = await import(pathToFileURL(nodeApiPath).href);
const ifcapi = new IfcAPI();
await ifcapi.Init();

const ifcBytes  = readFileSync(IFC_PATH);
const modelID   = ifcapi.OpenModel(new Uint8Array(ifcBytes.buffer, ifcBytes.byteOffset, ifcBytes.byteLength));

// layerGroups: layerName → array of point arrays (one per mesh)
const layerGroups = new Map();
let totalMeshes = 0, totalVerts = 0;

ifcapi.StreamAllMeshes(modelID, mesh => {
    const eid = mesh.expressID;
    const bar = barMap.get(eid);
    const groupKey = bar ? (bar.Avonmouth_Layer_Set || bar.Bar_Type || 'Unknown') : 'Unknown';

    const allPos = [];
    let vtxOffset = 0;

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
            allPos.push(wx, wy, wz);
        }
        vtxOffset += verts.length / 6;
        flat.delete();
    }

    if (allPos.length === 0) return;

    if (!layerGroups.has(groupKey)) layerGroups.set(groupKey, []);
    layerGroups.get(groupKey).push(allPos); // flat Float array: [x0,y0,z0, x1,y1,z1, ...]
    totalMeshes++;
    totalVerts += allPos.length / 3;
});

ifcapi.CloseModel(modelID);
console.log(`BREP: ${totalMeshes} meshes, ${totalVerts} total vertices`);
console.log(`Layers: ${[...layerGroups.keys()].sort().join(', ')}`);

const f1aGroup = layerGroups.get(FACE);
console.log(`${FACE} group: ${f1aGroup ? f1aGroup.length + ' meshes' : 'NOT FOUND'}`);
if (!f1aGroup) process.exit(1);

// ── 3. detectFaceSepAxis ──────────────────────────────────────────────────────
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
    const layers = Object.values(layerCoords);
    const hasFN = Object.keys(layerCoords).some(l => /^[FN]\d/i.test(l));
    const hasTB = Object.keys(layerCoords).some(l => /^[TB]\d/i.test(l));
    if (hasTB && !hasFN) return 'z';
    const maxRange = key => Math.max(...layers.map(pts => {
        const vals = pts.map(p => p[key]).filter(v => v != null).sort((a,b) => a-b);
        return vals.length >= 2 ? vals[vals.length-1] - vals[0] : 0;
    }));
    return maxRange('x') < maxRange('y') ? 'x' : 'y';
}
const sepAxis = detectFaceSepAxis(allData);
console.log(`sepAxis: ${sepAxis}`);

// ── 4. Project vertex cloud to 2D ────────────────────────────────────────────
// Three.js world space: engine_X=IFC_X/1000, engine_Y=IFC_Z/1000, engine_Z=-IFC_Y/1000
function engineToFace2D(ex, ey, ez) {
    const ix = ex * 1000, iy = -ez * 1000, iz = ey * 1000; // IFC mm
    if (sepAxis === 'x') return [iy, iz];
    if (sepAxis === 'y') return [ix, iz];
    /* z */              return [ix, iy];
}

// ── 5. 2D convex hull (Jarvis march) ─────────────────────────────────────────
function convexHull2D(pts) {
    if (pts.length <= 2) return pts;
    let s = 0;
    for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[s][0]) s = i;
    const hull = [];
    let cur = s;
    do {
        hull.push(pts[cur]);
        let nxt = (cur + 1) % pts.length;
        for (let i = 0; i < pts.length; i++) {
            const cross = (pts[nxt][0] - pts[cur][0]) * (pts[i][1] - pts[cur][1])
                        - (pts[nxt][1] - pts[cur][1]) * (pts[i][0] - pts[cur][0]);
            if (cross > 0) nxt = i;
        }
        cur = nxt;
    } while (cur !== s && hull.length <= pts.length);
    return hull;
}

// ── 6. Build projected segments ───────────────────────────────────────────────
const segments = [];
let totalHullPts = 0;

for (const flatPos of f1aGroup) {
    const pts2d = [];
    for (let i = 0; i < flatPos.length; i += 3) {
        pts2d.push(engineToFace2D(flatPos[i], flatPos[i+1], flatPos[i+2]));
    }
    const hull = convexHull2D(pts2d);
    totalHullPts += hull.length;
    for (let i = 0; i < hull.length; i++) {
        const a = hull[i], b = hull[(i+1) % hull.length];
        segments.push({ x1: a[0], z1: a[1], x2: b[0], z2: b[1] });
    }
}
console.log(`Convex hull: ${f1aGroup.length} bars → ${totalHullPts} hull vertices → ${segments.length} edge segments`);

// ── 7. Normalise ──────────────────────────────────────────────────────────────
const allPx = segments.flatMap(s => [s.x1, s.x2]);
const allPz = segments.flatMap(s => [s.z1, s.z2]);
const minPx = Math.min(...allPx), maxPx = Math.max(...allPx);
const minPz = Math.min(...allPz), maxPz = Math.max(...allPz);
const drawW = maxPx - minPx, drawH = maxPz - minPz;
const px = v => v - minPx, pz = v => v - minPz;

console.log(`Drawing extent: ${drawW.toFixed(0)} mm wide × ${drawH.toFixed(0)} mm tall`);
console.log(`Sample segment [0]: (${px(segments[0].x1).toFixed(1)}, ${pz(segments[0].z1).toFixed(1)}) → (${px(segments[0].x2).toFixed(1)}, ${pz(segments[0].z2).toFixed(1)})`);

// ── 8. Emit DXF ───────────────────────────────────────────────────────────────
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

emit('0','SECTION','2','HEADER',
     '9','$ACADVER','1','AC1009',
     '9','$INSUNITS','70','4',
     '0','ENDSEC');

emit('0','SECTION','2','TABLES',
     '0','TABLE','2','LTYPE','70','1',
     '0','LTYPE','2','CONTINUOUS','70','0','3','Solid line','72','65','73','0','40','0.0',
     '0','ENDTAB',
     '0','TABLE','2','LAYER','70','2',
     '0','LAYER','2','BARS','70','0','62','2','6','CONTINUOUS',
     '0','LAYER','2','TEXT','70','0','62','7','6','CONTINUOUS',
     '0','ENDTAB',
     '0','ENDSEC');

emit('0','SECTION','2','BLOCKS','0','ENDSEC');

emit('0','SECTION','2','ENTITIES');

for (const s of segments) {
    if (s.x1 == null || s.z1 == null) continue;
    LINE(px(s.x1), pz(s.z1), px(s.x2), pz(s.z2), 'BARS');
}

TEXT(0, drawH + 40, `P7349_C1  |  ${FACE}  |  ${f1aGroup.length} bars  [BREP]`, 18, 'TEXT');

emit('0','ENDSEC','0','EOF');

// ── 9. Write ──────────────────────────────────────────────────────────────────
const content = dxf.join('\r\n') + '\r\n';
const outPath = path.join(__dirname, `P7349_C1-${FACE}-brep.dxf`);
writeFileSync(outPath, content, 'utf8');

console.log(`\nDXF written: ${outPath}`);
console.log(`File size: ${(content.length / 1024).toFixed(1)} KB  |  LINE entities: ${segments.length}  |  CRLF endings: yes`);

// ── 10. Quick structure validation ───────────────────────────────────────────
const lines = content.split('\r\n');
let secs = 0, lineEnts = 0;
for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() === '0' && lines[i+1].trim() === 'SECTION') secs++;
    if (lines[i].trim() === '0' && lines[i+1].trim() === 'LINE')    lineEnts++;
}
console.log(`Sections: ${secs} (expected 4) | LINE entities: ${lineEnts}`);
if (secs !== 4 || lineEnts !== segments.length) {
    console.error('VALIDATION FAILED'); process.exit(1);
}
console.log('Validation PASSED ✓');
