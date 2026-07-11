/**
 * src/cross-surface-bridge.js
 * 
 * Manages communication between Editor and Paint surfaces via postMessage.
 * Ensures state synchronization and coordinated behavior across the PWA.
 */

class CrossSurfaceBridge {
    constructor() {
        this.channels = new Map();
        this.port = null;
        this.isHost = window === window.top;
        
        // Default channel for internal frames
        this.defaultChannel = 'coolpro-internal';
    }

    /**
     * Initialize bridge for host window (main app shell)
     */
    initHost() {
        if (!this.isHost) return;

        window.addEventListener('message', (event) => {
            if (event.source && event.data && event.data.channel === this.defaultChannel) {
                this.handleMessage(event);
            }
        });

        console.log('[CrossSurfaceBridge] Host initialized');
    }

    /**
     * Initialize bridge for guest window (embedded surface)
     */
    initGuest(surfaceType) {
        if (this.isHost) return;

        this.surfaceType = surfaceType;

        // Send handshake to host
        this.sendToHost({
            type: 'handshake',
            surface: surfaceType,
            timestamp: Date.now()
        });

        window.addEventListener('message', (event) => {
            if (event.data && event.data.channel === this.defaultChannel) {
                this.handleMessage(event);
            }
        });

        console.log(`[CrossSurfaceBridge] Guest initialized (${surfaceType})`);
    }

    sendToHost(message) {
        if (this.isHost) return;
        
        window.parent.postMessage({
            channel: this.defaultChannel,
            ...message
        }, '*');
    }

    broadcastToGuests(message) {
        if (!this.isHost) return;

        // In a real iframe scenario, you'd iterate over contentWindow references
        // For now, we dispatch locally for same-origin frames
        window.dispatchEvent(new CustomEvent('bridge:broadcast', {
            detail: message
        }));
    }

    handleMessage(event) {
        const { type, payload, source } = event.data;

        switch (type) {
            case 'handshake':
                console.log(`[CrossSurfaceBridge] Handshake received from ${payload.surface}`);
                break;

            case 'selection:update':
                // Sync selection state across surfaces
                window.dispatchEvent(new CustomEvent('selection:sync', {
                    detail: payload
                }));
                break;

            case 'theme:change':
                // Propagate theme changes
                window.dispatchEvent(new CustomEvent('theme:sync', {
                    detail: payload
                }));
                break;

            case 'memory:warning':
            case 'memory:critical':
                // Forward memory alerts
                window.dispatchEvent(new CustomEvent(type, {
                    detail: payload
                }));
                break;

            case 'cut:request':
                // Handle cut operation crossing surfaces
                this.handleCutRequest(payload);
                break;

            default:
                console.warn(`[CrossSurfaceBridge] Unknown message type: ${type}`);
        }
    }

    handleCutRequest(payload) {
        const { sourceSurface, data, targetSurface } = payload;

        console.log(`[CrossSurfaceBridge] Cut request: ${sourceSurface} → ${targetSurface}`);

        // If we are the target, process the data
        if (this.surfaceType === targetSurface) {
            window.dispatchEvent(new CustomEvent('clipboard:receive', {
                detail: {
                    data,
                    format: sourceSurface === 'editor' ? 'timeline-clip' : 'image-region'
                }
            }));
        }

        // Acknowledge
        this.sendToHost({
            type: 'cut:acknowledge',
            source: this.surfaceType
        });
    }

    /**
     * Send selection update to all surfaces
     */
    broadcastSelection(selectionData) {
        const message = {
            type: 'selection:update',
            payload: {
                mode: selectionData.mode, // 'time' or 'spatial'
                range: selectionData.range,
                mask: selectionData.mask, // Base64 or ImageBitmap
                timestamp: Date.now()
            }
        };

        if (this.isHost) {
            this.broadcastToGuests(message);
        } else {
            this.sendToHost(message);
        }
    }

    /**
     * Request theme synchronization
     */
    syncTheme(themeConfig) {
        const message = {
            type: 'theme:change',
            payload: themeConfig
        };

        if (this.isHost) {
            this.broadcastToGuests(message);
        } else {
            this.sendToHost(message);
        }
    }

    /**
     * Register custom channel listener
     */
    on(channelName, callback) {
        if (!this.channels.has(channelName)) {
            this.channels.set(channelName, []);
        }
        this.channels.get(channelName).push(callback);
    }

    off(channelName, callback) {
        if (!this.channels.has(channelName)) return;
        
        const listeners = this.channels.get(channelName);
        const index = listeners.indexOf(callback);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    }
}

export const crossSurfaceBridge = new CrossSurfaceBridge();

// Auto-init based on context
if (window === window.top) {
    crossSurfaceBridge.initHost();
} else {
    // Detect surface type from URL param or data attribute
    const surfaceType = new URLSearchParams(window.location.search).get('surface') || 
                        document.body.dataset.surface || 'unknown';
    crossSurfaceBridge.initGuest(surfaceType);
}
