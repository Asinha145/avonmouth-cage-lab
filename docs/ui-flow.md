# UI Flow — Three-Stage Access Control & Datum Gate

> Complete redesign of user workflow: passcode access → mandatory production number → datum confirmation before exports enabled.

---

## Overview

The tool now implements a strict three-stage flow to ensure proper access control, mandatory metadata capture, and explicit datum confirmation before any exports are available.

**Key change**: All exports are now **DISABLED by default** and only unlock after a user explicitly sets the datum by clicking "Set Datum" button. This prevents accidental exports with wrong datum orientation.

---

## Stage 1: Passcode Gate

**Visible on page load.** Only thing rendered.

### Form

- Title: "Avonmouth Cage Tool"
- Hint: "Enter access code to continue"
- Input: password field (⚫ masked)
- Button: "Unlock →"
- Error message: "Incorrect code. Try again." (hidden until wrong entry)

### Behavior

- **Correct passcode** (`4286`): error hidden, passcode section slides away, main content visible
- **Wrong passcode**: error shown, input cleared, focus moved to input for retry
- **Enter key**: triggers click event on unlock button (no form submission)
- **Persistence**: unlock stored in `sessionStorage['cage-tool-unlocked']` — survives page reload but not browser close

### Locked State (Until Correct Passcode)

```
HIDDEN: file input, production number input, cage viewer button
HIDDEN: 3D viewer, results cards, export buttons, tables
VISIBLE: passcode card only
```

---

## Stage 2: Upload + Production Number

**Visible after passcode unlock.**

### Form

```
┌─ Cage File Upload ──────────────────┐
│ IFC file picker (drag-drop enabled) │
└─────────────────────────────────────┘

┌─ Production Details ────────────────┐
│ Production No. [required]           │
│  input placeholder: "e.g. 1700"     │
│  helper text: "Required before analysis" │
│                                     │
│ Cage Reference [auto-extracted]     │
│  readonly input (light blue BG)      │
│  status: "✓ from IFC" or "⚠ not in IFC — edit if needed" │
│  [editable if not found in IFC]     │
└─────────────────────────────────────┘

Button: "Cage Viewer" [DISABLED until both file + prod# filled]
```

### Behavior

**File input:**
- Single IFC file only
- Drag-drop zone spans entire section
- On file selected: filename shown in help text, check enablement
- On drop: set `window._droppedFile`, check enablement

**Production Number input:**
- Text input, any string accepted
- `required` HTML5 attribute (browser-native check)
- On input change: check enablement
- Stored in `_productionNumber` global when "Cage Viewer" clicked

**Cage Reference input:**
- Auto-filled from `parser.cageReference` after file parses
- If found: readonly, green status "✓ from IFC"
- If not found: editable, orange status "⚠ not in IFC — edit if needed"
- User can edit manually if extraction failed
- Stored in `_cageReference` global when "Cage Viewer" clicked

**Button enablement logic:**
```javascript
enabled = (file exists) AND (production-number.trim().length > 0)
```

Called on:
- File input change
- Production number input change
- Drop zone drop
- Any time production number value changes

### Unlock Condition

Both filled → "Cage Viewer" button changes to enabled (blue, clickable)

---

## Stage 3: Datum Gate (LOCKED EXPORTS)

**Visible after BREP finishes loading** (3D viewer rendered).

### Workflow

```
1. User clicks "Cage Viewer"
   → File parsed
   → BREP loads (async)
   → 3D viewer renders

2. BREP ready (_brepReady = true)
   → Datum block becomes visible
   → Datum Side dropdown auto-populated: _detectDatumSide() → "left" or "right"
   → For slab cages: Datum Height dropdown also visible
   → Orange notice: "🔒 Set datum to unlock exports"
   → All 8 export buttons DISABLED
   → Preview: datum markers shown at auto-detected position (orange dots on BREP)

3. User selects datum orientation (left/right, +top/bottom for slab)
   → Datum markers update in real-time
   → (No export button change yet)

4. User clicks "Set Datum"
   → _datumSet = true
   → All 8 export buttons ENABLED
   → Orange notice hidden
   → Green notice shown: "✓ Datum set · Exports unlocked"
   → "Reset Datum" button becomes visible

5. (Optional) User clicks "Reset Datum"
   → _datumSet = false
   → All 8 export buttons DISABLED again
   → Green notice hidden, orange notice shown again
   → "Reset Datum" button hidden
   → Button text changes back to "Set Datum"
```

### Components

