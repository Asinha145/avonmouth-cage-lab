/**
 * IFC Rebar Analyzer v2 — Main
 *
 * v2 changes vs v1:
 *   - 3D viewer now uses web-ifc WASM (BREP solid meshes, not bs8666 wireframes)
 *   - Dimension boxes prefer BREP bounding box (outer-face to outer-face)
 *   - viewer3d.js handles all Three.js + web-ifc lifecycle
 *
 * What stays the same:
 *   - ifc-parser.js for ALL metadata, classification, validation, stats
 *   - C01 rejection logic
 *   - Stagger clustering (Z_BAND = 100mm gap threshold within clustering)
 *   - Step detection (mesh bars only, 50mm XY grid, 15–300mm range)
 *   - Weight: ATK/ICOS Rebar 'Weight' pset only — never formula for cage totals
 *   - UDL: formula weight (π×r²×L×7777) — geometry-based, pset-independent
 */

let allData      = [];
let filteredData = [];
let cageAxis     = [0, 0, 1];
let cageAxisName = 'Z';
// WASM BREP dimensions — set after 3D viewer loads; takes priority over text-parser bbox
let _wasm3DDims     = null;
// C01 rejection state — gating EDB and report exports
let _parserRejected = false;
// Slab cage flag — set after analysis, gates slab vs wall EDB buttons
let _isSlabCage = false;

// ── Initialise viewer on page load ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // File picker
    document.getElementById('ifc-file').addEventListener('change', e => {
        const f = e.target.files[0];
        document.getElementById('ifc-filename').textContent = f ? f.name : 'No file selected';
        document.getElementById('process-btn').disabled = !f;
    });
    document.getElementById('process-btn').addEventListener('click', processFile);

    // Drag-and-drop
    const dropZone = document.getElementById('upload-drop-zone');
    if (dropZone) {
        dropZone.addEventListener('dragover', e => {
            e.preventDefault();
            dropZone.classList.add('drag-active');
        });
        dropZone.addEventListener('dragleave', e => {
            if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-active');
        });
        dropZone.addEventListener('drop', e => {
            e.preventDefault();
            dropZone.classList.remove('drag-active');
            const f = e.dataTransfer.files[0];
            if (!f) return;
            try {
                const dt = new DataTransfer();
                dt.items.add(f);
                document.getElementById('ifc-file').files = dt.files;
            } catch (_) { /* Safari */ }
            window._droppedFile = f;
            document.getElementById('ifc-filename').textContent = f.name;
            document.getElementById('process-btn').disabled = false;
        });
    }

    document.getElementById('search-input').addEventListener('input', applyFilters);
    document.getElementById('bartype-filter').addEventListener('change', applyFilters);
    document.getElementById('export-excel-btn').addEventListener('click', () => exportXLSX());
    document.getElementById('export-ubars-btn').addEventListener('click',  () => exportEDB('ubars'));
    document.getElementById('export-struts-btn').addEventListener('click', () => exportEDB('struts'));
    document.getElementById('export-slab-btn').addEventListener('click',   () => exportSlabEDB());
    document.getElementById('export-report-btn').addEventListener('click', () => exportCageReport());
    document.getElementById('edb-wall-thickness').addEventListener('input', updateEDBComputedInfo);

    document.getElementById('page-prev').addEventListener('click', () => {
        if (currentPage > 1) { currentPage--; renderTable(); }
    });
    document.getElementById('page-next').addEventListener('click', () => {
        const totalPages = Math.ceil(filteredData.length / PAGE_SIZE);
        if (currentPage < totalPages) { currentPage++; renderTable(); }
    });

    const dlAllBtn = document.getElementById('download-all-samples-btn');
    if (dlAllBtn) dlAllBtn.addEventListener('click', downloadAllSamples);

    const stepBtn = document.getElementById('run-step-btn');
    if (stepBtn) stepBtn.addEventListener('click', runStepDetection);

    // Layer filter panel toggle
    const filterToggle = document.getElementById('viewer-filter-toggle');
    if (filterToggle) {
        filterToggle.addEventListener('click', () => {
            document.getElementById('viewer-filter-panel').classList.toggle('hidden');
        });
    }

    // ViewCube buttons
    document.querySelectorAll('.viewcube-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (window._viewer3d) window._viewer3d.setView(btn.dataset.view);
        });
    });

    // Initialise web-ifc Viewer3D (loads WASM once, re-used per file)
    if (typeof Viewer3D !== 'undefined' && typeof WebIFC !== 'undefined') {
        try {
            document.getElementById('viewer-col').classList.remove('hidden');
            _setViewerPlaceholder('⏳ Loading WASM engine…');
            window._viewer3d = new Viewer3D('threejs-container');
            await window._viewer3d.init();
            _setViewerPlaceholder('Drop an IFC file to load the 3D cage');
            console.log('[main] Viewer3D ready');
        } catch (e) {
            console.warn('[main] Viewer3D init failed:', e);
            window._viewer3d = null;
            _setViewerPlaceholder('3D preview unavailable — needs HTTP server');
        }
    } else {
        console.warn('[main] WebIFC or Viewer3D not loaded');
        window._viewer3d = null;
        document.getElementById('viewer-col').classList.remove('hidden');
        _setViewerPlaceholder('3D preview unavailable — web-ifc not loaded');
    }
});

// ── Step reset on new file ─────────────────────────────────────────────
function _resetClashStep() {
    const res = document.getElementById('step-results');
    if (res) { res.classList.add('hidden'); }
    const tbody = document.getElementById('step-tbody');
    if (tbody) tbody.innerHTML = '';
    const wrap = document.getElementById('step-table-wrap');
    if (wrap) wrap.style.display = 'none';
    const btn = document.getElementById('run-step-btn');
    if (btn) { btn.textContent = '▶ Re-run Step Check'; btn.disabled = false; }
    _setBox5Step(false);
}

// ── Process file ────────────────────────────────────────────────────────

async function processFile() {
    const file = document.getElementById('ifc-file').files[0] || window._droppedFile || null;
    window._droppedFile = null;
    if (!file) { alert('Please select an IFC file.'); return; }
    showProgress(); allData = []; _wasm3DDims = null;
    _resetClashStep();

    try {
        if (typeof IFCParser === 'undefined') throw new Error('IFCParser not loaded.');

        updateProgress(15, 'Reading file…');
        const content = await readFileAsText(file);
        if (!content.includes('IFCREINFORCINGBAR'))
            throw new Error('No reinforcing bars found in this file.');

        updateProgress(40, 'Analysing cage structure…');
        const parser = new IFCParser();
        allData = await parser.parseFile(content);
        if (!allData.length) throw new Error('No bars extracted.');
        cageAxis     = parser.cageAxis;
        cageAxisName = parser.cageAxisName;

        updateProgress(70, 'Building results…');
        displayResults(parser);

        updateProgress(90, '3D geometry loading…');
        setTimeout(async () => {
            hideProgress();
            _doStepDetection();

            // Load BREP geometry into viewer
            if (window._viewer3d) {
                try {
                    const arrayBuffer = await readFileAsBuffer(file);
                    const barMap = new Map();
                    allData.forEach(b => barMap.set(parseInt(b._entityId, 10), b));
                    const dims = await window._viewer3d.loadIFC(arrayBuffer, barMap);
                    if (dims) _updateDimBoxesFromBREP(dims);
                    _buildViewerCheckboxes();
                } catch (e) {
                    console.warn('[main] BREP load error:', e);
                }
            }
        }, 100);

    } catch (err) {
        console.error(err);
        alert(`Error: ${err.message}`);
        hideProgress();
    }
}

function readFileAsText(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result);
        r.onerror = e => rej(e);
        r.readAsText(file);
    });
}

function readFileAsBuffer(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result);
        r.onerror = e => rej(e);
        r.readAsArrayBuffer(file);
    });
}

