/**
 * src/ui-components.js
 * 
 * Reusable, touch-optimized UI components with consistent styling.
 * Includes confirmation dialogs, bottom sheets, and tool palettes.
 */

import { settings } from './settings.js';

/**
 * Creates a confirmation dialog for destructive actions
 * @param {Object} options - Configuration
 * @returns {Promise<boolean>} - Resolves to true if confirmed
 */
export function createConfirmDialog({
    title = 'Confirm Action',
    message = 'Are you sure?',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    type = 'warning', // warning | danger | info
    onConfirm,
    onCancel
}) {
    return new Promise((resolve) => {
        const existing = document.querySelector('.confirm-dialog-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            z-index: 10000;
            display: flex;
            align-items: flex-end; /* Bottom sheet on mobile */
            justify-content: center;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'confirm-title');
        
        // Touch-optimized sizing
        const isMobile = window.innerWidth < 768;
        dialog.style.cssText = `
            background: var(--color-surface, #fff);
            border-radius: ${isMobile ? '16px 16px 0 0' : '12px'};
            padding: 24px;
            width: ${isMobile ? '100%' : 'min(400px, 90vw)'};
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 -4px 24px rgba(0,0,0,0.2);
            transform: translateY(0);
            transition: transform 0.3s ease;
        `;

        // Type-specific styling
        const typeColors = {
            warning: '#f59e0b',
            danger: '#ef4444',
            info: '#3b82f6'
        };
        const accentColor = typeColors[type] || typeColors.info;

        dialog.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                <div style="width: 32px; height: 32px; border-radius: 50%; background: ${accentColor}20; display: flex; align-items: center; justify-content: center;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2">
                        <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                    </svg>
                </div>
                <h2 id="confirm-title" style="margin: 0; font-size: 18px; font-weight: 600; color: var(--color-text, #000);">${title}</h2>
            </div>
            
            <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.5; color: var(--color-text-secondary, #666);">${message}</p>
            
            <div style="display: flex; gap: 12px; flex-direction: ${isMobile ? 'column-reverse' : 'row-reverse'};">
                <button id="confirm-btn" class="btn-primary" style="
                    flex: 1;
                    min-height: 48px; /* WCAG touch target */
                    border: none;
                    border-radius: 8px;
                    background: ${accentColor};
                    color: white;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    padding: 0 24px;
                    touch-action: manipulation;
                ">${confirmText}</button>
                
                <button id="cancel-btn" class="btn-secondary" style="
                    flex: 1;
                    min-height: 48px;
                    border: 1px solid var(--color-border, #ddd);
                    border-radius: 8px;
                    background: transparent;
                    color: var(--color-text, #000);
                    font-size: 16px;
                    font-weight: 500;
                    cursor: pointer;
                    padding: 0 24px;
                    touch-action: manipulation;
                ">${cancelText}</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // Focus management
        const confirmBtn = dialog.querySelector('#confirm-btn');
        const cancelBtn = dialog.querySelector('#cancel-btn');
        
        setTimeout(() => confirmBtn.focus(), 100);

        // Event handlers
        const cleanup = () => {
            overlay.style.opacity = '0';
            overlay.style.transition = 'opacity 0.2s';
            setTimeout(() => overlay.remove(), 200);
            
            document.removeEventListener('keydown', handleKeydown);
        };

        const handleConfirm = () => {
            cleanup();
            resolve(true);
            onConfirm?.();
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
            onCancel?.();
        };

        const handleKeydown = (e) => {
            if (e.key === 'Escape') handleCancel();
            if (e.key === 'Enter' && document.activeElement === confirmBtn) handleConfirm();
        };

        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) handleCancel();
        });

        document.addEventListener('keydown', handleKeydown);
    });
}

/**
 * Creates a bottom sheet for mobile-friendly option selection
 */
export function createBottomSheet({
    title,
    options = [],
    onSelect
}) {
    return new Promise((resolve) => {
        const existing = document.querySelector('.bottom-sheet-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'bottom-sheet-overlay';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 9999;
            display: flex;
            align-items: flex-end;
            justify-content: center;
        `;

        const sheet = document.createElement('div');
        sheet.className = 'bottom-sheet';
        sheet.style.cssText = `
            background: var(--color-surface, #fff);
            border-radius: 16px 16px 0 0;
            width: 100%;
            max-height: 70vh;
            overflow-y: auto;
            padding: 20px;
            transform: translateY(0);
            transition: transform 0.3s ease;
        `;

        let optionsHTML = options.map((opt, i) => `
            <button class="sheet-option" data-index="${i}" style="
                width: 100%;
                min-height: 56px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 16px;
                border: none;
                border-bottom: 1px solid var(--color-border, #eee);
                background: transparent;
                font-size: 16px;
                color: var(--color-text, #000);
                cursor: pointer;
                touch-action: manipulation;
            ">
                <span>${opt.label}</span>
                ${opt.icon || ''}
            </button>
        `).join('');

        sheet.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
                <h3 style="margin: 0; font-size: 18px; font-weight: 600;">${title}</h3>
                <button id="close-sheet" style="
                    width: 36px;
                    height: 36px;
                    border: none;
                    background: transparent;
                    cursor: pointer;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                ">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div>${optionsHTML}</div>
        `;

        overlay.appendChild(sheet);
        document.body.appendChild(overlay);

        const handleClose = () => {
            sheet.style.transform = 'translateY(100%)';
            setTimeout(() => overlay.remove(), 300);
            resolve(null);
        };

        sheet.querySelector('#close-sheet').addEventListener('click', handleClose);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) handleClose();
        });

        sheet.querySelectorAll('.sheet-option').forEach((btn) => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                const option = options[index];
                handleClose();
                resolve(option);
                onSelect?.(option);
            });
        });

        // Trap focus
        sheet.querySelector('.sheet-option')?.focus();
    });
}

/**
 * Unified toast notification (replaces scattered hud/toast calls)
 */
export function toast(message, type = 'info', duration = 3000) {
    const existing = document.querySelector('.unified-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'unified-toast';
    
    const colors = {
        info: '#3b82f6',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444'
    };

    toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(100px);
        background: var(--color-surface, #fff);
        color: var(--color-text, #000);
        padding: 12px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
        z-index: 10001;
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 280px;
        max-width: 90vw;
        border-left: 4px solid ${colors[type]};
        opacity: 0;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    toast.innerHTML = `
        <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
        toast.style.opacity = '1';
    });

    // Auto-dismiss
    setTimeout(() => {
        toast.style.transform = 'translateX(-50%) translateY(100px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Export unified HUD as alias
export const hud = toast;