**Datum Block** (box with dark background #1a1a2e):

```
┌──────────────────────────────────────────┐
│ Datum Side: [Left ▼] [Right ▼]           │
│ Datum Height: [Bottom ▼] [Top ▼] (slab) │
│                                          │
│ [Set Datum] button (purple gradient)     │
│ [Reset Datum] button (orange, hidden)    │
│                                          │
│ 🔒 Set datum to unlock exports (orange)  │
│ ✓ Datum set · Exports unlocked (green)   │
└──────────────────────────────────────────┘
```

**Dropdown options:**
- `datum-side-select`: `["left", "right"]` → `_detectDatumSide()` auto-selected
- `slab-face-select` (hidden for walls): `["bottom", "top"]` → "bottom" default

**Button styles:**
- `btn-datum-set`: purple gradient, white text, `cursor: pointer`
- `btn-datum-reset`: orange border + text, transparent BG, `cursor: pointer`
- Disabled export buttons: opacity 0.35, `pointer-events: none`, `cursor: not-allowed`

---

## Export Gate (Secondary)

After "Set Datum" unlock, secondary gates apply:

| Gate | Condition | Blocked buttons |
|---|---|---|
| C01 rejection (`_parserRejected`) | cage has unknown bars / duplicates / missing data | export-ubars-btn, export-struts-btn, export-slab-btn, export-report-btn |
| VSHS presence | cage has no VS/HS bars | export-template-dxf-btn |
| Slab/wall visibility | `_isSlabCage` false | export-slab-btn hidden (display: none) |

All these checked by `_applySecondaryGates()` called after `_setExportsEnabled(true)`.

---

## Key Functions (main.js)

| Function | Purpose |
|---|---|
| `_unlockTool()` | Hide passcode, show main, store in sessionStorage |
| `_checkEnableCageViewer()` | Check file + prod# both filled, enable/disable Cage Viewer btn |
| `_showDatumBlock()` | Reveal datum block, auto-detect side, show datum markers |
| `_setDatumConfirmed()` | Set `_datumSet=true`, update notices, call `_setExportsEnabled(true)` |
| `_resetDatum()` | Set `_datumSet=false`, hide Reset btn, call `_setExportsEnabled(false)`, re-show initial markers |
| `_setExportsEnabled(enabled)` | Single source of truth: enable/disable all 8 export buttons + call `_applySecondaryGates()` |
| `_applySecondaryGates()` | Layer C01, VSHS, slab/wall gates on top of datum unlock |

---

## State Variables (main.js)

| Variable | Type | Scope | Purpose |
|---|---|---|---|
| `_productionNumber` | string | module | Production number entered by user (e.g. "1700") |
| `_cageReference` | string | module | Cage reference auto-extracted from IFC or user-edited |
| `_datumSet` | boolean | module | `true` = "Set Datum" clicked, exports enabled; `false` = locked |
| `_brepReady` | boolean | module | `true` = 3D viewer BREP finished loading, datum block visible |
| `sessionStorage['cage-tool-unlocked']` | string | browser storage | `'1'` = passcode correct, persist across reload |

---

## HTML Changes (index.html)

### A. Passcode Section (NEW)

```html
<section id="passcode-section" class="passcode-section">
    <div class="passcode-card">
        <div class="passcode-icon">🔒</div>
        <h2>Avonmouth Cage Tool</h2>
        <p class="passcode-hint">Enter access code to continue</p>
        <input type="password" id="passcode-input" placeholder="Access code"
               autocomplete="off" class="passcode-input">
        <button id="passcode-btn" class="btn-primary">Unlock →</button>
        <p id="passcode-error" class="passcode-error hidden">Incorrect code. Try again.</p>
    </div>
</section>
```

### B. Main (HIDDEN until passcode correct)

```html
<main class="main-hidden">
    <!-- file upload, production number, results, exports, etc. -->
</main>
```

Start with class `main-hidden`; removed on unlock.

### C. Upload Form (MODIFIED)

```html
<div class="cage-ref-fields">
    <div class="cage-ref-row">
        <label for="production-number">
            Production No. <span class="required-star">*</span>
        </label>
        <input type="text" id="production-number" placeholder="e.g. 1700" required>
        <span class="field-hint">Required before analysis</span>
    </div>
    <div class="cage-ref-row">
        <label for="cage-reference">Cage Reference</label>
        <input type="text" id="cage-reference" placeholder="Auto-extracted from IFC"
               class="cage-ref-auto" readonly>
        <span class="cage-ref-status" id="cage-ref-status"></span>
    </div>
</div>
```

### D. Datum Block (NEW)

```html
<div id="datum-block" class="datum-block hidden">
    <div class="datum-block-inner">
        <div class="datum-side-control" id="datum-side-control">
            <span class="datum-side-label">Datum Side</span>
            <select id="datum-side-select">
                <option value="left">Left</option>
                <option value="right">Right</option>
            </select>
        </div>
        <div class="datum-side-control hidden" id="slab-face-control">
            <span class="datum-side-label">Datum Height</span>
            <select id="slab-face-select">
                <option value="bottom">Bottom</option>
                <option value="top">Top</option>
            </select>
        </div>
        <button id="datum-set-btn" class="btn-datum-set">Set Datum</button>
        <button id="datum-reset-btn" class="btn-datum-reset hidden">Reset Datum</button>
    </div>
    <div id="datum-pending-notice" class="datum-pending-notice">
        🔒 Set datum to unlock exports
    </div>
    <div id="datum-confirmed-notice" class="datum-confirmed-notice hidden">
        ✓ Datum set · Exports unlocked
    </div>
</div>
```

### E. Export Buttons (MODIFIED)

All export buttons start with `disabled` attribute:

```html
<button id="export-excel-btn" class="btn-secondary" disabled>📊 Excel</button>
<button id="export-ubars-btn" class="btn-edb" disabled>🏗️ U-Bars EDB</button>
<!-- etc. -->
```

---

## CSS Classes (style.css — NEW/MODIFIED)

```css
.passcode-section {
    display: flex; align-items: center; justify-content: center; 
    min-height: 70vh;
}
.passcode-card {
    background: white; border-radius: 20px; padding: 48px 40px;
    text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.15);
    max-width: 400px; width: 100%;
}
.passcode-card h2 { color: #667eea; margin: 12px 0 6px; }
.passcode-hint { color: #888; font-size: .9rem; margin-bottom: 24px; }
.passcode-input {
    width: 100%; padding: 12px 16px; border: 2px solid #d1d5db;
    border-radius: 10px; font-size: 1.1rem; text-align: center;
    letter-spacing: 3px; margin-bottom: 16px; box-sizing: border-box;
}
.passcode-input:focus { outline: none; border-color: #667eea; }
.passcode-error { color: #e53e3e; font-size: .85rem; margin-top: 10px; }
.main-hidden { display: none !important; }

.required-star { color: #e53e3e; margin-left: 2px; }
.field-hint { font-size: .75rem; color: #999; display: block; margin-top: 2px; }
.cage-ref-ok   { color: #38a169; font-size: .8rem; }
.cage-ref-warn { color: #d97706; font-size: .8rem; }
.cage-ref-auto { background: #f8f9ff; }
.cage-ref-auto[readonly] { color: #555; cursor: default; }

.datum-block {
    background: #1a1a2e; border-radius: 12px; padding: 16px 20px;
    margin: 16px 0; display: flex; flex-direction: column; gap: 12px;
}
.datum-block-inner {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
}
.btn-datum-set {
    padding: 8px 22px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    color: white; border: none; border-radius: 8px;
    font-size: .9rem; font-weight: 600; cursor: pointer;
}
.btn-datum-reset {
    padding: 8px 22px; background: transparent;
    color: #ff8c00; border: 2px solid #ff8c00; border-radius: 8px;
    font-size: .9rem; font-weight: 600; cursor: pointer;
}
.datum-pending-notice {
    font-size: .82rem; color: #f6ad55;
    padding: 6px 12px; background: rgba(246,173,85,.1);
    border: 1px solid rgba(246,173,85,.3); border-radius: 6px;
}
.datum-confirmed-notice {
    font-size: .82rem; color: #68d391;
    padding: 6px 12px; background: rgba(104,211,145,.1);
    border: 1px solid rgba(104,211,145,.3); border-radius: 6px;
}

.btn-secondary:disabled, .btn-edb:disabled {
    opacity: .35 !important; cursor: not-allowed; pointer-events: none !important;
}
```

---

## Commits

| Hash | Description | Date |
|---|---|---|
| (UI refactor branch) | Three-stage UI: passcode, production-number, datum gate | 31 Mar 2026 |
| (fixes) | Fix passcode auto-unlock, production-number gating, cage-reference extraction | 2–5 Apr 2026 |
| `8067718` | DXF improvements (includes datum gate cleanup) | 24 Apr 2026 |

---

## Testing Checklist

- [ ] Passcode screen shows on load; wrong code → error; correct → main visible; reload → auto-unlocked
- [ ] Production-number input required; Cage Viewer disabled until filled
- [ ] Cage reference auto-extracted from IFC (green ✓ indicator) or editable fallback (orange ⚠ indicator)
- [ ] After Cage Viewer clicked: 3D loads → datum block appears → exports ALL disabled
- [ ] Datum dropdown auto-detects left/right; slab cages show height dropdown
- [ ] Select datum + click Set Datum → exports enabled, green notice shown, Reset Datum visible
- [ ] Change datum after Set Datum → should auto-reset (test behavior)
- [ ] Reset Datum → exports disabled, pending notice shown, Reset btn hidden
- [ ] C01 rejected cage: Set Datum → EDB/Report still disabled
- [ ] No VS/HS cage: Set Datum → Template DXF button still disabled
- [ ] Slab cage: Slab EDB visible; wall cage: Slab EDB hidden

---

## Future Enhancements

- [ ] Password hash instead of plain-text passcode in source
- [ ] Passcode change via settings panel (admin mode)
- [ ] Two-factor unlock (passcode + user name)
- [ ] Datum side auto-detect from bar naming (if convention available)
- [ ] "Update Datum" instead of requiring Reset → change flow
