# Implementation Plan: Unified Selection & Settings Architecture

## Executive Summary
This plan addresses critical architectural flaws in the CoolProMobile PWA:
- **Fragmented state management** between Editor and Paint surfaces
- **Premature AI erasure** without user confirmation
- **Confusing UI distinction** between selections and segmentations
- **Missing touch optimization** (WCAG 2.1 compliance)
- **No unified settings** controlling app behavior

**Implementation Status**: ✅ Core modules created, ⏳ Integration pending

---

## Phase 1: Unified Settings System ✅ COMPLETE

### Files Created
- `src/settings.js` - Centralized configuration manager

### Features Implemented
```javascript
// Single source of truth for all settings
settings.get('theme.accent')        // '#6366f1'
settings.get('behavior.confirmDestructive') // true
settings.get('ai.showPreview')      // true
settings.get('accessibility.highContrast') // false
```

### Configuration Categories
| Category | Keys | Purpose |
|----------|------|---------|
| `theme` | mode, accent, density, animations, reducedMotion | Visual appearance |
| `behavior` | confirmDestructive, autoSave, touchOptimized, hapticFeedback | Interaction rules |
| `ai` | modelSegmentation, modelGeneration, preferLocal, maxMemoryMB, showPreview | AI/ML behavior |
| `export` | format, quality, includeMetadata | Output defaults |
| `accessibility` | highContrast, screenReaderAnnouncements, fontSize | A11y features |

### Event System
```javascript
settings.addEventListener('settings:changed', (e) => {
  console.log(`Changed: ${e.detail.path} = ${e.detail.value}`);
});
```

---

## Phase 2: Unified Selection Manager ✅ COMPLETE

### Files Created
- `src/selection.js` - State machine for all selection operations
- `src/selection-renderer.js` - SVG-based visual renderer
- `src/styles/selection.css` - Touch-optimized styles

### State Machine
```
IDLE → SELECTING → SELECTED → PREVIEWING → CONFIRMING → SELECTED
     ↓              ↓           ↓            ↓
   CANCEL        CANCEL     CANCEL       CANCEL
```

### Key Methods
```javascript
// Initialize on surface ('paint' or 'editor')
selectionManager.init('paint');

// Start/end selection
selectionManager.startSelection(x, y);
selectionManager.updateSelection(x, y);
selectionManager.endSelection();

// Actions
await selectionManager.cut();    // With confirmation if enabled
await selectionManager.copy();
selectionManager.confirm();      // Confirm AI preview
selectionManager.cancel();       // Cancel operation
selectionManager.clear();        // Clear selection
```

### Events Emitted
| Event | Detail | Description |
|-------|--------|-------------|
| `selection:start` | `{startX, startY, path}` | User began selection |
| `selection:update` | `{path}` | Path updated during drag |
| `selection:end` | `{path}` | Selection gesture complete |
| `selection:preview-start` | - | AI segmentation running |
| `selection:preview-ready` | `{points, confidence}` | AI result ready |
| `selection:confirm` | `{data}` | User confirmed action |
| `selection:cancel` | - | Operation cancelled |
| `selection:clear` | - | Selection cleared |

---

## Phase 3: AI Lasso Animation & Visual Design ✅ COMPLETE

### "Living Border" System
- **SVG-based rendering** with dynamic path updates
- **Marching ants effect** using CSS animations
- **Scan line animation** during AI preview
- **Glow filter** for visibility on all backgrounds

### Animation Sequence
```javascript
// 1. User draws rough lasso
selectionRenderer.updatePath(userPath);

// 2. AI preview starts - scan line appears
selectionRenderer.startScanAnimation();
// → Pulsing laser effect travels along border
// → Haptic feedback: [5, 5, 5, 5, 5]ms vibration

// 3. AI completes - refined mask shown
selectionRenderer.onPreviewReady({ points: refinedPath });

// 4. User confirms - animation stops
selectionRenderer.stopScanAnimation();
```

### CSS Variables for Theming
```css
--selection-fill: rgba(99, 102, 241, 0.15);
--selection-border: var(--color-accent);
--selection-glow: 0 0 12px rgba(99, 102, 241, 0.6);
```

### Cut Mode Indicator
```css
.cut-mode-active::before {
  /* Red dashed pulsing border */
  border: 2px dashed #ef4444;
  animation: pulse-border 1.5s infinite;
}
```

---

## Phase 4: Model Management System ✅ COMPLETE

### Files Created
- `src/models.js` - Model loading, caching, and memory enforcement

### Registered Models
| Model ID | Type | Size | Format | Description |
|----------|------|------|--------|-------------|
| `mobilenet-v3-seg` | Segmentation | 12MB | ONNX | Lightweight mobile segmentation |
| `deeplab-v3` | Segmentation | 45MB | ONNX | High accuracy segmentation |
| `modnet` | Matting | 28MB | ONNX | Portrait matting specialist |
| `sd-turbo-onnx` | Generation | 1200MB | ONNX | Real-time image generation (INT8) |
| `lcm-lora` | Generation | 64MB | Safetensors | Latent Consistency Model adapter |

