/**
 * Web Worker для клиентской нейросетевой модели NMT (MarianMT via Transformers.js)
 * Полная изоляция от основного потока UI:
 * - Скачивание модели, конфигов и ONNX-весов выполняется в фоновом потоке
 * - Компиляция WebAssembly и ONNX Runtime Web выполняется в фоновом потоке
 * - Инференс нейросети выполняется в фоновом потоке
 * 
 * Благодаря этому основной поток интерфейса (DOM, клавиатура, поле ввода, 60fps анимации)
 * остаётся на 100% отзывчивым и никогда не блокируется.
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

// Настройки окружения Transformers.js для браузера
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/';

const MODEL_ID = 'Xenova/opus-mt-ru-en';
let translatorPromise = null;
let isModelReady = false;

async function getTranslator(onProgress) {
    if (!translatorPromise) {
        translatorPromise = (async () => {
            const instance = await pipeline('translation', MODEL_ID, {
                progress_callback: (p) => {
                    if (typeof onProgress === 'function') {
                        onProgress(p);
                    }
                }
            });
            isModelReady = true;
            // Уведомляем главный поток о полной готовности модели
            self.postMessage({ type: 'ready' });
            return instance;
        })();
    }
    return translatorPromise;
}

self.addEventListener('message', async (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'load') {
        try {
            await getTranslator((p) => {
                self.postMessage({ type: 'progress', data: p });
            });
            self.postMessage({ type: 'ready' });
        } catch (err) {
            self.postMessage({
                type: 'error',
                error: err ? (err.message || String(err)) : 'Failed to load model'
            });
        }
    } else if (msg.type === 'translate') {
        const { id, texts } = msg;
        try {
            const translator = await getTranslator((p) => {
                self.postMessage({ type: 'progress', data: p });
            });
            const raw = await translator(texts);
            const outputs = Array.isArray(raw) ? raw : [raw];
            self.postMessage({ type: 'complete', id, outputs });
        } catch (err) {
            self.postMessage({
                type: 'error',
                id,
                error: err ? (err.message || String(err)) : 'Translation failed'
            });
        }
    }
});
