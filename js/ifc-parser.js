/**
 * IFC Rebar Analyzer – Parser
 *
 * Position resolution:
 *   1. Walk IFCLOCALPLACEMENT chain → absolute origin P + rotation matrix R.
 *   2. Build R from Axis (local Z) + RefDirection (local X) via Gram-Schmidt.
 *   3. Get per-bar offset from MappedItem → CartesianTransformationOperator3D.
 *   4. Start = P + R·O,  BarDir = R[:,0],  End = Start + BarDir × Length.
 *
 * Cage-axis detection: "unique perpendicular positions" ratio.
 *   For each global axis (X / Y / Z):
 *     • Split Avonmouth mesh bars into: parallel (|Dir·axis| ≥ 0.5) and
 *       perpendicular (|Dir·axis| < 0.5) groups.
 *     • Count how many unique positions each group has in the plane
 *       perpendicular to that axis (rounded to nearest 100 mm grid).
 *     • ratio = uniq_parallel / max(uniq_perp, 1)
 *   The axis with the HIGHEST ratio is the cage's long axis.
 *
 *   Why this works:
 *     - Vertical (longitudinal) bars are spaced around the cage perimeter
 *       → many unique positions in the perpendicular plane.
 *     - Horizontal (ring/spacer) bars all start from a fixed transverse
 *       position → very few unique positions in the perpendicular plane.
 *
 *   This beats a pure "weighted span" approach, which can be fooled when
 *   horizontal ring bars are longer than the vertical bars (so their total
 *   span exceeds the vertical bars' total span), causing weighted span to
 *   mis-identify the ring direction as the cage axis.
 *
 * ATK Layer Name fallback (stats only, classification unchanged):
 *   Bars that have an Avonmouth "Layer/Set" always use that for classification.
 *   Bars with NO Avonmouth layer (av_layer = null) and an ATK "Layer Name"
 *   matching the F/N naming convention (F6 → F5A, N6 → N5A, …) get an
 *   inferred Effective_Mesh_Layer for the horizontal-count and height stats.
 *   This is intentionally ONLY for av_layer=null bars so that bars correctly
 *   assigned to VS1, HS1, PRL, etc. are never re-routed into mesh stats.
 *
 * Rejection conditions (stored on the parser, read by main.js):
 *   • unknownCount  > 0  – bars with no Avonmouth layer at all
 *   • duplicateCount > 0 – same GlobalId appears more than once
 *   Either condition → isRejected = true → "C01 Rejected" banner shown.
 *
 * Stagger clustering (countUniqueHorizPositions):
 *   Horizontal bars (bars parallel to cage axis) are often split into 2-3 IFC
 *   entities at the same structural position due to staggered lapping.
 *   e.g. Bar A starts at Z=28305 and Bar B at Z=28372 (67mm apart) — they are
 *   the SAME structural ring position, just physically offset to pass each other.
 *
 *   Algorithm: Average-linkage hierarchical clustering on the 1D projection of
 *   each bar's start point along the perpendicular-to-cage axis (e.g. Z when
 *   cage axis = X). A threshold of 100mm is used.
 *
 *   Why AVERAGE linkage (not single / complete)?
 *   - Single linkage chains: A→B (80mm) → B→C (90mm) merges A,B,C even if A–C=170mm.
 *   - Complete linkage splits: requires ALL pairs ≤ T, so rejects valid 3-bar stagger.
 *   - Average linkage measures the mean of all pairwise distances between clusters,
 *     correctly splitting the lapping zone (where two structural positions interleave)
 *     while merging genuine 2–3 segment stagger groups (all gaps 5–98mm).
 *
 *   Validated on 2HD70731AC1.ifc: 47 F1A horizontal IFC entities → 16 clusters ✓
 */
class IFCParser {
    constructor() {
        this.entities        = new Map();
        this.propertiesDict  = new Map();
        this.entityToPsets   = new Map();
        this.psetToProps     = new Map();
        this._ptCache        = new Map();
        this._dirCache       = new Map();
        // Set after parseFile():
        this.cageAxis        = [0, 0, 1];
        this.cageAxisName    = 'Z';
        this.unknownCount    = 0;
        this.duplicateCount  = 0;
        this.isRejected      = false;
    }

    async parseFile(content) {
        const lines = content.replace(/\r/g, '').split('\n');
        if (!lines.length) throw new Error('Empty file.');
        console.log(`Lines: ${lines.length}`);

        this.buildEntityLookup(lines);
        this.buildPropertiesDict(lines);
        this.buildRelationshipIndex(lines);

        const bars = this.extractReinforcementBars(lines);
        this.resolveAllPositions(bars);
        this.calculateWeights(bars);
        this.classifyBars(bars);
        this.detectCageAxis(bars);
        this.tagOrientation(bars);
        this.tagEffectiveMeshLayer(bars);
        this.reclassifyMeshCouplers(bars); // ← CPLR bars: inferred mesh layer → retype as Mesh
        this.tagStaggerClusters(bars);   // ← average-linkage stagger grouping
        this.parseShapeCodes(bars);      // ← split Shape_Code into base + coupler suffix
        this.detectBarShapes(bars);
        this.computeRejectionStatus(bars);
        this.couplerMap = this.extractCouplerHeads(lines);

        console.log(`Cage axis: ${this.cageAxisName} | Rejected: ${this.isRejected} (unknown=${this.unknownCount}, dups=${this.duplicateCount})`);
        console.log(`Done – ${bars.length} bars, ${this.couplerMap.size} coupler heads`);
        return bars;
    }

    // ── Entity / property / relationship builders ──────────────────────

    buildEntityLookup(lines) {
        const re = /^#(\d+)\s*=\s*(.+)$/;
        lines.forEach(l => {
            const m = l.match(re);
            if (m) this.entities.set(m[1], m[2]);
        });
        console.log(`Entities: ${this.entities.size}`);
    }

    buildPropertiesDict(lines) {
        const re = /^#(\d+)\s*=\s*IFCPROPERTYSINGLEVALUE\('([^']+)',.*?(?:IFCTEXT|IFCLABEL|IFCMASSMEASURE|IFCLENGTHMEASURE|IFCINTEGER|IFCIDENTIFIER)\('?([^')\s]+)'?\)/;
        lines.forEach(l => {
            const m = l.match(re);
            if (m) this.propertiesDict.set(m[1], { name: m[2], value: m[3] });
        });
        console.log(`Properties: ${this.propertiesDict.size}`);
    }

