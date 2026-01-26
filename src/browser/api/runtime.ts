import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ipcMain } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getExtensionManifest } from './common'
import { NativeMessagingHost } from './lib/native-messaging-host'
import debug from 'debug'

const d = debug('electron-chrome-extensions:runtime')

interface PortConnection {
  portId: string
  extensionId: string
  name: string
  senderWebContents: Electron.WebContents | Electron.ServiceWorkerMain
  senderUrl: string
  serviceWorker?: Electron.ServiceWorkerMain
}

// Helper to check if sender is a WebContents (not ServiceWorkerMain)
function isWebContents(sender: Electron.WebContents | Electron.ServiceWorkerMain): sender is Electron.WebContents {
  return 'isDestroyed' in sender && typeof sender.isDestroyed === 'function'
}

export class RuntimeAPI extends EventEmitter {
  private hostMap: Record<string, NativeMessagingHost | undefined> = {}

  // Pending message responses: messageId -> { resolve, reject, timeout }
  private pendingResponses = new Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  // Active port connections: portId -> PortConnection
  private ports = new Map<string, PortConnection>()

  // Track registered service workers by versionId to prevent duplicate listeners
  private registeredWorkers = new Map<number, boolean>()

  constructor(private ctx: ExtensionContext) {
    super()

    const handle = this.ctx.router.apiHandler()
    handle('runtime.connectNative', this.connectNative, { permission: 'nativeMessaging' })
    handle('runtime.disconnectNative', this.disconnectNative, { permission: 'nativeMessaging' })
    handle('runtime.openOptionsPage', this.openOptionsPage)
    handle('runtime.sendNativeMessage', this.sendNativeMessage, { permission: 'nativeMessaging' })
    handle('runtime.sendMessage', this.sendMessage.bind(this))
    handle('runtime.connect', this.connect.bind(this))

    // Handle responses from service workers/background pages
    this.setupResponseHandler()

    // Handle port messages and disconnects
    this.setupPortHandlers()

    // Set up consolidated service worker IPC listeners with proper cleanup
    this.setupServiceWorkerListeners()

    // Set up periodic cleanup for stale ports
    this.setupPortCleanup()
  }

  private setupResponseHandler() {
    // Listen for message responses from any extension context
    const handler = (_event: Electron.IpcMainEvent, messageId: string, response: any) => {
      d('received response for message %s: %o', messageId, response)
      const pending = this.pendingResponses.get(messageId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingResponses.delete(messageId)
        pending.resolve(response)
      }
    }

    ipcMain.on('crx-runtime-response', handler)

    // Response handler is now set up in setupServiceWorkerListeners
  }

