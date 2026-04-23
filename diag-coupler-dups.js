const fs = require('fs');

const filePath = process.argv[2] || './test-cages/P7349_C1.ifc';
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');

console.log(`\n=== Coupler Duplicate Analysis: ${filePath} ===\n`);

// Extract all IFCBEAM entities with their GlobalIds and placement refs
const beams = new Map();
for (const m of content.matchAll(/#(\d+)=IFCBEAM\('([^']+)'[^;]*#(\d+)/g)) {
    beams.set(m[1], { eid: m[1], globalId: m[2], placementRef: m[3] });
}
console.log(`Total IFCBEAM entities: ${beams.size}\n`);

// Extract ATK EMBEDMENTS HEIGHT for each beam
const beamOD = new Map();
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'ATK EMBEDMENTS'")) continue;

    // Extract HEIGHT property value
    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propId = pm[1];
        const propLine = content.match(new RegExp(`#${propId}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'HEIGHT'")) continue;
        const odMatch = propLine.match(/IFCLENGTHMEASURE\(([\d.]+)\)/);
        if (odMatch) {
            const od = parseFloat(odMatch[1]);
            const beamRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of beamRefs) {
                const bid = ref[1];
                if (beams.has(bid)) beamOD.set(bid, od);
            }
        }
    }
}

// Extract Avonmouth Layer/Set for each beam
const beamLayer = new Map();
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'Avonmouth'")) continue;

    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propId = pm[1];
        const propLine = content.match(new RegExp(`#${propId}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'Layer/Set'")) continue;
        const layerMatch = propLine.match(/IFCTEXT\('([^']+)'\)/);
        if (layerMatch) {
            const layer = layerMatch[1];
            const beamRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of beamRefs) {
                const bid = ref[1];
                if (beams.has(bid)) beamLayer.set(bid, layer);
            }
        }
    }
}

// Extract connected_rebar from Bylor psets
const beamConnectedRebar = new Map();
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'Bylor'")) continue;

    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propId = pm[1];
        const propLine = content.match(new RegExp(`#${propId}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'connected_rebar'")) continue;
        const rebarMatch = propLine.match(/IFCTEXT\('([^']+)'\)/);
        if (rebarMatch) {
            const rebar = rebarMatch[1];
            const beamRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of beamRefs) {
                const bid = ref[1];
                if (beams.has(bid)) beamConnectedRebar.set(bid, rebar);
            }
        }
    }
}

console.log('=== VS/HS COUPLERS ===\n');
let vsCount = 0, hsCount = 0;
const rebarConnMap = new Map(); // rebar GlobalId → array of couplers

for (const [eid, beam] of beams) {
    const layer = beamLayer.get(eid);
    if (!layer || !/^[VH]S/i.test(layer)) continue;

    const od = beamOD.get(eid);
    const cr = beamConnectedRebar.get(eid);
    const holeDia = od ? (od + 2) : '?';

    if (/^VS/i.test(layer)) vsCount++;
    else if (/^HS/i.test(layer)) hsCount++;

    if (cr) {
        if (!rebarConnMap.has(cr)) rebarConnMap.set(cr, []);
        rebarConnMap.get(cr).push({ eid, globalId: beam.globalId, layer, od, holeDia, cr });
    }
}

console.log(`Total VS couplers: ${vsCount}`);
console.log(`Total HS couplers: ${hsCount}`);
console.log(`Total with connected_rebar: ${rebarConnMap.size} unique rebars\n`);

// Check for duplicates
console.log('=== CHECKING FOR DUPLICATE CONNECTIONS ===\n');
let duplicates = 0;
for (const [rebarId, couplers] of rebarConnMap) {
    if (couplers.length > 1) {
        duplicates++;
        console.log(`⚠️  Rebar ${rebarId}: ${couplers.length} couplers connected!`);
        couplers.forEach(c => {
            console.log(`   - EID:${c.eid} Layer:${c.layer} OD:${c.od}mm → Hole:${c.holeDia}mm`);
        });
        console.log();
    }
}

if (duplicates === 0) {
    console.log('✓ No duplicate connections found. Each rebar has max 1 coupler.\n');
} else {
    console.log(`Found ${duplicates} rebars with multiple couplers!\n`);
}

// Show all unique hole diameters
const holeSizes = new Set();
for (const couplers of rebarConnMap.values()) {
    for (const c of couplers) {
        if (c.holeDia !== '?') holeSizes.add(c.holeDia);
    }
}

console.log(`=== UNIQUE HOLE DIAMETERS ===`);
console.log([...holeSizes].sort((a,b) => a-b).map(d => `${d}mm`).join(', '));
console.log();