function showProgress()  { document.getElementById('progress-container').classList.remove('hidden'); }
function hideProgress()  { document.getElementById('progress-container').classList.add('hidden'); }
function updateProgress(pct, txt) {
    document.getElementById('progress-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = txt;
}

// ── Top-level display ──────────────────────────────────────────────────

function displayResults(parser) {
    // Compute PRL/PRC mismatches early so they can feed into rejection banner
    const prlPrcResult = _computePRLPRCMismatches();
    const preloadMisCount = prlPrcResult ? prlPrcResult.totalMis : 0;

    // Rejection banner
    const banner   = document.getElementById('rejection-banner');
    const rejected = parser.isRejected;
    if (rejected) {
        const reasons = [];
        if (parser.unknownCount > 0)
            reasons.push(`${parser.unknownCount} bar${parser.unknownCount > 1 ? 's' : ''} with unknown Bar_Type`);
        if (parser.missingLayerCount > 0)
            reasons.push(`${parser.missingLayerCount} bar${parser.missingLayerCount > 1 ? 's' : ''} missing Avonmouth Layer/Set`);
        if (parser.duplicateCount > 0)
            reasons.push(`${parser.duplicateCount} duplicate GlobalId${parser.duplicateCount > 1 ? 's' : ''}`);
        if (parser.missingWeightCount > 0)
            reasons.push(`${parser.missingWeightCount} bar${parser.missingWeightCount > 1 ? 's' : ''} missing ATK/ICOS Weight`);
        document.getElementById('rejection-reasons').innerHTML =
            reasons.map(r => `<li>${r}</li>`).join('');
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }

    // Warning banner (non-blocking)
    const warnBanner = document.getElementById('warning-banner');
    if (warnBanner) {
        const warns = [];
        if (preloadMisCount > 0)
            warns.push(`${preloadMisCount} preload bar${preloadMisCount > 1 ? 's' : ''} with PRL/PRC label mismatch — review geometry`);
        if (warns.length) {
            document.getElementById('warning-reasons').innerHTML = warns.map(r => `<li>${r}</li>`).join('');
            warnBanner.classList.remove('hidden');
        } else {
            warnBanner.classList.add('hidden');
        }
    }

    // Cage axis badge
    const axisEl = document.getElementById('cage-axis-info');
    if (axisEl) axisEl.textContent = `${cageAxisName}-axis`;

    // Top stat cards
    const meshBars    = allData.filter(b => b.Bar_Type === 'Mesh');
    const nonMeshBars = allData.filter(b => b.Bar_Type !== 'Mesh' && b.Bar_Type !== 'Unknown');
    const w     = b => b.Weight || 0;
    const fw    = b => b.Formula_Weight || 0;
    const meshFW    = meshBars.reduce((s, b) => s + fw(b), 0);
    const nonMeshFW = nonMeshBars.reduce((s, b) => s + fw(b), 0);
    const udl = meshFW > 0 ? nonMeshFW / meshFW : 0;

    const guidCounts = new Map();
    allData.forEach(b => guidCounts.set(b.GlobalId, (guidCounts.get(b.GlobalId) || 0) + 1));
    const dupEntities = [...guidCounts.values()].reduce((s, c) => s + (c > 1 ? c : 0), 0);

    document.getElementById('total-count').textContent     = allData.length;
    document.getElementById('mesh-count').textContent      = meshBars.length;
    document.getElementById('unknown-count').textContent   = parser.unknownCount;
    document.getElementById('duplicate-count').textContent = dupEntities;
    document.getElementById('missing-weight-count').textContent = parser.missingWeightCount;
    document.getElementById('udl-value').textContent       = udl.toFixed(4);

    displayCageDimensionBoxes();
    displayBarTypeDistribution();
    displayMeshHorizontalStats();
    displayMeshHeightStats();
    displayLayerWeightStats();
    document.getElementById('results-section').classList.remove('hidden');
    applyFilters();
    buildC01Cards(parser);
    // Gate EDB and report exports on C01 approval
    _parserRejected = rejected;
    _isSlabCage = IFCParser.isSlabCage(allData);

    // Show/hide slab vs wall EDB buttons
    const slabBtn  = document.getElementById('export-slab-btn');
    const wallEdb  = document.getElementById('edb-wall-section');
    if (_isSlabCage) {
        if (slabBtn)  { slabBtn.style.display = 'inline-block'; slabBtn.disabled = rejected; }
        if (wallEdb)  wallEdb.style.display = 'none';
    } else {
        if (slabBtn)  slabBtn.style.display = 'none';
        if (wallEdb)  wallEdb.style.display = '';
        document.getElementById('export-ubars-btn').disabled  = rejected;
        document.getElementById('export-struts-btn').disabled = rejected;
    }

    const reportBtn = document.getElementById('export-report-btn');
    if (reportBtn) reportBtn.classList.toggle('hidden', rejected);
    autoFillEDBInputs();
    _renderPRLPRCResults(prlPrcResult);
}

// ── Cage dimension boxes (parser centreline, updated by BREP after viewer loads) ──

function displayCageDimensionBoxes() {
    const meshBars = allData.filter(b =>
        b.Bar_Type === 'Mesh' &&
        b.Mesh_Source !== 'ATK-inferred' &&
        b.Start_X !== null
    );

    const vertBars = meshBars.filter(b => b.Orientation === 'Vertical');
    const barsForHL = vertBars.length ? vertBars : meshBars;

    let minZ = Infinity, maxZ = -Infinity;
    barsForHL.forEach(b => {
        minZ = Math.min(minZ, b.Start_Z, b.End_Z);
        maxZ = Math.max(maxZ, b.Start_Z, b.End_Z);
    });
    const heightVal = isFinite(minZ) ? maxZ - minZ : null;

    // Overall width/length (all bars) for website display — BREP will replace this once loaded
    const overallSpans = _cageXYSpans();
    let widthVal  = overallSpans ? Math.min(overallSpans.spanX, overallSpans.spanY) : null;
    let lengthVal = overallSpans ? Math.max(overallSpans.spanX, overallSpans.spanY) : null;

    const fmt = v => v !== null && isFinite(v) ? Math.round(v).toLocaleString() + ' mm' : '—';
    document.getElementById('dim-width').textContent  = fmt(widthVal);
    document.getElementById('dim-length').textContent = fmt(lengthVal);
    document.getElementById('dim-height').textContent = fmt(heightVal);

    // Box4: Couplered Bars
    const hasCoupler = allData.some(b => {
        const av  = (b.Avonmouth_Layer_Set || '').toUpperCase();
        const atk = (b.ATK_Layer_Name || '').toUpperCase();
        return /^(VS|HS|LB)\d*$/.test(av) && atk.includes('CPLR');
    });
    const couplerEl = document.getElementById('dim-coupler');
    couplerEl.textContent = hasCoupler ? 'Yes' : 'No';
    couplerEl.className   = 'dim-value ' + (hasCoupler ? 'dim-yes' : 'dim-no');
}

/**
 * Called after BREP bbox is available from viewer3d.loadIFC().
 * BREP bbox is outer-face to outer-face — more accurate than centreline + half-dia.
 */
function _updateDimBoxesFromBREP(dims) {
    if (!dims) return;
    // Store for use by getCageWidthMm / getCageLengthMm (WASM is more accurate than text parser)
    _wasm3DDims = dims;
    const fmt = v => v !== null && isFinite(v) ? Math.round(v).toLocaleString() + ' mm' : '—';
    // Overall width/length (all bars) shown on website
    document.getElementById('dim-width').textContent  = fmt(dims.overallWidth);
    document.getElementById('dim-length').textContent = fmt(dims.overallLength);
    document.getElementById('dim-height').textContent = fmt(dims.height);
    // Re-run EDB auto-fill now that accurate WASM dims are available
    autoFillEDBInputs();
}

// ── Viewer placeholder text ────────────────────────────────────────────

function _setViewerPlaceholder(msg) {
    const el = document.getElementById('viewer-placeholder');
    if (el) el.textContent = msg;
}

// ── 3D viewer layer checkboxes ─────────────────────────────────────────

let _viewerChecked = new Set();

function _buildViewerCheckboxes() {
    if (!window._viewer3d) return;
    const layers = window._viewer3d.getLayerNames();
    const box    = document.getElementById('viewer-checkboxes');
    box.innerHTML = '';
    _viewerChecked = new Set(layers);

    layers.forEach(key => {
        const sampleBar = key === 'PRL/PRC Mismatch'
            ? { _prlPrcMismatch: true }
            : allData.find(b => !b._prlPrcMismatch && (b.Avonmouth_Layer_Set || b.Bar_Type || 'Unknown') === key) || null;
        const colour = window._viewer3d._barColour(sampleBar);
        const hex   = (colour >>> 0).toString(16).padStart(6, '0');
        const count = key === 'PRL/PRC Mismatch'
            ? allData.filter(b => b._prlPrcMismatch).length
            : allData.filter(b => !b._prlPrcMismatch && (b.Avonmouth_Layer_Set || b.Bar_Type || 'Unknown') === key).length;
        const label = document.createElement('label');
        label.className = 'viewer-cb-label';
        label.innerHTML = `
            <input type="checkbox" class="viewer-cb" data-key="${key}" checked>
            <span class="viewer-cb-dot" style="background:#${hex}"></span>
            <span>${key} <em>(${count})</em></span>`;
        box.appendChild(label);
        label.querySelector('input').addEventListener('change', _onViewerCbChange);
    });

    document.getElementById('viewer-check-all').onclick = () => {
        box.querySelectorAll('.viewer-cb').forEach(cb => { cb.checked = true; });
        _onViewerCbChange();
    };
    document.getElementById('viewer-check-none').onclick = () => {
        box.querySelectorAll('.viewer-cb').forEach(cb => { cb.checked = false; });
        _onViewerCbChange();
    };

    _buildViewerLegend(layers);
}

function _onViewerCbChange() {
    _viewerChecked = new Set(
        [...document.querySelectorAll('.viewer-cb:checked')].map(cb => cb.dataset.key)
    );
    if (window._viewer3d) {
        window._viewer3d.getLayerNames().forEach(key => {
            window._viewer3d.setLayerVisible(key, _viewerChecked.has(key));
        });
    }
    _buildViewerLegend([...window._viewer3d.getLayerNames()]);
}

function _buildViewerLegend(layers) {
    const legend = document.getElementById('viewer-legend');
    if (!legend || !window._viewer3d) return;
    legend.innerHTML = '';
    layers.filter(k => _viewerChecked.has(k)).forEach(key => {
        const sampleBar = key === 'PRL/PRC Mismatch'
            ? { _prlPrcMismatch: true }
            : allData.find(b => !b._prlPrcMismatch && (b.Avonmouth_Layer_Set || b.Bar_Type || 'Unknown') === key) || null;
        const colour = window._viewer3d._barColour(sampleBar);
        const hex   = (colour >>> 0).toString(16).padStart(6, '0').slice(-6);
        const count = key === 'PRL/PRC Mismatch'
            ? allData.filter(b => b._prlPrcMismatch).length
            : allData.filter(b => !b._prlPrcMismatch && (b.Avonmouth_Layer_Set || b.Bar_Type || 'Unknown') === key).length;
        const item  = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `<span class="legend-dot" style="background:#${hex}"></span>${key} (${count})`;
        legend.appendChild(item);
    });
}

// ── Helpers ────────────────────────────────────────────────────────────

function dotCage(b) {
    return Math.abs(b.Dir_X * cageAxis[0] + b.Dir_Y * cageAxis[1] + b.Dir_Z * cageAxis[2]);
}

function countUniqueHorizPositions(hBars) {
    if (!hBars.length) return { count: 0 };
    const tagged = hBars.filter(b => b.Stagger_Cluster_ID);
    if (tagged.length > 0) {
        const ids = new Set(tagged.map(b => b.Stagger_Cluster_ID));
        return { count: ids.size };
    }
    return { count: hBars.length };
}

function heightAlongAxis(bars) {
    if (!bars.length) return null;
    let mn = Infinity, mx = -Infinity;
    bars.forEach(b => {
        if (b.Start_Z === null) return;
        mn = Math.min(mn, b.Start_Z, b.End_Z);
        mx = Math.max(mx, b.Start_Z, b.End_Z);
    });
    return isFinite(mn) ? { min: mn, max: mx, height: mx - mn } : null;
}

// ── Bar type distribution ──────────────────────────────────────────────

function displayBarTypeDistribution() {
    const grid = document.getElementById('bar-types-grid');
    grid.innerHTML = '';
    const counts = {};
    allData.forEach(b => { const t = b.Bar_Type || 'Unknown'; counts[t] = (counts[t] || 0) + 1; });
    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
        const card = document.createElement('div');
        card.className = 'bar-type-card' + (type === 'Unknown' && count > 0 ? ' danger' : '');
        card.innerHTML = `<div class="type-name">${type}</div><div class="type-count">${count}</div>`;
        grid.appendChild(card);
    });
}

