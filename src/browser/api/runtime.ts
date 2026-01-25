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

    // Also handle from service workers
    this.ctx.session.serviceWorkers.on('running-status-changed' as any, ({ runningStatus, versionId }: any) => {
      if (runningStatus !== 'starting') return
      const sw = (this.ctx.session as any).serviceWorkers.getWorkerFromVersionID(versionId)
      if (sw?.scope?.startsWith('chrome-extension://')) {
        sw.ipc.on('crx-runtime-response', handler)
      }
    })
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
      console.log('[crx-runtime] Port message from popup:', portId, message)
      const port = this.ports.get(portId)
      if (!port) {
        console.log('[crx-runtime] Port message for unknown port:', portId, 'known ports:', Array.from(this.ports.keys()))
        return
      }

      // Forward message to service worker (MV3) or background page (MV2)
      if (port.serviceWorker) {
        console.log('[crx-runtime] Forwarding to SW:', portId)
        port.serviceWorker.send('crx-port-message', portId, message)
      } else {
        // MV2 - send directly to background page webContents
        console.log('[crx-runtime] Forwarding to background page:', portId)
        const bgPage = this.findBackgroundPage(port.extensionId)
        if (bgPage) {
          if (!this.safeSend(bgPage, 'crx-runtime.port-message', portId, message)) {
            console.log('[crx-runtime] Failed to forward port message to background page')
          }
        } else {
          console.log('[crx-runtime] No background page found for port message')
        }
      }
    })

    // Handle port disconnects from renderers (popup)
    ipcMain.on('crx-port-disconnect', (event, extensionId: string, portId: string) => {
      const port = this.ports.get(portId)
      if (!port) return

      console.log('[crx-runtime] Port disconnect from popup:', portId)

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
      console.log('[crx-runtime] Port message from background to popup:', portId, message)
      const port = this.ports.get(portId)
      if (!port) {
        console.log('[crx-runtime] Unknown port for bg->popup message:', portId)
        return
      }

      // Forward to popup
      if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
        console.log('[crx-runtime] Forwarding bg message to popup:', portId)
        port.senderWebContents.send(`crx-port-msg-${portId}`, message)
      }
    })

    // Handle port disconnects from background page
    ipcMain.on('crx-port-disconnect-from-bg', (event, portId: string) => {
      console.log('[crx-runtime] Port disconnect from background:', portId)
      const port = this.ports.get(portId)
      if (!port) return

      // Notify popup of disconnect
      if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
        port.senderWebContents.send(`crx-port-disconnect-${portId}`)
      }

      this.ports.delete(portId)
    })

    // Handle port messages from service workers
    this.ctx.session.serviceWorkers.on('running-status-changed' as any, ({ runningStatus, versionId }: any) => {
      if (runningStatus !== 'starting') return
      const sw = (this.ctx.session as any).serviceWorkers.getWorkerFromVersionID(versionId)
      if (sw?.scope?.startsWith('chrome-extension://')) {
        console.log('[crx-runtime] Setting up SW IPC listeners for scope:', sw.scope)

        // Listen for port messages from SW
        sw.ipc.on('crx-port-message', (_event: any, portId: string, message: any) => {
          console.log('[crx-runtime] Port message from SW:', portId, message)
          const port = this.ports.get(portId)
          if (!port) {
            console.log('[crx-runtime] Unknown port from SW:', portId)
            return
          }

          // Forward to renderer (only if sender is a WebContents)
          if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
            console.log('[crx-runtime] Forwarding to popup:', portId)
            port.senderWebContents.send(`crx-port-msg-${portId}`, message)
          } else {
            console.log('[crx-runtime] Cannot forward - sender not WebContents or destroyed')
          }
        })

        // Listen for port disconnects from SW
        sw.ipc.on('crx-port-disconnect', (_event: any, portId: string) => {
          console.log('[crx-runtime] Port disconnect from SW:', portId)
          const port = this.ports.get(portId)
          if (!port) return

          // Notify renderer of disconnect (only if sender is a WebContents)
          if (isWebContents(port.senderWebContents) && !port.senderWebContents.isDestroyed()) {
            port.senderWebContents.send(`crx-port-disconnect-${portId}`)
          }

          this.ports.delete(portId)
        })
      }
    })
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
            console.log('[crx-runtime] Background page has no mainFrame:', extensionId)
            continue
          }
          return wc
        } catch (e) {
          console.log('[crx-runtime] Background page frame not accessible:', extensionId, e)
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
        console.log('[crx-runtime] Cannot send - webContents destroyed')
        return false
      }
      wc.send(channel, ...args)
      return true
    } catch (e) {
      console.log('[crx-runtime] Error sending to webContents:', e)
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

    console.log('[crx-runtime] connect from', extensionId, 'portId:', portId, 'name:', portName)

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
    console.log('[crx-runtime] Port stored:', portId)

    // Try service worker first (MV3), then background page (MV2)
    const scope = `chrome-extension://${extensionId}/`
    try {
      console.log('[crx-runtime] Trying SW for scope:', scope)
      const serviceWorker = await this.ctx.session.serviceWorkers.startWorkerForScope(scope)
      console.log('[crx-runtime] SW started, sending onConnect')

      // Update port with service worker reference
      const port = this.ports.get(portId)
      if (port) {
        port.serviceWorker = serviceWorker
      }

      serviceWorker.send('crx-runtime.onConnect', portId, portName, sender)
      console.log('[crx-runtime] onConnect sent to SW')
    } catch (error) {
      console.log('[crx-runtime] SW failed, trying background page:', error)

      // MV2 extension - find and send directly to background page webContents
      // This avoids stale listener references in the router
      const bgPage = this.findBackgroundPage(extensionId)
      if (bgPage) {
        console.log('[crx-runtime] Found background page, sending onConnect directly')
        if (this.safeSend(bgPage, 'crx-runtime.onConnect', portId, portName, sender)) {
          console.log('[crx-runtime] onConnect sent to background page')
        } else {
          console.log('[crx-runtime] Failed to send onConnect to background page')
        }
      } else {
        console.log('[crx-runtime] No background page found for extension:', extensionId)
      }
    }
  }
}