  private sendMessage = async (
    event: ExtensionEvent,
    message: any,
    options?: { includeTlsChannelId?: boolean }
  ): Promise<any> => {
    const extensionId = event.extension.id
    const messageId = randomUUID()

    d('sendMessage from %s: messageId=%s, message=%o', extensionId, messageId, message)

    // Create sender info
    const sender: chrome.runtime.MessageSender = {
      id: extensionId,
      url: event.type === 'frame' ? event.sender.getURL() : `chrome-extension://${extensionId}/`
    }

    // If sender is from a tab, include tab info
    if (event.type === 'frame') {
      const tab = this.ctx.store.getTabById(event.sender.id)
      if (tab) {
        const tabDetails = this.ctx.store.tabDetailsCache.get(tab.id)
        if (tabDetails) {
          sender.tab = tabDetails as chrome.tabs.Tab
        }
      }
    }

    return new Promise((resolve, reject) => {
      // Set up timeout (30 seconds)
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(messageId)
        d('sendMessage timeout for %s', messageId)
        resolve(undefined) // Chrome returns undefined on timeout, not an error
      }, 30000)

      this.pendingResponses.set(messageId, { resolve, reject, timeout })

      // Send to service worker
      const scope = `chrome-extension://${extensionId}/`
      this.ctx.session.serviceWorkers
        .startWorkerForScope(scope)
        .then((serviceWorker) => {
          d('sending message to service worker: %s', scope)
          serviceWorker.send('crx-runtime.onMessage', messageId, message, sender)
        })
        .catch((error) => {
          d('failed to send message to service worker: %s', error)
          // Also try sending to background page listeners
          this.ctx.router.sendEvent(extensionId, 'runtime.onMessage', messageId, message, sender)
        })
    })
  }

  private connectNative = async (
    event: ExtensionEvent,
    connectionId: string,
    application: string
  ) => {
    const host = new NativeMessagingHost(
      event.extension.id,
      event.sender!,
      connectionId,
      application
    )
    this.hostMap[connectionId] = host
  }

  private disconnectNative = (event: ExtensionEvent, connectionId: string) => {
    this.hostMap[connectionId]?.destroy()
    this.hostMap[connectionId] = undefined
  }

  private sendNativeMessage = async (event: ExtensionEvent, application: string, message: any) => {
    const connectionId = randomUUID()
    const host = new NativeMessagingHost(
      event.extension.id,
      event.sender!,
      connectionId,
      application,
      false
    )
    await host.ready
    return await host.sendAndReceive(message)
  }

  private openOptionsPage = async ({ extension }: ExtensionEvent) => {
    // TODO: options page shouldn't appear in Tabs API
    // https://developer.chrome.com/extensions/options#tabs-api

    const manifest = getExtensionManifest(extension)

    if (manifest.options_ui) {
      // Embedded option not support (!options_ui.open_in_new_tab)
      const url = `chrome-extension://${extension.id}/${manifest.options_ui.page}`
      await this.ctx.store.createTab({ url, active: true })
    } else if (manifest.options_page) {
      const url = `chrome-extension://${extension.id}/${manifest.options_page}`
      await this.ctx.store.createTab({ url, active: true })
    }
  }

  private setupPortHandlers() {
    // Handle port messages from renderers (popup, etc.)
    ipcMain.on('crx-port-msg', (event, extensionId: string, portId: string, message: any) => {
      const port = this.ports.get(portId)
      if (!port) return

      // Forward message to service worker (MV3) or background page (MV2)
      if (port.serviceWorker) {
        port.serviceWorker.send('crx-port-message', portId, message)
      } else {
        // MV2 - send directly to background page webContents
        const bgPage = this.findBackgroundPage(port.extensionId)
        if (bgPage) {
          this.safeSend(bgPage, 'crx-runtime.port-message', portId, message)
        }
      }
    })

    // Handle port disconnects from renderers (popup)
    ipcMain.on('crx-port-disconnect', (event, extensionId: string, portId: string) => {
      const port = this.ports.get(portId)
      if (!port) return

      // Notify service worker or background page of disconnect
      if (port.serviceWorker) {
        port.serviceWorker.send('crx-port-disconnect', portId)
      } else {
        const bgPage = this.findBackgroundPage(port.extensionId)
        if (bgPage) {
          this.safeSend(bgPage, 'crx-runtime.port-disconnect', portId)
        }
      }

      this.ports.delete(portId)
    })

    // Handle port messages from background page back to popup
    ipcMain.on('crx-port-message-to-popup', (event, portId: string, message: any) => {
      const port = this.ports.get(portId)
      if (!port) return

      // Forward to popup
      if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
        port.senderWebContents.send(`crx-port-msg-${portId}`, message)
      }
    })

    // Handle port disconnects from background page
    ipcMain.on('crx-port-disconnect-from-bg', (event, portId: string) => {
      const port = this.ports.get(portId)
      if (!port) return

      // Notify popup of disconnect
      if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
        port.senderWebContents.send(`crx-port-disconnect-${portId}`)
      }

      this.ports.delete(portId)
    })

    // Service worker IPC listeners are now set up in setupServiceWorkerListeners
  }

  /**
   * Consolidated service worker IPC listener setup with proper tracking and cleanup.
   * This prevents listener accumulation when service workers restart.
   */
  private setupServiceWorkerListeners() {
    // Response handler for runtime messages
    const responseHandler = (_event: Electron.IpcMainEvent, messageId: string, response: any) => {
      d('received response for message %s: %o', messageId, response)
      const pending = this.pendingResponses.get(messageId)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingResponses.delete(messageId)
        pending.resolve(response)
      }
    }

    this.ctx.session.serviceWorkers.on('running-status-changed' as any, ({ runningStatus, versionId }: any) => {
      // Cleanup when worker stops
      if (runningStatus === 'stopped') {
        this.registeredWorkers.delete(versionId)
        return
      }

      if (runningStatus !== 'starting') return

      // Prevent duplicate registrations for the same versionId
      if (this.registeredWorkers.has(versionId)) return

      const sw = (this.ctx.session as any).serviceWorkers.getWorkerFromVersionID(versionId)
      if (!sw?.scope?.startsWith('chrome-extension://')) return

      this.registeredWorkers.set(versionId, true)
      d('setting up SW IPC listeners for scope: %s', sw.scope)

      // Runtime response handler
      sw.ipc.on('crx-runtime-response', responseHandler)

      // Port message handler
      sw.ipc.on('crx-port-message', (_event: any, portId: string, message: any) => {
        const port = this.ports.get(portId)
        if (!port) return

        // Forward to renderer (only if sender is a WebContents)
        if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
          port.senderWebContents.send(`crx-port-msg-${portId}`, message)
        }
      })

      // Port disconnect handler
      sw.ipc.on('crx-port-disconnect', (_event: any, portId: string) => {
        const port = this.ports.get(portId)
        if (!port) return

        // Notify renderer of disconnect (only if sender is a WebContents)
        if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
          port.senderWebContents.send(`crx-port-disconnect-${portId}`)
        }

        this.ports.delete(portId)
      })
    })
  }

  /**
   * Periodically clean up stale ports where the sender has been destroyed.
   */
  private setupPortCleanup() {
    setInterval(() => {
      for (const [portId, port] of this.ports) {
        if (isWebContents(port.senderWebContents) && port.senderWebContents.isDestroyed()) {
          d('Cleaning up stale port %s', portId)
          this.ports.delete(portId)
        }
      }
    }, 60 * 1000) // Clean up every 60 seconds
  }

  // Find the background page webContents for an extension
  private findBackgroundPage(extensionId: string): Electron.WebContents | undefined {
    const { webContents } = require('electron')
    const allWebContents = webContents.getAllWebContents() as Electron.WebContents[]

    for (const wc of allWebContents) {
      if (wc.isDestroyed()) continue
      if (wc.getType() !== 'backgroundPage') continue
      if (wc.session !== this.ctx.session) continue

      const url = wc.getURL()
      if (url.startsWith(`chrome-extension://${extensionId}/`)) {
        // Check if the webContents is actually usable
        try {
          // Try to access mainFrame - if this throws, the frame is disposed
          const frame = wc.mainFrame
          if (!frame) {
            continue
          }
          return wc
        } catch (e) {
          continue
        }
      }
    }
    return undefined
  }

  // Safely send IPC to a webContents, returning true if successful
  private safeSend(wc: Electron.WebContents, channel: string, ...args: any[]): boolean {
    try {
      if (wc.isDestroyed()) {
        return false
      }
      wc.send(channel, ...args)
      return true
    } catch (e) {
      return false
    }
  }

  private connect = async (
    event: ExtensionEvent,
    portId: string,
    connectInfo?: { name?: string }
  ): Promise<void> => {
    const extensionId = event.extension.id
    const portName = connectInfo?.name || ''

    // Create sender info
    const sender: chrome.runtime.MessageSender = {
      id: extensionId,
      url: event.type === 'frame' ? event.sender.getURL() : `chrome-extension://${extensionId}/`
    }

    // If sender is from a tab, include tab info
    if (event.type === 'frame') {
      const tab = this.ctx.store.getTabById(event.sender.id)
      if (tab) {
        const tabDetails = this.ctx.store.tabDetailsCache.get(tab.id)
        if (tabDetails) {
          sender.tab = tabDetails as chrome.tabs.Tab
        }
      }
    }

    // Store port connection FIRST (before trying to connect)
    // This ensures messages can be queued while we establish the connection
    this.ports.set(portId, {
      portId,
      extensionId,
      name: portName,
      senderWebContents: event.sender,
      senderUrl: sender.url || '',
      serviceWorker: undefined // Will be set if SW is used
    })

    // Try service worker first (MV3), then background page (MV2)
    const scope = `chrome-extension://${extensionId}/`
    try {
      const serviceWorker = await this.ctx.session.serviceWorkers.startWorkerForScope(scope)

      // Update port with service worker reference
      const port = this.ports.get(portId)
      if (port) {
        port.serviceWorker = serviceWorker
      }

      serviceWorker.send('crx-runtime.onConnect', portId, portName, sender)
    } catch (error) {
      // MV2 extension - find and send directly to background page webContents
      // This avoids stale listener references in the router
      const bgPage = this.findBackgroundPage(extensionId)
      if (bgPage) {
        this.safeSend(bgPage, 'crx-runtime.onConnect', portId, portName, sender)
      }
    }
  }
}
