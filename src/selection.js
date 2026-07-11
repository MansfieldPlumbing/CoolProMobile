/**
 * Unified Selection & Segmentation Manager
 * Eliminates the distinction between "selection" and "segmentation".
 * Provides a single state machine for both spatial (Paint) and temporal (Editor) domains.
 */

import { settings } from './settings.js';

// State Machine States
const STATES = {
  IDLE: 'IDLE',
  SELECTING: 'SELECTING', // User is actively dragging/lassoing
  SELECTED: 'SELECTED',   // Selection is active, awaiting action
  PREVIEWING: 'PREVIEWING', // AI segmentation preview active
  CONFIRMING: 'CONFIRMING'  // Awaiting confirmation for destructive action
};

class SelectionManager extends EventTarget {
  constructor() {
    super();
    this.state = STATES.IDLE;
    this.data = null; // Holds coordinates (spatial) or frames (temporal)
    this.previewData = null; // Holds AI mask data before commit
    this.surface = null; // 'paint' | 'editor' | null
    this.animationFrame = null;
    
    // Bind methods
    this.startSelection = this.startSelection.bind(this);
    this.updateSelection = this.updateSelection.bind(this);
    this.endSelection = this.endSelection.bind(this);
    this.clear = this.clear.bind(this);
    this.confirm = this.confirm.bind(this);
    this.cancel = this.cancel.bind(this);
  }

  /**
   * Initialize selection on a specific surface
   * @param {'paint'|'editor'} surfaceType 
   */
  init(surfaceType) {
    this.surface = surfaceType;
    this.clear();
    this.dispatchEvent(new CustomEvent('selection:init', { detail: { surface: surfaceType } }));
  }

  /**
   * Start a new selection (mouse down / touch start)
   */
  startSelection(x, y) {
    if (settings.get('behavior.hapticFeedback')) navigator.vibrate?.(5);
    
    this.state = STATES.SELECTING;
    this.data = {
      startX: x, startY: y,
      currentX: x, currentY: y,
      path: [{x, y}] // For freeform lasso
    };
    
    this._announce('Selection started');
    this.dispatchEvent(new CustomEvent('selection:start', { detail: this.data }));
  }

  /**
   * Update selection coordinates (mouse move / touch move)
   */
  updateSelection(x, y) {
    if (this.state !== STATES.SELECTING) return;

    this.data.currentX = x;
    this.data.currentY = y;
    this.data.path.push({x, y});

    this.dispatchEvent(new CustomEvent('selection:update', { detail: this.data }));
  }

  /**
   * End selection (mouse up / touch end)
   * Triggers AI segmentation if enabled
   */
  async endSelection() {
    if (this.state !== STATES.SELECTING) return;

    this.state = STATES.SELECTED;
    
    // If AI segmentation is preferred and we have a rough box/path
    if (settings.get('ai.showPreview') && this.surface === 'paint') {
      await this._runSegmentationPreview();
    } else {
      this._finalizeGeometry();
    }
    
    this.dispatchEvent(new CustomEvent('selection:end', { detail: this.data }));
  }

  /**
   * Internal: Run AI model to refine selection
   */
  async _runSegmentationPreview() {
    this.state = STATES.PREVIEWING;
    this.dispatchEvent(new CustomEvent('selection:preview-start'));

    try {
      // Placeholder for actual model call
      // const model = await ModelManager.get(settings.get('ai.modelSegmentation'));
      // const mask = await model.predict(this.data);
      
      // Simulate async delay for UI feedback
      await new Promise(r => setTimeout(r, 300));
      
      // Mock refined mask data
      this.previewData = {
        type: 'mask',
        points: this.data.path, // In real impl, this is refined by AI
        confidence: 0.95
      };

      this.state = STATES.CONFIRMING;
      this.dispatchEvent(new CustomEvent('selection:preview-ready', { detail: this.previewData }));
      this._announce('AI selection ready. Confirm or cancel.');
    } catch (err) {
      console.error('Segmentation failed', err);
      this._finalizeGeometry(); // Fallback to raw geometry
    }
  }

  /**
   * Internal: Commit raw geometry if no AI or fallback
   */
  _finalizeGeometry() {
    this.previewData = null;
    this.state = STATES.SELECTED;
    this.dispatchEvent(new CustomEvent('selection:finalized', { detail: this.data }));
  }

  /**
   * Confirm the current selection (commit AI preview or finalize)
   */
  confirm() {
    if (this.state === STATES.CONFIRMING) {
      // Commit AI preview
      this.data = { ...this.data, ...this.previewData };
      this.previewData = null;
    }
    
    this.state = STATES.SELECTED;
    this.dispatchEvent(new CustomEvent('selection:confirm', { detail: this.data }));
    this._announce('Selection confirmed');
  }

  /**
   * Cancel current selection operation
   */
  cancel() {
    this.clear();
    this._announce('Selection cancelled');
    this.dispatchEvent(new CustomEvent('selection:cancel'));
  }

  /**
   * Clear selection completely
   */
  clear() {
    this.state = STATES.IDLE;
    this.data = null;
    this.previewData = null;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.dispatchEvent(new CustomEvent('selection:clear'));
  }

  /**
   * Cut selected content to clipboard/new layer
   */
  async cut() {
    if (!this.data) return;
    
    if (settings.get('behavior.confirmDestructive')) {
      this.state = STATES.CONFIRMING;
      // Wait for external confirmation dialog
      return new Promise((resolve) => {
        const onConfirm = () => {
          this._executeCut();
          this.removeEventListener('selection:confirm', onConfirm);
          resolve(true);
        };
        this.addEventListener('selection:confirm', onConfirm, { once: true });
      });
    } else {
      return this._executeCut();
    }
  }

  async _executeCut() {
    this.dispatchEvent(new CustomEvent('selection:cut', { detail: this.data }));
    this.clear();
    if (settings.get('behavior.hapticFeedback')) navigator.vibrate?.([10, 20, 10]);
  }

  /**
   * Copy selected content
   */
  async copy() {
    if (!this.data) return;
    this.dispatchEvent(new CustomEvent('selection:copy', { detail: this.data }));
    this._announce('Copied to clipboard');
  }

  /**
   * Accessibility announcement helper
   */
  _announce(msg) {
    if (!settings.get('accessibility.screenReaderAnnouncements')) return;
    const el = document.getElementById('sr-announcer');
    if (el) el.textContent = msg;
  }
}

// Singleton
export const selectionManager = new SelectionManager();
export default selectionManager;
