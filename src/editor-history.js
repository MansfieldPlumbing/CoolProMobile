/**
 * src/editor-history.js
 * 
 * Implements Undo/Redo functionality for the Editor surface.
 * Mirrors the history system found in Paint but optimized for timeline/clip operations.
 */

import { store } from './store.js';

const MAX_HISTORY_LENGTH = 50;

class EditorHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.isRecording = true;
        this.currentSnapshot = null;
    }

    /**
     * Captures the current state of the editor (clips, timeline, markers)
     * and pushes it to the undo stack.
     */
    saveState(actionName = 'edit') {
        if (!this.isRecording) return;

        // Clear redo stack on new action
        this.redoStack = [];

        const state = {
            clips: JSON.parse(JSON.stringify(store.clips)),
            timeline: JSON.parse(JSON.stringify(store.timeline)),
            markers: JSON.parse(JSON.stringify(store.markers)),
            timestamp: Date.now(),
            action: actionName
        };

        this.undoStack.push(state);

        // Enforce max length
        if (this.undoStack.length > MAX_HISTORY_LENGTH) {
            this.undoStack.shift();
        }

        this.notifyChange();
    }

    /**
     * Restores a previous state from the undo stack.
     */
    undo() {
        if (this.undoStack.length === 0) {
            console.warn('EditorHistory: Nothing to undo');
            return false;
        }

        // Save current state to redo stack before overwriting
        const currentState = {
            clips: JSON.parse(JSON.stringify(store.clips)),
            timeline: JSON.parse(JSON.stringify(store.timeline)),
            markers: JSON.parse(JSON.stringify(store.markers)),
            timestamp: Date.now()
        };
        this.redoStack.push(currentState);

        const previousState = this.undoStack.pop();
        this.restoreState(previousState);
        
        this.notifyChange('undo');
        return true;
    }

    /**
     * Restores a state from the redo stack.
     */
    redo() {
        if (this.redoStack.length === 0) {
            console.warn('EditorHistory: Nothing to redo');
            return false;
        }

        // Save current state to undo stack
        const currentState = {
            clips: JSON.parse(JSON.stringify(store.clips)),
            timeline: JSON.parse(JSON.stringify(store.timeline)),
            markers: JSON.parse(JSON.stringify(store.markers)),
            timestamp: Date.now()
        };
        this.undoStack.push(currentState);

        const nextState = this.redoStack.pop();
        this.restoreState(nextState);

        this.notifyChange('redo');
        return true;
    }

    /**
     * Internal method to apply state to the store without triggering history recording.
     */
    restoreState(state) {
        this.isRecording = false;
        
        // Deep merge or replace depending on strategy. 
        // Here we replace to ensure exact restoration.
        store.clips = JSON.parse(JSON.stringify(state.clips));
        store.timeline = JSON.parse(JSON.stringify(state.timeline || []));
        store.markers = JSON.parse(JSON.stringify(state.markers || []));
        
        // Trigger store update events if they exist
        if (typeof store.emit === 'function') {
            store.emit('change', { source: 'history' });
        }

        setTimeout(() => {
            this.isRecording = true;
        }, 0);
    }

    /**
     * Executes a batch of operations as a single undoable unit.
     */
    batchExecute(operations, actionName = 'batch') {
        this.isRecording = false;
        try {
            operations.forEach(op => op());
            this.saveState(actionName);
        } finally {
            this.isRecording = true;
        }
    }

    notifyChange(type = 'state_change') {
        window.dispatchEvent(new CustomEvent('editor:history', {
            detail: {
                type,
                canUndo: this.undoStack.length > 0,
                canRedo: this.redoStack.length > 0,
                length: this.undoStack.length
            }
        }));
    }

    reset() {
        this.undoStack = [];
        this.redoStack = [];
        this.notifyChange();
    }
}

export const editorHistory = new EditorHistory();

// Global Keyboard Shortcuts for Undo/Redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y)
window.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
            editorHistory.redo();
        } else {
            editorHistory.undo();
        }
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        editorHistory.redo();
    }
});
