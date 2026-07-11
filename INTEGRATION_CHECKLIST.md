# Integration Checklist: Unified Architecture

## ✅ Files Created (10/10 Complete)

| File | Purpose | Status |
|------|---------|--------|
| `src/settings.js` | Centralized configuration | ✅ |
| `src/selection.js` | Unified selection state machine | ✅ |
| `src/selection-renderer.js` | SVG animations & visual feedback | ✅ |
| `src/styles/selection.css` | Touch-optimized styles | ✅ |
| `src/models.js` | Model management with eviction | ✅ |
| `src/editor-history.js` | Undo/redo for Editor | ✅ |
| `src/memory-monitor.js` | Memory pressure handling | ✅ |
| `src/cross-surface-bridge.js` | Editor ↔ Paint communication | ✅ |
| `src/accessibility.js` | WCAG 2.1 compliance layer | ✅ |
| `src/ui-components.js` | Reusable dialogs & toasts | ✅ |
| `src/index.js` | Central export hub | ✅ |

---

## 🔧 Integration Steps

### Step 1: Update Main Entry Point (`src/app.js` or `src/shell.js`)

```javascript
// Add at the top of your main entry file
import { 
    settings, 
    selectionManager, 
    accessibility,
    memoryMonitor,
    toast 
} from './index.js';

// Optional: Start memory monitoring in production
if (process.env.NODE_ENV === 'production') {
    memoryMonitor.start();
}
```

### Step 2: Replace localStorage Calls

**Before:**
```javascript
const theme = localStorage.getItem('theme') || 'dark';
localStorage.setItem('theme', newTheme);
```

**After:**
```javascript
const theme = settings.get('theme.mode');
settings.set('theme.mode', newTheme);
```

### Step 3: Fix Premature Erasure

**Before:**
```javascript
function eraseSelection() {
    // Immediately deletes content
    deleteSelectedRegion();
}
```

**After:**
```javascript
import { createConfirmDialog } from './ui-components.js';

async function eraseSelection() {
    const confirmed = await createConfirmDialog({
        title: 'Erase Selection',
        message: 'This will permanently remove the selected content. This action cannot be undone.',
        confirmText: 'Erase',
        type: 'danger'
    });
    
    if (confirmed) {
        deleteSelectedRegion();
        toast('Content erased', 'success');
    } else {
        toast('Erasure cancelled', 'info');
    }
}
```

### Step 4: Wire Up Selection Manager

**In Paint Surface:**
```javascript
import { selectionManager, selectionRenderer } from './index.js';

canvas.addEventListener('pointerdown', (e) => {
    if (currentTool === 'select' || currentTool === 'lasso') {
        selectionManager.startSelection(e.offsetX, e.offsetY, 'spatial');
    }
});

canvas.addEventListener('pointermove', (e) => {
    if (selectionManager.state === 'SELECTING') {
        selectionManager.updateSelection(e.offsetX, e.offsetY);
        selectionRenderer.render(selectionManager.currentSelection);
    }
});

canvas.addEventListener('pointerup', () => {
    if (selectionManager.state === 'SELECTING') {
        selectionManager.endSelection();
        selectionRenderer.animateAISelection(); // If AI was used
    }
});

// Listen for confirmation
window.addEventListener('selection:confirm', async (e) => {
    const { data, action } = e.detail;
    
    if (action === 'cut') {
        await cutToNewLayer(data);
    } else if (action === 'copy') {
        await copySelection(data);
    } else if (action === 'erase') {
        // Already confirmed via dialog
        applyErase(data);
    }
});
```

**In Editor Surface:**
```javascript
import { selectionManager } from './index.js';

timeline.addEventListener('pointerdown', (e) => {
    if (currentTool === 'select') {
        selectionManager.startSelection(e.offsetX, 0, 'time');
    }
});

// Same pattern as Paint but for time ranges
```

### Step 5: Add Undo/Redo to Editor Operations

```javascript
import { editorHistory } from './index.js';

function splitClip(clipId, frame) {
    editorHistory.saveState('split-clip');
    // ... perform split operation
}

function deleteClip(clipId) {
    editorHistory.saveState('delete-clip');
    // ... perform deletion
}

// Keyboard shortcuts are auto-wired, but you can also call:
// editorHistory.undo()
// editorHistory.redo()
```

### Step 6: Enable Accessibility Features

```javascript
import { accessibility } from './index.js';

// Auto-init happens on DOMContentLoaded
// But you can manually announce things:

function onSelectionComplete(type, count) {
    accessibility.announceSelection(type, count);
}

function onModalOpen(modalElement) {
    accessibility.trapFocus(modalElement);
}
```

### Step 7: Sync Themes Across Surfaces

```javascript
import { crossSurfaceBridge, settings } from './index.js';

// When theme changes
settings.addEventListener('settings:changed', (e) => {
    if (e.detail.path.startsWith('theme.')) {
        crossSurfaceBridge.syncTheme(settings.get('theme'));
    }
});

// In embedded surfaces, listen for sync events
window.addEventListener('theme:sync', (e) => {
    applyTheme(e.detail);
});
```

---

## 🧪 Testing Checklist

### Functional Tests
- [ ] Selection works in both Editor (time) and Paint (spatial) modes
- [ ] Cut/copy/paste works across surfaces
- [ ] Confirmation dialogs appear before erasure
- [ ] Undo/redo works in Editor (Ctrl+Z/Ctrl+Y)
- [ ] Memory warnings trigger at 85%
- [ ] Auto-eviction occurs at 95%
- [ ] Theme changes propagate to all surfaces

### Accessibility Tests
- [ ] Screen reader announces selection changes
- [ ] All buttons have 44px minimum touch targets
- [ ] Keyboard navigation works (Tab, Escape, Enter)
- [ ] Focus trapping works in modals
- [ ] Color contrast passes WCAG AA (4.5:1 ratio)
- [ ] Reduced motion preference is respected

### Performance Tests
- [ ] Selection response < 100ms
- [ ] Animations run at 60fps
- [ ] Memory stays under 2GB with 3 models loaded
- [ ] No jank during lasso animation

### Browser Compatibility
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Mobile Chrome
- [ ] Mobile Safari

---

## 🚨 Common Issues & Solutions

### Issue: "Module not found" errors
**Solution:** Ensure all imports use `.js` extension and paths are relative to the importing file.

### Issue: Selection not rendering
**Solution:** Call `selectionRenderer.render()` after `selectionManager.updateSelection()`.

### Issue: Confirmation dialog blocks UI
**Solution:** Dialogs are async - use `await` and handle both true/false results.

### Issue: Memory monitor not triggering
**Solution:** `performance.memory` is Chrome-only. The fallback uses model cache estimation.

### Issue: postMessage not working between frames
**Solution:** Ensure both frames are same-origin or set up proper CORS headers. Use `crossSurfaceBridge.initGuest(surfaceType)` in child frames.

---

## 📊 Success Metrics

Track these KPIs after integration:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Premature erasures | 0 | User reports, analytics |
| Selection latency | <100ms | DevTools Performance tab |
| Memory usage | <2GB | `memoryMonitor.getStats()` |
| A11y audit score | 100% | Lighthouse, axe DevTools |
| Crash rate (OOM) | <0.1% | Error tracking service |

---

**Last Updated**: 2024  
**Version**: 2.0  
**Status**: Ready for integration