    buildRelationshipIndex(lines) {
        lines.forEach(l => {
            const relM = l.match(/IFCRELDEFINESBYPROPERTIES\('[^']+',\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*\(([^)]+)\),\s*#(\d+)\)/);
            if (relM) {
                const psetId = relM[2];
                (relM[1].match(/#(\d+)/g) || []).forEach(e => {
                    const id = e.slice(1);
                    if (!this.entityToPsets.has(id)) this.entityToPsets.set(id, []);
                    this.entityToPsets.get(id).push(psetId);
                });
            }
            const psetM = l.match(/^#(\d+)\s*=\s*IFCPROPERTYSET\([^,]+,\s*[^,]+,\s*'([^']+)',\s*[^,]+,\s*\(([^)]+)\)/);
            if (psetM) {
                const ids = (psetM[3].match(/#(\d+)/g) || []).map(p => p.slice(1));
                this.psetToProps.set(psetM[1], { name: psetM[2], props: ids });
            }
        });
        console.log(`Entity→Pset: ${this.entityToPsets.size}`);
    }

    // ── Bar extraction ─────────────────────────────────────────────────

    extractReinforcementBars(lines) {
        const bars = [];
        const re   = /#(\d+)\s*=\s*IFCREINFORCINGBAR\('([^']+)'.*?#(\d+),\s*#(\d+),\s*'?(ID[^',)]+)?'?.*?,\s*([\d.]+),/;
        lines.forEach(line => {
            if (!line.includes('IFCREINFORCINGBAR')) return;
            const m = line.match(re);
            if (!m) return;
            const nameM = line.match(/,'([^']+)',/);
            const bar = {
                _entityId         : m[1],
                _placementId      : m[3],
                _shapeId          : m[4],
                Entity_ID         : `#${m[1]}`,
                GlobalId          : m[2],
                Name              : nameM ? nameM[1] : '',
                ObjectId          : m[5] || 'Unknown',
                NominalDiameter_mm: parseFloat(m[6]) || 0,
                Source_Global_ID  : null,
                Rebar_ID          : null,
                Size              : null,
                Weight            : null,
                Total_Weight      : null,
                Length            : null,
                Avonmouth_ID      : null,
                Avonmouth_Layer_Set  : null,  // from Avonmouth pset
                ATK_Layer_Name       : null,  // from ATK Rebar pset
                Effective_Mesh_Layer : null,  // computed: Avonmouth mesh OR ATK inferred (av=null only)
                Shape_Code           : null,  // raw e.g. "00GM", "12LGF"
                Shape_Code_Base      : null,  // numeric/letter part e.g. "00", "12L"
                Coupler_Suffix       : null,  // e.g. "GM", "GF", "GMB", "GFB"
                Coupler_Type         : null,  // e.g. "Male", "Female", "Male Bridging", "Female Bridging"
                Rebar_Mark           : null,  // e.g. "503"
                Full_Rebar_Mark      : null,  // e.g. "S/503"
                Bar_Type          : null,
                Bar_Shape         : null,
                Bar_Shape_Code    : null,  // numeric BS 8666 code e.g. '00', '21'
                Orientation       : null,
                Calculated_Weight : null,
                Start_X: null, Start_Y: null, Start_Z: null,
                End_X  : null, End_Y  : null, End_Z  : null,
                Dir_X  : null, Dir_Y  : null, Dir_Z  : null,
                // Bend direction (lZ column of rotation matrix) for BS 8666 shaped rendering
                Bend_X : null, Bend_Y : null, Bend_Z : null,
                // BS 8666 shape dimensions from ATK Rebar pset
                Dim_A  : null, Dim_B  : null, Dim_C  : null,
                Stagger_Cluster_ID: null,   // e.g. "F1A_H03"  (set after cage-axis detection)
                Formula_Weight    : null,   // geometry-based: π×r²×L×7777 — always computed, used for UDL only
            };
            this.extractProperties(m[1], bar);
            bars.push(bar);
        });
        console.log(`Bars extracted: ${bars.length}`);
        return bars;
    }

    extractProperties(entityId, bar) {
        const psets = this.entityToPsets.get(entityId);
        if (!psets) return;
        psets.forEach(psetId => {
            const pi = this.psetToProps.get(psetId);
            if (!pi) return;
            const psetName = pi.name;
            const isATK         = psetName === 'ATK Rebar';
            const isICOS        = psetName === 'ICOS Rebar';
            const isINGEROP     = /^INGEROP\s+REBAR$/i.test(psetName);
            // isVendorRebar: psets that contain authoritative per-bar weight/size/layer data.
            // Add new vendor prefixes here — no other method needs to change.
            const isVendorRebar = isATK || isICOS || isINGEROP;
            // Tekla Reinforcement - General: INGEROP files store the layer name as 'Name'
            // (e.g. 'FF1', 'NF2') — same format as ICOS, handled by existing tagEffectiveMeshLayer regex.
            const isTeklaGeneral = /tekla reinforcement.*general/i.test(psetName);
            pi.props.forEach(propId => {
                const p = this.propertiesDict.get(propId);
                if (!p) return;
                const { name: n, value: v } = p;
                const nl = n.toLowerCase();
                if      (nl === 'source_global_id') bar.Source_Global_ID    = v;
                else if (nl === 'rebar_id')          bar.Rebar_ID            = v;
                // ── Weight: only from vendor rebar psets (ATK/ICOS/INGEROP) — per-bar value.
                // Case-insensitive: ATK/ICOS use 'Weight', INGEROP uses 'WEIGHT'.
                // 'WEIGHT_TOTAL' / 'WEIGHT_TOTAL_IN_GROUP' don't match nl==='weight' (exact equality).
                else if (nl === 'weight' && isVendorRebar) {
                    const w = parseFloat(v);
                    if (w > 0) bar.Weight = w;
                }
                // ── Length / Size: same concept across vendors, different casing.
                // ATK/ICOS: 'Length', 'Size'  |  INGEROP: 'LENGTH', 'SIZE'
                else if (nl === 'length')  bar.Length = parseFloat(v) || null;
                else if (n === 'ID'        && psetName === 'Avonmouth') bar.Avonmouth_ID        = v;
                else if (n === 'Layer/Set' && psetName === 'Avonmouth') bar.Avonmouth_Layer_Set = v || null;
                // ── Layer name — vendor priority: ATK explicit > ICOS/INGEROP Name > IFC Name fallback.
                // ATK Rebar: 'Layer Name'  |  ICOS Rebar: 'Name'  |  INGEROP: 'Name' in Tekla General pset.
                else if (nl === 'layer name' && isATK) bar.ATK_Layer_Name = v;
                else if (nl === 'name' && (isICOS || isTeklaGeneral) && !bar.ATK_Layer_Name) bar.ATK_Layer_Name = v;
                // ── Size: case-insensitive to cover INGEROP 'SIZE'.
                else if (nl === 'size')          { bar.Size = parseFloat(v) || null; }
                // ── Shape code: ATK='Shape Code', Tekla/INGEROP='Shape' or 'SHAPE'.
                else if (/^shape(?:\s+code)?$/i.test(n))  { bar.Shape_Code = v; }
                // ── Bar marks: ATK='Rebar Mark'/'Full Rebar Mark', INGEROP='SERIAL_NUMBER'/'BAR_MARK'.
                else if (/^(rebar\s+mark|serial_number)$/i.test(n))                              { bar.Rebar_Mark = v; }
                else if (/^(full\s+rebar\s+mark|bar_mark|group\s+position\s+number)$/i.test(n)) { bar.Full_Rebar_Mark = v; }
                // ── Bending dims: ATK='Dim A', INGEROP='DIM_A' (underscore vs space, any case).
                else if (/^dim[_\s]a$/i.test(n)) { bar.Dim_A = parseFloat(v) || null; }
                else if (/^dim[_\s]b$/i.test(n)) { bar.Dim_B = parseFloat(v) || null; }
                else if (/^dim[_\s]c$/i.test(n)) { bar.Dim_C = parseFloat(v) || null; }
                // ── ATK Couplers Parts layer name (IFCBEAM — same format as ATK_Layer_Name on rebars)
                else if (nl === 'layer name' && psetName === 'ATK Couplers Parts' && !bar.ATK_Layer_Name) {
                    bar.ATK_Layer_Name = v;
                }
            });
        });
        // Normalise blank Avonmouth layer to null
        if (bar.Avonmouth_Layer_Set === '') bar.Avonmouth_Layer_Set = null;
        // Last-resort layer name: use the IFCREINFORCINGBAR Name field if no vendor pset supplied one.
        if (!bar.ATK_Layer_Name && bar.Name) bar.ATK_Layer_Name = bar.Name;
    }

    // ── IFCBEAM coupler head extraction ───────────────────────────────
    /**
     * Extracts IFCBEAM coupler head entities and their Avonmouth layer + weight.
     * Returns Map<expressID (int), { eid, layer, atkLayerName, weight }>
     *
     * IFCBEAM entities carry the same Avonmouth pset as their rebar:
     *   Avonmouth.Layer/Set → e.g. 'F1A'
     *   ATK Couplers Parts.Coupler weight → e.g. 1.76 (kg)
     */
    extractCouplerHeads(lines) {
        const couplerMap = new Map();
        lines.forEach(line => {
            if (!line.includes('IFCBEAM')) return;
            const m = line.match(/^#(\d+)\s*=\s*IFCBEAM\('([^']+)'/);
            if (!m) return;
            const obj = {
                _entityId          : m[1],
                GlobalId           : m[2],
                Name               : '',
                Avonmouth_Layer_Set: null,
                ATK_Layer_Name     : null,

            };
            this.extractProperties(m[1], obj);
            couplerMap.set(parseInt(m[1], 10), {
                eid          : m[1],
                globalId     : m[2],
                layer        : obj.Avonmouth_Layer_Set,
                atkLayerName : obj.ATK_Layer_Name,

            });
        });
        return couplerMap;
    }

    // ── Position resolution ────────────────────────────────────────────

    resolveAllPositions(bars) {
        let ok = 0;
        bars.forEach(bar => {
            try {
                const r = this._resolvePosition(bar._placementId, bar._shapeId, bar.Length || 0);
                if (r) {
                    [bar.Start_X, bar.Start_Y, bar.Start_Z] = r.start;
                    [bar.End_X,   bar.End_Y,   bar.End_Z  ] = r.end;
                    [bar.Dir_X,   bar.Dir_Y,   bar.Dir_Z  ] = r.dir;
                    // BendDir = lZ column of R (3rd column) — perpendicular to bar in bend plane
                    // Used by the 3D viewer for BS 8666 shaped bar rendering
                    if (r.bend) [bar.Bend_X, bar.Bend_Y, bar.Bend_Z] = r.bend;
                    ok++;
                }
            } catch (_) {}
        });
        console.log(`Positions: ${ok}/${bars.length}`);
    }

    _resolvePosition(placementId, shapeId, length) {
        const pl = this._walkPlacement(placementId, 0);
        if (!pl) return null;
        const O = this._getMappingOffset(shapeId);
        if (!O) return null;
        const { P, R } = pl;
        const start = [
            P[0] + R[0][0]*O[0] + R[0][1]*O[1] + R[0][2]*O[2],
            P[1] + R[1][0]*O[0] + R[1][1]*O[1] + R[1][2]*O[2],
            P[2] + R[2][0]*O[0] + R[2][1]*O[1] + R[2][2]*O[2],
        ];
        const dir  = [R[0][0], R[1][0], R[2][0]];  // local X column
        const bend = [R[0][2], R[1][2], R[2][2]];  // local Z column — bend plane direction
        const end  = [start[0]+dir[0]*length, start[1]+dir[1]*length, start[2]+dir[2]*length];
        return { start, end, dir, bend };
    }

    _walkPlacement(placementId, depth) {
        if (depth > 8) return null;
        const raw = this.entities.get(placementId);
        if (!raw) return null;
        const m = raw.match(/IFCLOCALPLACEMENT\(([^,]+),\s*#(\d+)\)/);
        if (!m) return null;
        const parentRef = m[1].trim(), axis2Id = m[2];
        const local = this._parseAxis2(axis2Id);
        if (!local) return null;
        if (parentRef !== '$') {
            const parent = this._walkPlacement(parentRef.replace('#',''), depth+1);
            if (parent) {
                const rP = parent.R, lP = local.P;
                const cP = [
                    parent.P[0] + rP[0][0]*lP[0] + rP[0][1]*lP[1] + rP[0][2]*lP[2],
                    parent.P[1] + rP[1][0]*lP[0] + rP[1][1]*lP[1] + rP[1][2]*lP[2],
                    parent.P[2] + rP[2][0]*lP[0] + rP[2][1]*lP[1] + rP[2][2]*lP[2],
                ];
                return { P: cP, R: this._mulR(parent.R, local.R) };
            }
        }
        return local;
    }

    _parseAxis2(id) {
        const raw = this.entities.get(id);
        if (!raw) return null;
        const m = raw.match(/IFCAXIS2PLACEMENT3D\(\s*#(\d+),\s*(#\d+|\$),\s*(#\d+|\$)\s*\)/);
        if (!m) return null;
        const P   = this._getPoint(m[1]) || [0,0,0];
        const lZ  = m[2] !== '$' ? (this._getDir(m[2].slice(1)) || [0,0,1]) : [0,0,1];
        const lXa = m[3] !== '$' ? (this._getDir(m[3].slice(1)) || [1,0,0]) : [1,0,0];
        const dot = lXa[0]*lZ[0]+lXa[1]*lZ[1]+lXa[2]*lZ[2];
        const lX  = this._norm([lXa[0]-dot*lZ[0], lXa[1]-dot*lZ[1], lXa[2]-dot*lZ[2]]);
        const nZ  = this._norm(lZ);
        const lY  = [nZ[1]*lX[2]-nZ[2]*lX[1], nZ[2]*lX[0]-nZ[0]*lX[2], nZ[0]*lX[1]-nZ[1]*lX[0]];
        return { P, R: [[lX[0],lY[0],nZ[0]],[lX[1],lY[1],nZ[1]],[lX[2],lY[2],nZ[2]]] };
    }

    _mulR(A, B) {
        const C = [[0,0,0],[0,0,0],[0,0,0]];
        for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) C[i][j]+=A[i][k]*B[k][j];
        return C;
    }

    _norm(v) {
        const l = Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
        return l < 1e-12 ? [1,0,0] : [v[0]/l, v[1]/l, v[2]/l];
    }

    _getMappingOffset(shapeId) {
        const shapeDef = this.entities.get(shapeId);
        if (!shapeDef) return null;
        const repM = shapeDef.match(/\((#\d+(?:,#\d+)*)\)/);
        if (!repM) return null;
        const firstRepId = repM[1].match(/#(\d+)/)[1];
        const shapeRep = this.entities.get(firstRepId);
        if (!shapeRep || !shapeRep.includes('MappedRepresentation')) return null;
        const itemsM = shapeRep.match(/\((#\d+(?:,#\d+)*)\)\)?[;)]/);
        if (!itemsM) return null;
        const miId = itemsM[1].match(/#(\d+)/)[1];
        const mi = this.entities.get(miId);
        if (!mi) return null;
        const miM = mi.match(/IFCMAPPEDITEM\(#\d+,#(\d+)\)/);
        if (!miM) return null;
        const xform = this.entities.get(miM[1]);
        if (!xform) return null;
        const xfM = xform.match(/IFCCARTESIANTRANSFORMATIONOPERATOR3D[^(]*\([^,]*,[^,]*,\s*(#\d+|\$)/);
        if (!xfM || xfM[1] === '$') return [0, 0, 0];
        return this._getPoint(xfM[1].slice(1)) || [0, 0, 0];
    }

    _getPoint(id) {
        if (this._ptCache.has(id)) return this._ptCache.get(id);
        const raw = this.entities.get(id);
        if (!raw) return null;
        const m = raw.match(/IFCCARTESIANPOINT\(\(([^)]+)\)\)/);
        if (!m) return null;
        const pt = m[1].split(',').map(Number);
        this._ptCache.set(id, pt);
        return pt;
    }

    _getDir(id) {
        if (this._dirCache.has(id)) return this._dirCache.get(id);
        const raw = this.entities.get(id);
        if (!raw) return null;
        const m = raw.match(/IFCDIRECTION\(\(([^)]+)\)\)/);
        if (!m) return null;
        const d = m[1].split(',').map(Number);
        this._dirCache.set(id, d);
        return d;
    }

    // ── Cage-axis detection: unique perpendicular positions ratio ──────
    /**
     * For each candidate axis (X, Y, Z):
     *   Split Avonmouth mesh bars into parallel (|Dir·axis| ≥ 0.5) and
     *   perpendicular (|Dir·axis| < 0.5) groups.
     *
     *   Count unique positions in the perpendicular plane for each group,
     *   snapped to a 100 mm grid to absorb floating-point noise.
     *
     *   ratio = uniq_parallel / max(uniq_perpendicular, 1)
     *
     * Correct cage axis = axis with MAXIMUM ratio:
     *   - Longitudinal (vertical) bars fan out around the cage perimeter
     *     → HIGH unique positions when parallel to cage axis.
     *   - Ring (horizontal) bars all sit at the same transverse offsets
     *     → LOW unique positions when perpendicular to cage axis.
     *
     * This method handles cages in any global orientation, including
     * cages laid on their side where the long ring bars would incorrectly
     * win a pure "weighted total span" contest.
     */
    detectCageAxis(bars) {
        const meshBars = bars.filter(b => b.Bar_Type === 'Mesh' && b.Dir_X !== null);
        if (!meshBars.length) return;

        const axes     = [[1,0,0], [0,1,0], [0,0,1]];
        const axNames  = ['X', 'Y', 'Z'];
        const RND      = 100; // mm grid for de-duplication

        // Unique positions in the two axes perpendicular to candidate axis `ai`
        const uniqPerpPos = (blist, ai) => {
            const oi = [0,1,2].filter(j => j !== ai);
            const coords = new Set();
            blist.forEach(b => {
                const p = [b.Start_X, b.Start_Y, b.Start_Z];
                coords.add(`${Math.round(p[oi[0]]/RND)},${Math.round(p[oi[1]]/RND)}`);
            });
            return coords.size;
        };

        let bestRatio = -1;
        axes.forEach((ax, i) => {
            const par  = meshBars.filter(b => Math.abs(b.Dir_X*ax[0]+b.Dir_Y*ax[1]+b.Dir_Z*ax[2]) >= 0.5);
            const perp = meshBars.filter(b => Math.abs(b.Dir_X*ax[0]+b.Dir_Y*ax[1]+b.Dir_Z*ax[2]) <  0.5);
            const ratio = uniqPerpPos(par, i) / Math.max(uniqPerpPos(perp, i), 1);
            if (ratio > bestRatio) {
                bestRatio = ratio;
                this.cageAxis     = ax;
                this.cageAxisName = axNames[i];
            }
        });
        console.log(`Cage axis: ${this.cageAxisName} (perp-pos ratio=${bestRatio.toFixed(2)})`);
    }

    // ── Orientation tagging (global-Z rule) ───────────────────────────
    /**
     * A bar is HORIZONTAL if |Dir_Z| < 0.5 (it does not travel up/down).
     *
     * Why NOT use the cage-axis dot product:
     *   - For an upright cage (axis=Z), both rules agree: ring bars travel in X/Y.
     *   - For a sideways cage (axis=X), the structural "horizontal" bars run along
     *     the cage length (dx=1) not around it. These are parallel to the cage axis,
     *     so the old dot-product rule labelled them 'Vertical' — but they are
     *     physically horizontal (dz=0) and are what the engineer counts as horizontal.
     *
     * The global-Z rule is cage-orientation-agnostic and matches engineering intent.
     */
    tagOrientation(bars) {
        bars.forEach(bar => {
            // ATK/ICOS parity rule takes priority — works even without resolved positions.
            // (odd = horizontal, even = vertical)
            const atkOri = this._atkOrientation(bar.ATK_Layer_Name);
            if (atkOri) {
                bar.Orientation = atkOri;
                return;
            }
            // No positions resolved — cannot determine orientation geometrically.
            if (bar.Dir_X === null) { bar.Orientation = 'Unknown'; return; }
            // Fallback: global-Z heuristic — bar is horizontal if it doesn't travel up/down
            bar.Orientation = Math.abs(bar.Dir_Z) < 0.5 ? 'Horizontal' : 'Vertical';
        });
    }

    // ── ATK/ICOS orientation helper ───────────────────────────────────────
    /**
     * Returns 'Horizontal', 'Vertical', or null based on the ATK/ICOS layer name.
     *
     * ATK Rebar:  F1, F3, N1, N3 (odd)  = Horizontal
     *             F2, F4, N2, N4 (even) = Vertical
     * ICOS Rebar: FF1, FF3, NF1, NF3 (odd)  = Horizontal
     *             FF2, FF4, NF2, NF4 (even) = Vertical
     *
     * This is the authoritative orientation for mesh bars and takes precedence
     * over the global-Z heuristic for bars whose ATK/ICOS layer is known.
     */
    _atkOrientation(atkLayer) {
        if (!atkLayer) return null;
        const mATK  = atkLayer.match(/^([FN])(\d+)/i);
        if (mATK)  return parseInt(mATK[2], 10)  % 2 === 1 ? 'Horizontal' : 'Vertical';
        const mICOS = atkLayer.match(/^(FF|NF)(\d+)/i);
        if (mICOS) return parseInt(mICOS[2], 10) % 2 === 1 ? 'Horizontal' : 'Vertical';
        return null;
    }

    // ── Stagger clustering: Z-band-aware average-linkage ─────────────────
    /**
     * Groups horizontal bar IFC entities that represent the SAME structural
     * bar position into a single Stagger_Cluster_ID.
     *
     * KEY FIX: bars must first be separated into Z-bands (500 mm tolerance)
     * before clustering. Without this, bars in the bottom mesh layer and bars
     * in the top mesh layer (e.g. splice zone at different heights) get pooled
     * together and produce inflated cluster counts.
     *
     * Within each Z-band, the custom 2D distance metric applies:
     *   dPerp = perpendicular offset (along cage axis, i.e. the "spacing" direction)
     *   dZ    = height difference
     *
     *   distance(i,j) = dZ(i,j)  if dPerp(i,j) ≥ 20 mm  (lateral offset = stagger)
     *                 = +∞       if dPerp(i,j) <  20 mm  (same track → never merge)
     *
     * Average-linkage hierarchical clustering stops when avg inter-cluster dZ > 100 mm.
     */
    tagStaggerClusters(bars) {
        const DX_MIN  = 20;    // mm — minimum perpendicular offset to be a stagger candidate
        const DZ_MAX  = 100;   // mm — maximum Z difference to merge within a stagger
        const Z_BAND  = 500;   // mm — Z tolerance to define a "height zone"

        // Gather horizontal mesh bars per Effective_Mesh_Layer
        const layerBars = {};
        bars.forEach(b => {
            const layer = b.Effective_Mesh_Layer;
            if (!layer) return;
            // Use ATK/ICOS orientation if available, else global-Z heuristic
            const atkOri = this._atkOrientation(b.ATK_Layer_Name);
            const isHoriz = atkOri
                ? atkOri === 'Horizontal'
                : (b.Orientation === 'Horizontal');
            if (!isHoriz) return;
            if (!layerBars[layer]) layerBars[layer] = [];
            layerBars[layer].push(b);
        });

        Object.entries(layerBars).forEach(([layer, hbars]) => {
            if (!hbars.length) return;

            if (hbars.length === 1) {
                hbars[0].Stagger_Cluster_ID = `${layer}_H01`;
                return;
            }

            // ── Step 1: Split into Z-bands (gap-based) ───────────────────
            // A new band starts only when consecutive bar Z values differ by
            // more than Z_BAND mm.  Using a fixed gap (not a running mean)
            // avoids drift when bars are evenly spaced across a long cage.
            const zBands = [];
            const sorted = [...hbars].sort((a, b) => a.Start_Z - b.Start_Z);
            let currentBand = [sorted[0]];
            for (let si = 1; si < sorted.length; si++) {
                const gap = sorted[si].Start_Z - sorted[si - 1].Start_Z;
                if (gap > Z_BAND) {
                    zBands.push({ bars: currentBand });
                    currentBand = [sorted[si]];
                } else {
                    currentBand.push(sorted[si]);
                }
            }
            zBands.push({ bars: currentBand });

            // ── Step 2: Cluster within each Z-band ───────────────────────
            let globalClusterIdx = 0;
            const allClusters = [];

            zBands.forEach(band => {
                const zb = band.bars;
                if (zb.length === 1) {
                    allClusters.push(zb);
                    return;
                }

                const n = zb.length;

                // Perpendicular axis to cage axis — direction along which bars are spaced
                // For cage axis Z: spacing is in X or Y (we use the dominant spread axis)
                const perpAxis = (() => {
                    const spreadX = Math.max(...zb.map(b => b.Start_X)) - Math.min(...zb.map(b => b.Start_X));
                    const spreadY = Math.max(...zb.map(b => b.Start_Y)) - Math.min(...zb.map(b => b.Start_Y));
                    return spreadX >= spreadY ? 'Start_X' : 'Start_Y';
                })();

                const dist = Array.from({length: n}, (_, i) =>
                    Array.from({length: n}, (_, j) => {
                        if (i === j) return 0;
                        const dPerp = Math.abs(zb[i][perpAxis] - zb[j][perpAxis]);
                        const dZ    = Math.abs(zb[i].Start_Z   - zb[j].Start_Z);
                        return dPerp < DX_MIN ? 1e9 : dZ;
                    })
                );

                let clusters = Array.from({length: n}, (_, i) => [i]);
                while (clusters.length > 1) {
                    let minD = Infinity, mergeA = -1, mergeB = -1;
                    for (let a = 0; a < clusters.length; a++) {
                        for (let b = a + 1; b < clusters.length; b++) {
                            let sum = 0, cnt = 0;
                            for (const i of clusters[a])
                                for (const j of clusters[b]) { sum += dist[i][j]; cnt++; }
                            const avgD = sum / cnt;
                            if (avgD < minD) { minD = avgD; mergeA = a; mergeB = b; }
                        }
                    }
                    if (minD > DZ_MAX) break;
                    clusters[mergeA] = [...clusters[mergeA], ...clusters[mergeB]];
                    clusters.splice(mergeB, 1);
                }

                clusters.forEach(members => allClusters.push(members.map(i => zb[i])));
            });

            // ── Step 3: Sort all clusters by min Z, assign IDs ────────────
            allClusters.sort((a, b) =>
                Math.min(...a.map(b => b.Start_Z)) -
                Math.min(...b.map(b => b.Start_Z))
            );

            allClusters.forEach((members, ci) => {
                const id = `${layer}_H${String(ci + 1).padStart(2, '0')}`;
                members.forEach(b => { b.Stagger_Cluster_ID = id; });
            });

            console.log(`  ${layer}: ${hbars.length} entities → ${allClusters.length} stagger clusters (${zBands.length} Z-bands)`);
        });
    }

    // ── ATK fallback: Effective_Mesh_Layer ────────────────────────────
    /**
     * Infer which mesh layer a bar belongs to for stats purposes.
     *
     * Priority:
     *   1. Avonmouth_Layer_Set if it matches ^[FN]\d+A$ (primary, trusted)
     *   2. Inferred from ATK_Layer_Name IFF Avonmouth_Layer_Set is NULL
     *      (bars with any Avonmouth layer — even VS1/HS1/PRL — are NOT
     *       re-routed here, preserving correct classification)
     *
     * ATK naming convention:
     *   F1/F2 → F1A,  F3/F4 → F3A,  F5/F6 → F5A,  F7/F8 → F7A
     *   N1/N2 → N1A,  N3/N4 → N3A,  N5/N6 → N5A,  N7/N8 → N7A
     *   Odd ATK number = horizontal ring bars; Even = vertical longitudinals.
     */
    tagEffectiveMeshLayer(bars) {
        bars.forEach(bar => {
            const av = bar.Avonmouth_Layer_Set;

            // RULE: only assign a mesh layer if Avonmouth EXPLICITLY says it's mesh.
            // Unknown bars (av === null) with a recognisable ATK mesh layer name
            // (e.g. F2-CPLR → F1A) will get an Effective_Mesh_Layer here.
            // reclassifyMeshCouplers() then promotes those to Bar_Type = 'Mesh'.
            // Bars whose ATK name ends in -U or -LINK stay Unknown → C01 rejected.
            if (av && /^[FNBTfnbt]\d+A$/i.test(av)) {
                bar.Effective_Mesh_Layer = av.toUpperCase();
                return;
            }

            // ATK fallback ONLY when Avonmouth is completely absent (null).
            if (av === null || av === undefined) {
                const atk = bar.ATK_Layer_Name;
                if (atk) {
                    const isNonMesh = /[-_]U$/i.test(atk) || /[-_]LINK$/i.test(atk);
                    if (!isNonMesh) {
                        // ATK Rebar naming: F1, F2, F1-CPLR, F2-CPLR, N1, N2, etc.
                        // Odd number  = horizontal bars  → mesh layer = F<odd>A / N<odd>A
                        // Even number = vertical bars    → mesh layer = F<even-1>A / N<even-1>A
                        const mATK = atk.match(/^([FN])(\d+)/i);
                        if (mATK) {
                            const face    = mATK[1].toUpperCase();
                            const num     = parseInt(mATK[2], 10);
                            const meshNum = num % 2 === 1 ? num : num - 1;
                            bar.Effective_Mesh_Layer = `${face}${meshNum}A`;
                            return;
                        }
                        // ICOS Rebar naming: FF1, FF2, NF1, NF2, FF3, NF4, etc.
                        // Same parity rule: odd = horizontal, even = vertical
                        const mICOS = atk.match(/^(FF|NF)(\d+)/i);
                        if (mICOS) {
                            const face    = mICOS[1].charAt(0).toUpperCase(); // F or N
                            const num     = parseInt(mICOS[2], 10);
                            const meshNum = num % 2 === 1 ? num : num - 1;
                            bar.Effective_Mesh_Layer = `${face}${meshNum}A`;
                            return;
                        }
                    }
                }
            }
            bar.Effective_Mesh_Layer = null;
        });
    }

    // ── Shape Code parsing: base code + coupler suffix ────────────────
    /**
     * British Standard shape codes may be followed by Griptech coupler suffixes:
     *   GM  → Male coupler
     *   GF  → Female coupler
     *   GMB → Male Bridging coupler
     *   GFB → Female Bridging coupler
     *
     * Examples:  "00"     → base=00, no coupler
     *            "00GM"   → base=00, coupler=GM (Male)
     *            "00GMBGF"→ base=00, couplers on both ends (GMB + GF)
     *            "12LGF"  → base=12L, coupler=GF (Female)
     *
     * We store:
     *   Shape_Code_Base  — the numeric/letter part before any G suffix
     *   Coupler_Suffix   — all G-code characters after the base
     *   Coupler_Type     — human-readable description
     */
    parseShapeCodes(bars) {
        // Known coupler suffixes, longest-first so we match GMB before GM
        const SUFFIXES = [
            ['GMBGF', 'Male Bridging + Female'],
            ['GFBGM', 'Female Bridging + Male'],
            ['GMB',   'Male Bridging'],
            ['GFB',   'Female Bridging'],
            ['GM',    'Male'],
            ['GF',    'Female'],
        ];

        bars.forEach(bar => {
            const raw = (bar.Shape_Code || '').trim().toUpperCase();
            if (!raw) return;

            // Find coupler suffix: scan for the first 'G' that starts a known suffix
            let base = raw, suffix = '', couplerType = null;
            for (const [sfx, label] of SUFFIXES) {
                const idx = raw.indexOf(sfx);
                if (idx !== -1) {
                    base        = raw.slice(0, idx);
                    suffix      = raw.slice(idx);
                    couplerType = label;
                    break;
                }
            }
            bar.Shape_Code_Base = base || raw;
            bar.Coupler_Suffix  = suffix || null;
            bar.Coupler_Type    = couplerType;
        });
    }

    // ── Weight / classify / shape ──────────────────────────────────────

    calculateWeights(bars) {
        const RHO = 7777; // kg/m³ steel density
        bars.forEach(bar => {
            // ALWAYS compute formula weight from geometry — stored as bar.Formula_Weight.
            // This is the ONLY value used for UDL (nonMeshFormulaW / meshFormulaW).
            // It is NOT used for cage weight totals, layer weight table, or bar stats.
            const size = bar.Size || bar.NominalDiameter_mm;
            const len  = bar.Length;
            if (size && len) {
                const r = (size / 1000) / 2, l = len / 1000;
                bar.Formula_Weight    = parseFloat((Math.PI * r * r * l * RHO).toFixed(3));
                bar.Calculated_Weight = bar.Formula_Weight; // keep for legacy CSV export
            }

            // bar.Weight = ATK Rebar or ICOS Rebar 'Weight' pset field ONLY.
            // Already extracted by extractProperties into bar.Weight (never overwritten here).
            // If ATK/ICOS weight is absent, bar.Weight stays null — flagged as missingWeightCount.
        });
    }


    /**
     * Second-pass reclassification for bars that:
     *   1. Have no Avonmouth Layer/Set (Avonmouth_Layer_Set === null)
     *   2. BUT have a valid Effective_Mesh_Layer inferred from their ATK Layer Name
     *      (e.g. ATK "F2-CPLR" → Effective_Mesh_Layer "F1A")
     *
     * These are vertical coupler connector bars in the mesh cage.  The Avonmouth
     * property set is simply missing from their IFC export — they are genuine mesh
     * members and must be counted as Mesh for weight, height, and dimension stats.
     *
     * -U and -LINK bars are excluded by tagEffectiveMeshLayer (Effective_Mesh_Layer
     * stays null for them) so they remain Unknown and still trigger C01 rejection.
     *
     * Must run AFTER tagEffectiveMeshLayer() and BEFORE tagStaggerClusters().
     */
    reclassifyMeshCouplers(bars) {
        bars.forEach(bar => {
            if (bar.Bar_Type === 'Unknown' &&
                bar.Avonmouth_Layer_Set === null &&
                bar.Effective_Mesh_Layer !== null) {
                bar.Bar_Type = 'Mesh';
                // Tag so the data table can show the source of the classification
                bar.Mesh_Source = 'ATK-inferred';
            }
        });
    }

    classifyBars(bars) {
        bars.forEach(bar => {
            const layer = bar.Avonmouth_Layer_Set || '';
            if (!layer)                                  bar.Bar_Type = 'Unknown';
            else if (/^[FNBTfnbt]\d+A$/i.test(layer))  bar.Bar_Type = 'Mesh'; // F/N/B/T face layers
            else if (/^LB\d*$/i.test(layer))            bar.Bar_Type = 'Loose Bar';
            else if (/^LK\d*$/i.test(layer))            bar.Bar_Type = 'Link Bar';
            else if (/^[VH]S\d*$/i.test(layer))         bar.Bar_Type = 'Strut Bar';
            else if (/^PR[LC]\d*$/i.test(layer))       bar.Bar_Type = 'Preload Bar'; // PRL and PRC family
            else if (/^S\d*$/i.test(layer))             bar.Bar_Type = 'Site Bar';
            else                                         bar.Bar_Type = 'Other';
        });
    }

    detectBarShapes(bars) {
        // BS 8666:2020 Table 3 shape code descriptions
        const BS8666_SHAPES = {
            '00': 'Straight',
            '01': 'Stock length (straight)',
            '11': 'Standard bend — one end',
            '12': 'Large radius bend',
            '13': 'Single crank',
            '14': 'Two parallel bends',
            '15': 'Two parallel bends (simple)',
            '21': 'U-bar',
            '22': 'U-bar (closed end)',
            '23': 'Z-bar (reverse crank)',
            '24': 'Right-angle two bends',
            '25': 'Offset U-bar',
            '26': 'S-crank',
            '27': 'S-crank (with deduction)',
            '28': 'Double crank',
            '29': 'Reverse U-bar / triple crank',
            '31': 'Open rectangular link',
            '32': 'Open rectangular link (variant)',
            '33': 'Closed link (radius end)',
            '34': 'Lapped rectangular link',
            '35': 'Seismic rectangular link',
            '36': 'Closed rectangular link',
            '41': 'Four-bend frame',
            '44': 'Four-bend frame (variant)',
            '46': 'Four-bend bobbin',
            '47': 'Closed square link',
            '48': 'Closed square (variant)',
            '51': 'Five-bend closed loop',
            '52': 'Five-bend loop (variant)',
            '56': 'Complex closed link',
            '63': 'Double closed loop',
            '64': 'Complex closed frame',
            '67': 'Straight spacer',
            '75': 'Circular spiral',
            '77': 'Helix / coil',
            '98': 'Isometric 3D bend',
            '99': 'Custom shape',
        };

        bars.forEach(bar => {
            const code = (bar.Shape_Code_Base || '').trim().toUpperCase();
            if (code && BS8666_SHAPES[code]) {
                bar.Bar_Shape = `${code} — ${BS8666_SHAPES[code]}`;
                bar.Bar_Shape_Code = code;
            } else if (code) {
                bar.Bar_Shape = `${code}`;
                bar.Bar_Shape_Code = code;
            } else {
                // No shape code — fall back to name heuristic
                const n = (bar.Name || '').toUpperCase();
                if      (n.includes('LINK')) bar.Bar_Shape = 'Link';
                else if (n.includes('CPLR') || n.includes('COUPLER')) bar.Bar_Shape = 'Straight';
                else                         bar.Bar_Shape = '—';
                bar.Bar_Shape_Code = null;
            }
        });
    }

    // ── Rejection status ──────────────────────────────────────────────
    /**
     * Rejection conditions:
     *   1. Unknown bars  — bars with no Avonmouth "Layer/Set" property at all
     *      (Avonmouth_Layer_Set === null). Indicates missing/wrong IFC data.
     *   2. Duplicate GlobalIds — same bar represented more than once.
     *
     * When any condition is true: isRejected = true.
     * The analysis still runs and displays so the engineer can see what is wrong.
     */
    computeRejectionStatus(bars) {
        // Unknown bar type: bars with Bar_Type === 'Unknown'
        this.unknownCount = bars.filter(b => b.Bar_Type === 'Unknown').length;
        this.unknownBars  = bars.filter(b => b.Bar_Type === 'Unknown');

        // Missing Avonmouth layer: bars with no Avonmouth_Layer_Set regardless of Bar_Type.
        // Even ATK-inferred Mesh bars without an Avonmouth pset are flagged — the IFC
        // is incomplete and the cage must be rejected until the data gap is resolved.
        this.missingLayerBars  = bars.filter(b => !b.Avonmouth_Layer_Set);
        this.missingLayerCount = this.missingLayerBars.length;

        // Duplicates: any GlobalId appearing more than once
        const seen = new Map();
        bars.forEach(b => seen.set(b.GlobalId, (seen.get(b.GlobalId) || 0) + 1));
        this.duplicateCount = [...seen.values()].filter(c => c > 1).length;
        this.duplicateGuids = [...seen.entries()].filter(([, c]) => c > 1).map(([g]) => g);
        this.duplicateBars  = bars.filter(b => (seen.get(b.GlobalId) || 0) > 1);

        // Missing ATK/ICOS Weight: bars that have no Weight from ATK Rebar or ICOS Rebar psets.
        // bar.Weight is set ONLY by extractProperties from ATK/ICOS psets — never from formula.
        // Formula_Weight is always computed separately and does NOT affect this flag.
        this.missingWeightBars  = bars.filter(b =>
            b.Weight === null || b.Weight === undefined
        );
        this.missingWeightCount = this.missingWeightBars.length;

        this.isRejected = this.unknownCount      > 0 ||
                          this.missingLayerCount  > 0 ||
                          this.duplicateCount     > 0 ||
                          this.missingWeightCount > 0;
    }
}

// ── Slab cage detection ────────────────────────────────────────────────
IFCParser.isSlabCage = function(bars) {
    const layers = new Set(bars.map(b => b.Effective_Mesh_Layer).filter(Boolean));
    return (layers.has('T1A') || layers.has('B1A')) && !layers.has('F1A') && !layers.has('N1A');
};

// ── Slab data extraction ───────────────────────────────────────────────
// Extracts values for the slab EDB Excel (INPUT SPAN RESULTS row 36):
//   H=cageLength  I=cageHeight  J=totalWeight(T)
//   N=t1Dia  O=t1Spacing  P=t2Dia  Q=t2Spacing  R=t2Count
//   T=b1Dia  U=b1Spacing  V=b2Dia  W=b2Spacing  X=b2Count  Z=meshWeight(T)
//
// ATK_Layer_Name convention for slab cages:
//   T1 / T1-CPLR = height-direction bars in T1A face (spaced along length axis)
//   T2 / T2-CPLR = length-direction bars in T1A face (spaced along height axis)
//   B1 / B1-CPLR = height-direction bars in B1A face
//   B2 / B2-CPLR = length-direction bars in B1A face
//
// Spacing = span of bar start positions / count → round to nearest 5 mm
// T1/B1: use only -CPLR bars for spacing (excludes lone edge bars that skew span)
IFCParser.prototype.extractSlabData = function(bars) {
    const roundNearest5 = v => Math.round(v / 5) * 5;

    const dominantDia = bs => {
        const freq = {};
        bs.forEach(b => { const d = b.Size || b.NominalDiameter_mm; if (d) freq[d] = (freq[d] || 0) + 1; });
        const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        return top ? +top[0] : null;
    };

    const t1aBars = bars.filter(b => b.Effective_Mesh_Layer === 'T1A');
    const b1aBars = bars.filter(b => b.Effective_Mesh_Layer === 'B1A');

    const byRole = (bs, role) => bs.filter(b => {
        const n = b.ATK_Layer_Name || '';
        return n === role || n.startsWith(role + '-');
    });

    const t1all  = byRole(t1aBars, 'T1');
    const t1cplr = t1all.filter(b => b.ATK_Layer_Name === 'T1-CPLR');
    const t2     = byRole(t1aBars, 'T2');
    const b1all  = byRole(b1aBars, 'B1');
    const b1cplr = b1all.filter(b => b.ATK_Layer_Name === 'B1-CPLR');
    const b2     = byRole(b1aBars, 'B2');

    const uniquePos = (bs, axis) => [...new Set(
        bs.map(b => Math.round(axis === 'x' ? b.Start_X : b.Start_Y)).filter(v => v != null)
    )].sort((a, b) => a - b);

    const calcSpacing = positions =>
        positions.length >= 2
            ? roundNearest5((positions[positions.length - 1] - positions[0]) / (positions.length - 1))
            : null;

    const t1Pos = uniquePos(t1cplr.length ? t1cplr : t1all, 'y');
    const t2Pos = uniquePos(t2, 'x');
    const b1Pos = uniquePos(b1cplr.length ? b1cplr : b1all, 'y');
    const b2Pos = uniquePos(b2, 'x');

    const meshBars = [...t1aBars, ...b1aBars];
    const maxLen = bs => bs.length ? Math.max(...bs.map(b => b.Length || 0)) : 0;
    // H36: cage length = T2/B2 bars run along the length dimension → their bar length = cage length
    const lenMm = maxLen([...t2, ...b2]);
    // I36: cage height = T1/B1 bars run along the height dimension → their bar length = cage height
    const hgtMm = maxLen([...t1all, ...b1all]);

    const bw      = b => b.Weight ?? b.Formula_Weight ?? 0;
    const meshWt  = meshBars.reduce((s, b) => s + bw(b), 0);
    const totalWt = bars.reduce((s, b) => s + bw(b), 0);

    return {
        cageLength : +(lenMm  / 1000).toFixed(2),
        cageHeight : +(hgtMm  / 1000).toFixed(2),
        totalWeight: +(totalWt / 1000).toFixed(3),
        t1Dia      : dominantDia(t1all),
        t1Spacing  : calcSpacing(t1Pos),
        t2Dia      : dominantDia(t2),
        t2Spacing  : calcSpacing(t2Pos),
        t2Count    : t2Pos.length,
        b1Dia      : dominantDia(b1all),
        b1Spacing  : calcSpacing(b1Pos),
        b2Dia      : dominantDia(b2),
        b2Spacing  : calcSpacing(b2Pos),
        b2Count    : b2Pos.length,
        meshWeight : +(meshWt  / 1000).toFixed(3),
    };
};

window.IFCParser = IFCParser;
