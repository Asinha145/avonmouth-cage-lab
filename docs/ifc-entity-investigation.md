# IFC Entity Investigation — Methodology Reference

How to diagnose why a parser is not finding IFCBEAM (or any IFC entity) positions, properties, or relationships. All examples drawn from cage-lab/cage-v2 JS regex parsers.

---

## 1. The Investigation Pattern

Every investigation follows the same four-step structure:

```
1. Count  — how many entities of that type exist in the file?
2. Trace  — follow the data chain for one representative entity
3. Compare — compare what the code expects vs what the file contains
4. Fix    — close the gap between expectation and reality
```

Do not guess. Every assumption must be proven by reading the raw IFC text.

---

## 2. IFC Entity Identification

### Regex to find an entity by type

```javascript
// All IFCBEAM entities
[...ifcText.matchAll(/#(\d+)=IFCBEAM\(/g)]

// A specific entity by ID
ifcText.match(/#21869=([^\n]+)/)

// Generic entity lookup (used throughout parsers)
const getEntity = id => {
    const m = ifcText.match(new RegExp(`#${id}=([^\n]+)`));
    return m ? m[1] : null;
};
```

### Count before you trace

Always count first:

```javascript
const beamCount = [...ifcText.matchAll(/#(\d+)=IFCBEAM\(/g)].length;
console.log(`IFCBEAM count: ${beamCount}`);
```

If the count is 0 — the entity type is absent or named differently in this file.
If the count is non-zero but the parser returns 0 — the chain somewhere is broken.

---

## 3. The IFCBEAM Data Chain

For coupler head extraction, the full chain is:

```
IFCBEAM(guid, #lpRef, ...)
  └─ #lpRef = IFCLOCALPLACEMENT(parentOrDollar, #axId)
                └─ #axId = IFCAXIS2PLACEMENT3D(#cpId, ...)
                             └─ #cpId = IFCCARTESIANPOINT((X, Y, Z))

IFCRELDEFINESBYPROPERTIES(guid, owner, $, $, (#beamId, ...), #psetId)
  └─ #psetId = IFCPROPERTYSET(guid, owner, 'ATK EMBEDMENTS', (#propId, ...))
                 └─ #propId = IFCPROPERTYSINGLEVALUE('HEIGHT', $, IFCLENGTHMEASURE(25.), $)

IFCRELDEFINESBYPROPERTIES(guid, owner, $, $, (#beamId, ...), #psetId)
  └─ #psetId = IFCPROPERTYSET(guid, owner, 'Avonmouth', (#propId, ...))
                 └─ #propId = IFCPROPERTYSINGLEVALUE('Layer/Set', $, IFCTEXT('VS1'), $)
```

### Step-by-step chain trace (Node.js diagnostic script pattern)

```javascript
const beamMatch = ifcText.match(/#(\d+)=IFCBEAM\(([^;]+);/);
const [, bid, bdata] = beamMatch;

// Find placement reference inside IFCBEAM args
for (const ref of bdata.matchAll(/#(\d+)/g)) {
    const e = getEntity(ref[1]);
    if (e?.includes('IFCLOCALPLACEMENT')) {
        console.log(`Placement #${ref[1]}: ${e}`);

        // First arg: $ = absolute, #N = relative (has parent)
        const parentRef = e.match(/IFCLOCALPLACEMENT\(#(\d+)/)?.[1];
        if (parentRef) {
            console.log(`  Parent #${parentRef}: ${getEntity(parentRef)}`);
        }

        // Second arg: IFCAXIS2PLACEMENT3D
        const axRef = e.match(/IFCLOCALPLACEMENT\([^,]*,#(\d+)\)/)?.[1];
        const ax = getEntity(axRef);
        console.log(`  Axis #${axRef}: ${ax}`);

        // First arg of IFCAXIS2PLACEMENT3D: IFCCARTESIANPOINT
        const cpRef = ax?.match(/#(\d+)/)?.[1];
        console.log(`  CartPoint #${cpRef}: ${getEntity(cpRef)}`);
        break;
    }
}
```

---

## 4. IFCLOCALPLACEMENT Patterns

The first argument of `IFCLOCALPLACEMENT` is the parent placement:

| First arg | Meaning | Common usage |
|---|---|---|
| `$` | No parent — absolute global coordinates | Tekla IFC2X3 exports (older/simple cages) |
| `#N` | Relative to parent placement `#N` | Tekla IFC2X3 exports (nested objects, newer exports) |

### Critical finding — Tekla always uses global coords in CartesianPoint

Tekla encodes **absolute BNG global coordinates** directly in each element's own `IFCAXIS2PLACEMENT3D → IFCCARTESIANPOINT`, regardless of whether the `IFCLOCALPLACEMENT` has a parent reference or `$`.

This means you do **not** need to walk the parent chain and compose transforms. The coordinates in the element's own CartesianPoint are already global.

**Cage 1613 (absolute):**
```
#21869=IFCBEAM(...)
#lpRef=IFCLOCALPLACEMENT($, #axId)     ← $ = no parent
#axId=IFCAXIS2PLACEMENT3D(#cpId, ...)
#cpId=IFCCARTESIANPOINT((X_global, Y_global, Z_global))
```

**RF35 (relative):**
```
#3411=IFCBEAM(...)
#3417=IFCLOCALPLACEMENT(#14, #3418)    ← #14 = parent exists
#3418=IFCAXIS2PLACEMENT3D(#3419, ...)
#3419=IFCCARTESIANPOINT((X_global, Y_global, Z_global))  ← still global!
```

### Parser fix for relative placements

**Wrong (only matches absolute):**
```javascript
for (const m of ifcText.matchAll(/#(\d+)=IFCLOCALPLACEMENT\(\$,#(\d+)\)/g)) {
```

**Correct (matches any first arg):**
```javascript
for (const m of ifcText.matchAll(/#(\d+)=IFCLOCALPLACEMENT\([^,)]*,#(\d+)\)/g)) {
```

`[^,)]*` matches `$`, `#14`, `#3417` — anything that isn't a comma or closing paren.

---

## 5. IFCRELDEFINESBYPROPERTIES — Pset Member Extraction

The relationship record format:
```
#N=IFCRELDEFINESBYPROPERTIES('guid', #owner, $, $, (#mem1, #mem2, ...), #psetId);
```

Key fields:
- **5th argument** `(#mem1, #mem2, ...)` — the entities this pset applies to
- **6th argument** `#psetId` — the property set

### Extracting members and pset

```javascript
for (const m of ifcText.matchAll(/#(\d+)=IFCRELDEFINESBYPROPERTIES\([^;]+;/g)) {
    const rel = m[0];

    // Pset ID: last #number before closing );
    const psetId = rel.match(/,#(\d+)\s*\)\s*;/)?.[1];

    // Member list: the parenthesised group containing # refs (not the pset)
    const mm = rel.match(/,\(([^)]*#[^)]*)\),#\d+\)/);
    if (!mm) continue;  // no member list found
    for (const b of mm[1].matchAll(/#(\d+)/g)) {
        // b[1] = member entity ID
    }
}
```

### Common failure: member regex not matching

If `mm` is null, the member list pattern didn't match. Causes:
- The member list has no `#` refs (empty or all `$`)
- The regex is too specific (e.g. looking for 4 `$` arguments before the members)

Always print the raw `rel` string to inspect when the match fails.

### Property value extraction patterns

| Property type | IFC encoding | Regex |
|---|---|---|
| Length (mm) | `IFCLENGTHMEASURE(25.)` | `/IFCLENGTHMEASURE\(([\d.]+)\)/` |
| Text / string | `IFCTEXT('VS1')` | `/IFCTEXT\('([^']+)'\)/` |
| Label | `IFCLABEL('AG25')` | `/IFCLABEL\('([^']+)'\)/` |
| Mass (kg) | `IFCMASSMEASURE(1.76)` | `/IFCMASSMEASURE\(([\d.]+)\)/` |
| Boolean | `IFCBOOLEAN(.T.)` | `/IFCBOOLEAN\(\.([TF])\.\)/` |

---

## 6. Diagnosing "Zero Results" — Checklist

When a parser returns 0 entities that should be present:

### Step 1 — Count the raw entities
```javascript
console.log([...ifcText.matchAll(/#(\d+)=IFCBEAM\(/g)].length);
// If 0 → entity type absent or differently named
// If >0 → chain is broken, continue
```

### Step 2 — Check the placement pattern
```javascript
const lpPatterns = new Map();
for (const m of ifcText.matchAll(/#(\d+)=IFCLOCALPLACEMENT\(([^,)]+)/g)) {
    const firstArg = m[2].trim();
    lpPatterns.set(firstArg, (lpPatterns.get(firstArg) || 0) + 1);
}
console.log('IFCLOCALPLACEMENT first-arg patterns:', Object.fromEntries(lpPatterns));
```

If no `$` entries — all placements are relative. The parser must handle `[^,)]*` not just `\$`.

### Step 3 — Check the pset names
```javascript
for (const m of ifcText.matchAll(/'([^']+)'/g)) {
    // look for pset names used in your parser
}
// or specifically:
console.log(ifcText.includes("'ATK EMBEDMENTS'"));
console.log(ifcText.includes("'Avonmouth'"));
```

### Step 4 — Check property value types
A property might exist under a different IFC measure type:
```javascript
// Is it IFCLENGTHMEASURE or IFCREAL or bare number?
const sample = getEntity(somePropId);
console.log(sample);  // inspect raw text
```

### Step 5 — Check the Y midpoint filter

The face filter splits F1A vs N1A couplers by Y midpoint:
```javascript
const yVals = beams.map(b => b.yMm);
const yMid = (Math.min(...yVals) + Math.max(...yVals)) / 2;
// If all beams have the same Y → yMid = that Y → filter drops all
```

If the cage has couplers on only one face, or all at the same Y, this filter may incorrectly drop everything.

---

## 7. The `connected_rebar` Trap

`IFCBEAM` entities in Tekla have a `Bylor` pset with a `connected_rebar` property that references a rebar `GlobalId`:

```
Bylor pset → connected_rebar → GlobalId of some IFCREINFORCINGBAR
```

**This is a batch reference, not a positional link.** Tekla links all couplers of the same type/batch to one reference bar, regardless of physical proximity. The referenced bar may be at a completely different X, Z position.

**Never use `connected_rebar` to derive hole position.** Always read the IFCBEAM's own `IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D → IFCCARTESIANPOINT` for position.

---

## 8. Diagnostic Script Template

```javascript
import { readFileSync } from 'fs';
const ifcText = readFileSync('path/to/file.ifc', 'utf8');
const getEntity = id => { const m = ifcText.match(new RegExp(`#${id}=([^\n]+)`)); return m ? m[1] : null; };

// 1. Entity count
const beams = [...ifcText.matchAll(/#(\d+)=IFCBEAM\(/g)];
console.log(`IFCBEAM count: ${beams.length}`);

// 2. Placement pattern survey
const lpPat = new Map();
for (const m of ifcText.matchAll(/#(\d+)=IFCLOCALPLACEMENT\(([^,)]+)/g))
    lpPat.set(m[2].trim(), (lpPat.get(m[2].trim()) || 0) + 1);
console.log('LP patterns:', Object.fromEntries(lpPat));

// 3. Pset presence
console.log("'ATK EMBEDMENTS' present:", ifcText.includes("'ATK EMBEDMENTS'"));
console.log("'Avonmouth' present:", ifcText.includes("'Avonmouth'"));

// 4. Layer breakdown on IFCBEAM entities
// ... (run beamLayer extraction then group by layer)

// 5. Trace one IFCBEAM placement chain manually
const first = beams[0];
// ... (follow #lpRef → IFCLOCALPLACEMENT → IFCAXIS2PLACEMENT3D → IFCCARTESIANPOINT)
```

---

## 9. File Variation by Tekla Export Version

| Behaviour | Observed in |
|---|---|
| `IFCLOCALPLACEMENT($, #axId)` — absolute | Cage 1613 (2HD70719AC1) |
| `IFCLOCALPLACEMENT(#N, #axId)` — relative but coords still global | RF35 C01 |
| Property value type `IFCTEXT` for Layer/Set | All Avonmouth Tekla exports |
| Property value type `IFCLABEL` for Height | Not seen — always `IFCLENGTHMEASURE` |

Always verify the actual value type in the raw IFC before writing a regex for it.
