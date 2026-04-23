const fs = require('fs');

const filePath = process.argv[2] || './test-cages/P7349_C1.ifc';
const content = fs.readFileSync(filePath, 'utf8');

console.log(`\n=== COUPLER POSITIONS (Checking for same-location duplicates) ===\n`);

// Extract placement → position mapping
const placementPos = new Map();
for (const m of content.matchAll(/#(\d+)=IFCAXIS2PLACEMENT3D\(#(\d+)[^;]+;/g)) {
    const [, placeId, cpId] = m;
    const cpLine = content.match(new RegExp(`#${cpId}=IFCCARTESIANPOINT\\(\\(([^)]+)\\)`));
    if (!cpLine) continue;
    const coords = [...cpLine[1].matchAll(/[-+]?\d+\.?\d*(?:[Ee][+-]?\d+)?/g)].map(x => parseFloat(x[0]));
    if (coords.length === 3) {
        placementPos.set(placeId, { x: coords[0], y: coords[1], z: coords[2] });
    }
}
console.log(`Extracted ${placementPos.size} placement positions\n`);

// Extract IFCBEAM → placement mapping
const beamPlacement = new Map();
for (const m of content.matchAll(/#(\d+)=IFCBEAM\(([^;]+);/g)) {
    const [, eid, bdata] = m;
    for (const ref of bdata.matchAll(/#(\d+)/g)) {
        const placementId = ref[1];
        if (placementPos.has(placementId)) {
            beamPlacement.set(eid, { placementId, ...placementPos.get(placementId) });
            break;
        }
    }
}
console.log(`Beams with positions: ${beamPlacement.size}\n`);

// Extract all properties again (OD, Layer, connected_rebar)
const beamOD = new Map(), beamLayer = new Map(), beamConnectedRebar = new Map();

for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine) continue;

    if (psetLine.includes("'ATK EMBEDMENTS'")) {
        const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
        for (const pm of propMatches) {
            const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
            if (!propLine || !propLine.includes("'HEIGHT'")) continue;
            const od = parseFloat(propLine.match(/IFCLENGTHMEASURE\(([\d.]+)\)/)?.[1]);
            if (od) {
                const beamRefs = [...rel.matchAll(/#(\d+)/g)];
                for (const ref of beamRefs) beamOD.set(ref[1], od);
            }
        }
    }

    if (psetLine.includes("'Avonmouth'")) {
        const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
        for (const pm of propMatches) {
            const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
            if (!propLine || !propLine.includes("'Layer/Set'")) continue;
            const layer = propLine.match(/IFCTEXT\('([^']+)'\)/)?.[1];
            if (layer) {
                const beamRefs = [...rel.matchAll(/#(\d+)/g)];
                for (const ref of beamRefs) beamLayer.set(ref[1], layer);
            }
        }
    }

    if (psetLine.includes("'Bylor'")) {
        const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
        for (const pm of propMatches) {
            const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
            if (!propLine || !propLine.includes("'connected_rebar'")) continue;
            const rebar = propLine.match(/IFCTEXT\('([^']+)'\)/)?.[1];
            if (rebar) {
                const beamRefs = [...rel.matchAll(/#(\d+)/g)];
                for (const ref of beamRefs) beamConnectedRebar.set(ref[1], rebar);
            }
        }
    }
}

// Build coupler list with positions
console.log(`EID\tX\tY\tZ\tOD\tHole\tLayer\tConnected Rebar`);
console.log(`---\t---\t---\t---\t---\t----\t-----\t---------------`);

const couplersByPos = new Map();
for (const [eid, pos] of beamPlacement) {
    const layer = beamLayer.get(eid);
    if (!layer || !/^[VH]S/i.test(layer)) continue;

    const od = beamOD.get(eid) || '?';
    const cr = beamConnectedRebar.get(eid) || 'NONE';
    const holeDia = od !== '?' ? (od + 2) : '?';

    const x = pos.x.toFixed(0);
    const y = pos.y.toFixed(0);
    const z = pos.z.toFixed(0);
    const posKey = `${x},${y}`;  // XY position key (ignoring Z for now)

    if (!couplersByPos.has(posKey)) couplersByPos.set(posKey, []);
    couplersByPos.get(posKey).push({ eid, x, y, z, od, holeDia, layer, cr });

    console.log(`${eid}\t${x}\t${y}\t${z}\t${od}mm\t${holeDia}\t${layer}\t${cr.substring(0, 15)}`);
}

console.log(`\n=== CHECKING FOR SAME-POSITION DUPLICATES ===\n`);
let duplicatePositions = 0;
for (const [posKey, couplers] of couplersByPos) {
    if (couplers.length > 1) {
        duplicatePositions++;
        console.log(`⚠️  Position ${posKey}: ${couplers.length} couplers!`);
        couplers.forEach(c => {
            console.log(`   EID:${c.eid} Z:${c.z} OD:${c.od}mm→${c.holeDia} Layer:${c.layer} Rebar:${c.cr.substring(0, 20)}`);
        });
        console.log();
    }
}

if (duplicatePositions === 0) {
    console.log('✓ No duplicate positions. Each location has max 1 coupler.\n');
} else {
    console.log(`⚠️  Found ${duplicatePositions} locations with multiple couplers!\n`);
}
