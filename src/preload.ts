import { injectExtensionAPIs } from './renderer'

console.log('[crx-preload] process.type:', process.type, 'contextIsolated:', process.contextIsolated)

// Only load within extension page context
if (process.type === 'service-worker' || (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://'))) {
  console.log('[crx-preload] Injecting extension APIs')
  injectExtensionAPIs()
} else {
  console.log('[crx-preload] Skipped injection. location:', typeof location !== 'undefined' ? location.href : 'undefined')
}
