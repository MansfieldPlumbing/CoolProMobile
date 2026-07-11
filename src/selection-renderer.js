/**
 * Selection UI Renderer & Animator
 * Handles the visual representation of selections, AI lasso animations,
 * and the "Living Border" effect. Touch-optimized and accessible.
 */

import { settings } from './settings.js';
import { selectionManager } from './selection.js';

class SelectionRenderer {
  constructor() {
    this.svgContainer = null;
    this.maskElement = null;
    this.borderElement = null;
    this.scanLineElement = null;
    this.animationFrame = null;
    this.isAnimating = false;
    
    this.initDOM();
    this.bindEvents();
  }

  /**
   * Initialize SVG overlay DOM
   */
  initDOM() {
    // Create SVG overlay if not exists
    if (!document.getElementById('selection-overlay')) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.id = 'selection-overlay';
      svg.setAttribute('class', 'selection-overlay');
      svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = `
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
          <linearGradient id="marching-ants" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:var(--color-accent);stop-opacity:1" />
            <stop offset="50%" style="stop-color:transparent;stop-opacity:0" />
            <stop offset="100%" style="stop-color:var(--color-accent);stop-opacity:1" />
          </linearGradient>
        </defs>
        <g id="selection-group" style="display:none">
          <path id="selection-mask" fill="rgba(99, 102, 241, 0.15)" stroke="none" />
          <path id="selection-border" fill="none" stroke="url(#marching-ants)" stroke-width="2" stroke-dasharray="8,4" filter="url(#glow)" />
          <path id="scan-line" fill="none" stroke="var(--color-accent)" stroke-width="2" opacity="0" />
        </g>
      `;
      
      // Ensure overlay covers the app
      svg.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 1000;
        overflow: visible;
      `;
      
      document.body.appendChild(svg);
    }

    this.svgContainer = document.getElementById('selection-overlay');
    this.maskElement = document.getElementById('selection-mask');
    this.borderElement = document.getElementById('selection-border');
    this.scanLineElement = document.getElementById('scan-line');
    this.groupElement = document.getElementById('selection-group');
  }

  /**
   * Bind to selection manager events
   */
  bindEvents() {
    selectionManager.addEventListener('selection:start', (e) => this.onStart(e));
    selectionManager.addEventListener('selection:update', (e) => this.onUpdate(e));
    selectionManager.addEventListener('selection:end', (e) => this.onEnd(e));
    selectionManager.addEventListener('selection:preview-start', () => this.startScanAnimation());
    selectionManager.addEventListener('selection:preview-ready', (e) => this.onPreviewReady(e));
    selectionManager.addEventListener('selection:clear', () => this.hide());
    selectionManager.addEventListener('selection:confirm', () => this.stopScanAnimation());
    
    // Theme updates
    settings.addEventListener('settings:changed', (e) => {
      if (e.detail.path.startsWith('theme')) {
        this.updateStyles();
      }
    });
  }

  /**
   * Start selection visualization
   */
  onStart(e) {
    const { startX, startY } = e.detail;
    this.groupElement.style.display = 'block';
    
    // Initialize with single point
    this.updatePath([{x: startX, y: startY}]);
    this.show();
  }

  /**
   * Update selection path during drag
   */
  onUpdate(e) {
    const { path } = e.detail;
    this.updatePath(path);
  }

  /**
   * Finalize selection shape
   */
  onEnd(e) {
    const { path } = e.detail;
    this.updatePath(path);
    
    // Add closing point for complete shape
    if (path.length > 2 && path[0].x !== path[path.length-1].x) {
      const closedPath = [...path, path[0]];
      this.updatePath(closedPath);
    }
  }

  /**
   * Preview ready - show refined mask
   */
  onPreviewReady(e) {
    const { points } = e.detail;
    this.updatePath(points);
    this.maskElement.setAttribute('fill', 'rgba(99, 102, 241, 0.25)');
  }

  /**
   * Update SVG path elements
   */
  updatePath(points) {
    if (points.length === 0) return;

    // Create SVG path data
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    
    // Close path if more than 2 points
    if (points.length > 2) {
      d += ' Z';
    }

    this.maskElement.setAttribute('d', d);
    this.borderElement.setAttribute('d', d);
    
    // Update scan line to follow border
    if (this.isAnimating) {
      this.scanLineElement.setAttribute('d', d);
    }
  }

  /**
   * Start AI scanning animation
   */
  startScanAnimation() {
    this.isAnimating = true;
    this.scanLineElement.style.opacity = '1';
    this.scanLineElement.setAttribute('stroke-dasharray', '10,100');
    
    let offset = 0;
    const animate = () => {
      if (!this.isAnimating) return;
      
      offset = (offset + 2) % 100;
      this.scanLineElement.setAttribute('stroke-dashoffset', -offset);
      
      // Pulse opacity
      const pulse = 0.5 + Math.sin(Date.now() / 200) * 0.5;
      this.scanLineElement.setAttribute('opacity', pulse.toString());
      
      this.animationFrame = requestAnimationFrame(animate);
    };
    
    animate();
    
    if (settings.get('behavior.hapticFeedback')) {
      navigator.vibrate?.([5, 5, 5, 5, 5]);
    }
  }

  /**
   * Stop scanning animation
   */
  stopScanAnimation() {
    this.isAnimating = false;
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
    this.scanLineElement.style.opacity = '0';
  }

  /**
   * Show selection overlay
   */
  show() {
    this.groupElement.style.display = 'block';
    this.updateStyles();
  }

  /**
   * Hide selection overlay
   */
  hide() {
    this.groupElement.style.display = 'none';
    this.stopScanAnimation();
  }

  /**
   * Update styles based on theme
   */
  updateStyles() {
    const accent = settings.get('theme.accent');
    const reducedMotion = settings.get('theme.reducedMotion');
    
    // Update gradient colors dynamically
    const gradient = document.querySelector('#marching-ants stop:first-child');
    if (gradient) {
      gradient.style.stopColor = accent;
    }
    
    if (reducedMotion) {
      this.borderElement.setAttribute('stroke-dasharray', '0'); // Solid line
      this.stopScanAnimation();
    } else {
      this.borderElement.setAttribute('stroke-dasharray', '8,4');
    }
  }
}

// Singleton
export const selectionRenderer = new SelectionRenderer();
export default selectionRenderer;
