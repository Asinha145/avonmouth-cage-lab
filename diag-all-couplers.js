const fs = require('fs');

const filePath = process.argv[2] || './test-cages/P7349_C1.ifc';
const content = fs.readFileSync(filePath, 'utf8');

console.log(`\n=== ALL COUPLERS (With & Without connected_rebar) ===\n`);

// Extract all IFCBEAM entities
const beams = new Map();
for (const m of content.matchAll(/#(\d+)=IFCBEAM\('([^']+)'[^;]*#(\d+)/g)) {
    beams.set(m[1], { eid: m[1], globalId: m[2], placementRef: m[3] });
}

// Extract ATK EMBEDMENTS HEIGHT
const beamOD = new Map();
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'ATK EMBEDMENTS'")) continue;
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

// Extract Avonmouth Layer/Set
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

// Extract connected_rebar
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

console.log('=== ALL VS/HS COUPLERS ===\n');
const couplers = [];
for (const [eid, beam] of beams) {
    const layer = beamLayer.get(eid);
    if (!layer || !/^[VH]S/i.test(layer)) continue;

    const od = beamOD.get(eid);
    const cr = beamConnectedRebar.get(eid);
    const holeDia = od ? (od + 2) : '?';

    couplers.push({
        eid, globalId: beam.globalId, layer,
        od: od || '?',
        holeDia,
        connected_rebar: cr || 'NONE',
        hasConnection: cr ? '✓' : '✗'
    });
}

// Sort by hole diameter
couplers.sort((a, b) => {
    const aNum = parseFloat(a.holeDia);
    const bNum = parseFloat(b.holeDia);
    if (isNaN(aNum) || isNaN(bNum)) return 0;
    return bNum - aNum;
});

console.log(`EID\tLayer\tOD\tHole Dia\tHas Connection?\tConnected Rebar`);
console.log(`---\t-----\t---\t--------\t---------------\t----------------`);
couplers.forEach(c => {
    console.log(`${c.eid}\t${c.layer}\t${c.od}mm\t${c.holeDia}\t${c.hasConnection}\t${c.connected_rebar.substring(0, 20)}`);
});

console.log(`\nTotal couplers: ${couplers.length}`);
console.log(`With connected_rebar: ${couplers.filter(c => c.connected_rebar !== 'NONE').length}`);
console.log(`WITHOUT connected_rebar (Bridging): ${couplers.filter(c => c.connected_rebar === 'NONE').length}`);
