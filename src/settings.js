/**
 * Unified Settings Manager
 * Single source of truth for PWA configuration, theme, behavior, and AI preferences.
 * Replaces scattered localStorage calls and fragmented config objects.
 */

const DEFAULTS = {
  theme: {
    mode: 'dark', // 'light' | 'dark' | 'system'
    accent: '#6366f1', // Indigo-500
    density: 'comfortable', // 'compact' | 'comfortable' | 'spacious'
    animations: true,
    reducedMotion: false,
  },
  behavior: {
    confirmDestructive: true, // Confirm before erase/cut
    autoSave: true,
    touchOptimized: true, // Enforce 44px targets
    hapticFeedback: true,
  },
  ai: {
    modelSegmentation: 'mobilenet-v3-seg', // Default lightweight model
    modelGeneration: 'sd-turbo-onnx',
    preferLocal: true,
    maxMemoryMB: 2048,
    showPreview: true, // Always preview AI results before applying
  },
  export: {
    format: 'webp',
    quality: 0.9,
    includeMetadata: true,
  },
  accessibility: {
    highContrast: false,
    screenReaderAnnouncements: true,
    fontSize: 16,
  }
};

class SettingsManager extends EventTarget {
  constructor() {
    super();
    this.state = JSON.parse(JSON.stringify(DEFAULTS));
    this.storageKey = 'coolpro_settings_v1';
    this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Deep merge to ensure new defaults aren't lost on version updates
        this.state = this._deepMerge(DEFAULTS, parsed);
      }
    } catch (e) {
      console.warn('Settings load failed, using defaults', e);
    }
    this._applyTheme();
    this._applyAccessibility();
  }

  save() {
    localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    this._applyTheme();
    this._applyAccessibility();
    this.dispatchEvent(new CustomEvent('settings:saved', { detail: this.state }));
  }

  get(path) {
    return path.split('.').reduce((obj, key) => obj?.[key], this.state);
  }

  set(path, value) {
    const keys = path.split('.');
    let current = this.state;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }
    const oldValue = current[keys[keys.length - 1]];
    current[keys[keys.length - 1]] = value;
    
    this.save();
    this.dispatchEvent(new CustomEvent('settings:changed', { 
      detail: { path, value, oldValue } 
    }));
  }

  reset() {
    this.state = JSON.parse(JSON.stringify(DEFAULTS));
    this.save();
  }

  _deepMerge(target, source) {
    for (const key in source) {
      if (source[key] instanceof Object && key in target) {
        this._deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  _applyTheme() {
    const root = document.documentElement;
    const { mode, accent, density, animations, reducedMotion } = this.state.theme;
    
    // Mode
    if (mode === 'system') {
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      root.setAttribute('data-theme', systemDark ? 'dark' : 'light');
    } else {
      root.setAttribute('data-theme', mode);
    }

    // Accent
    root.style.setProperty('--color-accent', accent);

    // Density
    root.setAttribute('data-density', density);

    // Animations
    if (!animations || reducedMotion) {
      root.style.setProperty('--animation-speed', '0s');
      root.setAttribute('data-reduced-motion', 'true');
    } else {
      root.style.setProperty('--animation-speed', '0.3s');
      root.setAttribute('data-reduced-motion', 'false');
    }
  }

  _applyAccessibility() {
    const root = document.documentElement;
    const { highContrast, fontSize } = this.state.accessibility;
    
    if (highContrast) root.setAttribute('data-high-contrast', 'true');
    else root.removeAttribute('data-high-contrast');

    root.style.setProperty('--font-size-base', `${fontSize}px`);
  }
}

// Singleton instance
export const settings = new SettingsManager();
export default settings;