### Memory Enforcement
```javascript
// Automatic eviction when exceeding limits
modelManager.maxMemoryMB = 2048; // 2GB limit

// 95% threshold triggers auto-eviction
// Oldest models unloaded first (LRU strategy)
```

### Usage Example
```javascript
// Load model with memory checking
const model = await modelManager.load('mobilenet-v3-seg');

// Run inference
const inputTensor = new ort.Tensor('float32', imageData, [1, 3, 512, 512]);
const output = await modelManager.infer('mobilenet-v3-seg', inputTensor);

// Check stats
const stats = modelManager.getStats();
// { loadedCount: 2, memoryUsageMB: 1240, maxMemoryMB: 2048, utilization: '60.5%' }
```

### Recommended Model Upgrades
1. **Replace current segmentation** with MobileSAM (if available as ONNX)
2. **Add RVM (Robust Video Matting)** for temporal consistency in video
3. **Quantize SD-Turbo to INT8** for 4x speedup on mobile NPUs
4. **Consider MediaPipe Selfie Segmentation** for ultra-low-latency portraits

---

## Phase 5: Touch Optimization & Accessibility ⏳ PENDING

### WCAG 2.1 Compliance Checklist
- [x] 44px minimum touch targets (`--touch-target-min`)
- [x] Focus visible indicators (3px outline)
- [x] Reduced motion support (`data-reduced-motion`)
- [x] High contrast mode (`data-high-contrast`)
- [x] Screen reader announcements (`#sr-announcer` live region)
- [ ] Color contrast ratio ≥ 4.5:1 (needs audit)
- [ ] Keyboard navigation for all actions (needs implementation)

### Haptic Feedback Pattern
```javascript
// Light tap
navigator.vibrate?.(5);

// Success
navigator.vibrate?.([10, 20, 10]);

// Error/Warning
navigator.vibrate?.([20, 10, 20, 10, 20]);

// AI scanning
navigator.vibrate?.([5, 5, 5, 5, 5]);
```

### Density Variants
```css
[data-density="compact"]    { --touch-target-min: 40px; }   /* Power users */
[data-density="comfortable"]{ --touch-target-min: 44px; }   /* Default */
[data-density="spacious"]   { --touch-target-min: 52px; }   /* Accessibility */
```

---

## Phase 6: Confirmation Dialog System ⏳ PENDING

### Premature Erasure Fix
**Before**: AI erase executed immediately on tool selection
**After**: Two-step confirmation with preview

```javascript
// In paint.js or editor.js
async function handleErase() {
  if (!selectionManager.data) return;
  
  if (settings.get('behavior.confirmDestructive')) {
    // Show bottom sheet dialog
    const confirmed = await showConfirmationDialog({
      title: 'Erase Selected Area?',
      message: 'This action cannot be undone.',
      confirmText: 'Erase',
      cancelText: 'Cancel',
      type: 'danger'
    });
    
    if (!confirmed) return;
  }
  
  // Execute erase
  await performErase(selectionManager.data);
}
```

### Dialog Component Structure
```html
<div class="confirmation-dialog" role="dialog" aria-modal="true">
  <h2>Erase Selected Area?</h2>
  <p>This action cannot be undone.</p>
  <div class="confirmation-dialog__actions">
    <button class="btn btn--secondary">Cancel</button>
    <button class="btn btn--danger">Erase</button>
  </div>
</div>
```

---

## Phase 7: Editor Undo/Redo Integration ⏳ PENDING

### History System (Mirror Paint's Implementation)
```javascript
// Add to src/store.js
class EditHistory {
  constructor(maxSteps = 50) {
    this.stack = [];
    this.redoStack = [];
    this.maxSteps = maxSteps;
  }
  
  push(state) {
    this.stack.push(state);
    this.redoStack = [];
    if (this.stack.length > this.maxSteps) {
      this.stack.shift();
    }
  }
  
  undo() {
    if (this.stack.length === 0) return null;
    const current = this.stack.pop();
    this.redoStack.push(current);
    return this.stack[this.stack.length - 1] || null;
  }
  
  redo() {
    if (this.redoStack.length === 0) return null;
    const state = this.redoStack.pop();
    this.stack.push(state);
    return state;
  }
}
```

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Redo |

---

## Phase 8: Cross-Surface Communication ⏳ PENDING

### postMessage Protocol Extensions
```javascript
// From Editor to Paint
window.postMessage({
  type: 'SELECTION_TRANSFER',
  payload: {
    frames: [10, 11, 12],
    action: 'cut'
  }
}, '*');

// From Paint to Editor
window.postMessage({
  type: 'LAYER_CREATED',
  payload: {
    layerId: 'layer_abc123',
    source: 'paint-cut',
    thumbnail: dataURL
  }
}, '*');
```

