/**
 * src/memory-monitor.js
 * 
 * Enforces memory limits and handles pressure events.
 * Implements auto-eviction strategy when approaching browser limits.
 */

import { modelManager } from './models.js';

class MemoryMonitor {
    constructor() {
        this.limitBytes = 4 * 1024 * 1024 * 1024; // 4GB default advisory
        this.warningThreshold = 0.85; // 85%
        this.criticalThreshold = 0.95; // 95%
        this.currentUsage = 0;
        this.isMonitoring = false;
        this.checkInterval = null;
    }

    /**
     * Initialize monitoring if supported by browser
     */
    start() {
        if (this.isMonitoring) return;

        // Check for deviceMemory API
        if (navigator.deviceMemory) {
            // Set limit based on device RAM (conservative estimate: 25% of total)
            this.limitBytes = navigator.deviceMemory * 1024 * 1024 * 1024 * 0.25;
            console.log(`[MemoryMonitor] Device RAM: ${navigator.deviceMemory}GB, Limit set to: ${(this.limitBytes / 1024 / 1024 / 1024).toFixed(2)}GB`);
        }

        this.isMonitoring = true;
        
        // Start periodic checks
        this.checkInterval = setInterval(() => this.check(), 5000);

        // Listen for pressure events (Chrome 115+)
        if ('PressureObserver' in window) {
            this.initPressureObserver();
        }

        console.log('[MemoryMonitor] Started');
    }

    stop() {
        this.isMonitoring = false;
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        if (this.pressureObserver) {
            this.pressureObserver.disconnect();
        }
    }

    initPressureObserver() {
        try {
            this.pressureObserver = new PressureObserver((changes) => {
                for (const change of changes) {
                    if (change.state === 'critical') {
                        console.warn('[MemoryMonitor] Critical pressure detected');
                        this.handleCriticalPressure();
                    } else if (change.state === 'serious') {
                        console.warn('[MemoryMonitor] Serious pressure detected');
                        this.handleWarningPressure();
                    }
                }
            });

            this.pressureObserver.observe('memory');
        } catch (e) {
            console.warn('[MemoryMonitor] PressureObserver not fully supported', e);
        }
    }

    check() {
        if (!performance || !performance.memory) {
            // Fallback: estimate based on model cache size
            this.estimateUsage();
            return;
        }

        this.currentUsage = performance.memory.usedJSHeapSize;
        const ratio = this.currentUsage / this.limitBytes;

        if (ratio >= this.criticalThreshold) {
            this.handleCriticalPressure();
        } else if (ratio >= this.warningThreshold) {
            this.handleWarningPressure();
        }
    }

    estimateUsage() {
        // Estimate usage based on tracked models and textures
        const modelUsage = modelManager.getMemoryUsage();
        this.currentUsage = modelUsage;
        
        const ratio = this.currentUsage / this.limitBytes;
        if (ratio >= this.criticalThreshold) {
            this.handleCriticalPressure();
        } else if (ratio >= this.warningThreshold) {
            this.handleWarningPressure();
        }
    }

    handleWarningPressure() {
        window.dispatchEvent(new CustomEvent('memory:warning', {
            detail: {
                usage: this.currentUsage,
                limit: this.limitBytes,
                ratio: this.currentUsage / this.limitBytes
            }
        }));
        
        console.warn(`[MemoryMonitor] Warning: ${(this.currentUsage / this.limitBytes * 100).toFixed(1)}% memory used`);
    }

    handleCriticalPressure() {
        console.error('[MemoryMonitor] Critical: Initiating auto-eviction');
        
        // Evict oldest unused models
        const evicted = modelManager.evictLeastUsed(3);
        
        if (evicted > 0) {
            console.log(`[MemoryMonitor] Evicted ${evicted} models to free memory`);
        }

        window.dispatchEvent(new CustomEvent('memory:critical', {
            detail: {
                usage: this.currentUsage,
                limit: this.limitBytes,
                evictedCount: evicted
            }
        }));
    }

    getStats() {
        return {
            used: this.currentUsage,
            limit: this.limitBytes,
            ratio: this.currentUsage / this.limitBytes,
            usedFormatted: this.formatBytes(this.currentUsage),
            limitFormatted: this.formatBytes(this.limitBytes)
        };
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

export const memoryMonitor = new MemoryMonitor();

// Auto-start if in production environment
if (process.env.NODE_ENV === 'production') {
    memoryMonitor.start();
}
