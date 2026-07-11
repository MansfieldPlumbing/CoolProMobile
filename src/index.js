/**
 * src/index.js
 * 
 * Central export hub for all new unified modules.
 * Import from this file to access the complete refactored architecture.
 */

// Core Architecture
export { settings } from './settings.js';
export { selectionManager } from './selection.js';
export { selectionRenderer } from './selection-renderer.js';
export { modelManager } from './models.js';
export { memoryMonitor } from './memory-monitor.js';
export { editorHistory } from './editor-history.js';
export { crossSurfaceBridge } from './cross-surface-bridge.js';
export { accessibility } from './accessibility.js';

// UI Components
export { 
    createConfirmDialog, 
    createBottomSheet, 
    toast, 
    hud 
} from './ui-components.js';

// Styles (import side effects)
import './styles/selection.css';

/**
 * Quick Start Guide:
 * 
 * 1. Initialize in your main entry point:
 * ```javascript
 * import { settings, selectionManager, accessibility } from './src/index.js';
 * 
 * // Settings auto-initialize
 * console.log('Current theme:', settings.get('theme.mode'));
 * 
 * // Accessibility auto-init on DOMContentLoaded
 * 
 * // Wire up selection
 * canvas.addEventListener('pointerdown', (e) => {
 *   if (currentTool === 'select') {
 *     selectionManager.startSelection(e.offsetX, e.offsetY);
 *   }
 * });
 * ```
 * 
 * 2. Replace old patterns:
 * - `localStorage.getItem()` → `settings.get()`
 * - Direct erasure → `createConfirmDialog()` then erase
 * - Scattered toasts → `toast()`
 * - Editor-only undo → `editorHistory.undo()`
 * 
 * 3. Listen for events:
 * ```javascript
 * window.addEventListener('selection:confirm', (e) => { ... });
 * window.addEventListener('memory:warning', (e) => { ... });
 * window.addEventListener('theme:changed', (e) => { ... });
 * ```
 */

console.log('[CoolProMobile] Unified architecture loaded');
