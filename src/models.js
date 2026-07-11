/**
 * Model Manager
 * Handles loading, caching, and swapping of AI models.
 * Supports ONNX, TFLite, and WebGL backends with memory enforcement.
 */

import { settings } from './settings.js';

const MODEL_REGISTRY = {
  // Segmentation Models
  'mobilenet-v3-seg': {
    type: 'segmentation',
    format: 'onnx',
    url: '/models/mobilenetv3-seg.onnx',
    sizeMB: 12,
    optimized: true,
    description: 'Lightweight mobile segmentation'
  },
  'deeplab-v3': {
    type: 'segmentation',
    format: 'onnx',
    url: '/models/deeplabv3.onnx',
    sizeMB: 45,
    optimized: false,
    description: 'High accuracy segmentation'
  },
  'modnet': {
    type: 'matting',
    format: 'onnx',
    url: '/models/modnet.onnx',
    sizeMB: 28,
    optimized: true,
    description: 'Portrait matting specialist'
  },
  
  // Generation Models
  'sd-turbo-onnx': {
    type: 'generation',
    format: 'onnx',
    url: '/models/sd-turbo-int8.onnx',
    sizeMB: 1200,
    optimized: true,
    description: 'Real-time image generation (INT8 quantized)'
  },
  'lcm-lora': {
    type: 'generation',
    format: 'safetensors',
    url: '/models/lcm-lora.safetensors',
    sizeMB: 64,
    optimized: true,
    description: 'Latent Consistency Model adapter',
    requiresBase: 'sd-base'
  }
};

class ModelManager extends EventTarget {
  constructor() {
    super();
    this.loadedModels = new Map();
    this.loadingQueue = [];
    this.memoryUsageMB = 0;
    this.maxMemoryMB = settings.get('ai.maxMemoryMB');
    
    // Listen for settings changes
    settings.addEventListener('settings:changed', (e) => {
      if (e.detail.path === 'ai.maxMemoryMB') {
        this.maxMemoryMB = e.detail.value;
        this._enforceMemoryLimit();
      }
    });
  }

  /**
   * Get model metadata from registry
   */
  getMetadata(modelId) {
    return MODEL_REGISTRY[modelId] || null;
  }

  /**
   * Check if model is already loaded
   */
  isLoaded(modelId) {
    return this.loadedModels.has(modelId);
  }

  /**
   * Load a model with memory checking
   */
  async load(modelId) {
    if (this.isLoaded(modelId)) {
      return this.loadedModels.get(modelId);
    }

    const meta = MODEL_REGISTRY[modelId];
    if (!meta) throw new Error(`Unknown model: ${modelId}`);

    // Check memory before loading
    if (this.memoryUsageMB + meta.sizeMB > this.maxMemoryMB) {
      await this._evictOldestModel(meta.sizeMB);
    }

    this.dispatchEvent(new CustomEvent('model:loading', { detail: { modelId, ...meta } }));

    try {
      let model;
      
      if (meta.format === 'onnx') {
        model = await this._loadONNX(meta.url);
      } else if (meta.format === 'tflite') {
        model = await this._loadTFLite(meta.url);
      } else {
        throw new Error(`Unsupported format: ${meta.format}`);
      }

      this.loadedModels.set(modelId, {
        instance: model,
        loadedAt: Date.now(),
        meta
      });
      
      this.memoryUsageMB += meta.sizeMB;
      this.dispatchEvent(new CustomEvent('model:loaded', { detail: { modelId, ...meta } }));
      
      return model;
    } catch (err) {
      this.dispatchEvent(new CustomEvent('model:error', { detail: { modelId, error: err } }));
      throw err;
    }
  }

  /**
   * Load ONNX model
   */
  async _loadONNX(url) {
    // Check for ONNX Runtime Web
    if (typeof ort === 'undefined') {
      // Dynamically load ONNX Runtime
      await this._loadScript('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.0/dist/ort.min.js');
    }
    
    const session = await ort.InferenceSession.create(url, {
      executionProviders: ['webgl', 'wasm'],
      graphOptimizationLevel: 'all'
    });
    
    return session;
  }

  /**
   * Load TFLite model
   */
  async _loadTFLite(url) {
    if (typeof tflite === 'undefined') {
      await this._loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm');
    }
    // Placeholder for TFLite loading logic
    throw new Error('TFLite loading not fully implemented');
  }

  /**
   * Dynamic script loader
   */
  _loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Run inference on loaded model
   */
  async infer(modelId, inputTensor) {
    const modelData = this.loadedModels.get(modelId);
    if (!modelData) throw new Error(`Model not loaded: ${modelId}`);

    const session = modelData.instance;
    
    // ONNX Runtime inference
    const feeds = { [session.inputNames[0]]: inputTensor };
    const results = await session.run(feeds);
    
    return results[session.outputNames[0]];
  }

  /**
   * Unload specific model
   */
  unload(modelId) {
    const modelData = this.loadedModels.get(modelId);
    if (modelData) {
      this.memoryUsageMB -= modelData.meta.sizeMB;
      // Dispose ONNX session
      if (modelData.instance.dispose) modelData.instance.dispose();
      this.loadedModels.delete(modelId);
      this.dispatchEvent(new CustomEvent('model:unloaded', { detail: { modelId } }));
    }
  }

  /**
   * Evict oldest model to make room
   */
  async _evictOldestModel(neededMB) {
    let oldest = null;
    let oldestTime = Infinity;

    for (const [id, data] of this.loadedModels) {
      if (data.loadedAt < oldestTime) {
        oldestTime = data.loadedAt;
        oldest = id;
      }
    }

    if (oldest && (this.memoryUsageMB - MODEL_REGISTRY[oldest].sizeMB + neededMB <= this.maxMemoryMB)) {
      this.unload(oldest);
    } else if (oldest) {
      // Recursive eviction if still not enough
      this.unload(oldest);
      await this._evictOldestModel(neededMB);
    } else {
      throw new Error('Cannot free enough memory');
    }
  }

  /**
   * Enforce hard memory limit
   */
  _enforceMemoryLimit() {
    while (this.memoryUsageMB > this.maxMemoryMB * 0.95) {
      const oldest = Array.from(this.loadedModels.entries())
        .sort((a, b) => a[1].loadedAt - b[1].loadedAt)[0];
      if (oldest) this.unload(oldest[0]);
      else break;
    }
  }

  /**
   * Get memory stats
   */
  getStats() {
    return {
      loadedCount: this.loadedModels.size,
      memoryUsageMB: this.memoryUsageMB,
      maxMemoryMB: this.maxMemoryMB,
      utilization: (this.memoryUsageMB / this.maxMemoryMB * 100).toFixed(1) + '%'
    };
  }
}

export const modelManager = new ModelManager();
export default modelManager;
