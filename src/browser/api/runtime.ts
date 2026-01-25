import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { ipcMain } from 'electron'
import { ExtensionContext } from '../context'
import { ExtensionEvent } from '../router'
import { getExtensionManifest } from './common'
import { NativeMessagingHost } from './lib/native-messaging-host'
import debug from 'debug'

const d = debug('electron-chrome-extensions:runtime')

export class RuntimeAPI extends EventEmitter {
  private hostMap: Record<string, NativeMessagingHost | undefined> = {}

  // Pending message responses: messageId -> { resolve, reject, timeout }
  private pendingResponses = new Map<string, {
    resolve: (value: any) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  constructor(private ctx: ExtensionContext) {
    super()

    const handle = this.ctx.router.apiHandler()
    handle('runtime.connectNative', this.connectNative, { permission: 'nativeMessaging' })
    handle('runtime.disconnectNative', this.disconnectNative, { permission: 'nativeMessaging' })
    handle('runtime.openOptionsPage', this.openOptionsPage)
    handle('runtime.sendNativeMessage', this.sendNativeMessage, { permission: 'nativeMessaging' })
    handle('runtime.sendMessage', this.sendMessage.bind(this))

    // Handle responses from service workers/background pages
    this.setupResponseHandler()
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
}