// ── Block 1: Horizontal bars per mesh layer ────────────────────────────

function displayMeshHorizontalStats() {
    const container = document.getElementById('mesh-horizontal-grid');
    container.innerHTML = '';
    const layerMap = {};
    allData.forEach(bar => {
        const av = bar.Avonmouth_Layer_Set;
        if (!av || !/^[FN]\d+A$/i.test(av)) return;
        const layer = bar.Effective_Mesh_Layer;
        if (!layer) return;
        if (!layerMap[layer]) layerMap[layer] = [];
        layerMap[layer].push(bar);
    });

    const sortedLayers = Object.keys(layerMap).sort();
    sortedLayers.forEach(layer => {
        const bars  = layerMap[layer];
        const hBars = bars.filter(b => b.Orientation === 'Horizontal');
        const { count: hCount } = countUniqueHorizPositions(hBars);
        const sizes  = hBars.map(b => b.Size).filter(s => s > 0);
        const minDia = sizes.length ? Math.min(...sizes) : null;
        const maxDia = sizes.length ? Math.max(...sizes) : null;
        const diaStr = minDia === null ? '—'
            : minDia === maxDia ? `⌀${minDia}`
            : `⌀${minDia} – ⌀${maxDia}`;
        const card = document.createElement('div');
        card.className = 'mesh-stat-card';
        card.innerHTML = `
            <div class="mesh-layer-name">${layer}</div>
            <div class="mesh-stat-value">${hCount}</div>
            <div class="mesh-stat-label">horizontal bars</div>
            <div class="mesh-stat-dia">${diaStr} mm</div>`;
        container.appendChild(card);
    });
    if (!sortedLayers.length)
        container.innerHTML = '<p class="no-data">No mesh layers found.</p>';
}

// ── Block 2: Cage height per mesh layer ───────────────────────────────

function displayMeshHeightStats() {
    const container = document.getElementById('mesh-height-grid');
    container.innerHTML = '';
    const layerMap = {};
    allData.forEach(bar => {
        const av = bar.Avonmouth_Layer_Set;
        if (!av || !/^[FN]\d+A$/i.test(av)) return;
        const layer = bar.Effective_Mesh_Layer;
        if (!layer) return;
        if (!layerMap[layer]) layerMap[layer] = [];
        layerMap[layer].push(bar);
    });

    const sortedLayers = Object.keys(layerMap).sort();
    sortedLayers.forEach(layer => {
        const bars  = layerMap[layer];
        const hBars = bars.filter(b => b.Orientation === 'Horizontal');
        const vBars = bars.filter(b => b.Orientation === 'Vertical');
        const h     = heightAlongAxis(bars);

        const hSizes = hBars.map(b => b.Size).filter(s => s > 0);
        const hMin   = hSizes.length ? Math.min(...hSizes) : null;
        const hMax   = hSizes.length ? Math.max(...hSizes) : null;
        const hDia   = hMin === null ? '—'
            : hMin === hMax ? `⌀${hMin}` : `⌀${hMin}–⌀${hMax}`;

        const vSizes = vBars.map(b => b.Size).filter(s => s > 0);
        const vMin   = vSizes.length ? Math.min(...vSizes) : null;
        const vMax   = vSizes.length ? Math.max(...vSizes) : null;
        const vDia   = vMin === null ? '—'
            : vMin === vMax ? `⌀${vMin}` : `⌀${vMin}–⌀${vMax}`;

        const card = document.createElement('div');
        card.className = 'mesh-stat-card height-card';
        card.innerHTML = `
            <div class="mesh-layer-name">${layer}</div>
            <div class="mesh-stat-value">${h ? Math.round(h.height).toLocaleString() : '—'}</div>
            <div class="mesh-stat-label">mm cage height</div>
            <div class="mesh-stat-sub">
                ↓ ${h ? Math.round(h.min).toLocaleString() : '—'} &nbsp;|&nbsp; ↑ ${h ? Math.round(h.max).toLocaleString() : '—'}
            </div>
            <div class="mesh-dia-row">
                <span class="mesh-stat-dia dia-horiz" title="Horizontal bars">↔ ${hDia}</span>
                <span class="mesh-stat-dia dia-vert"  title="Vertical bars">↕ ${vDia}</span>
            </div>`;
        container.appendChild(card);
    });
    if (!sortedLayers.length)
        container.innerHTML = '<p class="no-data">No mesh layers found.</p>';
}

// ── Block 3: Weight per layer ──────────────────────────────────────────

function displayLayerWeightStats() {
    const container = document.getElementById('layer-weight-tbody');
    container.innerHTML = '';
    const layerMap = {};
    allData.forEach(bar => {
        const layer = bar.Avonmouth_Layer_Set
            || (bar.Bar_Type === 'Mesh' && bar.Effective_Mesh_Layer
                ? bar.Effective_Mesh_Layer + ' \u2691'
                : null)
            || 'Unknown';
        const isInferred = !bar.Avonmouth_Layer_Set && bar.Bar_Type === 'Mesh';
        if (!layerMap[layer]) layerMap[layer] = { count: 0, weight: 0, type: bar.Bar_Type || 'Unknown', inferred: isInferred };
        layerMap[layer].count++;
        layerMap[layer].weight += bar.Weight || 0;
    });

    const rows        = Object.entries(layerMap).sort((a, b) => a[0].localeCompare(b[0]));
    const totalWeight = rows.reduce((s, [, v]) => s + v.weight, 0);
    rows.forEach(([layer, data]) => {
        const pct        = totalWeight > 0 ? (data.weight / totalWeight * 100) : 0;
        const isUnknown  = layer === 'Unknown';
        const isInferred = !!data.inferred;
        const tr         = document.createElement('tr');
        if (isUnknown) tr.className = 'danger-row';
        else if (isInferred) tr.className = 'inferred-row';
        const displayLayer = isInferred
            ? layer.replace(' \u2691', '') + ' <span class="inferred-badge" title="ATK-inferred">\u2691 ATK-inferred</span>'
            : layer;
        tr.innerHTML = `
            <td><strong>${isInferred ? displayLayer : layer}</strong>${isUnknown ? ' ⚠' : ''}</td>
            <td><span class="bar-type-badge ${(data.type || '').toLowerCase().replace(/\s+/g, '-')}">${data.type}</span></td>
            <td>${data.count.toLocaleString()}</td>
            <td>${data.weight.toFixed(1)}</td>
            <td>
                <div class="weight-bar-wrap">
                    <div class="weight-bar-fill" style="width:${pct.toFixed(1)}%"></div>
                    <span class="weight-bar-pct">${pct.toFixed(1)}%</span>
                </div>
            </td>`;
        container.appendChild(tr);
    });
    const totalRow = document.createElement('tr');
    totalRow.className = 'total-row';
    totalRow.innerHTML = `
        <td colspan="2"><strong>TOTAL</strong></td>
        <td><strong>${allData.length.toLocaleString()}</strong></td>
        <td><strong>${totalWeight.toFixed(1)}</strong></td>
        <td></td>`;
    container.appendChild(totalRow);
}

// ── Data table ─────────────────────────────────────────────────────────

const PAGE_SIZE = 100;
let currentPage = 1;

