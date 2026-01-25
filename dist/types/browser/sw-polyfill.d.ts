/**
 * Generates polyfill code to be prepended to service worker scripts.
 *
 * This code runs inside the actual SW execution context (not the preload realm),
 * so modifications to chrome.* persist. It uses the `electron` bridge exposed
 * by the preload via contextBridge.exposeInMainWorld.
 */
export declare function generateSWPolyfill(): string;
