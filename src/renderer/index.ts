import { ipcRenderer, contextBridge, webFrame } from 'electron'
import { addExtensionListener, removeExtensionListener } from './event'

export const injectExtensionAPIs = () => {
  interface ExtensionMessageOptions {
    noop?: boolean
    defaultResponse?: any
    serialize?: (...args: any[]) => any[]
  }

  const invokeExtension = async function (
    extensionId: string,
    fnName: string,
    options: ExtensionMessageOptions = {},
    ...args: any[]
  ) {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined

    if (process.env.NODE_ENV === 'development') {
      console.log(fnName, args)
    }

    if (options.noop) {
      console.warn(`${fnName} is not yet implemented.`)
      if (callback) callback(options.defaultResponse)
      return Promise.resolve(options.defaultResponse)
    }

    if (options.serialize) {
      args = options.serialize(...args)
    }

    let result

    try {
      result = await ipcRenderer.invoke('crx-msg', extensionId, fnName, ...args)
    } catch (e) {
      // TODO: Set chrome.runtime.lastError?
      console.error(e)
      result = undefined
    }

    if (process.env.NODE_ENV === 'development') {
      console.log(fnName, '(result)', result)
    }

    if (callback) {
      callback(result)
    } else {
      return result
    }
  }

  type ConnectNativeCallback = (connectionId: string, send: (message: any) => void) => void
  const connectNative = (
    extensionId: string,
    application: string,
    receive: (message: any) => void,
    disconnect: () => void,
    callback: ConnectNativeCallback
  ) => {
    const connectionId = process.type === 'service-worker'
      ? require('node:crypto').randomUUID()
      : (contextBridge as any).executeInMainWorld({
          func: () => crypto.randomUUID()
        })
    invokeExtension(extensionId, 'runtime.connectNative', {}, connectionId, application)
    const onMessage = (_event: Electron.IpcRendererEvent, message: any) => {
      receive(message)
    }
    ipcRenderer.on(`crx-native-msg-${connectionId}`, onMessage)
    ipcRenderer.once(`crx-native-msg-${connectionId}-disconnect`, () => {
      ipcRenderer.off(`crx-native-msg-${connectionId}`, onMessage)
      disconnect()
    })
    const send = (message: any) => {
      ipcRenderer.send(`crx-native-msg-${connectionId}`, message)
    }
    callback(connectionId, send)
  }

  const disconnectNative = (extensionId: string, connectionId: string) => {
    invokeExtension(extensionId, 'runtime.disconnectNative', {}, connectionId)
  }

  // Send IPC message (for runtime message responses)
  const sendIpc = (channel: string, ...args: any[]) => {
    ipcRenderer.send(channel, ...args)
  }

  // Listen for IPC messages (for runtime.onMessage)
  const onIpc = (channel: string, callback: (...args: any[]) => void) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args))
  }

  // Remove IPC listener
  const offIpc = (channel: string, callback?: (...args: any[]) => void) => {
    if (callback) {
      ipcRenderer.off(channel, callback)
    } else {
      ipcRenderer.removeAllListeners(channel)
    }
  }

  // Port-based messaging for runtime.connect
  const connectPort = (
    extensionId: string,
    connectInfo: { name?: string } | undefined,
    onMessage: (message: any) => void,
    onDisconnect: () => void,
    callback: (portId: string) => void
  ) => {
    // Generate port ID
    const portId = process.type === 'service-worker'
      ? require('node:crypto').randomUUID()
      : (contextBridge as any).executeInMainWorld({
          func: () => crypto.randomUUID()
        })

    // Set up message listener for this port
    const messageHandler = (_event: Electron.IpcRendererEvent, msg: any) => {
      onMessage(msg)
    }
    ipcRenderer.on(`crx-port-msg-${portId}`, messageHandler)

    // Set up disconnect listener
    ipcRenderer.once(`crx-port-disconnect-${portId}`, () => {
      ipcRenderer.off(`crx-port-msg-${portId}`, messageHandler)
      onDisconnect()
    })

    // Invoke the connect handler
    invokeExtension(extensionId, 'runtime.connect', {}, portId, connectInfo)

    callback(portId)
  }

  const sendPortMessage = (extensionId: string, portId: string, message: any) => {
    ipcRenderer.send('crx-port-msg', extensionId, portId, message)
  }

  const disconnectPort = (extensionId: string, portId: string) => {
    ipcRenderer.send('crx-port-disconnect', extensionId, portId)
  }

  const electronContext = {
    invokeExtension,
    addExtensionListener,
    removeExtensionListener,
    connectNative,
    disconnectNative,
    sendIpc,
    onIpc,
    offIpc,
    connectPort,
    sendPortMessage,
    disconnectPort
  }

  // Function body to run in the main world.
  // IMPORTANT: This must be self-contained, no closure variable will be included!
  function mainWorldScript() {
    console.log('[electron-chrome-extensions] mainWorldScript running in:', location.href)

    // CRITICAL: Patch chrome.storage.sync IMMEDIATELY before any other code runs
    // This must happen before webextension-polyfill checks for sync
    const chromeObj = (globalThis as any).chrome
    console.log('[electron-chrome-extensions] chrome exists:', !!chromeObj,
                'storage exists:', !!(chromeObj && chromeObj.storage),
                'storage.sync:', chromeObj?.storage?.sync,
                'storage.local:', chromeObj?.storage?.local)

    if (chromeObj && chromeObj.storage) {
      const local = chromeObj.storage.local
      // Create a fallback if local doesn't exist
      const storageImpl = local || {
        get: (keys: any, cb?: Function) => { const r = {}; if(cb) cb(r); return Promise.resolve(r); },
        set: (items: any, cb?: Function) => { if(cb) cb(); return Promise.resolve(); },
        remove: (keys: any, cb?: Function) => { if(cb) cb(); return Promise.resolve(); },
        clear: (cb?: Function) => { if(cb) cb(); return Promise.resolve(); },
        getBytesInUse: (keys: any, cb?: Function) => { if(cb) cb(0); return Promise.resolve(0); }
      }

      // Always set sync/managed/session to ensure they exist
      try {
        Object.defineProperty(chromeObj.storage, 'sync', {
          value: storageImpl,
          writable: true,
          enumerable: true,
          configurable: true
        })
        Object.defineProperty(chromeObj.storage, 'managed', {
          value: storageImpl,
          writable: true,
          enumerable: true,
          configurable: true
        })
        Object.defineProperty(chromeObj.storage, 'session', {
          value: storageImpl,
          writable: true,
          enumerable: true,
          configurable: true
        })
        console.log('[electron-chrome-extensions] Patched storage, sync hasOwn:',
                    Object.prototype.hasOwnProperty.call(chromeObj.storage, 'sync'),
                    'sync value:', chromeObj.storage.sync)
      } catch (e) {
        console.error('[electron-chrome-extensions] Failed to patch storage:', e)
      }
    }

    // Use context bridge API or closure variable when context isolation is disabled.
    const electron = ((globalThis as any).electron as typeof electronContext) || electronContext

    const chrome = globalThis.chrome || {}
    if (!(globalThis as any).chrome) {
      ;(globalThis as any).chrome = chrome
    }
    const extensionId = chrome.runtime?.id

    // NOTE: This uses a synchronous IPC to get the extension manifest.
    // To avoid this, JS bindings for RendererExtensionRegistry would be
    // required.
    // OFFSCREEN_DOCUMENT contexts do not have this function defined.
    const manifest: chrome.runtime.Manifest =
      (extensionId && chrome.runtime.getManifest?.()) || ({} as any)

    const invokeExtension =
      (fnName: string, opts: ExtensionMessageOptions = {}) =>
      (...args: any[]) =>
        electron.invokeExtension(extensionId, fnName, opts, ...args)

    function imageData2base64(imageData: ImageData) {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) return null

      canvas.width = imageData.width
      canvas.height = imageData.height
      ctx.putImageData(imageData, 0, 0)

      return canvas.toDataURL()
    }

    class ExtensionEvent<T extends Function> implements chrome.events.Event<T> {
      constructor(private name: string) {}

      addListener(callback: T) {
        electron.addExtensionListener(extensionId, this.name, callback)
      }
      removeListener(callback: T) {
        electron.removeExtensionListener(extensionId, this.name, callback)
      }

      getRules(callback: (rules: chrome.events.Rule[]) => void): void
      getRules(ruleIdentifiers: string[], callback: (rules: chrome.events.Rule[]) => void): void
      getRules(ruleIdentifiers: any, callback?: any) {
        throw new Error('Method not implemented.')
      }
      hasListener(callback: T): boolean {
        throw new Error('Method not implemented.')
      }
      removeRules(ruleIdentifiers?: string[] | undefined, callback?: (() => void) | undefined): void
      removeRules(callback?: (() => void) | undefined): void
      removeRules(ruleIdentifiers?: any, callback?: any) {
        throw new Error('Method not implemented.')
      }
      addRules(
        rules: chrome.events.Rule[],
        callback?: ((rules: chrome.events.Rule[]) => void) | undefined
      ): void {
        throw new Error('Method not implemented.')
      }
      hasListeners(): boolean {
        throw new Error('Method not implemented.')
      }
    }

    // chrome.types.ChromeSetting<any>
    class ChromeSetting {
      set() {}
      get() {}
      clear() {}
      onChange = {
        addListener: () => {}
      }
    }

    class Event<T extends Function> implements Partial<chrome.events.Event<T>> {
      private listeners: T[] = []

      _emit(...args: any[]) {
        this.listeners.forEach((listener) => {
          listener(...args)
        })
      }

      addListener(callback: T): void {
        this.listeners.push(callback)
      }
      removeListener(callback: T): void {
        const index = this.listeners.indexOf(callback)
        if (index > -1) {
          this.listeners.splice(index, 1)
        }
      }
    }

    class NativePort implements chrome.runtime.Port {
      private connectionId: string = ''
      private connected = false
      private pending: any[] = []

      name: string = ''

      _init = (connectionId: string, send: (message: any) => void) => {
        this.connected = true
        this.connectionId = connectionId
        this._send = send

        this.pending.forEach((msg) => this.postMessage(msg))
        this.pending = []

        Object.defineProperty(this, '_init', { value: undefined })
      }

      _send(message: any) {
        this.pending.push(message)
      }

      _receive(message: any) {
        ;(this.onMessage as any)._emit(message)
      }

      _disconnect() {
        this.disconnect()
      }

      postMessage(message: any) {
        this._send(message)
      }
      disconnect() {
        if (this.connected) {
          electron.disconnectNative(extensionId, this.connectionId)
          ;(this.onDisconnect as any)._emit()
          this.connected = false
        }
      }
      onMessage: chrome.runtime.PortMessageEvent = new Event() as any
      onDisconnect: chrome.runtime.PortDisconnectEvent = new Event() as any
    }

    // Port for runtime.connect() - popup/content script side (sender)
    class RuntimePort implements chrome.runtime.Port {
      private portId: string = ''
      private connected = false
      private pending: any[] = []

      name: string

      constructor(name?: string) {
        this.name = name || ''
      }

      _init = (portId: string) => {
        this.connected = true
        this.portId = portId

        this.pending.forEach((msg) => this.postMessage(msg))
        this.pending = []

        Object.defineProperty(this, '_init', { value: undefined })
      }

      _receive(message: any) {
        ;(this.onMessage as any)._emit(message, this)
      }

      _disconnect() {
        if (this.connected) {
          this.connected = false
          ;(this.onDisconnect as any)._emit(this)
        }
      }

      postMessage(message: any) {
        if (!this.connected) {
          this.pending.push(message)
          return
        }
        electron.sendPortMessage(extensionId, this.portId, message)
      }

      disconnect() {
        if (this.connected) {
          electron.disconnectPort(extensionId, this.portId)
          this._disconnect()
        }
      }

      onMessage: chrome.runtime.PortMessageEvent = new Event() as any
      onDisconnect: chrome.runtime.PortDisconnectEvent = new Event() as any
    }

    // Port for background page side (receiver) - receives connections from popup/content scripts
    class BackgroundPort implements chrome.runtime.Port {
      private connected = true

      name: string
      sender?: chrome.runtime.MessageSender

      constructor(private portId: string, name: string, sender: chrome.runtime.MessageSender) {
        this.name = name || ''
        this.sender = sender
      }

      _receive(message: any) {
        ;(this.onMessage as any)._emit(message, this)
      }

      _disconnect() {
        if (this.connected) {
          this.connected = false
          ;(this.onDisconnect as any)._emit(this)
        }
      }

      postMessage(message: any) {
        if (!this.connected) return
        // Send message back to the popup/content script via IPC
        electron.sendIpc('crx-port-message-to-popup', this.portId, message)
      }

      disconnect() {
        if (this.connected) {
          this.connected = false
          electron.sendIpc('crx-port-disconnect-from-bg', this.portId)
          ;(this.onDisconnect as any)._emit(this)
        }
      }

      onMessage: chrome.runtime.PortMessageEvent = new Event() as any
      onDisconnect: chrome.runtime.PortDisconnectEvent = new Event() as any
    }

    // Track background ports for message routing
    const backgroundPorts: Map<string, BackgroundPort> = new Map()

    // Check if current context is a background page
    const isBackgroundPage = (() => {
      if (!extensionId) return false

      // Cast to any to handle both MV2 and MV3 manifest types
      const background = manifest.background as any

      // Check MV2 background page path
      const bgPage = background?.page as string | undefined
      if (bgPage) {
        const bgUrl = `chrome-extension://${extensionId}/${bgPage}`
        return location.href === bgUrl || location.href.startsWith(bgUrl + '?')
      }

      // Check if background scripts are specified (generated background page)
      const bgScripts = background?.scripts as string[] | undefined
      if (bgScripts && bgScripts.length > 0) {
        // Generated background pages have URLs like chrome-extension://id/_generated_background_page.html
        return location.href.includes('_generated_background_page.html')
      }

      return false
    })()

    console.log('[electron-chrome-extensions] Context check - isBackgroundPage:', isBackgroundPage, 'url:', location.href)

    // Custom onConnect event that creates proper Port objects
    class OnConnectEvent {
      private listeners: ((port: chrome.runtime.Port) => void)[] = []
      private initialized = false

      constructor() {
        // Only register IPC listeners in background page context
        // This prevents popups from receiving onConnect events meant for background
        if (isBackgroundPage) {
          this.initializeListeners()
        }
      }

      private initializeListeners() {
        if (this.initialized) return
        this.initialized = true

        console.log('[electron-chrome-extensions] Initializing onConnect listeners for background page')

        // Listen for onConnect events from main process
        electron.addExtensionListener(extensionId, 'runtime.onConnect', (portId: string, name: string, sender: any) => {
          console.log('[electron-chrome-extensions] Background received onConnect:', portId, name)
          const port = new BackgroundPort(portId, name, sender)
          backgroundPorts.set(portId, port)

          // Call all registered listeners
          this.listeners.forEach(listener => {
            try {
              listener(port)
            } catch (e) {
              console.error('[electron-chrome-extensions] onConnect listener error:', e)
            }
          })
        })

        // Listen for port messages from main process
        electron.addExtensionListener(extensionId, 'runtime.port-message', (portId: string, message: any) => {
          console.log('[electron-chrome-extensions] Background received port message:', portId, message)
          const port = backgroundPorts.get(portId)
          if (port) {
            port._receive(message)
          }
        })

        // Listen for port disconnects
        electron.addExtensionListener(extensionId, 'runtime.port-disconnect', (portId: string) => {
          console.log('[electron-chrome-extensions] Background received port disconnect:', portId)
          const port = backgroundPorts.get(portId)
          if (port) {
            port._disconnect()
            backgroundPorts.delete(portId)
          }
        })
      }

      addListener(callback: (port: chrome.runtime.Port) => void) {
        console.log('[electron-chrome-extensions] onConnect.addListener called, isBackgroundPage:', isBackgroundPage)
        this.listeners.push(callback)

        // If addListener is called in background page but we haven't initialized yet, do it now
        if (isBackgroundPage && !this.initialized) {
          this.initializeListeners()
        }
      }

      removeListener(callback: (port: chrome.runtime.Port) => void) {
        const index = this.listeners.indexOf(callback)
        if (index > -1) {
          this.listeners.splice(index, 1)
        }
      }

      hasListener(callback: (port: chrome.runtime.Port) => void): boolean {
        return this.listeners.indexOf(callback) > -1
      }

      hasListeners(): boolean {
        return this.listeners.length > 0
      }
    }

    // Create singleton onConnect event
    const onConnectEvent = new OnConnectEvent()

    type DeepPartial<T> = {
      [P in keyof T]?: DeepPartial<T[P]>
    }

    type APIFactoryMap = {
      [apiName in keyof typeof chrome]: {
        shouldInject?: () => boolean
        factory: (
          base: DeepPartial<(typeof chrome)[apiName]>
        ) => DeepPartial<(typeof chrome)[apiName]>
      }
    }

    const browserActionFactory = (base: DeepPartial<typeof globalThis.chrome.browserAction>) => {
      const api = {
        ...base,

        setTitle: invokeExtension('browserAction.setTitle'),
        getTitle: invokeExtension('browserAction.getTitle'),

        setIcon: invokeExtension('browserAction.setIcon', {
          serialize: (details: chrome.action.TabIconDetails) => {
            if (details.imageData) {
              if (manifest.manifest_version === 3) {
                // TODO(mv3): might need to use offscreen document to serialize
                console.warn(
                  'action.setIcon with imageData is not yet supported by electron-chrome-extensions'
                )
                details.imageData = undefined
              } else if (details.imageData instanceof ImageData) {
                details.imageData = imageData2base64(details.imageData) as any
              } else {
                details.imageData = Object.entries(details.imageData).reduce(
                  (obj: any, pair: any[]) => {
                    obj[pair[0]] = imageData2base64(pair[1])
                    return obj
                  },
                  {}
                )
              }
            }

            return [details]
          }
        }),

        setPopup: invokeExtension('browserAction.setPopup'),
        getPopup: invokeExtension('browserAction.getPopup'),

        setBadgeText: invokeExtension('browserAction.setBadgeText'),
        getBadgeText: invokeExtension('browserAction.getBadgeText'),

        setBadgeBackgroundColor: invokeExtension('browserAction.setBadgeBackgroundColor'),
        getBadgeBackgroundColor: invokeExtension('browserAction.getBadgeBackgroundColor'),

        getUserSettings: invokeExtension('browserAction.getUserSettings'),

        enable: invokeExtension('browserAction.enable', { noop: true }),
        disable: invokeExtension('browserAction.disable', { noop: true }),

        openPopup: invokeExtension('browserAction.openPopup'),

        onClicked: new ExtensionEvent('browserAction.onClicked')
      }

      return api
    }

    /**
     * Factories for each additional chrome.* API.
     */
    const apiDefinitions: Partial<APIFactoryMap> = {
      action: {
        shouldInject: () => manifest.manifest_version === 3 && !!manifest.action,
        factory: browserActionFactory
      },

      browserAction: {
        shouldInject: () => manifest.manifest_version === 2 && !!manifest.browser_action,
        factory: browserActionFactory
      },

      commands: {
        factory: (base) => {
          return {
            ...base,
            getAll: invokeExtension('commands.getAll'),
            onCommand: new ExtensionEvent('commands.onCommand')
          }
        }
      },

      contextMenus: {
        factory: (base) => {
          let menuCounter = 0
          const menuCallbacks: {
            [key: string]: chrome.contextMenus.CreateProperties['onclick']
          } = {}
          const menuCreate = invokeExtension('contextMenus.create')

          let hasInternalListener = false
          const addInternalListener = () => {
            api.onClicked.addListener((info, tab) => {
              const callback = menuCallbacks[info.menuItemId]
              if (callback && tab) callback(info, tab)
            })
            hasInternalListener = true
          }

          const api = {
            ...base,
            create: function (
              createProperties: chrome.contextMenus.CreateProperties,
              callback?: Function
            ) {
              if (typeof createProperties.id === 'undefined') {
                createProperties.id = `${++menuCounter}`
              }
              if (createProperties.onclick) {
                if (!hasInternalListener) addInternalListener()
                menuCallbacks[createProperties.id] = createProperties.onclick
                delete createProperties.onclick
              }
              menuCreate(createProperties, callback)
              return createProperties.id
            },
            update: invokeExtension('contextMenus.update', { noop: true }),
            remove: invokeExtension('contextMenus.remove'),
            removeAll: invokeExtension('contextMenus.removeAll'),
            onClicked: new ExtensionEvent<
              (info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab) => void
            >('contextMenus.onClicked')
          }

          return api
        }
      },

      cookies: {
        factory: (base) => {
          return {
            ...base,
            get: invokeExtension('cookies.get'),
            getAll: invokeExtension('cookies.getAll'),
            set: invokeExtension('cookies.set'),
            remove: invokeExtension('cookies.remove'),
            getAllCookieStores: invokeExtension('cookies.getAllCookieStores'),
            onChanged: new ExtensionEvent('cookies.onChanged')
          }
        }
      },

      // TODO: implement
      downloads: {
        factory: (base) => {
          return {
            ...base,
            acceptDanger: invokeExtension('downloads.acceptDanger', { noop: true }),
            cancel: invokeExtension('downloads.cancel', { noop: true }),
            download: invokeExtension('downloads.download', { noop: true }),
            erase: invokeExtension('downloads.erase', { noop: true }),
            getFileIcon: invokeExtension('downloads.getFileIcon', { noop: true }),
            open: invokeExtension('downloads.open', { noop: true }),
            pause: invokeExtension('downloads.pause', { noop: true }),
            removeFile: invokeExtension('downloads.removeFile', { noop: true }),
            resume: invokeExtension('downloads.resume', { noop: true }),
            search: invokeExtension('downloads.search', { noop: true }),
            setUiOptions: invokeExtension('downloads.setUiOptions', { noop: true }),
            show: invokeExtension('downloads.show', { noop: true }),
            showDefaultFolder: invokeExtension('downloads.showDefaultFolder', { noop: true }),
            onChanged: new ExtensionEvent('downloads.onChanged'),
            onCreated: new ExtensionEvent('downloads.onCreated'),
            onDeterminingFilename: new ExtensionEvent('downloads.onDeterminingFilename'),
            onErased: new ExtensionEvent('downloads.onErased')
          }
        }
      },

      extension: {
        factory: (base) => {
          return {
            ...base,
            isAllowedFileSchemeAccess: invokeExtension('extension.isAllowedFileSchemeAccess', {
              noop: true,
              defaultResponse: false
            }),
            isAllowedIncognitoAccess: invokeExtension('extension.isAllowedIncognitoAccess', {
              noop: true,
              defaultResponse: false
            }),
            // TODO: Add native implementation
            getViews: () => []
          }
        }
      },

      i18n: {
        shouldInject: () => manifest.manifest_version === 3,
        factory: (base) => {
          // Electron configuration prevented this API from being available.
          // https://github.com/electron/electron/pull/45031
          if (base.getMessage) {
            return base
          }

          return {
            ...base,
            getUILanguage: () => 'en-US',
            getAcceptLanguages: (callback: any) => {
              const results = ['en-US']
              if (callback) {
                queueMicrotask(() => callback(results))
              }
              return Promise.resolve(results)
            },
            getMessage: (messageName: string) => messageName
          }
        }
      },

      notifications: {
        factory: (base) => {
          return {
            ...base,
            clear: invokeExtension('notifications.clear'),
            create: invokeExtension('notifications.create'),
            getAll: invokeExtension('notifications.getAll'),
            getPermissionLevel: invokeExtension('notifications.getPermissionLevel'),
            update: invokeExtension('notifications.update'),
            onClicked: new ExtensionEvent('notifications.onClicked'),
            onButtonClicked: new ExtensionEvent('notifications.onButtonClicked'),
            onClosed: new ExtensionEvent('notifications.onClosed')
          }
        }
      },

      permissions: {
        factory: (base) => {
          return {
            ...base,
            contains: invokeExtension('permissions.contains'),
            getAll: invokeExtension('permissions.getAll'),
            remove: invokeExtension('permissions.remove'),
            request: invokeExtension('permissions.request'),
            onAdded: new ExtensionEvent('permissions.onAdded'),
            onRemoved: new ExtensionEvent('permissions.onRemoved')
          }
        }
      },

      privacy: {
        factory: (base) => {
          return {
            ...base,
            network: {
              networkPredictionEnabled: new ChromeSetting(),
              webRTCIPHandlingPolicy: new ChromeSetting()
            },
            services: {
              autofillAddressEnabled: new ChromeSetting(),
              autofillCreditCardEnabled: new ChromeSetting(),
              passwordSavingEnabled: new ChromeSetting()
            },
            websites: {
              hyperlinkAuditingEnabled: new ChromeSetting()
            }
          }
        }
      },

      runtime: {
        factory: (base) => {
          console.log('[electron-chrome-extensions] runtime factory called, base.sendMessage:', typeof base?.sendMessage)

          const runtimeApi = {
            ...base,
            connectNative: (application: string) => {
              const port = new NativePort()
              const receive = port._receive.bind(port)
              const disconnect = port._disconnect.bind(port)
              const callback: ConnectNativeCallback = (connectionId, send) => {
                port._init(connectionId, send)
              }
              electron.connectNative(extensionId, application, receive, disconnect, callback)
              return port
            },
            openOptionsPage: invokeExtension('runtime.openOptionsPage'),
            sendNativeMessage: invokeExtension('runtime.sendNativeMessage'),
            // Port-based messaging via runtime.connect
            connect: (extensionIdOrConnectInfo?: any, connectInfo?: { name?: string }) => {
              // Handle overloaded signatures
              let targetExtensionId: string | undefined
              let info: { name?: string } | undefined

              if (typeof extensionIdOrConnectInfo === 'string') {
                // connect(extensionId, connectInfo?)
                targetExtensionId = extensionIdOrConnectInfo
                info = connectInfo
              } else if (extensionIdOrConnectInfo && typeof extensionIdOrConnectInfo === 'object') {
                // connect(connectInfo)
                info = extensionIdOrConnectInfo
              }

              const port = new RuntimePort(info?.name)
              const receive = port._receive.bind(port)
              const disconnect = port._disconnect.bind(port)

              console.log('[electron-chrome-extensions] runtime.connect called, name:', info?.name)

              electron.connectPort(
                targetExtensionId || extensionId,
                info,
                receive,
                disconnect,
                (portId: string) => {
                  port._init(portId)
                }
              )

              return port
            },
            onConnect: onConnectEvent,
            // Custom sendMessage that routes through our IPC
            sendMessage: function(
              extensionIdOrMessage: any,
              messageOrOptions?: any,
              optionsOrCallback?: any,
              callback?: Function
            ) {
              // Handle overloaded signatures
              let message: any
              let options: any
              let responseCallback: Function | undefined

              if (typeof extensionIdOrMessage === 'string') {
                // sendMessage(extensionId, message, options?, callback?)
                message = messageOrOptions
                options = typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined
                responseCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
              } else {
                // sendMessage(message, options?, callback?)
                message = extensionIdOrMessage
                options = typeof messageOrOptions === 'object' ? messageOrOptions : undefined
                responseCallback = typeof messageOrOptions === 'function' ? messageOrOptions : optionsOrCallback
              }

              console.log('[electron-chrome-extensions] popup runtime.sendMessage:', message)

              // Use our custom IPC-based implementation
              const promise = electron.invokeExtension(extensionId, 'runtime.sendMessage', {}, message, options)

              if (typeof responseCallback === 'function') {
                promise.then((result: any) => {
                  responseCallback!(result)
                }).catch((e: Error) => {
                  console.error('[electron-chrome-extensions] sendMessage error:', e)
                  responseCallback!(undefined)
                })
                return true // Indicate async response
              }

              return promise
            }
          }

          console.log('[electron-chrome-extensions] runtime factory result, sendMessage:', typeof runtimeApi.sendMessage, 'connect:', typeof runtimeApi.connect)

          // Also patch browser.runtime if browser object exists
          // (webextension-polyfill may have already wrapped chrome.runtime)
          if ((globalThis as any).browser?.runtime) {
            console.log('[electron-chrome-extensions] Patching browser.runtime.sendMessage and connect')
            ;(globalThis as any).browser.runtime.sendMessage = runtimeApi.sendMessage
            ;(globalThis as any).browser.runtime.connect = runtimeApi.connect
            ;(globalThis as any).browser.runtime.onConnect = runtimeApi.onConnect
          }

          return runtimeApi
        }
      },

      storage: {
        factory: (base) => {
          const local = base && base.local
          // If local storage isn't available, create a simple fallback
          // to prevent "sync is not available" errors from webextension-polyfill
          const fallbackStorage = {
            get: (keys: any, callback?: Function) => {
              const result = {}
              if (callback) callback(result)
              return Promise.resolve(result)
            },
            set: (items: any, callback?: Function) => {
              if (callback) callback()
              return Promise.resolve()
            },
            remove: (keys: any, callback?: Function) => {
              if (callback) callback()
              return Promise.resolve()
            },
            clear: (callback?: Function) => {
              if (callback) callback()
              return Promise.resolve()
            },
            getBytesInUse: (keys: any, callback?: Function) => {
              if (callback) callback(0)
              return Promise.resolve(0)
            },
            onChanged: new ExtensionEvent('storage.onChanged')
          }
          const storageImpl = local || fallbackStorage

          // IMPORTANT: Modify existing chrome.storage object in-place rather than
          // replacing it. webextension-polyfill captures a reference to chrome.storage
          // before our code runs, so we must mutate the existing object.
          if (base) {
            if (!base.sync) base.sync = storageImpl
            if (!base.managed) base.managed = storageImpl
            if (!base.session) base.session = storageImpl
            if (!base.local) base.local = storageImpl
            return base
          }

          return {
            local: storageImpl,
            managed: storageImpl,
            sync: storageImpl,
            session: storageImpl
          }
        }
      },

      tabs: {
        factory: (base) => {
          const api = {
            ...base,
            create: invokeExtension('tabs.create'),
            executeScript: async function (
              arg1: unknown,
              arg2: unknown,
              arg3: unknown
            ): Promise<any> {
              // Electron's implementation of chrome.tabs.executeScript is in
              // C++, but it doesn't support implicit execution in the active
              // tab. To handle this, we need to get the active tab ID and
              // pass it into the C++ implementation ourselves.
              if (typeof arg1 === 'object') {
                const [activeTab] = await api.query({
                  active: true,
                  windowId: chrome.windows.WINDOW_ID_CURRENT
                })
                return api.executeScript(activeTab.id, arg1, arg2)
              } else {
                return (base.executeScript as typeof chrome.tabs.executeScript)(
                  arg1 as number,
                  arg2 as chrome.tabs.InjectDetails,
                  arg3 as () => {}
                )
              }
            },
            get: invokeExtension('tabs.get'),
            getCurrent: invokeExtension('tabs.getCurrent'),
            getAllInWindow: invokeExtension('tabs.getAllInWindow'),
            insertCSS: invokeExtension('tabs.insertCSS'),
            query: invokeExtension('tabs.query'),
            reload: invokeExtension('tabs.reload'),
            update: invokeExtension('tabs.update'),
            remove: invokeExtension('tabs.remove'),
            goBack: invokeExtension('tabs.goBack'),
            goForward: invokeExtension('tabs.goForward'),
            onCreated: new ExtensionEvent('tabs.onCreated'),
            onRemoved: new ExtensionEvent('tabs.onRemoved'),
            onUpdated: new ExtensionEvent('tabs.onUpdated'),
            onActivated: new ExtensionEvent('tabs.onActivated'),
            onReplaced: new ExtensionEvent('tabs.onReplaced')
          }
          return api
        }
      },

      topSites: {
        factory: () => {
          return {
            get: invokeExtension('topSites.get', { noop: true, defaultResponse: [] })
          }
        }
      },

      webNavigation: {
        factory: (base) => {
          return {
            ...base,
            getFrame: invokeExtension('webNavigation.getFrame'),
            getAllFrames: invokeExtension('webNavigation.getAllFrames'),
            onBeforeNavigate: new ExtensionEvent('webNavigation.onBeforeNavigate'),
            onCommitted: new ExtensionEvent('webNavigation.onCommitted'),
            onCompleted: new ExtensionEvent('webNavigation.onCompleted'),
            onCreatedNavigationTarget: new ExtensionEvent(
              'webNavigation.onCreatedNavigationTarget'
            ),
            onDOMContentLoaded: new ExtensionEvent('webNavigation.onDOMContentLoaded'),
            onErrorOccurred: new ExtensionEvent('webNavigation.onErrorOccurred'),
            onHistoryStateUpdated: new ExtensionEvent('webNavigation.onHistoryStateUpdated'),
            onReferenceFragmentUpdated: new ExtensionEvent(
              'webNavigation.onReferenceFragmentUpdated'
            ),
            onTabReplaced: new ExtensionEvent('webNavigation.onTabReplaced')
          }
        }
      },

      webRequest: {
        factory: (base) => {
          return {
            ...base,
            onHeadersReceived: new ExtensionEvent('webRequest.onHeadersReceived')
          }
        }
      },

      windows: {
        factory: (base) => {
          return {
            ...base,
            WINDOW_ID_NONE: -1,
            WINDOW_ID_CURRENT: -2,
            get: invokeExtension('windows.get'),
            getCurrent: invokeExtension('windows.getCurrent'),
            getLastFocused: invokeExtension('windows.getLastFocused'),
            getAll: invokeExtension('windows.getAll'),
            create: invokeExtension('windows.create'),
            update: invokeExtension('windows.update'),
            remove: invokeExtension('windows.remove'),
            onCreated: new ExtensionEvent('windows.onCreated'),
            onRemoved: new ExtensionEvent('windows.onRemoved'),
            onFocusChanged: new ExtensionEvent('windows.onFocusChanged'),
            onBoundsChanged: new ExtensionEvent('windows.onBoundsChanged')
          }
        }
      }
    }

    // Initialize APIs
    Object.keys(apiDefinitions).forEach((key: any) => {
      const apiName: keyof typeof chrome = key
      const baseApi = chrome[apiName] as any
      const api = apiDefinitions[apiName]!

      // Allow APIs to opt-out of being available in this context.
      if (api.shouldInject && !api.shouldInject()) return

      try {
        const desc = Object.getOwnPropertyDescriptor(chrome, apiName)
        if (desc && !desc.configurable) {
          console.warn(`[electron-chrome-extensions] ${apiName} is non-configurable, trying direct assignment`)
          // Try to extend the existing object instead
          const newValue = api.factory(baseApi)
          if (baseApi && typeof baseApi === 'object' && typeof newValue === 'object') {
            Object.assign(baseApi, newValue)
          }
        } else {
          Object.defineProperty(chrome, apiName, {
            value: api.factory(baseApi),
            enumerable: true,
            configurable: true
          })
        }
      } catch (e) {
        console.error(`[electron-chrome-extensions] Failed to define ${apiName}:`, e)
      }
    })

    // Remove access to internals
    delete (globalThis as any).electron

    console.log('[electron-chrome-extensions] APIs injected, storage.sync:', !!chrome.storage?.sync)

    Object.freeze(chrome)

    void 0 // no return
  }

  if (!process.contextIsolated) {
    console.warn(`injectExtensionAPIs: context isolation disabled in ${location.href}`)
    mainWorldScript()
    return
  }

  try {
    // Expose extension IPC to main world
    contextBridge.exposeInMainWorld('electron', electronContext)

    if (process.type === 'service-worker') {
      // For service workers, only expose the electron bridge.
      // The chrome.* API augmentation is handled by the polyfill code
      // prepended to the SW script via protocol interception in the
      // main process (see sw-polyfill.ts).
      return
    }

    // Mutate global 'chrome' object with additional APIs in the main world.
    if ('executeInMainWorld' in contextBridge) {
      ;(contextBridge as any).executeInMainWorld({
        func: mainWorldScript
      })
    } else if (webFrame) {
      webFrame.executeJavaScript(`(${mainWorldScript}());`)
    }
  } catch (error) {
    console.error(`injectExtensionAPIs error (${process.type === 'service-worker' ? 'service-worker' : location.href})`)
    console.error(error)
  }
}
