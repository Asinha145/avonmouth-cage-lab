const fs = require('fs');

const filePath = process.argv[2] || './test-cages/P7349_C1.ifc';
const content = fs.readFileSync(filePath, 'utf8');

console.log(`\n=== REBAR EXTRACTION CHECK ===\n`);

// Extract all IFCREINFORCINGBAR entities from the IFC file
const ifcRebars = new Map();
for (const m of content.matchAll(/#(\d+)=IFCREINFORCINGBAR\('([^']+)'/g)) {
    ifcRebars.set(m[2], { globalId: m[2], eid: m[1] });
}
console.log(`Total IFCREINFORCINGBAR in IFC: ${ifcRebars.size}\n`);

// Extract Avonmouth Layer/Set for these rebars
const rebarLayers = new Map();
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
            const rebarRefs = [...rel.matchAll(/#(\d+)/g)];
            for (const ref of rebarRefs) {
                const refEid = ref[1];
                const rebarLine = content.match(new RegExp(`^#${refEid}=IFCREINFORCINGBAR\\('([^']+)'`, 'm'));
                if (rebarLine) {
                    const rebarGlobalId = rebarLine[1];
                    rebarLayers.set(rebarGlobalId, layer);
                }
            }
        }
    }
}

console.log(`Rebars with Avonmouth Layer/Set: ${rebarLayers.size}\n`);

// Check for rebars that have layers assigned
let vs_count = 0, other_count = 0;
for (const [gid, layer] of rebarLayers) {
    if (/^[VH]S/i.test(layer)) vs_count++;
    else other_count++;
}

console.log(`VS/HS rebars: ${vs_count}`);
console.log(`Mesh/Face rebars: ${other_count}\n`);

// Now check if the "NOT FOUND" rebars from the couplers actually exist
const notFoundRebars = [
    '2tU7SBw9FGNcWLgxFNP5',
    '2GgDLjh98bIsugJibKnT',
    '1WY9chQKXUCE39hfh71H',
    '2iNZ_vhCpR9dmy0q5ShB',
    '19q1kaMY2W0T8Rwh40nh',
    '1i8C7YPYwdkrrK_YT83W',
    '0iUeoTrAzlRkxRtgRc8y',
    '185h_eSXmQWyXuFAyQu8'
];

console.log(`=== Checking "NOT FOUND" rebars ===\n`);
for (const gid of notFoundRebars) {
    const exists = ifcRebars.has(gid);
    const layer = rebarLayers.get(gid) || 'NO LAYER';
    console.log(`${gid}: ${exists ? '✓ EXISTS' : '✗ NOT IN IFC'} | Layer: ${layer}`);
}

console.log(`\nSummary: Check if these rebars exist in the IFC at all`);
console.log(`If they exist but have NO LAYER, they may not be extracted by the parser`);