### Shared Event Bus
```javascript
// Create src/event-bus.js
class EventBus extends EventTarget {
  emit(event, detail) {
    this.dispatchEvent(new CustomEvent(event, { detail }));
  }
}
export const bus = new EventBus();

// Usage
bus.emit('app:selection-created', { surface: 'paint', data: {...} });
```

---

## Phase 9: Testing & Verification ⏳ PENDING

### Unit Tests Required
- [ ] Settings load/save with deep merge
- [ ] Selection state machine transitions
- [ ] Model memory eviction logic
- [ ] Touch target size calculations
- [ ] Confirmation dialog flow

### Integration Tests
- [ ] Cut from Editor → Paste in Paint
- [ ] AI segmentation preview → Confirm → Apply
- [ ] Theme change → All surfaces update
- [ ] Memory pressure → Auto-eviction triggers

### Manual QA Checklist
- [ ] Touch targets measurable at 44px minimum
- [ ] Haptic feedback feels appropriate
- [ ] Animations smooth at 60fps
- [ ] Reduced motion disables all animations
- [ ] Screen reader announces selection states
- [ ] Confirmation prevents accidental erasure

---

## Migration Guide

### Step 1: Import New Modules
```javascript
// In main.js or app entry point
import { settings } from './settings.js';
import { selectionManager } from './selection.js';
import { selectionRenderer } from './selection-renderer.js';
import { modelManager } from './models.js';
import './styles/selection.css';
```

### Step 2: Replace Scattered localStorage Calls
```javascript
// Before
const theme = localStorage.getItem('theme') || 'dark';
const confirmErase = JSON.parse(localStorage.getItem('confirmErase') || 'true');

// After
const theme = settings.get('theme.mode');
const confirmErase = settings.get('behavior.confirmDestructive');
```

### Step 3: Integrate Selection Manager
```javascript
// In paint.js
import { selectionManager } from './selection.js';

// Replace direct canvas event handling
canvas.addEventListener('pointerdown', (e) => {
  if (currentTool === 'select') {
    selectionManager.startSelection(e.offsetX, e.offsetY);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (selectionManager.state === 'SELECTING') {
    selectionManager.updateSelection(e.offsetX, e.offsetY);
  }
});

canvas.addEventListener('pointerup', () => {
  if (selectionManager.state === 'SELECTING') {
    selectionManager.endSelection();
  }
});
```

### Step 4: Listen for Selection Events
```javascript
selectionManager.addEventListener('selection:confirm', async (e) => {
  const { data } = e.detail;
  
  if (actionMode === 'cut') {
    await cutToNewLayer(data);
  } else if (actionMode === 'copy') {
    await copySelection(data);
  }
});
```

---

## Timeline

| Week | Phase | Deliverables |
|------|-------|--------------|
| 1 | Settings + Selection | `settings.js`, `selection.js`, basic integration |
| 2 | Renderer + Styles | `selection-renderer.js`, `selection.css`, animations |
| 3 | Models + Memory | `models.js`, eviction logic, ONNX integration |
| 4 | Polish + Testing | Confirmation dialogs, a11y, unit tests, QA |

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Model loading fails | High | Fallback to geometry-only selection, graceful degradation |
| Memory exhaustion | Critical | Hard 95% limit with aggressive eviction, user warnings |
| Touch targets too small | Medium | Enforce via CSS, automated screenshot testing |
| Performance regression | High | Profile with Chrome DevTools, lazy-load non-critical modules |
| Breaking existing workflows | Critical | Feature flag rollout, A/B testing with subset of users |

---

## Success Metrics

1. **Zero premature erasures** - All destructive actions require confirmation
2. **Unified selection** - Single code path for spatial + temporal selections
3. **WCAG 2.1 AA compliant** - Passes automated accessibility audit
4. **<100ms selection response** - From touch to visual feedback
5. **<2GB memory footprint** - Even with multiple models loaded
6. **60fps animations** - No jank during lasso or scan effects

---

## Appendix: Model Sources

### Recommended ONNX Models
1. **MobileSAM**: https://github.com/ChaoningZhang/MobileSAM (convert to ONNX)
2. **DeepLabV3**: https://github.com/onnx/models/tree/main/vision/segmentation
3. **MODNet**: https://github.com/ZHKKKe/MODNet (community ONNX conversions available)

### Conversion Tools
```bash
# PyTorch to ONNX
python -m torch.onnx.export model.py model.onnx

# Optimize with ONNX Runtime
python -m onnxruntime.tools.optimize_onnx_model model.onnx model-opt.onnx

# Quantize to INT8
python -m onnxruntime.quantization.preprocess --input model.onnx --output model-pre.onnx
python -m onnxruntime.quantization.quantize --input model-pre.onnx --output model-int8.onnx
```

---

**Document Version**: 1.0  
**Last Updated**: 2024  
**Status**: Core modules implemented, integration in progress