function applyFilters() {
    const search  = document.getElementById('search-input').value.toLowerCase().trim();
    const barType = document.getElementById('bartype-filter').value;
    filteredData = allData.filter(bar => {
        if (barType !== 'all' && bar.Bar_Type !== barType) return false;
        if (search) {
            const txt = [
                bar.Shape_Code, bar.Shape_Code_Base, bar.Coupler_Suffix, bar.Coupler_Type,
                bar.Avonmouth_Layer_Set, bar.Bar_Type, bar.Size, bar.Length,
                bar.Rebar_Mark, bar.Full_Rebar_Mark, bar.Bar_Shape, bar.Orientation,
                bar.ATK_Layer_Name, bar.GlobalId, bar.Avonmouth_ID,
            ].map(v => v == null ? '' : String(v)).join(' ').toLowerCase();
            if (!txt.includes(search)) return false;
        }
        return true;
    });
    currentPage = 1;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = '';

    const totalPages = Math.max(1, Math.ceil(filteredData.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const slice = filteredData.slice(start, start + PAGE_SIZE);

    slice.forEach(bar => {
        const isUnknown = bar.Bar_Type === 'Unknown';
        const tr = document.createElement('tr');
        if (isUnknown) tr.className = 'danger-row';

        const baseCode     = bar.Shape_Code_Base || bar.Shape_Code || '—';
        const couplerBadge = bar.Coupler_Suffix
            ? `<span class="coupler-badge" title="${bar.Coupler_Type || bar.Coupler_Suffix}">${bar.Coupler_Suffix}</span>`
            : '';

        tr.innerHTML = `
            <td class="col-shape">${baseCode}${couplerBadge}</td>
            <td>${bar.Avonmouth_Layer_Set || '—'}</td>
            <td><span class="bar-type-badge ${(bar.Bar_Type || '').toLowerCase().replace(/\s+/g, '-')}">${bar.Bar_Type || 'Unknown'}</span></td>
            <td>${bar.Size ? bar.Size + ' mm' : '—'}</td>
            <td>${bar.Length ? Number(bar.Length).toLocaleString() + ' mm' : '—'}</td>
            <td>${bar.Rebar_Mark || '—'}</td>
            <td>${bar.Bar_Shape || '—'}</td>`;
        tbody.appendChild(tr);
    });

    const countEl = document.getElementById('result-count');
    if (countEl) countEl.textContent = `${filteredData.length} bars`;

    const pager = document.getElementById('table-pagination');
    if (!pager) return;
    if (totalPages <= 1) { pager.classList.add('hidden'); return; }
    pager.classList.remove('hidden');
    document.getElementById('page-info').textContent =
        `Page ${currentPage} of ${totalPages}  (${filteredData.length} bars)`;
    document.getElementById('page-prev').disabled = currentPage <= 1;
    document.getElementById('page-next').disabled = currentPage >= totalPages;
}

// ── Export CSV ─────────────────────────────────────────────────────────

function exportCSV(filename) {
    if (!allData.length) { alert('No data to export.'); return; }
    const headers = ['GlobalId','Name','Avonmouth_Layer','ATK_Layer_Name','Effective_Mesh_Layer',
                     'Bar_Type','Orientation','Shape_Code','Shape_Code_Base','Coupler_Suffix','Coupler_Type',
                     'Bar_Shape','Size_mm','Weight_kg','Length_mm','Rebar_Mark','Full_Rebar_Mark',
                     'Avonmouth_ID','Start_X','Start_Y','Start_Z','End_X','End_Y','End_Z',
                     'Dir_X','Dir_Y','Dir_Z','Stagger_Cluster_ID','Cage_Axis'];
    let csv = headers.join(',') + '\n';
    allData.forEach(b => {
        const row = [
            b.GlobalId||'', b.Name||'',
            b.Avonmouth_Layer_Set||'', b.ATK_Layer_Name||'', b.Effective_Mesh_Layer||'',
            b.Bar_Type||'', b.Orientation||'',
            b.Shape_Code||'', b.Shape_Code_Base||'', b.Coupler_Suffix||'', b.Coupler_Type||'',
            b.Bar_Shape||'',
            b.Size||'', b.Weight||b.Calculated_Weight||'', b.Length||'',
            b.Rebar_Mark||'', b.Full_Rebar_Mark||'',
            b.Avonmouth_ID||'',
            b.Start_X!==null?b.Start_X.toFixed(1):'', b.Start_Y!==null?b.Start_Y.toFixed(1):'', b.Start_Z!==null?b.Start_Z.toFixed(1):'',
            b.End_X!==null?b.End_X.toFixed(1):'',     b.End_Y!==null?b.End_Y.toFixed(1):'',     b.End_Z!==null?b.End_Z.toFixed(1):'',
            b.Dir_X!==null?b.Dir_X.toFixed(4):'',     b.Dir_Y!==null?b.Dir_Y.toFixed(4):'',     b.Dir_Z!==null?b.Dir_Z.toFixed(4):'',
            b.Stagger_Cluster_ID||'', cageAxisName,
        ].map(v => { const s = String(v); return s.includes(',') ? `"${s}"` : s; });
        csv += row.join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.click();
}

// ── Export Excel (SheetJS) ──────────────────────────────────────────────

function exportXLSX() {
    if (!allData.length) { alert('No data to export.'); return; }
    if (typeof XLSX === 'undefined') { alert('Excel library not loaded. Check your connection.'); return; }

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Bar Schedule ──────────────────────────────────────────
    const scheduleRows = allData.map(b => ({
        'GlobalId':            b.GlobalId || '',
        'Rebar Mark':          b.Rebar_Mark || '',
        'Full Rebar Mark':     b.Full_Rebar_Mark || '',
        'Avonmouth Layer':     b.Avonmouth_Layer_Set || '',
        'ATK Layer Name':      b.ATK_Layer_Name || '',
        'Eff. Mesh Layer':     b.Effective_Mesh_Layer || '',
        'Bar Type':            b.Bar_Type || '',
        'Orientation':         b.Orientation || '',
        'Shape Code':          b.Shape_Code_Base || b.Shape_Code || '',
        'Coupler Suffix':      b.Coupler_Suffix || '',
        'Bar Shape':           b.Bar_Shape || '',
        'Size (mm)':           b.Size ? Number(b.Size) : '',
        'Length (mm)':         b.Length ? Number(b.Length) : '',
        'Weight (kg)':         b.Weight || b.Calculated_Weight ? Number(b.Weight || b.Calculated_Weight) : '',
        'Start X (mm)':        b.Start_X != null ? +b.Start_X.toFixed(1) : '',
        'Start Y (mm)':        b.Start_Y != null ? +b.Start_Y.toFixed(1) : '',
        'Start Z (mm)':        b.Start_Z != null ? +b.Start_Z.toFixed(1) : '',
        'End X (mm)':          b.End_X   != null ? +b.End_X.toFixed(1)   : '',
        'End Y (mm)':          b.End_Y   != null ? +b.End_Y.toFixed(1)   : '',
        'End Z (mm)':          b.End_Z   != null ? +b.End_Z.toFixed(1)   : '',
        'Cage Axis':           cageAxisName || '',
        'Stagger Cluster ID':  b.Stagger_Cluster_ID || '',
    }));
    const ws1 = XLSX.utils.json_to_sheet(scheduleRows);
    // Column widths
    ws1['!cols'] = [
        {wch:36},{wch:18},{wch:22},{wch:18},{wch:20},{wch:18},
        {wch:14},{wch:13},{wch:12},{wch:14},{wch:12},
        {wch:10},{wch:12},{wch:12},
        {wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},
        {wch:12},{wch:18},
    ];
    XLSX.utils.book_append_sheet(wb, ws1, 'Bar Schedule');

    // ── Sheet 2: Layer Summary ─────────────────────────────────────────
    const layerMap = {};
    allData.forEach(b => {
        const key = b.Avonmouth_Layer_Set || 'Unknown';
        if (!layerMap[key]) layerMap[key] = { layer: key, type: b.Bar_Type || '', count: 0, weight: 0 };
        layerMap[key].count++;
        layerMap[key].weight += Number(b.Weight || b.Calculated_Weight || 0);
    });
    const totalWeight = Object.values(layerMap).reduce((s, r) => s + r.weight, 0);
    const summaryRows = Object.values(layerMap)
        .sort((a, b) => b.weight - a.weight)
        .map(r => ({
            'Layer / Set':  r.layer,
            'Bar Type':     r.type,
            'Bar Count':    r.count,
            'Weight (kg)':  +r.weight.toFixed(2),
            '% of Total':   totalWeight > 0 ? +(r.weight / totalWeight * 100).toFixed(1) : 0,
        }));
    const ws2 = XLSX.utils.json_to_sheet(summaryRows);
    ws2['!cols'] = [{wch:18},{wch:14},{wch:12},{wch:14},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Layer Summary');

    // ── Filename with cage ref if available ───────────────────────────
    const cageRef = (document.getElementById('ifc-filename').textContent || 'cage')
        .replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    XLSX.writeFile(wb, `${cageRef}_rebar_schedule.xlsx`);
}

// ── EDB Excel (U-bars / Struts templates) ──────────────────────────────

/**
 * Count unique active F-face Avonmouth layers (F1A, F3A, F5A, F7A…)
 * to determine cage type: 1→single, 2→double, 3→triple, 4+→quad
 */
function detectCageType() {
    const fLayers = new Set();
    allData.forEach(b => {
        const av = (b.Avonmouth_Layer_Set || '').toUpperCase();
        if (/^F\d+A$/.test(av)) fLayers.add(av);
    });
    const n = fLayers.size;
    if (n <= 1) return 'single';
    if (n === 2) return 'double';
    if (n === 3) return 'triple';
    return 'quad';
}

// Bracing bar lookup tables — sourced from edb-ubars.xlsm / edb-struts.xlsm Span Lookup sheet
// Key = wall thickness in metres. Value = [D, E, F, G] bar diameters (mm).
// Fill into D35:G35 (ubars) / D39:G39 (struts).
const _EDB_BRACING = {
    ubars: {
        single: { 0.5: [12,12,12,6], 0.8: [12,12,16,6], 1.1: [16,12,20,6], 1.5: [20,16,25,6], 2.6: [32,20,32,6] },
        double: {                     0.8: [12,12,12,6], 1.1: [12,12,16,6], 1.5: [16,16,25,6], 2.6: [32,20,32,6] },
        triple: {                     0.8: [12,12,12,6], 1.1: [12,12,16,6], 1.5: [16,12,20,6], 2.6: [32,20,32,6] },
        quad:   {                     0.8: [12,12,12,6], 1.1: [12,12,16,6], 1.5: [16,12,20,6], 2.6: [32,20,32,6] },
    },
    struts: {
        single: { 0.5: [25,25,25,6], 0.8: [25,25,25,6], 1.1: [25,25,25,6], 1.5: [25,25,32,6], 2.6: [40,32,40,4] },
        double: {                     0.8: [25,25,25,6], 1.1: [25,25,25,6], 1.5: [25,25,32,6], 2.6: [40,32,40,3] },
        triple: {                     0.8: [25,25,25,6], 1.1: [25,25,25,6], 1.5: [25,25,32,6], 2.6: [40,32,40,3] },
        quad:   {                     0.8: [25,25,25,6], 1.1: [25,25,25,6], 1.5: [25,25,25,6], 2.6: [32,32,40,4] },
    },
};

function _lookupBracingBars(type, cageType, wallM) {
    const table = (_EDB_BRACING[type] || {})[cageType];
    if (!table) return null;
    const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
    const key  = keys.find(k => k >= wallM) ?? keys[keys.length - 1];
    return table[key] || null;
}

function computeLayerStatsForEDB() {
    const layerBars = {};
    allData.forEach(b => {
        const av = b.Avonmouth_Layer_Set;
        if (!av || !/^[FN]\d+A$/i.test(av)) return;
        if (!layerBars[av]) layerBars[av] = [];
        layerBars[av].push(b);
    });
    const stats = {};
    for (const [layer, bars] of Object.entries(layerBars)) {
        const hBars  = bars.filter(b => b.Orientation === 'Horizontal');
        const vBars  = bars.filter(b => b.Orientation === 'Vertical');
        const hSizes = hBars.map(b => b.Size).filter(s => s > 0);
        const vSizes = vBars.map(b => b.Size).filter(s => s > 0);
        const vH     = heightAlongAxis(vBars);
        stats[layer] = {
            hDiaMin:    hSizes.length ? Math.min(...hSizes) : null,
            hDiaMax:    hSizes.length ? Math.max(...hSizes) : null,
            nLacers:    countUniqueHorizPositions(hBars).count,
            vDiaMin:    vSizes.length ? Math.min(...vSizes) : null,
            vDiaMax:    vSizes.length ? Math.max(...vSizes) : null,
            vHeightMax: vH ? vH.height : null,
        };
    }
    return stats;
}

function _cageXYSpans() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    allData.forEach(b => {
        if (b.Start_X == null) return;
        const r = (b.Size || 0) / 2;
        minX = Math.min(minX, b.Start_X - r, b.End_X - r);
        maxX = Math.max(maxX, b.Start_X + r, b.End_X + r);
        minY = Math.min(minY, b.Start_Y - r, b.End_Y - r);
        maxY = Math.max(maxY, b.Start_Y + r, b.End_Y + r);
    });
    if (!isFinite(minX)) return null;
    return { spanX: maxX - minX, spanY: maxY - minY };
}

// Mesh-only XY spans (centreline ± half-dia) — fallback when BREP is not yet loaded.
// Used by getCageWidthMm / getCageLengthMm which feed Excel/EDB (mesh outer-to-outer).
function _meshXYSpans() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    allData.forEach(b => {
        if (b.Bar_Type !== 'Mesh' || b.Start_X == null) return;
        const r = (b.Size || 0) / 2;
        minX = Math.min(minX, b.Start_X - r, b.End_X - r);
        maxX = Math.max(maxX, b.Start_X + r, b.End_X + r);
        minY = Math.min(minY, b.Start_Y - r, b.End_Y - r);
        maxY = Math.max(maxY, b.Start_Y + r, b.End_Y + r);
    });
    if (!isFinite(minX)) return null;
    return { spanX: maxX - minX, spanY: maxY - minY };
}

function getCageLengthMm() {
    if (_wasm3DDims) return _wasm3DDims.meshLength;
    const s = _meshXYSpans(); return s ? Math.max(s.spanX, s.spanY) : null;
}

// Mesh-only width — outer-to-outer of mesh bars. Used by cage-sequence Excel.
function getCageWidthMm() {
    if (_wasm3DDims) return _wasm3DDims.meshWidth;
    const s = _meshXYSpans(); return s ? Math.min(s.spanX, s.spanY) : null;
}

// Overall width — outer-to-outer of ALL bars (mesh + strut + link + loose).
// Used by EDB wall-thickness autofill.
function getOverallWidthMm() {
    if (_wasm3DDims) return _wasm3DDims.overallWidth;
    const s = _cageXYSpans(); return s ? Math.min(s.spanX, s.spanY) : null;
}

// Round raw mm up to nearest standard wall thickness; return in metres
function roundWallThicknessM(rawMm) {
    const standards = [300, 500, 800, 1100, 1500, 2600];
    const found = standards.find(s => s >= rawMm);
    return (found || 2600) / 1000;
}

function autoFillEDBInputs() {
    if (!allData.length) return;
    const widthMm = getOverallWidthMm();  // overall (all bars) — wall must contain the whole cage
    if (widthMm == null) return;
    const rawMm  = widthMm + 100;
    const wallM  = roundWallThicknessM(rawMm);
    document.getElementById('edb-wall-thickness').value = wallM;
    document.getElementById('edb-wall-hint').textContent =
        `overall cage width ${Math.round(widthMm).toLocaleString()} mm + 100 mm cover = ${Math.round(rawMm)} mm → ${wallM} m`;
    updateEDBComputedInfo();
}

function updateEDBComputedInfo() {
    if (!allData.length) return;
    const wallM = parseFloat(document.getElementById('edb-wall-thickness').value);
    const info  = document.getElementById('edb-computed-info');
    if (!wallM || wallM <= 0) { info.textContent = ''; return; }
    const cageLenMm = getCageLengthMm();
    const cageWidMm = getCageWidthMm();
    if (!cageLenMm) { info.textContent = ''; return; }
    info.innerHTML = `Cage: <span>${Math.round(cageLenMm).toLocaleString()} mm</span> long &nbsp;·&nbsp; Wall thickness: <span>${wallM} m</span> &nbsp;·&nbsp; Span &amp; G-value auto-calculated in Excel`;
}

async function exportEDB(type) {
    if (!allData.length) { alert('No data to export.'); return; }
    if (_parserRejected) { alert('C01 rejected — EDB cannot be exported for a rejected cage. Resolve all C01 issues first.'); return; }
    if (typeof XlsxPopulate === 'undefined') { alert('Excel library not loaded.'); return; }

    const wallM  = parseFloat(document.getElementById('edb-wall-thickness').value);
    if (isNaN(wallM) || wallM <= 0) { alert('Wall thickness missing — analyse a cage first.'); return; }

    // UDL: round UP to 2 decimal places
    const meshBars     = allData.filter(b => b.Bar_Type === 'Mesh');
    const nonMeshBars  = allData.filter(b => b.Bar_Type !== 'Mesh' && b.Bar_Type !== 'Unknown');
    const meshW        = meshBars.reduce((s, b) => s + (b.Weight || 0), 0);
    const nonMeshW     = nonMeshBars.reduce((s, b) => s + (b.Weight || 0), 0);
    const udl          = meshW > 0 ? Math.ceil((nonMeshW / meshW) * 100) / 100 : 0;

    const layerStats = computeLayerStatsForEDB();

    // Cell mappings confirmed from blank template inspection
    // hRow = horizontal bars (C=minDia, D=maxDia, E=nLacers)
    // vRow = vertical bars  (C=vDiaMin, D=vDiaMax, F=height in m)
    const layerRows = type === 'ubars'
        ? { F1A:{h:20,v:21}, F3A:{h:22,v:23}, F5A:{h:24,v:25},
            N1A:{h:26,v:27}, N3A:{h:28,v:29}, N5A:{h:30,v:31} }
        : { F1A:{h:20,v:21}, F3A:{h:22,v:23}, F5A:{h:24,v:25}, F7A:{h:26,v:27},
            N1A:{h:28,v:29}, N3A:{h:30,v:31}, N5A:{h:32,v:33}, N7A:{h:34,v:35} };

    const udlCell  = type === 'ubars' ? 'C33' : 'C37';
    const wallCell = type === 'ubars' ? 'C35' : 'C39';
    // Note: C39 in ubars and G35/G39 are formula cells — do NOT overwrite them

    const btnId = type === 'ubars' ? 'export-ubars-btn' : 'export-struts-btn';
    const btn   = document.getElementById(btnId);
    const orig  = btn.textContent;
    btn.textContent = '⏳ Generating…'; btn.disabled = true;

    try {
        const resp = await fetch(`templates/edb-${type}.xlsm`);
        if (!resp.ok) throw new Error(`Template file not found: edb-${type}.xlsm`);
        const buf = await resp.arrayBuffer();

        // xlsx-populate reads the template preserving all styles, borders, colours, formulas
        const wb = await XlsxPopulate.fromDataAsync(buf);
        const ws = wb.sheet('Span Lookup') || wb.sheet(0);

        function setVal(ref, val) {
            if (val == null) return;
            ws.cell(ref).value(val);
        }

        // Global inputs
        setVal(udlCell,  udl);
        setVal(wallCell, wallM);

        // Per-layer data
        for (const [layer, rows] of Object.entries(layerRows)) {
            const s = layerStats[layer];
            if (!s) continue;
            // Horizontal row: min dia, max dia, lacer count
            if (s.hDiaMin  != null) setVal(`C${rows.h}`, s.hDiaMin);
            if (s.hDiaMax  != null) setVal(`D${rows.h}`, s.hDiaMax);
            if (s.nLacers  != null) setVal(`E${rows.h}`, s.nLacers);
            // Vertical row: min dia, max dia, max height (m)
            if (s.vDiaMin  != null) setVal(`C${rows.v}`, s.vDiaMin);
            if (s.vDiaMax  != null) setVal(`D${rows.v}`, s.vDiaMax);
            if (s.vHeightMax != null) setVal(`F${rows.v}`, +(s.vHeightMax / 1000).toFixed(3));
        }

        // Bracing bar sizes (D35:G35 for ubars, D39:G39 for struts)
        const cageType   = detectCageType();
        const bracingRow = type === 'ubars' ? 35 : 39;
        const bracing    = _lookupBracingBars(type, cageType, wallM);
        if (bracing) {
            setVal(`D${bracingRow}`, bracing[0]);
            setVal(`E${bracingRow}`, bracing[1]);
            setVal(`F${bracingRow}`, bracing[2]);
            setVal(`G${bracingRow}`, bracing[3]);
        }

        // H19: production line classification (> 5600mm = Bespoke, else Pallet line)
        const cageHeightMm = _wasm3DDims ? _wasm3DDims.height : null;
        if (cageHeightMm != null) setVal('H19', cageHeightMm > 5600 ? 'Bespoke' : 'Pallet line');

        const cageRef = (document.getElementById('ifc-filename').textContent || 'cage')
            .replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

        const outBuf = await wb.outputAsync();
        const blob = new Blob([outBuf], { type: 'application/vnd.ms-excel.sheet.macroenabled.12' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${cageRef}-EDB-${type}.xlsm`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
        alert(`EDB generation failed: ${e.message}`);
    } finally {
        btn.textContent = orig; btn.disabled = false;
    }
}

// ── Slab EDB Excel ────────────────────────────────────────────────────
async function exportSlabEDB() {
    if (!allData.length) { alert('No data to export.'); return; }
    if (_parserRejected) { alert('C01 rejected — EDB cannot be exported for a rejected cage.'); return; }
    if (typeof XlsxPopulate === 'undefined') { alert('Excel library not loaded.'); return; }

    const parser = new IFCParser();
    const sd = parser.extractSlabData(allData);

    const btn = document.getElementById('export-slab-btn');
    const orig = btn.textContent;
    btn.textContent = '⏳ Generating…'; btn.disabled = true;

    try {
        const resp = await fetch('templates/slab-template.xlsx');
        if (!resp.ok) throw new Error('Slab template not found: templates/slab-template.xlsx');
        const buf = await resp.arrayBuffer();

        const wb = await XlsxPopulate.fromDataAsync(buf);
        const ws = wb.sheet('INPUT SPAN RESULTS');
        if (!ws) throw new Error('Sheet "INPUT SPAN RESULTS" not found in slab template');

        const set = (col, val) => { if (val != null) ws.cell(`${col}36`).value(val); };
        set('H', sd.cageLength);
        set('I', sd.cageHeight);
        set('J', sd.totalWeight);
        set('N', sd.t1Dia);
        set('O', sd.t1Spacing);
        set('P', sd.t2Dia);
        set('Q', sd.t2Spacing);
        set('R', sd.t2Count);
        set('T', sd.b1Dia);
        set('U', sd.b1Spacing);
        set('V', sd.b2Dia);
        set('W', sd.b2Spacing);
        set('X', sd.b2Count);
        set('Z', sd.meshWeight);

        // H42: production line classification (> 5600mm = Bespoke, else Pallet line)
        if (sd.cageHeight != null) ws.cell('H42').value(sd.cageHeight > 5600 ? 'Bespoke' : 'Pallet line');

        const cageRef = (document.getElementById('ifc-filename').textContent || 'cage')
            .replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);

        const outBuf = await wb.outputAsync();
        const blob = new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${cageRef}-Slab-EDB.xlsx`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) {
        alert(`Slab EDB generation failed: ${e.message}`);
    } finally {
        btn.textContent = orig; btn.disabled = false;
    }
}

// ── Cage Review Report (C01 approved only) ────────────────────────────

async function exportCageReport() {
    if (!allData.length) { alert('No data loaded.'); return; }
    if (_parserRejected) { alert('C01 rejected — report can only be generated for approved cages.'); return; }
    if (typeof ExcelJS === 'undefined') { alert('ExcelJS library not loaded.'); return; }

    const btn  = document.getElementById('export-report-btn');
    const orig = btn.textContent;
    btn.textContent = '⏳ Generating…'; btn.disabled = true;

    try {
        // Capture 3D screenshots before anything else changes the view
        let frontImg = null, sideImg = null;
        if (window._viewer3d) {
            const views = await window._viewer3d.captureViews();
            frontImg = views.front;
            sideImg  = views.side;
        }

        const cageRef  = (document.getElementById('ifc-filename').textContent || 'cage')
            .replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const widthMm  = getCageWidthMm();
        const lengthMm = getCageLengthMm();
        const heightMm = _wasm3DDims ? _wasm3DDims.height : null;
        const cageType = detectCageType();
        const wallM    = parseFloat(document.getElementById('edb-wall-thickness').value) || null;
        const totalKg  = allData.reduce((s, b) => s + (b.Weight || 0), 0);

        const uBracing = wallM ? _lookupBracingBars('ubars',  cageType, wallM) : null;
        const stBracing= wallM ? _lookupBracingBars('struts', cageType, wallM) : null;

        const hasLinks     = allData.some(b => b.Bar_Type === 'Link Bar');
        const hasPreloaded = allData.some(b => b.Bar_Type === 'Preload Bar');
        const hasCoupled   = allData.some(b => (b.ATK_Layer_Name || '').toUpperCase().includes('CPLR'));

        const wb = new ExcelJS.Workbook();
        wb.creator = 'Avonmouth DE Tool';
        wb.created = new Date();

        const ws = wb.addWorksheet('Cage Sheet');
        ws.pageSetup.paperSize = 9; // A4
        ws.pageSetup.orientation = 'landscape';
        ws.pageSetup.fitToPage = true;
        ws.pageSetup.fitToWidth = 1;

        ws.getColumn(1).width = 30;
        ws.getColumn(2).width = 35;
        ws.getColumn(3).width = 20;
        ws.getColumn(4).width = 20;
        ws.getColumn(5).width = 20;

        const DARK  = { argb: 'FF2D3748' };
        const WHITE = { argb: 'FFFFFFFF' };
        const GREY  = { argb: 'FFF7FAFC' };
        const BORDER = { style: 'thin', color: { argb: 'FFE2E8F0' } };
        const thinBorder = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

        function addSectionHeader(text) {
            const r = ws.addRow([text]);
            r.height = 22;
            const c = r.getCell(1);
            c.font  = { bold: true, size: 11, color: WHITE };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: DARK };
            c.alignment = { vertical: 'middle', indent: 1 };
            ws.mergeCells(r.number, 1, r.number, 5);
        }

        function addDataRow(label, value) {
            const r = ws.addRow([label, value != null ? value : '—']);
            r.getCell(1).font   = { bold: true, size: 10, color: { argb: 'FF4A5568' } };
            r.getCell(1).fill   = { type: 'pattern', pattern: 'solid', fgColor: GREY };
            r.getCell(1).border = thinBorder;
            r.getCell(1).alignment = { vertical: 'middle', indent: 1 };
            r.getCell(2).font   = { size: 10 };
            r.getCell(2).border = thinBorder;
            r.getCell(2).alignment = { vertical: 'middle' };
            ws.mergeCells(r.number, 2, r.number, 5);
        }

        // ── Title ──
        const title = ws.addRow(['CAGE SEQUENCING REVIEW']);
        title.height = 34;
        title.getCell(1).font = { bold: true, size: 16, color: DARK };
        title.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
        ws.mergeCells(1, 1, 1, 5);

        const dateLine = ws.addRow([`Generated: ${new Date().toLocaleDateString('en-GB')}  ·  Avonmouth DE Tool`]);
        dateLine.getCell(1).font = { size: 9, color: { argb: 'FF718096' } };
        dateLine.getCell(1).alignment = { horizontal: 'center' };
        ws.mergeCells(2, 1, 2, 5);

        ws.addRow([]); // spacer

        // ── Cage Details ──
        addSectionHeader('Cage Details');
        addDataRow('Cage Reference', cageRef);
        addDataRow('Cage Type', cageType.charAt(0).toUpperCase() + cageType.slice(1) + ' Mesh');
        addDataRow('Width', widthMm  != null ? `${Math.round(widthMm).toLocaleString()} mm`  : null);
        addDataRow('Length',lengthMm != null ? `${Math.round(lengthMm).toLocaleString()} mm` : null);
        addDataRow('Height',heightMm != null ? `${Math.round(heightMm).toLocaleString()} mm` : null);
        addDataRow('Total Weight', totalKg > 0 ? `${(totalKg / 1000).toFixed(2)} t` : null);
        addDataRow('Wall Thickness', wallM ? `${wallM} m` : null);

        ws.addRow([]);

        // ── TW Bar Sizes ──
        addSectionHeader('TW Bar Sizes');
        // U-bars bracing
        if (uBracing) {
            addDataRow('U Strut (D)', `${uBracing[0]} mm`);
            addDataRow('U Strut (E)', `${uBracing[1]} mm`);
            addDataRow('U Strut (F)', `${uBracing[2]} mm`);
            addDataRow('U Strut (G)', `${uBracing[3]} mm`);
        }
        // Struts bracing
        if (stBracing) {
            addDataRow('Vert Z Strut (D)', `${stBracing[0]} mm`);
            addDataRow('Plan Z Strut (E)', `${stBracing[1]} mm`);
            addDataRow('Plan Z Strut (F)', `${stBracing[2]} mm`);
            addDataRow('Nominal Strut (G)',`${stBracing[3]} mm`);
        }

        ws.addRow([]);

        // ── Cage Features ──
        addSectionHeader('Cage Features');
        addDataRow('Shear Links',    hasLinks     ? 'Yes' : 'No');
        addDataRow('Preloaded Bars', hasPreloaded ? 'Yes' : 'No');
        addDataRow('Coupled Bars',   hasCoupled   ? 'Yes' : 'No');

        // ── 3D Views ──
        if (frontImg || sideImg) {
            ws.addRow([]);
            addSectionHeader('3D Views');

            let imgRowStart = ws.lastRow.number + 1;
            const IMG_H = 200; // px height for image placeholder rows (approx 15 rows)
            const IMG_W = 480;
            const ROW_RESERVE = 15;

            if (frontImg) {
                ws.addRow(['Front View']);
                ws.lastRow.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF718096' } };
                for (let i = 1; i < ROW_RESERVE; i++) ws.addRow([]);
                const base64 = frontImg.replace(/^data:image\/png;base64,/, '');
                const imgId  = wb.addImage({ base64, extension: 'png' });
                ws.addImage(imgId, {
                    tl: { col: 0, row: imgRowStart - 1 },
                    ext: { width: IMG_W, height: IMG_H },
                    editAs: 'oneCell',
                });
                imgRowStart = ws.lastRow.number + 2;
            }

            if (sideImg) {
                ws.addRow(['Side View']);
                ws.lastRow.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF718096' } };
                for (let i = 1; i < ROW_RESERVE; i++) ws.addRow([]);
                const base64 = sideImg.replace(/^data:image\/png;base64,/, '');
                const imgId  = wb.addImage({ base64, extension: 'png' });
                ws.addImage(imgId, {
                    tl: { col: 0, row: imgRowStart - 1 },
                    ext: { width: IMG_W, height: IMG_H },
                    editAs: 'oneCell',
                });
            }
        }

        const buf  = await wb.xlsx.writeBuffer();
        const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = `${cageRef}-CageReview.xlsx`;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);

    } catch (e) {
        console.error('[exportCageReport]', e);
        alert(`Report generation failed: ${e.message}`);
    } finally {
        btn.textContent = orig; btn.disabled = false;
    }
}

// ── C01 detail cards ───────────────────────────────────────────────────

function buildDetailPageURL(title, bars) {
    const rows = bars.map(b => `
        <tr>
            <td>${b.GlobalId || '—'}</td>
            <td>${b.Rebar_Mark || b.Full_Rebar_Mark || '—'}</td>
            <td>${b.Length ? Number(b.Length).toLocaleString() + ' mm' : '—'}</td>
            <td>${b.Shape_Code_Base || b.Shape_Code || '—'}${b.Coupler_Suffix ? ' <span class="badge">' + b.Coupler_Suffix + '</span>' : ''}</td>
            <td>${b.Size ? b.Size + ' mm' : '—'}</td>
            <td>${b.Avonmouth_Layer_Set || '—'}</td>
            <td>${b.ATK_Layer_Name || '—'}</td>
        </tr>`).join('');
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${title}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#f7f7fb;color:#222;padding:24px}h1{font-size:1.2rem;margin-bottom:4px;color:#c53030}.sub{font-size:.8rem;color:#666;margin-bottom:20px}table{width:100%;border-collapse:collapse;background:white;border-radius:10px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}th{background:#2d3748;color:white;padding:10px 12px;font-size:.78rem;text-align:left;text-transform:uppercase;letter-spacing:.05em}td{padding:8px 12px;font-size:.82rem;border-bottom:1px solid #eee}tr:last-child td{border-bottom:none}tr:nth-child(even){background:#fafafa}.badge{display:inline-block;background:#f56565;color:white;border-radius:8px;padding:1px 6px;font-size:.68rem;font-weight:700;margin-left:4px}.count{font-weight:700;color:#c53030;font-size:1rem;margin-bottom:16px}</style></head>
<body><h1>C01 — ${title}</h1><p class="sub">IFC Rebar Analyzer v2 | ${new Date().toLocaleString()}</p>
<p class="count">${bars.length} bar${bars.length !== 1 ? 's' : ''}</p>
<table><thead><tr><th>GlobalId</th><th>Rebar Mark</th><th>Length</th><th>Shape Code</th><th>Size</th><th>Layer</th><th>ATK Layer</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
    return URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
}

function buildC01Cards(parser) {
    const row = document.getElementById('c01-cards-row');

    const unknownCard = document.getElementById('c01-unknown-card');
    if (parser.unknownCount > 0) {
        document.getElementById('c01-unknown-count').textContent = parser.unknownCount;
        document.getElementById('c01-unknown-link').href = buildDetailPageURL('Unknown Bars', parser.unknownBars || allData.filter(b => b.Bar_Type === 'Unknown'));
        unknownCard.classList.remove('hidden');
    } else { unknownCard.classList.add('hidden'); }

    const missingLayerCard = document.getElementById('c01-missing-layer-card');
    if (missingLayerCard) {
        if (parser.missingLayerCount > 0) {
            document.getElementById('c01-missing-layer-count').textContent = parser.missingLayerCount;
            document.getElementById('c01-missing-layer-link').href = buildDetailPageURL('Missing Avonmouth Layer', parser.missingLayerBars || allData.filter(b => !b.Avonmouth_Layer_Set));
            missingLayerCard.classList.remove('hidden');
        } else { missingLayerCard.classList.add('hidden'); }
    }

    const dupCard = document.getElementById('c01-dup-card');
    if (parser.duplicateCount > 0) {
        document.getElementById('c01-dup-count').textContent = parser.duplicateCount;
        document.getElementById('c01-dup-link').href = buildDetailPageURL('Duplicate GlobalIds', parser.duplicateBars || []);
        dupCard.classList.remove('hidden');
    } else { dupCard.classList.add('hidden'); }

    const weightCard = document.getElementById('c01-weight-card');
    if (parser.missingWeightCount > 0) {
        document.getElementById('c01-weight-count').textContent = parser.missingWeightCount;
        document.getElementById('c01-weight-link').href = buildDetailPageURL('Missing ATK Weight', parser.missingWeightBars || []);
        weightCard.classList.remove('hidden');
    } else { weightCard.classList.add('hidden'); }

    const preloadCard = document.getElementById('c01-preload-card');
    if (preloadCard) {
        const prlPrc = _computePRLPRCMismatches();
        const mis    = prlPrc ? prlPrc.totalMis : 0;
        if (mis > 0) {
            document.getElementById('c01-preload-count').textContent = mis;
            document.getElementById('c01-preload-link').href =
                buildDetailPageURL('PRL/PRC Mislabelled', (prlPrc.mismatches || []).map(m => m.bar));
            preloadCard.classList.remove('hidden');
        } else { preloadCard.classList.add('hidden'); }
    }

    const anyVisible = parser.unknownCount > 0 || parser.missingLayerCount > 0 ||
                       parser.duplicateCount > 0 || parser.missingWeightCount > 0 ||
                       (document.getElementById('c01-preload-card') &&
                        !document.getElementById('c01-preload-card').classList.contains('hidden'));
    row.classList.toggle('hidden', !anyVisible);
}

// ── Step detection ─────────────────────────────────────────────────────

function runStepDetection() {
    const btn = document.getElementById('run-step-btn');
    btn.textContent = '⏳ Running…'; btn.disabled = true;
    setTimeout(() => {
        try { _doStepDetection(); }
        finally { btn.textContent = '▶ Re-run Step Check'; btn.disabled = false; }
    }, 20);
}

function _doStepDetection() {
    const GRID     = 50;
    const STEP_THR = 3;    // minimum step height to report (mm)
    const STEP_MAX = 200;  // ignore deliberate level changes above this (mm)

    const vertBars = allData.filter(b =>
        b.Bar_Type === 'Mesh' && b.Start_Z !== null && b.Dir_Z !== null && Math.abs(b.Dir_Z) >= 0.5
    );
    if (!vertBars.length) { _renderStepResults([], 'No vertical bars found.'); _setBox5Step(false); return; }

    // Group by XY grid cell
    const cells = new Map();
    vertBars.forEach(b => {
        const gx = Math.round(b.Start_X / GRID) * GRID;
        const gy = Math.round(b.Start_Y / GRID) * GRID;
        const key = `${gx}|${gy}`;
        if (!cells.has(key)) cells.set(key, { gx, gy, bars: [] });
        cells.get(key).bars.push(b);
    });

    const steps = [];
    cells.forEach(({ gx, gy, bars }) => {
        // De-duplicate by Rebar_Mark — same mark = same bar type, won't have different originating plane
        // Take the maximum top Z per unique rebar mark
        const markMap = new Map();
        bars.forEach(b => {
            const mark = b.Rebar_Mark || b.Full_Rebar_Mark || b.GlobalId;
            const top  = Math.max(b.Start_Z, b.End_Z);
            const prev = markMap.get(mark);
            if (!prev || top > prev.top)
                markMap.set(mark, { top, layer: b.Avonmouth_Layer_Set || b.ATK_Layer_Name || '?' });
        });
        if (markMap.size < 2) return;

        const entries = [...markMap.values()];
        const tops    = entries.map(e => e.top);
        const minTop  = Math.min(...tops);
        const maxTop  = Math.max(...tops);
        const stepH   = maxTop - minTop;
        if (stepH < STEP_THR || stepH > STEP_MAX) return;

        const layers = [...new Set(entries.map(e => e.layer))].sort().join(', ');
        steps.push({ gx, gy, markCount: markMap.size, minTop, maxTop, stepH, layers });
    });

    steps.sort((a, b) => b.stepH - a.stepH);
    _renderStepResults(steps, null);
    _setBox5Step(steps.length > 0);
}

// ── PRL / PRC geometry check ───────────────────────────────────────────

function _computeMeshBoundingBox() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    allData.forEach(b => {
        if (b.Bar_Type !== 'Mesh' || b.Start_X == null) return;
        const r = (b.Size || 0) / 2;
        minX = Math.min(minX, b.Start_X - r, b.End_X - r);
        maxX = Math.max(maxX, b.Start_X + r, b.End_X + r);
        minY = Math.min(minY, b.Start_Y - r, b.End_Y - r);
        maxY = Math.max(maxY, b.Start_Y + r, b.End_Y + r);
        minZ = Math.min(minZ, b.Start_Z - r, b.End_Z - r);
        maxZ = Math.max(maxZ, b.Start_Z + r, b.End_Z + r);
    });
    return isFinite(minX) ? { minX, maxX, minY, maxY, minZ, maxZ } : null;
}

function _barIntersectsMeshBox(bar, box) {
    // AABB overlap test — bar's axis-aligned bounding box vs mesh bounding box
    const bMinX = Math.min(bar.Start_X, bar.End_X);
    const bMaxX = Math.max(bar.Start_X, bar.End_X);
    const bMinY = Math.min(bar.Start_Y, bar.End_Y);
    const bMaxY = Math.max(bar.Start_Y, bar.End_Y);
    const bMinZ = Math.min(bar.Start_Z, bar.End_Z);
    const bMaxZ = Math.max(bar.Start_Z, bar.End_Z);
    return bMaxX >= box.minX && bMinX <= box.maxX
        && bMaxY >= box.minY && bMinY <= box.maxY
        && bMaxZ >= box.minZ && bMinZ <= box.maxZ;
}

// Returns { prlCorrect, prlMismatch, prcCorrect, prcMismatch, mismatches[], total, totalMis }
// or null if no preload bars / no mesh box
function _computePRLPRCMismatches() {
    const preloadBars = allData.filter(b => b.Bar_Type === 'Preload Bar' && b.Start_X != null);
    if (!preloadBars.length) return null;
    const box = _computeMeshBoundingBox();
    if (!box) return null;

    let prlCorrect = 0, prlMismatch = 0, prcCorrect = 0, prcMismatch = 0;
    const mismatches = [];

    preloadBars.forEach(b => {
        const labeled = (b.Avonmouth_Layer_Set || '').toUpperCase();
        const isPRL   = labeled.startsWith('PRL');
        const isPRC   = labeled.startsWith('PRC');
        if (!isPRL && !isPRC) return;

        const inside   = _barIntersectsMeshBox(b, box);
        const geoLabel = inside ? 'PRL' : 'PRC';
        const match    = (isPRL && inside) || (isPRC && !inside);

        if (match) {
            isPRL ? prlCorrect++ : prcCorrect++;
            b._prlPrcMismatch = false; // ensure flag is clear on correct bars
        } else {
            isPRL ? prlMismatch++ : prcMismatch++;
            b._prlPrcMismatch = true;  // tag for 3D viewer highlight
            mismatches.push({ bar: b, labeled: isPRL ? 'PRL' : 'PRC', geo: geoLabel });
        }
    });

    const total    = prlCorrect + prlMismatch + prcCorrect + prcMismatch;
    const totalMis = prlMismatch + prcMismatch;
    return { prlCorrect, prlMismatch, prcCorrect, prcMismatch, mismatches, total, totalMis };
}

function _renderPRLPRCResults(result) {
    const resultsDiv = document.getElementById('prl-prc-results');
    const summaryDiv = document.getElementById('prl-prc-summary');
    const tableWrap  = document.getElementById('prl-prc-table-wrap');
    const tbody      = document.getElementById('prl-prc-tbody');
    if (!resultsDiv) return;
    resultsDiv.classList.remove('hidden');

    if (!result) {
        summaryDiv.innerHTML = '<div class="clash-ok">ℹ️ No preload bars (PRL/PRC) found in this cage.</div>';
        tableWrap.style.display = 'none';
        return;
    }

    const { prlCorrect, prlMismatch, prcCorrect, prcMismatch, mismatches, total, totalMis } = result;

    if (totalMis === 0) {
        summaryDiv.innerHTML = `<div class="clash-ok">✅ All ${total} preload bar${total !== 1 ? 's' : ''} correctly classified — PRL: ${prlCorrect}, PRC: ${prcCorrect}</div>`;
        tableWrap.style.display = 'none';
    } else {
        summaryDiv.innerHTML = `<div class="clash-fail">🚫 ${totalMis} mislabelled preload bar${totalMis !== 1 ? 's' : ''} — PRL: ${prlCorrect} correct / ${prlMismatch} mismatch &nbsp;·&nbsp; PRC: ${prcCorrect} correct / ${prcMismatch} mismatch</div>`;
        tbody.innerHTML = '';
        mismatches.forEach(({ bar, labeled, geo }) => {
            const tr = document.createElement('tr');
            tr.className = 'danger-row';
            tr.innerHTML = `
                <td>${bar.Rebar_Mark || bar.Full_Rebar_Mark || '—'}</td>
                <td>${labeled}</td>
                <td>${geo}</td>
                <td>⚠️ Mismatch</td>
                <td>${bar.Avonmouth_Layer_Set || '—'}</td>
                <td>${bar.Size ? bar.Size + ' mm' : '—'}</td>`;
            tbody.appendChild(tr);
        });
        tableWrap.style.display = '';
    }
}

function _setBox5Step(hasStep) {
    const el = document.getElementById('dim-step');
    if (!el) return;
    el.textContent = hasStep ? 'Yes' : 'No';
    el.className   = 'dim-value ' + (hasStep ? 'dim-yes' : 'dim-no');
}

function _renderStepResults(steps, errMsg) {
    const resultsDiv = document.getElementById('step-results');
    const summaryDiv = document.getElementById('step-summary');
    const tableWrap  = document.getElementById('step-table-wrap');
    const tbody      = document.getElementById('step-tbody');
    resultsDiv.classList.remove('hidden');

    if (errMsg) {
        summaryDiv.innerHTML = `<div class="clash-ok">ℹ️ ${errMsg}</div>`;
        tableWrap.style.display = 'none';
        return;
    }
    if (steps.length === 0) {
        summaryDiv.innerHTML = '<div class="clash-ok">✅ No steps detected — all unique bar marks at the same XY position have tops within 3 mm of each other.</div>';
        tableWrap.style.display = 'none';
        return;
    }
    summaryDiv.innerHTML = `<div class="clash-fail">📐 ${steps.length} step location${steps.length > 1 ? 's' : ''} detected (bar tops differ by 3–200 mm between different rebar marks)</div>`;
    tbody.innerHTML = '';
    steps.forEach((s, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${idx + 1}</td>
            <td>${Math.round(s.gx).toLocaleString()}</td>
            <td>${Math.round(s.gy).toLocaleString()}</td>
            <td>${s.markCount}</td>
            <td>${s.layers || '—'}</td>
            <td>${Math.round(s.minTop).toLocaleString()}</td>
            <td>${Math.round(s.maxTop).toLocaleString()}</td>
            <td class="${s.stepH > 100 ? 'clash-severe' : ''}">${Math.round(s.stepH).toLocaleString()}</td>`;
        tbody.appendChild(tr);
    });
    tableWrap.style.display = '';
}

// ── Sample files ZIP download ──────────────────────────────────────────

async function downloadAllSamples() {
    const btn = document.getElementById('download-all-samples-btn');
    const origText = btn.textContent;
    btn.textContent = '⏳ Building ZIP…'; btn.disabled = true;
    const FILES = ['examples/P165_C2.txt', 'examples/P7019_C1.ifc'];
    try {
        const encoder = new TextEncoder(), parts = [];
        for (const path of FILES) {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`Failed: ${path}`);
            parts.push({ name: path.split('/').pop(), data: new Uint8Array(await res.arrayBuffer()) });
        }
        const crc32Table = (() => {
            const t = new Uint32Array(256);
            for (let i = 0; i < 256; i++) {
                let c = i;
                for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                t[i] = c;
            }
            return t;
        })();
        const crc32 = d => { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = crc32Table[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
        const le16  = v => [v & 0xFF, (v >> 8) & 0xFF];
        const le32  = v => [v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF];
        const now   = new Date();
        const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
        const lhs   = [], offsets = [];
        parts.forEach(({ name, data }) => {
            const nb = encoder.encode(name), crc = crc32(data);
            offsets.push(lhs.reduce((s, h) => s + h.length, 0));
            lhs.push(new Uint8Array([0x50,0x4B,0x03,0x04,20,0,0,0,0,0,...le16(dosTime),...le16(dosDate),...le32(crc),...le32(data.length),...le32(data.length),...le16(nb.length),0,0,...nb,...data]));
        });
        const cds = parts.map(({ name, data }, i) => {
            const nb = encoder.encode(name), crc = crc32(data);
            return new Uint8Array([0x50,0x4B,0x01,0x02,20,0,20,0,0,0,0,0,...le16(dosTime),...le16(dosDate),...le32(crc),...le32(data.length),...le32(data.length),...le16(nb.length),0,0,0,0,0,0,0,0,0,0,0,0,...le32(offsets[i]),...nb]);
        });
        const cdOff = lhs.reduce((s, h) => s + h.length, 0);
        const cdSz  = cds.reduce((s, e) => s + e.length, 0);
        const eocd  = new Uint8Array([0x50,0x4B,0x05,0x06,0,0,0,0,...le16(parts.length),...le16(parts.length),...le32(cdSz),...le32(cdOff),0,0]);
        const total = [...lhs,...cds,eocd].reduce((s,a)=>s+a.length,0);
        const zip = new Uint8Array(total); let off = 0;
        [...lhs,...cds,eocd].forEach(a => { zip.set(a, off); off += a.length; });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
        a.download = 'ifc-analyzer-samples.zip'; a.click();
    } catch (err) {
        console.error('ZIP failed:', err);
        alert('Download failed: ' + err.message);
    } finally {
        btn.textContent = origText; btn.disabled = false;
    }
}
