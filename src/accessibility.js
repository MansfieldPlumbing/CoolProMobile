/**
 * src/accessibility.js
 * 
 * Comprehensive accessibility layer for WCAG 2.1 AA compliance.
 * Handles ARIA live regions, keyboard navigation, and screen reader announcements.
 */

import { settings } from './settings.js';

class AccessibilityManager {
    constructor() {
        this.liveRegion = null;
        this.focusTrap = null;
        this.isInitialized = false;
        this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduced)').matches;
    }

    init() {
        if (this.isInitialized) return;

        this.createLiveRegion();
        this.setupKeyboardShortcuts();
        this.enhanceCanvasAccessibility();
        this.monitorFocus();

        // Listen for preference changes
        window.matchMedia('(prefers-reduced-motion: reduced)').addEventListener('change', (e) => {
            this.reducedMotion = e.matches;
            settings.set('accessibility.reducedMotion', e.matches);
        });

        this.isInitialized = true;
        console.log('[Accessibility] Initialized');
    }

    createLiveRegion() {
        // Create ARIA live region for screen reader announcements
        const liveRegion = document.createElement('div');
        liveRegion.id = 'aria-live-region';
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        
        // Visually hidden but accessible
        liveRegion.style.cssText = `
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
        `;

        document.body.appendChild(liveRegion);
        this.liveRegion = liveRegion;
    }

    announce(message, priority = 'polite') {
        if (!this.liveRegion) return;

        // Clear previous announcement
        this.liveRegion.textContent = '';

        // Set priority
        this.liveRegion.setAttribute('aria-live', priority);

        // Announce (small delay ensures screen readers pick it up)
        setTimeout(() => {
            this.liveRegion.textContent = message;
        }, 100);

        // Also show visual toast for non-screen-reader users
        if (priority === 'assertive') {
            this.showVisualToast(message);
        }
    }

    showVisualToast(message) {
        // Reuse existing toast system if available, otherwise create temp element
        if (typeof window.toast === 'function') {
            window.toast(message);
        } else {
            const toast = document.createElement('div');
            toast.className = 'a11y-toast';
            toast.textContent = message;
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: var(--color-bg-inverse, #000);
                color: var(--color-fg-inverse, #fff);
                padding: 12px 24px;
                border-radius: 8px;
                z-index: 9999;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            `;
            
            document.body.appendChild(toast);
            
            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transition = 'opacity 0.3s';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Escape key: Cancel current operation
            if (e.key === 'Escape') {
                window.dispatchEvent(new CustomEvent('a11y:cancel'));
                this.announce('Operation cancelled');
            }

            // F1: Help
            if (e.key === 'F1') {
                e.preventDefault();
                this.announce('Keyboard shortcuts: Ctrl+Z Undo, Ctrl+Y Redo, Ctrl+C Copy, Ctrl+V Paste, S Select, E Erase');
            }
        });
    }

    enhanceCanvasAccessibility() {
        // Add accessible labels to all canvases
        document.querySelectorAll('canvas').forEach((canvas, index) => {
            if (!canvas.getAttribute('aria-label')) {
                canvas.setAttribute('role', 'img');
                canvas.setAttribute('aria-label', `Editing canvas ${index + 1}. Use mouse or touch to draw.`);
                canvas.setAttribute('tabindex', '0');
            }

            // Add keyboard instructions
            canvas.addEventListener('focus', () => {
                this.announce('Canvas focused. Use arrow keys to navigate tools, Enter to select.');
            });
        });
    }

    monitorFocus() {
        // Track focus for better screen reader context
        document.addEventListener('focusin', (e) => {
            const target = e.target;
            
            // Announce major section changes
            if (target.closest('[data-section]')) {
                const sectionName = target.closest('[data-section]').dataset.section;
                // Debounce announcements
                clearTimeout(this.focusTimeout);
                this.focusTimeout = setTimeout(() => {
                    this.announce(`Entered ${sectionName} section`, 'polite');
                }, 500);
            }
        });
    }

    /**
     * Create a focus trap for modals/dialogs
     */
    trapFocus(element) {
        const focusableElements = element.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        element.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        });

        // Focus first element
        firstElement?.focus();
        
        this.announce('Dialog opened. Press Tab to navigate, Escape to close.', 'assertive');
    }

    /**
     * Check color contrast compliance
     */
    checkContrast(fgColor, bgColor) {
        // Simple luminance calculation
        const getLuminance = (hex) => {
            const rgb = parseInt(hex.slice(1), 16);
            const r = ((rgb >> 16) & 0xff) / 255;
            const g = ((rgb >> 8) & 0xff) / 255;
            const b = (rgb & 0xff) / 255;
            
            const adjust = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            
            return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b);
        };

        const l1 = getLuminance(fgColor);
        const l2 = getLuminance(bgColor);
        
        const ratio = l1 > l2 
            ? (l1 + 0.05) / (l2 + 0.05) 
            : (l2 + 0.05) / (l1 + 0.05);

        return {
            ratio: ratio.toFixed(2),
            passesAA: ratio >= 4.5,
            passesAAA: ratio >= 7
        };
    }

    /**
     * Announce selection changes
     */
    announceSelection(type, count) {
        const messages = {
            'time-range': `${count} frames selected`,
            'spatial-region': 'Region selected',
            'ai-segmentation': 'AI selection complete',
            'none': 'Selection cleared'
        };

        this.announce(messages[type] || 'Selection updated', 'polite');
    }
}

export const accessibility = new AccessibilityManager();

// Auto-init on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => accessibility.init());
} else {
    accessibility.init();
}
