import fs from 'fs';
import { IFCParser } from './js/ifc-parser.js';

const filePath = process.argv[2] || './test-cages/P7349_C1.ifc';
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
const parser = new IFCParser();
const bars = await parser.parseFile(content);

console.log(`\n=== Coupler Analysis: ${filePath} ===\n`);
console.log(`Total bars: ${bars.length}`);
console.log(`Total couplers in map: ${parser.couplerMap.size}\n`);

// Group bars by layer
const barsByLayer = new Map();
bars.forEach(b => {
    const layer = b.Avonmouth_Layer_Set || 'Unknown';
    if (!barsByLayer.has(layer)) barsByLayer.set(layer, []);
    barsByLayer.get(layer).push(b);
});

console.log('=== VS/HS BARS (Coupler/Strut Rebars) ===');
for (const [layer, barList] of barsByLayer) {
    if (!/^[VH]S/i.test(layer)) continue;
    console.log(`\n${layer}: ${barList.length} bars`);
    barList.slice(0, 3).forEach(b => {
        console.log(`  - GlobalId: ${b.GlobalId}`);
        console.log(`    Position: (${b.Start_X?.toFixed(0)}, ${b.Start_Y?.toFixed(0)}, ${b.Start_Z?.toFixed(0)}) → (${b.End_X?.toFixed(0)}, ${b.End_Y?.toFixed(0)}, ${b.End_Z?.toFixed(0)})`);
        console.log(`    Size: ${b.Size || '?'} | Length: ${b.Length?.toFixed(0)} | Weight: ${b.Weight || '?'}`);
        console.log(`    Source_Global_ID: ${b.Source_Global_ID || 'none'}`);
        console.log(`    Rebar_ID: ${b.Rebar_ID || 'none'}`);
    });
    if (barList.length > 3) console.log(`  ... and ${barList.length - 3} more`);
}

console.log('\n=== COUPLERS (IFCBEAMs) ===');
const couplersBySize = new Map();
parser.couplerMap.forEach((c, eid) => {
    if (!couplersBySize.has(c.globalId)) {
        couplersBySize.set(c.globalId, c);
    }
});

const couplerArray = Array.from(couplersBySize.values());
console.log(`Total unique couplers: ${couplerArray.length}\n`);

// Group by layer
const couplersByLayer = new Map();
couplerArray.forEach(c => {
    const layer = c.layer || 'Unknown';
    if (!couplersByLayer.has(layer)) couplersByLayer.set(layer, []);
    couplersByLayer.get(layer).push(c);
});

for (const [layer, clist] of couplersByLayer) {
    if (!/^[VH]S/i.test(layer)) continue;
    console.log(`${layer}: ${clist.length} couplers`);
    clist.slice(0, 2).forEach(c => {
        console.log(`  - EID: ${c.eid}, GlobalId: ${c.globalId}`);
        console.log(`    Layer: ${c.layer}, connectedRebar: ${c.connectedRebar || 'NONE'}`);
    });
    if (clist.length > 2) console.log(`  ... and ${clist.length - 2} more`);
}

// Check for duplicate sizes at same position
console.log('\n=== CHECKING FOR DUPLICATE CONNECTED_REBAR ===');
const rebarConnections = new Map();
couplerArray.forEach(c => {
    if (!c.connectedRebar) return;
    if (!rebarConnections.has(c.connectedRebar)) {
        rebarConnections.set(c.connectedRebar, []);
    }
    rebarConnections.get(c.connectedRebar).push(c);
});

let duplicateCount = 0;
for (const [rebarId, couplers] of rebarConnections) {
    if (couplers.length > 1) {
        duplicateCount++;
        console.log(`\nRebar ${rebarId}: ${couplers.length} couplers connected!`);
        couplers.forEach(c => {
            console.log(`  - EID: ${c.eid}, Layer: ${c.layer}, connectedRebar: ${c.connectedRebar}`);
        });
    }
}
if (duplicateCount === 0) {
    console.log('No rebars have multiple couplers connected. ✓');
}

console.log('\nDone.');
