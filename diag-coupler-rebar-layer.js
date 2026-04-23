const fs = require('fs');

const filePath = process.argv[2] || './test-cages/P7349_C1.ifc';
const content = fs.readFileSync(filePath, 'utf8');

console.log(`\n=== COUPLER → CONNECTED REBAR LAYER CHECK ===\n`);

// Extract all IFCREINFORCINGBAR entities
const rebars = new Map();
for (const m of content.matchAll(/#(\d+)=IFCREINFORCINGBAR\('([^']+)'/g)) {
    rebars.set(m[2], { globalId: m[2], eid: m[1], layer: 'UNKNOWN' });
}
console.log(`Total rebars: ${rebars.size}\n`);

// Extract Avonmouth Layer/Set for rebars
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'Avonmouth'")) continue;

    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'Layer/Set'")) continue;
        const layerMatch = propLine.match(/IFCTEXT\('([^']+)'\)/);
        if (!layerMatch) continue;
        const layer = layerMatch[1];

        // Extract rebar refs from IFCRELDEFINESBYPROPERTIES
        const rebarRefs = [...rel.matchAll(/#(\d+)/g)];
        for (const ref of rebarRefs) {
            const refEid = ref[1];
            const rebarLine = content.match(new RegExp(`^#${refEid}=IFCREINFORCINGBAR\\('([^']+)'`, 'm'));
            if (rebarLine) {
                const rebarGlobalId = rebarLine[1];
                if (rebars.has(rebarGlobalId)) {
                    rebars.get(rebarGlobalId).layer = layer;
                }
            }
        }
    }
}

// Extract all IFCBEAM couplers with their properties
const couplers = new Map();
for (const m of content.matchAll(/#(\d+)=IFCBEAM\('([^']+)'/g)) {
    couplers.set(m[2], { globalId: m[2], eid: m[1], od: '?', layer: 'UNKNOWN', connectedRebar: null });
}
console.log(`Total couplers: ${couplers.size}\n`);

// Extract OD for couplers
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'ATK EMBEDMENTS'")) continue;

    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'HEIGHT'")) continue;
        const od = parseFloat(propLine.match(/IFCLENGTHMEASURE\(([\d.]+)\)/)?.[1]);
        if (od) {
            const couplerRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of couplerRefs) {
                const refEid = ref[1];
                const couplerLine = content.match(new RegExp(`^#${refEid}=IFCBEAM\\('([^']+)'`, 'm'));
                if (couplerLine) {
                    const couplerGlobalId = couplerLine[1];
                    if (couplers.has(couplerGlobalId)) {
                        couplers.get(couplerGlobalId).od = od;
                    }
                }
            }
        }
    }
}

// Extract Layer for couplers
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'Avonmouth'")) continue;

    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'Layer/Set'")) continue;
        const layer = propLine.match(/IFCTEXT\('([^']+)'\)/)?.[1];
        if (layer) {
            const couplerRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of couplerRefs) {
                const refEid = ref[1];
                const couplerLine = content.match(new RegExp(`^#${refEid}=IFCBEAM\\('([^']+)'`, 'm'));
                if (couplerLine) {
                    const couplerGlobalId = couplerLine[1];
                    if (couplers.has(couplerGlobalId)) {
                        couplers.get(couplerGlobalId).layer = layer;
                    }
                }
            }
        }
    }
}

// Extract connected_rebar for couplers
for (const m of content.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\(([^;]+);/g)) {
    const rel = m[0];
    const psetMatch = rel.match(/,#(\d+)\s*\)\s*;/);
    if (!psetMatch) continue;
    const psetId = psetMatch[1];
    const psetLine = content.match(new RegExp(`#${psetId}=IFCPROPERTYSET\\([^;]+;`))?.[0];
    if (!psetLine || !psetLine.includes("'Bylor'")) continue;

    const propMatches = [...psetLine.matchAll(/#(\d+)/g)];
    for (const pm of propMatches) {
        const propLine = content.match(new RegExp(`#${pm[1]}=IFCPROPERTYSINGLEVALUE\\([^;]+;`))?.[0];
        if (!propLine || !propLine.includes("'connected_rebar'")) continue;
        const rebar = propLine.match(/IFCTEXT\('([^']+)'\)/)?.[1];
        if (rebar) {
            const couplerRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of couplerRefs) {
                const refEid = ref[1];
                const couplerLine = content.match(new RegExp(`^#${refEid}=IFCBEAM\\('([^']+)'`, 'm'));
                if (couplerLine) {
                    const couplerGlobalId = couplerLine[1];
                    if (couplers.has(couplerGlobalId)) {
                        couplers.get(couplerGlobalId).connectedRebar = rebar;
                    }
                }
            }
        }
    }
}

// Now display: Coupler → Connected Rebar → Rebar Layer
console.log(`EID\tCoupler Layer\tOD\tHole\tConnected Rebar\t\t\tRebar Layer\tVS?`);
console.log(`---\t-------------\t---\t----\t---------------\t\t\t-----------\t---`);

const vsVsOther = { vs: 0, other: 0 };
for (const [globalId, c] of couplers) {
    if (!c.connectedRebar) continue;
    if (!/^[VH]S/i.test(c.layer)) continue;  // Only show coupler VS/HS

    const rebar = rebars.get(c.connectedRebar);
    const rebarLayer = rebar ? rebar.layer : 'NOT FOUND';
    const isRebarVS = rebar && /^[VH]S/i.test(rebar.layer) ? '✓' : '✗';

    if (rebar && /^[VH]S/i.test(rebar.layer)) {
        vsVsOther.vs++;
    } else {
        vsVsOther.other++;
    }

    console.log(`${c.eid}\t${c.layer}\t\t${c.od}mm\t${c.od + 2}\t${c.connectedRebar.substring(0, 15)}\t...\t${rebarLayer}\t${isRebarVS}`);
}

console.log(`\n=== SUMMARY ===`);
console.log(`Connected to VS/HS rebar: ${vsVsOther.vs}`);
console.log(`Connected to OTHER (mesh/F/N/T/B) rebar: ${vsVsOther.other}`);

if (vsVsOther.other > 0) {
    console.log(`\n⚠️  PROBLEM FOUND: ${vsVsOther.other} couplers are connected to NON-VS/HS rebars!`);
    console.log(`These should NOT generate holes in the formwork plate.\n`);
}
