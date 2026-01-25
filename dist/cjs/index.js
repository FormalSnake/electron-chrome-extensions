"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ElectronChromeExtensions: () => ElectronChromeExtensions,
  setSessionPartitionResolver: () => setSessionPartitionResolver
});
module.exports = __toCommonJS(index_exports);

// src/browser/index.ts
var import_electron13 = require("electron");
var import_node_events4 = require("node:events");
var import_node_path = __toESM(require("node:path"));
var import_node_fs3 = require("node:fs");
var import_node_module = require("node:module");

// src/browser/sw-polyfill.ts
function generateSWPolyfill() {
  return `;(function __crxSWPolyfill() {
  'use strict';

  const electron = globalThis.electron;
  if (!electron) {
    console.warn('[electron-chrome-extensions] electron bridge not available in SW');
    return;
  }

  const chrome = globalThis.chrome;
  if (!chrome || !chrome.runtime) {
    console.warn('[electron-chrome-extensions] chrome.runtime not available in SW');
    return;
  }

  const extensionId = chrome.runtime.id;
  if (!extensionId) {
    console.warn('[electron-chrome-extensions] no extension ID in SW');
    return;
  }

  const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};

  // --- Helpers ---

  function invokeExtension(fnName, options) {
    options = options || {};
    return function() {
      var args = Array.prototype.slice.call(arguments);
      var callback = typeof args[args.length - 1] === 'function' ? args.pop() : undefined;

      if (options.noop) {
        console.warn(fnName + ' is not yet implemented.');
        if (callback) callback(options.defaultResponse);
        return Promise.resolve(options.defaultResponse);
      }

      if (options.serialize) {
        args = options.serialize.apply(null, args);
      }

      return electron.invokeExtension(extensionId, fnName, options, ...args)
        .then(function(result) {
          if (callback) { callback(result); }
          else { return result; }
        })
        .catch(function(e) {
          console.error(e);
          if (callback) callback(undefined);
          return undefined;
        });
    };
  }

  function ExtensionEvent(name) {
    this._name = name;
  }
  ExtensionEvent.prototype.addListener = function(callback) {
    electron.addExtensionListener(extensionId, this._name, callback);
  };
  ExtensionEvent.prototype.removeListener = function(callback) {
    electron.removeExtensionListener(extensionId, this._name, callback);
  };
  ExtensionEvent.prototype.hasListener = function() { return false; };
  ExtensionEvent.prototype.hasListeners = function() { return false; };
  ExtensionEvent.prototype.getRules = function() { throw new Error('Method not implemented.'); };
  ExtensionEvent.prototype.removeRules = function() { throw new Error('Method not implemented.'); };
  ExtensionEvent.prototype.addRules = function() { throw new Error('Method not implemented.'); };

  // --- API Augmentation ---
  // Only augment APIs that Electron doesn't provide natively.
  // Check existence before overriding to preserve native implementations.

  // Helper to safely define chrome.* properties
  function safeDefine(obj, prop, value) {
    try {
      if (Object.getOwnPropertyDescriptor(obj, prop)?.configurable === false) {
        // Property is non-configurable, try to extend instead
        Object.assign(obj[prop], value);
      } else {
        Object.defineProperty(obj, prop, {
          value: value,
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
    } catch (e) {
      console.warn('[electron-chrome-extensions] Failed to define', prop, e);
      // Last resort: direct assignment
      try { obj[prop] = value; } catch (e2) { /* ignore */ }
    }
  }

  // chrome.commands
  if (!chrome.commands || !chrome.commands.onCommand) {
    var commandsBase = chrome.commands || {};
    var commandsApi = {
      getAll: commandsBase.getAll || invokeExtension('commands.getAll'),
      onCommand: new ExtensionEvent('commands.onCommand')
    };
    safeDefine(chrome, 'commands', commandsApi);
  }

  // chrome.contextMenus
  if (!chrome.contextMenus || !chrome.contextMenus.create) {
    var ctxBase = chrome.contextMenus || {};
    var menuCounter = 0;
    var menuCallbacks = {};
    var ctxApi = {
      create: function(createProperties, callback) {
        if (typeof createProperties.id === 'undefined') {
          createProperties.id = '' + (++menuCounter);
        }
        if (createProperties.onclick) {
          menuCallbacks[createProperties.id] = createProperties.onclick;
          delete createProperties.onclick;
        }
        invokeExtension('contextMenus.create')(createProperties, callback);
        return createProperties.id;
      },
      update: ctxBase.update || invokeExtension('contextMenus.update', { noop: true }),
      remove: ctxBase.remove || invokeExtension('contextMenus.remove'),
      removeAll: ctxBase.removeAll || invokeExtension('contextMenus.removeAll'),
      onClicked: new ExtensionEvent('contextMenus.onClicked')
    };
    // Wire up onclick callbacks
    ctxApi.onClicked.addListener(function(info, tab) {
      var cb = menuCallbacks[info.menuItemId];
      if (cb && tab) cb(info, tab);
    });
    chrome.contextMenus = ctxApi;
  }

  // chrome.action / chrome.browserAction
  var browserActionFactory = function(base) {
    return {
      setTitle: invokeExtension('browserAction.setTitle'),
      getTitle: invokeExtension('browserAction.getTitle'),
      setIcon: invokeExtension('browserAction.setIcon'),
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
    };
  };

  if (manifest.manifest_version === 3 && manifest.action) {
    if (!chrome.action || !chrome.action.setTitle) {
      chrome.action = browserActionFactory(chrome.action || {});
    }
  } else if (manifest.manifest_version === 2 && manifest.browser_action) {
    if (!chrome.browserAction || !chrome.browserAction.setTitle) {
      chrome.browserAction = browserActionFactory(chrome.browserAction || {});
    }
  }

  // chrome.tabs
  if (!chrome.tabs || !chrome.tabs.onCreated) {
    var tabsBase = chrome.tabs || {};
    chrome.tabs = Object.assign({}, tabsBase, {
      create: tabsBase.create || invokeExtension('tabs.create'),
      get: tabsBase.get || invokeExtension('tabs.get'),
      getCurrent: tabsBase.getCurrent || invokeExtension('tabs.getCurrent'),
      getAllInWindow: tabsBase.getAllInWindow || invokeExtension('tabs.getAllInWindow'),
      insertCSS: tabsBase.insertCSS || invokeExtension('tabs.insertCSS'),
      query: tabsBase.query || invokeExtension('tabs.query'),
      reload: tabsBase.reload || invokeExtension('tabs.reload'),
      update: tabsBase.update || invokeExtension('tabs.update'),
      remove: tabsBase.remove || invokeExtension('tabs.remove'),
      goBack: tabsBase.goBack || invokeExtension('tabs.goBack'),
      goForward: tabsBase.goForward || invokeExtension('tabs.goForward'),
      onCreated: new ExtensionEvent('tabs.onCreated'),
      onRemoved: new ExtensionEvent('tabs.onRemoved'),
      onUpdated: new ExtensionEvent('tabs.onUpdated'),
      onActivated: new ExtensionEvent('tabs.onActivated'),
      onReplaced: new ExtensionEvent('tabs.onReplaced')
    });
  }

  // chrome.windows
  if (!chrome.windows || !chrome.windows.onCreated) {
    var winBase = chrome.windows || {};
    chrome.windows = Object.assign({}, winBase, {
      WINDOW_ID_NONE: -1,
      WINDOW_ID_CURRENT: -2,
      get: winBase.get || invokeExtension('windows.get'),
      getCurrent: winBase.getCurrent || invokeExtension('windows.getCurrent'),
      getLastFocused: winBase.getLastFocused || invokeExtension('windows.getLastFocused'),
      getAll: winBase.getAll || invokeExtension('windows.getAll'),
      create: winBase.create || invokeExtension('windows.create'),
      update: winBase.update || invokeExtension('windows.update'),
      remove: winBase.remove || invokeExtension('windows.remove'),
      onCreated: new ExtensionEvent('windows.onCreated'),
      onRemoved: new ExtensionEvent('windows.onRemoved'),
      onFocusChanged: new ExtensionEvent('windows.onFocusChanged'),
      onBoundsChanged: new ExtensionEvent('windows.onBoundsChanged')
    });
  }

  // chrome.cookies
  if (!chrome.cookies) {
    chrome.cookies = {
      get: invokeExtension('cookies.get'),
      getAll: invokeExtension('cookies.getAll'),
      set: invokeExtension('cookies.set'),
      remove: invokeExtension('cookies.remove'),
      getAllCookieStores: invokeExtension('cookies.getAllCookieStores'),
      onChanged: new ExtensionEvent('cookies.onChanged')
    };
  }

  // chrome.notifications
  if (!chrome.notifications) {
    chrome.notifications = {
      clear: invokeExtension('notifications.clear'),
      create: invokeExtension('notifications.create'),
      getAll: invokeExtension('notifications.getAll'),
      getPermissionLevel: invokeExtension('notifications.getPermissionLevel'),
      update: invokeExtension('notifications.update'),
      onClicked: new ExtensionEvent('notifications.onClicked'),
      onButtonClicked: new ExtensionEvent('notifications.onButtonClicked'),
      onClosed: new ExtensionEvent('notifications.onClosed')
    };
  }

  // chrome.permissions
  if (!chrome.permissions || !chrome.permissions.contains) {
    chrome.permissions = {
      contains: invokeExtension('permissions.contains'),
      getAll: invokeExtension('permissions.getAll'),
      remove: invokeExtension('permissions.remove'),
      request: invokeExtension('permissions.request'),
      onAdded: new ExtensionEvent('permissions.onAdded'),
      onRemoved: new ExtensionEvent('permissions.onRemoved')
    };
  }

  // chrome.webNavigation
  if (!chrome.webNavigation) {
    chrome.webNavigation = {
      getFrame: invokeExtension('webNavigation.getFrame'),
      getAllFrames: invokeExtension('webNavigation.getAllFrames'),
      onBeforeNavigate: new ExtensionEvent('webNavigation.onBeforeNavigate'),
      onCommitted: new ExtensionEvent('webNavigation.onCommitted'),
      onCompleted: new ExtensionEvent('webNavigation.onCompleted'),
      onCreatedNavigationTarget: new ExtensionEvent('webNavigation.onCreatedNavigationTarget'),
      onDOMContentLoaded: new ExtensionEvent('webNavigation.onDOMContentLoaded'),
      onErrorOccurred: new ExtensionEvent('webNavigation.onErrorOccurred'),
      onHistoryStateUpdated: new ExtensionEvent('webNavigation.onHistoryStateUpdated'),
      onReferenceFragmentUpdated: new ExtensionEvent('webNavigation.onReferenceFragmentUpdated'),
      onTabReplaced: new ExtensionEvent('webNavigation.onTabReplaced')
    };
  }

  // chrome.storage.sync and chrome.storage.managed aliases
  if (chrome.storage && chrome.storage.local) {
    if (!chrome.storage.sync) chrome.storage.sync = chrome.storage.local;
    if (!chrome.storage.managed) chrome.storage.managed = chrome.storage.local;
  }

  // chrome.runtime augmentations
  if (chrome.runtime) {
    if (!chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage = invokeExtension('runtime.openOptionsPage');
    }

    // Custom runtime.sendMessage that routes through our IPC
    var originalSendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = function(extensionIdOrMessage, messageOrOptions, optionsOrCallback, callback) {
      // Handle overloaded signatures
      var message, options, responseCallback;
      if (typeof extensionIdOrMessage === 'string') {
        // sendMessage(extensionId, message, options?, callback?)
        message = messageOrOptions;
        options = typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined;
        responseCallback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      } else {
        // sendMessage(message, options?, callback?)
        message = extensionIdOrMessage;
        options = typeof messageOrOptions === 'object' ? messageOrOptions : undefined;
        responseCallback = typeof messageOrOptions === 'function' ? messageOrOptions : optionsOrCallback;
      }

      console.log('[electron-chrome-extensions] runtime.sendMessage:', message);

      // Use our custom IPC-based implementation
      var promise = electron.invokeExtension(extensionId, 'runtime.sendMessage', {}, message, options);

      if (typeof responseCallback === 'function') {
        promise.then(function(result) {
          responseCallback(result);
        }).catch(function(e) {
          console.error('[electron-chrome-extensions] sendMessage error:', e);
          responseCallback(undefined);
        });
        return true; // Indicate async response
      }

      return promise;
    };

    // Custom runtime.onMessage handler
    var onMessageListeners = [];
    var originalOnMessage = chrome.runtime.onMessage;

    // Listen for messages from our IPC
    var ipcRenderer = require('electron').ipcRenderer;
    ipcRenderer.on('crx-runtime.onMessage', function(event, messageId, message, sender) {
      console.log('[electron-chrome-extensions] SW received message:', messageId, message);

      var responded = false;
      var sendResponse = function(response) {
        if (!responded) {
          responded = true;
          console.log('[electron-chrome-extensions] SW sending response:', messageId, response);
          ipcRenderer.send('crx-runtime-response', messageId, response);
        }
      };

      // Call all registered listeners
      var willRespondAsync = false;
      for (var i = 0; i < onMessageListeners.length; i++) {
        try {
          var result = onMessageListeners[i](message, sender, sendResponse);
          if (result === true) {
            willRespondAsync = true;
          } else if (result && typeof result.then === 'function') {
            // Promise-based response
            willRespondAsync = true;
            result.then(function(promiseResult) {
              sendResponse(promiseResult);
            }).catch(function(e) {
              console.error('[electron-chrome-extensions] onMessage promise error:', e);
              sendResponse(undefined);
            });
          }
        } catch (e) {
          console.error('[electron-chrome-extensions] onMessage listener error:', e);
        }
      }

      // If no listener indicated async response, send undefined
      if (!willRespondAsync && !responded) {
        sendResponse(undefined);
      }
    });

    // Override onMessage to use our listener array
    chrome.runtime.onMessage = {
      addListener: function(callback) {
        console.log('[electron-chrome-extensions] SW onMessage.addListener called');
        onMessageListeners.push(callback);
        // Also register with original if it exists (for Electron's built-in messaging)
        if (originalOnMessage && originalOnMessage.addListener) {
          originalOnMessage.addListener(callback);
        }
      },
      removeListener: function(callback) {
        var index = onMessageListeners.indexOf(callback);
        if (index > -1) {
          onMessageListeners.splice(index, 1);
        }
        if (originalOnMessage && originalOnMessage.removeListener) {
          originalOnMessage.removeListener(callback);
        }
      },
      hasListener: function(callback) {
        return onMessageListeners.indexOf(callback) > -1;
      },
      hasListeners: function() {
        return onMessageListeners.length > 0;
      }
    };
  }

  // chrome.extension
  if (!chrome.extension) {
    chrome.extension = {
      isAllowedFileSchemeAccess: invokeExtension('extension.isAllowedFileSchemeAccess', {
        noop: true, defaultResponse: false
      }),
      isAllowedIncognitoAccess: invokeExtension('extension.isAllowedIncognitoAccess', {
        noop: true, defaultResponse: false
      }),
      getViews: function() { return []; }
    };
  }

  // chrome.privacy
  if (!chrome.privacy) {
    var ChromeSetting = function() {};
    ChromeSetting.prototype.set = function() {};
    ChromeSetting.prototype.get = function() {};
    ChromeSetting.prototype.clear = function() {};
    ChromeSetting.prototype.onChange = { addListener: function() {} };

    chrome.privacy = {
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
    };
  }

  // chrome.i18n fallback (if not provided by Electron)
  if (manifest.manifest_version === 3 && (!chrome.i18n || !chrome.i18n.getMessage)) {
    chrome.i18n = Object.assign({}, chrome.i18n || {}, {
      getUILanguage: function() { return 'en-US'; },
      getAcceptLanguages: function(callback) {
        var results = ['en-US'];
        if (callback) { queueMicrotask(function() { callback(results); }); }
        return Promise.resolve(results);
      },
      getMessage: function(messageName) { return messageName; }
    });
  }

  // Set up browser.* APIs for extensions using webextension-polyfill
  // ALWAYS augment browser object with our APIs, whether it exists or not
  if (!globalThis.browser) {
    globalThis.browser = Object.create(Object.prototype);
  }

  // Copy/overwrite with our augmented chrome APIs
  // This ensures browser.commands.onCommand etc. are available
  globalThis.browser.commands = chrome.commands;
  globalThis.browser.contextMenus = chrome.contextMenus;
  globalThis.browser.tabs = chrome.tabs;
  globalThis.browser.windows = chrome.windows;
  globalThis.browser.cookies = chrome.cookies;
  globalThis.browser.notifications = chrome.notifications;
  globalThis.browser.permissions = chrome.permissions;
  globalThis.browser.webNavigation = chrome.webNavigation;
  globalThis.browser.storage = chrome.storage;
  globalThis.browser.extension = chrome.extension;
  globalThis.browser.privacy = chrome.privacy;
  globalThis.browser.i18n = chrome.i18n;
  if (chrome.action) globalThis.browser.action = chrome.action;
  if (chrome.browserAction) globalThis.browser.browserAction = chrome.browserAction;
  // Keep existing runtime but add our openOptionsPage
  if (!globalThis.browser.runtime) {
    globalThis.browser.runtime = chrome.runtime;
  } else if (!globalThis.browser.runtime.openOptionsPage) {
    globalThis.browser.runtime.openOptionsPage = chrome.runtime.openOptionsPage;
  }

  console.log('[electron-chrome-extensions] browser.* APIs augmented, commands:', !!globalThis.browser.commands, 'onCommand:', !!globalThis.browser.commands?.onCommand);

  // Note: Don't delete globalThis.electron in SW context - contextBridge makes it non-configurable
  // The electron bridge remains available but this is acceptable for trusted extension code

  console.log('[electron-chrome-extensions] SW polyfill setup complete, chrome.commands:', !!chrome.commands);

})();
`;
}

// src/browser/api/browser-action.ts
var import_electron3 = require("electron");

// src/browser/popup.ts
var import_node_events = require("node:events");
var import_electron2 = require("electron");

// src/browser/api/common.ts
var import_node_fs = require("node:fs");
var path = __toESM(require("node:path"));
var import_electron = require("electron");
var getExtensionManifest = (extension) => extension.manifest;
var getExtensionUrl = (extension, uri) => {
  try {
    return new URL(uri, extension.url).href;
  } catch {
  }
};
var resolveExtensionPath = (extension, uri, requestPath) => {
  const relativePath = path.join(requestPath || "/", uri);
  const resPath = path.join(extension.path, relativePath);
  if (!resPath.startsWith(extension.path)) return;
  return resPath;
};
var validateExtensionResource = async (extension, uri) => {
  const resPath = resolveExtensionPath(extension, uri);
  if (!resPath) return;
  try {
    await import_node_fs.promises.stat(resPath);
  } catch {
    return;
  }
  return resPath;
};
var matchSize = (imageSet, size, match) => {
  const first = parseInt(Object.keys(imageSet).pop(), 10);
  return imageSet[first];
};
var getIconPath = (extension, iconSize = 32, resizeType = 1 /* Up */) => {
  const manifest = getExtensionManifest(extension);
  const { icons } = manifest;
  const default_icon = (manifest.manifest_version === 3 ? manifest.action : manifest.browser_action)?.default_icon;
  if (typeof default_icon === "string") {
    const iconPath = default_icon;
    return iconPath;
  } else if (typeof default_icon === "object") {
    const iconPath = matchSize(default_icon, iconSize, resizeType);
    return iconPath;
  } else if (typeof icons === "object") {
    const iconPath = matchSize(icons, iconSize, resizeType);
    return iconPath;
  }
};
var getIconImage = (extension) => {
  const iconPath = getIconPath(extension);
  const iconAbsolutePath = iconPath && resolveExtensionPath(extension, iconPath);
  return iconAbsolutePath ? import_electron.nativeImage.createFromPath(iconAbsolutePath) : void 0;
};
var escapePattern = (pattern) => pattern.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
var matchesPattern = (pattern, url) => {
  if (pattern === "<all_urls>") return true;
  const regexp = new RegExp(`^${pattern.split("*").map(escapePattern).join(".*")}$`);
  return url.match(regexp);
};
var matchesTitlePattern = (pattern, title) => {
  const regexp = new RegExp(`^${pattern.split("*").map(escapePattern).join(".*")}$`);
  return title.match(regexp);
};
var getAllWindows = () => [...import_electron.BaseWindow.getAllWindows(), ...import_electron.BrowserWindow.getAllWindows()];

// src/browser/popup.ts
var import_debug = __toESM(require("debug"));
var d = (0, import_debug.default)("electron-chrome-extensions:popup");
var supportsPreferredSize = () => {
  const major = parseInt(process.versions.electron.split(".").shift() || "", 10);
  return major >= 12;
};
var _PopupView = class _PopupView extends import_node_events.EventEmitter {
  constructor(opts) {
    super();
    this.destroyed = false;
    this.hidden = true;
    this.stableHeight = 0;
    /** Preferred size changes are only received in Electron v12+ */
    this.usingPreferredSize = supportsPreferredSize();
    this.destroy = () => {
      if (this.destroyed) return;
      this.destroyed = true;
      d(`destroying ${this.extensionId}`);
      if (this.parent) {
        if (!this.parent.isDestroyed()) {
          this.parent.off("closed", this.destroy);
        }
        this.parent = void 0;
      }
      if (this.browserWindow) {
        if (!this.browserWindow.isDestroyed()) {
          const { webContents: webContents2 } = this.browserWindow;
          if (!webContents2.isDestroyed() && webContents2.isDevToolsOpened()) {
            webContents2.closeDevTools();
          }
          this.browserWindow.off("closed", this.destroy);
          this.browserWindow.destroy();
        }
        this.browserWindow = void 0;
      }
    };
    this.maybeClose = () => {
      if (!this.browserWindow?.isDestroyed() && this.browserWindow?.webContents.isDevToolsOpened()) {
        d("preventing close due to DevTools being open");
        return;
      }
      if (!getAllWindows().some((win) => win.isFocused())) {
        d("preventing close due to focus residing outside of the app");
        return;
      }
      this.destroy();
    };
    this.updatePreferredSize = (event, size) => {
      d("updatePreferredSize", size);
      this.usingPreferredSize = true;
      if (!this.hidden && this.stableHeight > 0) {
        size = { ...size, height: Math.max(size.height, this.stableHeight) };
      }
      this.setSize(size);
      this.updatePosition();
      if (!this.hidden) {
        this.stableHeight = Math.max(this.stableHeight, size.height);
      }
      if (this.hidden) {
        this.stableHeight = size.height;
        this.show();
      }
    };
    this.parent = opts.parent;
    this.extensionId = opts.extensionId;
    this.anchorRect = opts.anchorRect;
    this.alignment = opts.alignment;
    this.pendingUrl = opts.url;
    this.browserWindow = new import_electron2.BrowserWindow({
      show: false,
      frame: true,
      parent: opts.parent,
      movable: true,
      maximizable: false,
      minimizable: false,
      // https://github.com/electron/electron/issues/47579
      fullscreenable: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: "#ffffff",
      roundedCorners: true,
      webPreferences: {
        session: opts.session,
        sandbox: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        enablePreferredSizeMode: true
      }
    });
    const untypedWebContents = this.browserWindow.webContents;
    untypedWebContents.on("preferred-size-changed", this.updatePreferredSize);
    this.browserWindow.webContents.on("devtools-closed", this.maybeClose);
    this.browserWindow.on("blur", this.maybeClose);
    this.browserWindow.on("closed", this.destroy);
    this.parent.once("closed", this.destroy);
  }
  /**
   * Start loading the popup URL. Call this AFTER registering the popup
   * with the store to ensure IPC is ready before page scripts run.
   */
  startLoading() {
    if (this.pendingUrl && !this.readyPromise) {
      this.readyPromise = this.load(this.pendingUrl);
      this.pendingUrl = void 0;
    }
  }
  show() {
    this.hidden = false;
    this.browserWindow?.show();
  }
  async load(url) {
    const win = this.browserWindow;
    try {
      await win.webContents.loadURL(url);
    } catch (e) {
      console.error(e);
    }
    if (this.destroyed) return;
    if (this.usingPreferredSize) {
      this.setSize({ width: _PopupView.BOUNDS.minWidth, height: _PopupView.BOUNDS.minHeight });
    } else {
      this.setSize({ width: _PopupView.BOUNDS.maxWidth, height: _PopupView.BOUNDS.maxHeight });
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (this.destroyed) return;
      await this.queryPreferredSize();
      if (this.destroyed) return;
      this.show();
    }
  }
  isDestroyed() {
    return this.destroyed;
  }
  /** Resolves when the popup finishes loading. */
  whenReady() {
    if (!this.readyPromise) {
      this.startLoading();
    }
    return this.readyPromise;
  }
  setSize(rect) {
    if (!this.browserWindow || !this.parent) return;
    const width = Math.floor(
      Math.min(_PopupView.BOUNDS.maxWidth, Math.max(rect.width || 0, _PopupView.BOUNDS.minWidth))
    );
    const height = Math.floor(
      Math.min(_PopupView.BOUNDS.maxHeight, Math.max(rect.height || 0, _PopupView.BOUNDS.minHeight))
    );
    const size = { width, height };
    d(`setSize`, size);
    this.emit("will-resize", size);
    this.browserWindow?.setBounds({
      ...this.browserWindow.getBounds(),
      ...size
    });
    this.emit("resized");
  }
  updatePosition() {
    if (!this.browserWindow || !this.parent) return;
    const winBounds = this.parent.getBounds();
    const winContentBounds = this.parent.getContentBounds();
    const nativeTitlebarHeight = winBounds.height - winContentBounds.height;
    const viewBounds = this.browserWindow.getBounds();
    let x = winBounds.x + this.anchorRect.x + this.anchorRect.width - viewBounds.width;
    let y = winBounds.y + nativeTitlebarHeight + this.anchorRect.y + this.anchorRect.height + _PopupView.POSITION_PADDING;
    if (this.alignment?.includes("right")) x = winBounds.x + this.anchorRect.x;
    if (this.alignment?.includes("top"))
      y = winBounds.y + nativeTitlebarHeight - viewBounds.height + this.anchorRect.y - _PopupView.POSITION_PADDING;
    x = Math.floor(x);
    y = Math.floor(y);
    const position = { x, y };
    d(`updatePosition`, position);
    this.emit("will-move", position);
    this.browserWindow.setBounds({
      ...this.browserWindow.getBounds(),
      ...position
    });
    this.emit("moved");
  }
  /** Backwards compat for Electron <12 */
  async queryPreferredSize() {
    if (this.usingPreferredSize || this.destroyed) return;
    const rect = await this.browserWindow.webContents.executeJavaScript(
      `((${() => {
        const rect2 = document.body.getBoundingClientRect();
        return { width: rect2.width, height: rect2.height };
      }})())`
    );
    if (this.destroyed) return;
    this.setSize({ width: rect.width, height: rect.height });
    this.updatePosition();
  }
};
_PopupView.POSITION_PADDING = 5;
_PopupView.BOUNDS = {
  minWidth: 25,
  minHeight: 25,
  maxWidth: 800,
  maxHeight: 600
};
var PopupView = _PopupView;

// src/browser/api/browser-action.ts
var import_debug2 = __toESM(require("debug"));
var d2 = (0, import_debug2.default)("electron-chrome-extensions:browserAction");
if (!import_electron3.app.isReady()) {
  import_electron3.protocol.registerSchemesAsPrivileged([{ scheme: "crx", privileges: { bypassCSP: true } }]);
}
var getBrowserActionDefaults = (extension) => {
  const manifest = getExtensionManifest(extension);
  const browserAction = manifest.manifest_version === 3 ? manifest.action : manifest.manifest_version === 2 ? manifest.browser_action : void 0;
  if (typeof browserAction === "object") {
    const manifestAction = browserAction;
    const action = {};
    action.title = manifestAction.default_title || manifest.name;
    const iconPath = getIconPath(extension);
    if (iconPath) action.icon = { path: iconPath };
    if (manifestAction.default_popup) {
      action.popup = manifestAction.default_popup;
    }
    return action;
  }
};
var BrowserActionAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.actionMap = /* @__PURE__ */ new Map();
    this.observers = /* @__PURE__ */ new Set();
    this.queuedUpdate = false;
    this.openPopup = (event, options) => {
      const window = typeof options?.windowId === "number" ? this.ctx.store.getWindowById(options.windowId) : this.ctx.store.getCurrentWindow();
      if (!window || window.isDestroyed()) {
        d2("openPopup: window %d destroyed", window?.id);
        return;
      }
      const activeTab = this.ctx.store.getActiveTabFromWindow(window);
      if (!activeTab) return;
      const [width] = window.getSize();
      const anchorSize = 64;
      this.activateClick({
        eventType: "click",
        extensionId: event.extension.id,
        tabId: activeTab?.id,
        // TODO(mv3): get anchor position
        anchorRect: { x: width - anchorSize, y: 0, width: anchorSize, height: anchorSize }
      });
    };
    const handle = this.ctx.router.apiHandler();
    const getter = (propName) => ({ extension }, details = {}) => {
      const { tabId } = details;
      const action = this.getAction(extension.id);
      let result;
      if (tabId) {
        if (action.tabs[tabId]) {
          result = action.tabs[tabId][propName];
        } else {
          result = action[propName];
        }
      } else {
        result = action[propName];
      }
      return result;
    };
    const setDetails = ({ extension }, details, propName) => {
      const { tabId } = details;
      let value = details[propName];
      if (typeof value === "undefined" || value === null) {
        const defaults = getBrowserActionDefaults(extension);
        value = defaults ? defaults[propName] : value;
      }
      const valueObj = { [propName]: value };
      const action = this.getAction(extension.id);
      if (tabId) {
        const tabAction = action.tabs[tabId] || (action.tabs[tabId] = {});
        Object.assign(tabAction, valueObj);
      } else {
        Object.assign(action, valueObj);
      }
      this.onUpdate();
    };
    const setter = (propName) => (event, details) => setDetails(event, details, propName);
    const handleProp = (prop, key) => {
      handle(`browserAction.get${prop}`, getter(key));
      handle(`browserAction.set${prop}`, setter(key));
    };
    handleProp("BadgeBackgroundColor", "color");
    handleProp("BadgeText", "text");
    handleProp("Title", "title");
    handleProp("Popup", "popup");
    handle("browserAction.getUserSettings", () => {
      return { isOnToolbar: true };
    });
    handle(
      "browserAction.setIcon",
      (event, { tabId, ...details }) => {
        setDetails(event, { tabId, icon: details }, "icon");
        setDetails(event, { tabId, iconModified: Date.now() }, "iconModified");
      }
    );
    handle("browserAction.openPopup", this.openPopup);
    const preloadOpts = { allowRemote: true, extensionContext: false };
    handle("browserAction.getState", this.getState.bind(this), preloadOpts);
    handle("browserAction.activate", this.activate.bind(this), preloadOpts);
    handle(
      "browserAction.addObserver",
      (event) => {
        if (event.type != "frame") return;
        const observer = event.sender;
        this.observers.add(observer);
        observer.once?.("destroyed", () => {
          this.observers.delete(observer);
        });
      },
      preloadOpts
    );
    handle(
      "browserAction.removeObserver",
      (event) => {
        if (event.type != "frame") return;
        const { sender: observer } = event;
        this.observers.delete(observer);
      },
      preloadOpts
    );
    this.ctx.store.on("active-tab-changed", () => {
      this.onUpdate();
    });
    this.ctx.store.on("tab-removed", (tabId) => {
      for (const [, actionDetails] of this.actionMap) {
        if (actionDetails.tabs[tabId]) {
          delete actionDetails.tabs[tabId];
        }
      }
      this.onUpdate();
    });
    this.setupSession(this.ctx.session);
  }
  setupSession(session2) {
    const sessionExtensions = session2.extensions || session2;
    sessionExtensions.on("extension-loaded", (event, extension) => {
      this.processExtension(extension);
    });
    sessionExtensions.on("extension-unloaded", (event, extension) => {
      this.removeActions(extension.id);
    });
  }
  handleCRXRequest(request) {
    d2("%s", request.url);
    try {
      const url = new URL(request.url);
      const { hostname: requestType } = url;
      switch (requestType) {
        case "extension-icon": {
          const tabId = url.searchParams.get("tabId");
          const fragments = url.pathname.split("/");
          const extensionId = fragments[1];
          const imageSize = parseInt(fragments[2], 10);
          const resizeType = parseInt(fragments[3], 10) || 1 /* Up */;
          const sessionExtensions = this.ctx.session.extensions || this.ctx.session;
          const extension = sessionExtensions.getExtension(extensionId);
          let iconDetails;
          const action = this.actionMap.get(extensionId);
          if (action) {
            iconDetails = tabId && action.tabs[tabId]?.icon || action.icon;
          }
          let iconImage;
          if (extension && iconDetails) {
            if (typeof iconDetails.path === "string") {
              const iconAbsPath = resolveExtensionPath(extension, iconDetails.path);
              if (iconAbsPath) iconImage = import_electron3.nativeImage.createFromPath(iconAbsPath);
            } else if (typeof iconDetails.path === "object") {
              const imagePath = matchSize(iconDetails.path, imageSize, resizeType);
              const iconAbsPath = imagePath && resolveExtensionPath(extension, imagePath);
              if (iconAbsPath) iconImage = import_electron3.nativeImage.createFromPath(iconAbsPath);
            } else if (typeof iconDetails.imageData === "string") {
              iconImage = import_electron3.nativeImage.createFromDataURL(iconDetails.imageData);
            } else if (typeof iconDetails.imageData === "object") {
              const imageData = matchSize(iconDetails.imageData, imageSize, resizeType);
              iconImage = imageData ? import_electron3.nativeImage.createFromDataURL(imageData) : void 0;
            }
            if (iconImage?.isEmpty()) {
              d2("crx: icon image is empty", iconDetails);
            }
          }
          if (iconImage) {
            return new Response(iconImage.toPNG(), {
              status: 200,
              headers: {
                "Content-Type": "image/png"
              }
            });
          }
          d2("crx: no icon image for %s", extensionId);
          return new Response(null, { status: 400 });
        }
        default: {
          d2("crx: invalid request %s", requestType);
          return new Response(null, { status: 400 });
        }
      }
    } catch (e) {
      console.error(e);
      return new Response(null, { status: 500 });
    }
  }
  getAction(extensionId) {
    let action = this.actionMap.get(extensionId);
    if (!action) {
      action = { tabs: {} };
      this.actionMap.set(extensionId, action);
      this.onUpdate();
    }
    return action;
  }
  // TODO: Make private for v4 major release.
  removeActions(extensionId) {
    if (this.actionMap.has(extensionId)) {
      this.actionMap.delete(extensionId);
    }
    this.onUpdate();
  }
  getPopupUrl(extensionId, tabId) {
    const action = this.getAction(extensionId);
    const tabPopupValue = action.tabs[tabId]?.popup;
    const actionPopupValue = action.popup;
    let popupPath;
    if (typeof tabPopupValue !== "undefined") {
      popupPath = tabPopupValue;
    } else if (typeof actionPopupValue !== "undefined") {
      popupPath = actionPopupValue;
    }
    let url;
    try {
      url = popupPath && new URL(popupPath).href;
    } catch {
    }
    if (!url) {
      try {
        url = popupPath && new URL(popupPath, `chrome-extension://${extensionId}`).href;
      } catch {
      }
    }
    return url;
  }
  // TODO: Make private for v4 major release.
  processExtension(extension) {
    const defaultAction = getBrowserActionDefaults(extension);
    if (defaultAction) {
      const action = this.getAction(extension.id);
      Object.assign(action, defaultAction);
    }
  }
  getState() {
    const actions = Array.from(this.actionMap.entries()).map(([id, details]) => {
      const { icon, tabs, ...rest } = details;
      const tabsInfo = {};
      for (const tabId of Object.keys(tabs)) {
        const { icon: icon2, ...rest2 } = tabs[tabId];
        tabsInfo[tabId] = rest2;
      }
      return {
        id,
        tabs: tabsInfo,
        ...rest
      };
    });
    const activeTab = this.ctx.store.getActiveTabOfCurrentWindow();
    return { activeTabId: activeTab?.id, actions };
  }
  activate({ type, sender }, details) {
    if (type != "frame") return;
    const { eventType, extensionId, tabId } = details;
    d2(
      `activate [eventType: ${eventType}, extensionId: '${extensionId}', tabId: ${tabId}, senderId: ${sender?.id}]`
    );
    switch (eventType) {
      case "click":
        this.activateClick(details);
        break;
      case "contextmenu":
        this.activateContextMenu(details);
        break;
      default:
        console.debug(`Ignoring unknown browserAction.activate event '${eventType}'`);
    }
  }
  activateClick(details) {
    const { extensionId, tabId, anchorRect, alignment } = details;
    if (this.popup) {
      const toggleExtension = !this.popup.isDestroyed() && this.popup.extensionId === extensionId;
      this.popup.destroy();
      this.popup = void 0;
      if (toggleExtension) {
        d2("skipping activate to close popup");
        return;
      }
    }
    const tab = tabId >= 0 ? this.ctx.store.getTabById(tabId) : this.ctx.store.getActiveTabOfCurrentWindow();
    if (!tab) {
      throw new Error(`Unable to get active tab`);
    }
    const popupUrl = this.getPopupUrl(extensionId, tab.id);
    if (popupUrl) {
      const win = this.ctx.store.tabToWindow.get(tab);
      if (!win) {
        throw new Error("Unable to get BrowserWindow from active tab");
      }
      this.popup = new PopupView({
        extensionId,
        session: this.ctx.session,
        parent: win,
        url: popupUrl,
        anchorRect,
        alignment
      });
      if (this.popup.browserWindow) {
        console.log("[browser-action] Registering popup:", {
          popupWindowId: this.popup.browserWindow.id,
          parentWindowId: win.id
        });
        this.ctx.store.registerPopup(this.popup.browserWindow, win);
        this.popup.browserWindow.once("closed", () => {
          console.log("[browser-action] Popup closed, unregistering");
          if (this.popup?.browserWindow) {
            this.ctx.store.unregisterPopup(this.popup.browserWindow);
          }
        });
        this.popup.startLoading();
      } else {
        console.log("[browser-action] WARNING: popup.browserWindow is undefined!");
      }
      d2(`opened popup: ${popupUrl}`);
      this.ctx.emit("browser-action-popup-created", this.popup);
    } else {
      d2(`dispatching onClicked for ${extensionId}`);
      const tabDetails = this.ctx.store.tabDetailsCache.get(tab.id);
      this.ctx.router.sendEvent(extensionId, "browserAction.onClicked", tabDetails);
    }
  }
  activateContextMenu(details) {
    const { extensionId, anchorRect } = details;
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session;
    const extension = sessionExtensions.getExtension(extensionId);
    if (!extension) {
      throw new Error(`Unregistered extension '${extensionId}'`);
    }
    const manifest = getExtensionManifest(extension);
    const menu = new import_electron3.Menu();
    const append = (opts) => menu.append(new import_electron3.MenuItem(opts));
    const appendSeparator = () => menu.append(new import_electron3.MenuItem({ type: "separator" }));
    append({
      label: extension.name,
      click: () => {
        const homePageUrl = manifest.homepage_url || `https://chrome.google.com/webstore/detail/${extension.id}`;
        this.ctx.store.createTab({ url: homePageUrl });
      }
    });
    appendSeparator();
    const contextMenuItems = this.ctx.store.buildMenuItems(
      extensionId,
      "browser_action"
    );
    if (contextMenuItems.length > 0) {
      contextMenuItems.forEach((item) => menu.append(item));
      appendSeparator();
    }
    const optionsPage = manifest.options_page || manifest.options_ui?.page;
    const optionsPageUrl = optionsPage ? getExtensionUrl(extension, optionsPage) : void 0;
    append({
      label: "Options",
      enabled: typeof optionsPageUrl === "string",
      click: () => {
        this.ctx.store.createTab({ url: optionsPageUrl });
      }
    });
    if (process.env.NODE_ENV === "development" && process.env.DEBUG) {
      append({
        label: "Remove extension",
        click: () => {
          d2(`removing extension "${extension.name}" (${extension.id})`);
          sessionExtensions.removeExtension(extension.id);
        }
      });
    }
    menu.popup({
      x: Math.floor(anchorRect.x),
      y: Math.floor(anchorRect.y + anchorRect.height)
    });
  }
  onUpdate() {
    if (this.queuedUpdate) return;
    this.queuedUpdate = true;
    queueMicrotask(() => {
      this.queuedUpdate = false;
      if (this.observers.size === 0) return;
      d2(`dispatching update to ${this.observers.size} observer(s)`);
      Array.from(this.observers).forEach((observer) => {
        if (!observer.isDestroyed()) {
          observer.send?.("browserAction.update");
        }
      });
    });
  }
};

// src/browser/api/tabs.ts
var import_electron4 = require("electron");

// src/browser/api/windows.ts
var import_debug3 = __toESM(require("debug"));
var d3 = (0, import_debug3.default)("electron-chrome-extensions:windows");
var getWindowState = (win) => {
  if (win.isMaximized()) return "maximized";
  if (win.isMinimized()) return "minimized";
  if (win.isFullScreen()) return "fullscreen";
  return "normal";
};
var _WindowsAPI = class _WindowsAPI {
  constructor(ctx) {
    this.ctx = ctx;
    const handle = this.ctx.router.apiHandler();
    handle("windows.get", this.get.bind(this));
    handle("windows.getCurrent", this.getLastFocused.bind(this));
    handle("windows.getLastFocused", this.getLastFocused.bind(this));
    handle("windows.getAll", this.getAll.bind(this));
    handle("windows.create", this.create.bind(this));
    handle("windows.update", this.update.bind(this));
    handle("windows.remove", this.remove.bind(this));
    this.ctx.store.on("window-added", this.observeWindow.bind(this));
  }
  observeWindow(window) {
    const windowId = window.id;
    window.on("focus", () => {
      this.onFocusChanged(windowId);
    });
    window.on("resized", () => {
      this.onBoundsChanged(windowId);
    });
    window.once("closed", () => {
      this.ctx.store.windowDetailsCache.delete(windowId);
      this.ctx.store.removeWindow(window);
      this.onRemoved(windowId);
    });
    this.onCreated(windowId);
    d3(`Observing window[${windowId}]`);
  }
  createWindowDetails(win) {
    const details = {
      id: win.id,
      focused: win.isFocused(),
      top: win.getPosition()[1],
      left: win.getPosition()[0],
      width: win.getSize()[0],
      height: win.getSize()[1],
      tabs: Array.from(this.ctx.store.tabs).filter((tab) => {
        const ownerWindow = this.ctx.store.tabToWindow.get(tab);
        return ownerWindow?.isDestroyed() ? false : ownerWindow?.id === win.id;
      }).map((tab) => this.ctx.store.tabDetailsCache.get(tab.id)).filter(Boolean),
      incognito: !this.ctx.session.isPersistent(),
      type: "normal",
      // TODO
      state: getWindowState(win),
      alwaysOnTop: win.isAlwaysOnTop(),
      sessionId: "default"
      // TODO
    };
    this.ctx.store.windowDetailsCache.set(win.id, details);
    return details;
  }
  getWindowDetails(win) {
    if (this.ctx.store.windowDetailsCache.has(win.id)) {
      return this.ctx.store.windowDetailsCache.get(win.id);
    }
    const details = this.createWindowDetails(win);
    return details;
  }
  getWindowFromId(id) {
    if (id === _WindowsAPI.WINDOW_ID_CURRENT) {
      return this.ctx.store.getCurrentWindow();
    } else {
      return this.ctx.store.getWindowById(id);
    }
  }
  get(event, windowId) {
    const win = this.getWindowFromId(windowId);
    if (!win) return { id: _WindowsAPI.WINDOW_ID_NONE };
    return this.getWindowDetails(win);
  }
  getLastFocused(event) {
    const win = this.ctx.store.getLastFocusedWindow();
    return win ? this.getWindowDetails(win) : null;
  }
  getAll(event) {
    return Array.from(this.ctx.store.windows).map(this.getWindowDetails.bind(this));
  }
  async create(event, details) {
    const win = await this.ctx.store.createWindow(event, details);
    return this.getWindowDetails(win);
  }
  async update(event, windowId, updateProperties = {}) {
    const win = this.getWindowFromId(windowId);
    if (!win) return;
    const props = updateProperties;
    if (props.state) {
      switch (props.state) {
        case "maximized":
          win.maximize();
          break;
        case "minimized":
          win.minimize();
          break;
        case "normal": {
          if (win.isMinimized() || win.isMaximized()) {
            win.restore();
          }
          break;
        }
      }
    }
    return this.createWindowDetails(win);
  }
  async remove(event, windowId = _WindowsAPI.WINDOW_ID_CURRENT) {
    const win = this.getWindowFromId(windowId);
    if (!win) return;
    const removedWindowId = win.id;
    await this.ctx.store.removeWindow(win);
    this.onRemoved(removedWindowId);
  }
  onCreated(windowId) {
    const window = this.ctx.store.getWindowById(windowId);
    if (!window) return;
    const windowDetails = this.getWindowDetails(window);
    this.ctx.router.broadcastEvent("windows.onCreated", windowDetails);
  }
  onRemoved(windowId) {
    this.ctx.router.broadcastEvent("windows.onRemoved", windowId);
  }
  onFocusChanged(windowId) {
    if (this.ctx.store.lastFocusedWindowId === windowId) return;
    this.ctx.store.lastFocusedWindowId = windowId;
    this.ctx.router.broadcastEvent("windows.onFocusChanged", windowId);
  }
  onBoundsChanged(windowId) {
    const window = this.ctx.store.getWindowById(windowId);
    if (!window) return;
    const windowDetails = this.createWindowDetails(window);
    this.ctx.router.broadcastEvent("windows.onBoundsChanged", windowDetails);
  }
};
_WindowsAPI.WINDOW_ID_NONE = -1;
_WindowsAPI.WINDOW_ID_CURRENT = -2;
var WindowsAPI = _WindowsAPI;

// src/browser/api/tabs.ts
var import_debug4 = __toESM(require("debug"));
var d4 = (0, import_debug4.default)("electron-chrome-extensions:tabs");
var validateExtensionUrl = (url, extension) => {
  try {
    url = new URL(url, extension.url).href;
  } catch (e) {
    throw new Error("Invalid URL");
  }
  if (url.startsWith("chrome:") || url.startsWith("javascript:")) {
    throw new Error("Invalid URL");
  }
  return url;
};
var _TabsAPI = class _TabsAPI {
  constructor(ctx) {
    this.ctx = ctx;
    const handle = this.ctx.router.apiHandler();
    handle("tabs.get", this.get.bind(this));
    handle("tabs.getAllInWindow", this.getAllInWindow.bind(this));
    handle("tabs.getCurrent", this.getCurrent.bind(this));
    handle("tabs.create", this.create.bind(this));
    handle("tabs.insertCSS", this.insertCSS.bind(this));
    handle("tabs.query", this.query.bind(this));
    handle("tabs.reload", this.reload.bind(this));
    handle("tabs.update", this.update.bind(this));
    handle("tabs.remove", this.remove.bind(this));
    handle("tabs.goForward", this.goForward.bind(this));
    handle("tabs.goBack", this.goBack.bind(this));
    this.ctx.store.on("tab-added", this.observeTab.bind(this));
  }
  observeTab(tab) {
    const tabId = tab.id;
    const updateEvents = [
      "page-title-updated",
      // title
      "did-start-loading",
      // status
      "did-stop-loading",
      // status
      "media-started-playing",
      // audible
      "media-paused",
      // audible
      "did-start-navigation",
      // url
      "did-redirect-navigation",
      // url
      "did-navigate-in-page",
      // url
      // Listen for 'tab-updated' to handle all other cases which don't have
      // an official Electron API such as discarded tabs. App developers can
      // emit this event to trigger chrome.tabs.onUpdated if a property has
      // changed.
      "tab-updated"
    ];
    const updateHandler = () => {
      this.onUpdated(tabId);
    };
    updateEvents.forEach((eventName) => {
      tab.on(eventName, updateHandler);
    });
    const faviconHandler = (event, favicons) => {
      ;
      tab.favicon = favicons[0];
      this.onUpdated(tabId);
    };
    tab.on("page-favicon-updated", faviconHandler);
    tab.once("destroyed", () => {
      updateEvents.forEach((eventName) => {
        tab.off(eventName, updateHandler);
      });
      tab.off("page-favicon-updated", faviconHandler);
      this.ctx.store.removeTab(tab);
      this.onRemoved(tabId);
    });
    this.onCreated(tabId);
    this.onActivated(tabId);
    d4(`Observing tab[${tabId}][${tab.getType()}] ${tab.getURL()}`);
  }
  createTabDetails(tab) {
    const tabId = tab.id;
    const activeTab = this.ctx.store.getActiveTabFromWebContents(tab);
    let win = this.ctx.store.tabToWindow.get(tab);
    if (win?.isDestroyed()) win = void 0;
    const [width = 0, height = 0] = win ? win.getSize() : [];
    const details = {
      active: activeTab?.id === tabId,
      audible: tab.isCurrentlyAudible(),
      autoDiscardable: true,
      discarded: false,
      favIconUrl: tab.favicon || void 0,
      frozen: false,
      height,
      highlighted: false,
      id: tabId,
      incognito: false,
      index: -1,
      // TODO
      groupId: -1,
      // TODO(mv3): implement?
      mutedInfo: { muted: tab.audioMuted },
      pinned: false,
      selected: true,
      status: tab.isLoading() ? "loading" : "complete",
      title: tab.getTitle(),
      url: tab.getURL(),
      // TODO: tab.mainFrame.url (Electron 12)
      width,
      windowId: win ? win.id : -1
    };
    if (typeof this.ctx.store.impl.assignTabDetails === "function") {
      this.ctx.store.impl.assignTabDetails(details, tab);
    }
    this.ctx.store.tabDetailsCache.set(tab.id, details);
    return details;
  }
  getTabDetails(tab) {
    if (this.ctx.store.tabDetailsCache.has(tab.id)) {
      return this.ctx.store.tabDetailsCache.get(tab.id);
    }
    const details = this.createTabDetails(tab);
    return details;
  }
  get(event, tabId) {
    const tab = this.ctx.store.getTabById(tabId);
    if (!tab) return { id: _TabsAPI.TAB_ID_NONE };
    return this.createTabDetails(tab);
  }
  getAllInWindow(event, windowId = _TabsAPI.WINDOW_ID_CURRENT) {
    if (windowId === _TabsAPI.WINDOW_ID_CURRENT) windowId = this.ctx.store.lastFocusedWindowId;
    const tabs = Array.from(this.ctx.store.tabs).filter((tab) => {
      if (tab.isDestroyed()) return false;
      const browserWindow = this.ctx.store.tabToWindow.get(tab);
      if (!browserWindow || browserWindow.isDestroyed()) return;
      return browserWindow.id === windowId;
    });
    return tabs.map(this.createTabDetails.bind(this));
  }
  getCurrent(event) {
    const tab = this.ctx.store.getActiveTabOfCurrentWindow();
    return tab ? this.createTabDetails(tab) : void 0;
  }
  async create(event, details = {}) {
    const url = details.url ? validateExtensionUrl(details.url, event.extension) : void 0;
    const tab = await this.ctx.store.createTab({ ...details, url });
    const tabDetails = this.getTabDetails(tab);
    if (details.active) {
      queueMicrotask(() => this.onActivated(tab.id));
    }
    return tabDetails;
  }
  insertCSS(event, tabId, details) {
    const tab = this.ctx.store.getTabById(tabId);
    if (!tab) return;
    if (details.code) {
      tab.insertCSS(details.code);
    }
  }
  query(event, info = {}) {
    const isSet = (value) => typeof value !== "undefined";
    console.log("[tabs.query] ========== QUERY CALLED ==========");
    console.log("[tabs.query] Event type:", event.type, "Has sender:", !!event.sender);
    console.log("[tabs.query] Query info:", JSON.stringify(info));
    console.log("[tabs.query] Store state:", {
      lastFocusedWindowId: this.ctx.store.lastFocusedWindowId,
      totalTabs: this.ctx.store.tabs.size,
      totalWindows: this.ctx.store.windows.size,
      popupWindowsCount: this.ctx.store.popupWindows.size
    });
    let resolvedWindowId = this.ctx.store.lastFocusedWindowId;
    if (event.type === "frame" && event.sender) {
      const senderWindow = import_electron4.BrowserWindow.fromWebContents(event.sender);
      console.log("[tabs.query] Frame sender window:", {
        senderWindowId: senderWindow?.id,
        senderWindowDestroyed: senderWindow?.isDestroyed(),
        isPopup: senderWindow ? this.ctx.store.isPopup(senderWindow) : false
      });
      if (senderWindow && this.ctx.store.isPopup(senderWindow)) {
        const parentWindow = this.ctx.store.getPopupParent(senderWindow);
        console.log("[tabs.query] Found popup, parent window:", parentWindow?.id);
        if (parentWindow) {
          resolvedWindowId = parentWindow.id;
        }
      }
    }
    if (typeof resolvedWindowId !== "number") {
      console.log("[tabs.query] No resolvedWindowId, looking for fallback");
      const firstWindowWithTabs = Array.from(this.ctx.store.windows).find((win) => {
        return Array.from(this.ctx.store.tabs).some(
          (tab) => this.ctx.store.tabToWindow.get(tab)?.id === win.id
        );
      });
      if (firstWindowWithTabs) {
        resolvedWindowId = firstWindowWithTabs.id;
        console.log("[tabs.query] Using fallback window:", resolvedWindowId);
      }
    }
    console.log("[tabs.query] Final resolvedWindowId:", resolvedWindowId);
    const filteredTabs = Array.from(this.ctx.store.tabs).map(this.createTabDetails.bind(this)).filter((tab) => {
      if (!tab) return false;
      if (isSet(info.active) && info.active !== tab.active) return false;
      if (isSet(info.pinned) && info.pinned !== tab.pinned) return false;
      if (isSet(info.audible) && info.audible !== tab.audible) return false;
      if (isSet(info.muted) && info.muted !== tab.mutedInfo?.muted) return false;
      if (isSet(info.highlighted) && info.highlighted !== tab.highlighted) return false;
      if (isSet(info.discarded) && info.discarded !== tab.discarded) return false;
      if (isSet(info.autoDiscardable) && info.autoDiscardable !== tab.autoDiscardable)
        return false;
      if (isSet(info.currentWindow) && info.currentWindow) {
        if (resolvedWindowId !== tab.windowId) return false;
      }
      if (isSet(info.lastFocusedWindow) && info.lastFocusedWindow) {
        if (resolvedWindowId !== tab.windowId) return false;
      }
      if (isSet(info.frozen) && info.frozen !== tab.frozen) return false;
      if (isSet(info.groupId) && info.groupId !== tab.groupId) return false;
      if (isSet(info.status) && info.status !== tab.status) return false;
      if (isSet(info.title) && typeof info.title === "string" && typeof tab.title === "string") {
        if (!matchesTitlePattern(info.title, tab.title)) return false;
      }
      if (isSet(info.url) && typeof tab.url === "string") {
        if (typeof info.url === "string" && !matchesPattern(info.url, tab.url)) {
          return false;
        } else if (Array.isArray(info.url) && !info.url.some((pattern) => matchesPattern(pattern, tab.url))) {
          return false;
        }
      }
      if (isSet(info.windowId)) {
        if (info.windowId === _TabsAPI.WINDOW_ID_CURRENT) {
          if (resolvedWindowId !== tab.windowId) return false;
        } else if (info.windowId !== tab.windowId) {
          return false;
        }
      }
      return true;
    }).map((tab, index) => {
      if (tab) {
        tab.index = index;
      }
      return tab;
    });
    console.log("[tabs.query] Result:", filteredTabs.length, "tabs, first:", filteredTabs[0]?.url?.substring(0, 50));
    if (filteredTabs.length === 0) {
      console.log("[tabs.query] WARNING: No tabs matched! All tabs in store:");
      Array.from(this.ctx.store.tabs).forEach((tab, i) => {
        const win = this.ctx.store.tabToWindow.get(tab);
        console.log(`  [${i}] id=${tab.id}, windowId=${win?.id}, active=${this.ctx.store.getActiveTabFromWebContents(tab)?.id === tab.id}, url=${tab.getURL()?.substring(0, 50)}`);
      });
    }
    return filteredTabs;
  }
  reload(event, arg1, arg2) {
    const tabId = typeof arg1 === "number" ? arg1 : void 0;
    const reloadProperties = typeof arg1 === "object" ? arg1 : typeof arg2 === "object" ? arg2 : {};
    const tab = tabId ? this.ctx.store.getTabById(tabId) : this.ctx.store.getActiveTabOfCurrentWindow();
    if (!tab) return;
    if (reloadProperties?.bypassCache) {
      tab.reloadIgnoringCache();
    } else {
      tab.reload();
    }
  }
  async update(event, arg1, arg2) {
    let tabId = typeof arg1 === "number" ? arg1 : void 0;
    const updateProperties = (typeof arg1 === "object" ? arg1 : arg2) || {};
    const tab = tabId ? this.ctx.store.getTabById(tabId) : this.ctx.store.getActiveTabOfCurrentWindow();
    if (!tab) return;
    tabId = tab.id;
    const props = updateProperties;
    const url = props.url ? validateExtensionUrl(props.url, event.extension) : void 0;
    if (url) await tab.loadURL(url);
    if (typeof props.muted === "boolean") tab.setAudioMuted(props.muted);
    if (props.active) this.onActivated(tabId);
    this.onUpdated(tabId);
    return this.createTabDetails(tab);
  }
  remove(event, id) {
    const ids = Array.isArray(id) ? id : [id];
    ids.forEach((tabId) => {
      const tab = this.ctx.store.getTabById(tabId);
      if (tab) this.ctx.store.removeTab(tab);
      this.onRemoved(tabId);
    });
  }
  goForward(event, arg1) {
    const tabId = typeof arg1 === "number" ? arg1 : void 0;
    const tab = tabId ? this.ctx.store.getTabById(tabId) : this.ctx.store.getActiveTabOfCurrentWindow();
    if (!tab) return;
    tab.navigationHistory.goForward();
  }
  goBack(event, arg1) {
    const tabId = typeof arg1 === "number" ? arg1 : void 0;
    const tab = tabId ? this.ctx.store.getTabById(tabId) : this.ctx.store.getActiveTabOfCurrentWindow();
    if (!tab) return;
    tab.navigationHistory.goBack();
  }
  onCreated(tabId) {
    const tab = this.ctx.store.getTabById(tabId);
    if (!tab) return;
    const tabDetails = this.getTabDetails(tab);
    this.ctx.router.broadcastEvent("tabs.onCreated", tabDetails);
  }
  onUpdated(tabId) {
    const tab = this.ctx.store.getTabById(tabId);
    if (!tab) return;
    let prevDetails;
    if (this.ctx.store.tabDetailsCache.has(tab.id)) {
      prevDetails = this.ctx.store.tabDetailsCache.get(tab.id);
    }
    if (!prevDetails) return;
    const details = this.createTabDetails(tab);
    const compareProps = [
      "audible",
      "autoDiscardable",
      "discarded",
      "favIconUrl",
      "frozen",
      "groupId",
      "pinned",
      "status",
      "title",
      "url"
    ];
    let didUpdate = false;
    const changeInfo = {};
    for (const prop of compareProps) {
      if (details[prop] !== prevDetails[prop]) {
        ;
        changeInfo[prop] = details[prop];
        didUpdate = true;
      }
    }
    if (details.mutedInfo?.muted !== prevDetails.mutedInfo?.muted) {
      changeInfo.mutedInfo = details.mutedInfo;
      didUpdate = true;
    }
    if (!didUpdate) return;
    this.ctx.router.broadcastEvent("tabs.onUpdated", tab.id, changeInfo, details);
  }
  onRemoved(tabId) {
    const details = this.ctx.store.tabDetailsCache.has(tabId) ? this.ctx.store.tabDetailsCache.get(tabId) : null;
    this.ctx.store.tabDetailsCache.delete(tabId);
    const windowId = details ? details.windowId : WindowsAPI.WINDOW_ID_NONE;
    const win = typeof windowId !== "undefined" && windowId > -1 ? getAllWindows().find((win2) => win2.id === windowId) : null;
    this.ctx.router.broadcastEvent("tabs.onRemoved", tabId, {
      windowId,
      isWindowClosing: win ? win.isDestroyed() : false
    });
  }
  onActivated(tabId) {
    const tab = this.ctx.store.getTabById(tabId);
    if (!tab) return;
    const activeTab = this.ctx.store.getActiveTabFromWebContents(tab);
    const activeChanged = activeTab?.id !== tabId;
    if (!activeChanged) return;
    const win = this.ctx.store.tabToWindow.get(tab);
    this.ctx.store.setActiveTab(tab);
    this.ctx.store.tabDetailsCache.forEach((tabInfo, cacheTabId) => {
      tabInfo.active = tabId === cacheTabId;
    });
    this.ctx.router.broadcastEvent("tabs.onActivated", {
      tabId,
      windowId: win?.id
    });
  }
};
_TabsAPI.TAB_ID_NONE = -1;
_TabsAPI.WINDOW_ID_NONE = -1;
_TabsAPI.WINDOW_ID_CURRENT = -2;
var TabsAPI = _TabsAPI;

// src/browser/api/web-navigation.ts
var electron = __toESM(require("electron"));
var import_debug5 = __toESM(require("debug"));
var d5 = (0, import_debug5.default)("electron-chrome-extensions:webNavigation");
var getFrame = (frameProcessId, frameRoutingId) => electron.webFrameMain.fromId(frameProcessId, frameRoutingId);
var getFrameId = (frame) => frame === frame.top ? 0 : frame.frameTreeNodeId;
var getParentFrameId = (frame) => {
  const parentFrame = frame?.parent;
  return parentFrame ? getFrameId(parentFrame) : -1;
};
var getFrameType = (frame) => !frame.parent ? "outermost_frame" : "sub_frame";
var getDocumentLifecycle = (frame) => "active";
var getFrameDetails = (frame) => ({
  // TODO(mv3): implement new properties
  url: frame.url,
  documentId: "not-implemented",
  documentLifecycle: getDocumentLifecycle(frame),
  errorOccurred: false,
  frameType: getFrameType(frame),
  // FIXME: frameId is missing from @types/chrome
  ...{
    frameId: getFrameId(frame)
  },
  parentDocumentId: void 0,
  parentFrameId: getParentFrameId(frame)
});
var WebNavigationAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.sendNavigationEvent = (eventName, details) => {
      d5(`${eventName} [url: ${details.url}]`);
      this.ctx.router.broadcastEvent(`webNavigation.${eventName}`, details);
    };
    this.onCreatedNavigationTarget = (tab, { url, frame }) => {
      if (!frame) return;
      const details = {
        sourceTabId: tab.id,
        sourceProcessId: frame ? frame.processId : -1,
        sourceFrameId: getFrameId(frame),
        url,
        tabId: tab.id,
        timeStamp: Date.now()
      };
      this.sendNavigationEvent("onCreatedNavigationTarget", details);
    };
    this.onBeforeNavigate = (tab, {
      url,
      isSameDocument,
      frame
    }) => {
      if (isSameDocument) return;
      if (!frame) return;
      const details = {
        frameId: getFrameId(frame),
        frameType: getFrameType(frame),
        documentLifecycle: getDocumentLifecycle(frame),
        parentFrameId: getParentFrameId(frame),
        processId: frame ? frame.processId : -1,
        tabId: tab.id,
        timeStamp: Date.now(),
        url
      };
      this.sendNavigationEvent("onBeforeNavigate", details);
    };
    this.onCommitted = (tab, _event, url, _httpResponseCode, _httpStatusText, _isMainFrame, frameProcessId, frameRoutingId) => {
      const frame = getFrame(frameProcessId, frameRoutingId);
      if (!frame) return;
      const details = {
        frameId: getFrameId(frame),
        // NOTE: workaround for property missing in type
        ...{
          parentFrameId: getParentFrameId(frame)
        },
        frameType: getFrameType(frame),
        transitionType: "",
        // TODO(mv3)
        transitionQualifiers: [],
        // TODO(mv3)
        documentLifecycle: getDocumentLifecycle(frame),
        processId: frameProcessId,
        tabId: tab.id,
        timeStamp: Date.now(),
        url
      };
      this.sendNavigationEvent("onCommitted", details);
    };
    this.onHistoryStateUpdated = (tab, event, url, isMainFrame, frameProcessId, frameRoutingId) => {
      const frame = getFrame(frameProcessId, frameRoutingId);
      if (!frame) return;
      const details = {
        transitionType: "",
        // TODO
        transitionQualifiers: [],
        // TODO
        frameId: getFrameId(frame),
        parentFrameId: getParentFrameId(frame),
        frameType: getFrameType(frame),
        documentLifecycle: getDocumentLifecycle(frame),
        processId: frameProcessId,
        tabId: tab.id,
        timeStamp: Date.now(),
        url
      };
      this.sendNavigationEvent("onHistoryStateUpdated", details);
    };
    this.onDOMContentLoaded = (tab, frame) => {
      const details = {
        frameId: getFrameId(frame),
        parentFrameId: getParentFrameId(frame),
        frameType: getFrameType(frame),
        documentLifecycle: getDocumentLifecycle(frame),
        processId: frame.processId,
        tabId: tab.id,
        timeStamp: Date.now(),
        url: frame.url
      };
      this.sendNavigationEvent("onDOMContentLoaded", details);
      if (!tab.isLoadingMainFrame()) {
        this.sendNavigationEvent("onCompleted", details);
      }
    };
    this.onFinishLoad = (tab, event, isMainFrame, frameProcessId, frameRoutingId) => {
      const frame = getFrame(frameProcessId, frameRoutingId);
      if (!frame) return;
      const url = tab.getURL();
      const details = {
        frameId: getFrameId(frame),
        parentFrameId: getParentFrameId(frame),
        frameType: getFrameType(frame),
        documentLifecycle: getDocumentLifecycle(frame),
        processId: frameProcessId,
        tabId: tab.id,
        timeStamp: Date.now(),
        url
      };
      this.sendNavigationEvent("onCompleted", details);
    };
    const handle = this.ctx.router.apiHandler();
    handle("webNavigation.getFrame", this.getFrame.bind(this));
    handle("webNavigation.getAllFrames", this.getAllFrames.bind(this));
    this.ctx.store.on("tab-added", this.observeTab.bind(this));
  }
  observeTab(tab) {
    tab.once("will-navigate", this.onCreatedNavigationTarget.bind(this, tab));
    tab.on("did-start-navigation", this.onBeforeNavigate.bind(this, tab));
    tab.on("did-frame-finish-load", this.onFinishLoad.bind(this, tab));
    tab.on("did-frame-navigate", this.onCommitted.bind(this, tab));
    tab.on("did-navigate-in-page", this.onHistoryStateUpdated.bind(this, tab));
    tab.on("frame-created", (_e, { frame }) => {
      if (!frame || frame.top === frame) return;
      frame.on("dom-ready", () => {
        this.onDOMContentLoaded(tab, frame);
      });
    });
    tab.on("dom-ready", () => {
      if ("mainFrame" in tab) {
        this.onDOMContentLoaded(tab, tab.mainFrame);
      }
    });
  }
  getFrame(event, details) {
    const tab = this.ctx.store.getTabById(details.tabId);
    if (!tab) return null;
    let targetFrame;
    if (typeof details.frameId === "number") {
      const mainFrame = tab.mainFrame;
      targetFrame = mainFrame.framesInSubtree.find((frame) => {
        const isMainFrame = frame === frame.top;
        return isMainFrame ? details.frameId === 0 : details.frameId === frame.frameTreeNodeId;
      });
    }
    return targetFrame ? getFrameDetails(targetFrame) : null;
  }
  getAllFrames(event, details) {
    const tab = this.ctx.store.getTabById(details.tabId);
    if (!tab || !("mainFrame" in tab)) return [];
    return tab.mainFrame.framesInSubtree.map(getFrameDetails);
  }
};

// src/browser/store.ts
var import_electron5 = require("electron");
var import_node_events2 = require("node:events");
var ExtensionStore = class extends import_node_events2.EventEmitter {
  constructor(impl) {
    super();
    this.impl = impl;
    /** Tabs observed by the extensions system. */
    this.tabs = /* @__PURE__ */ new Set();
    /** Windows observed by the extensions system. */
    this.windows = /* @__PURE__ */ new Set();
    /**
     * Map of tabs to their parent window.
     *
     * It's not possible to access the parent of a BrowserView so we must manage
     * this ourselves.
     */
    this.tabToWindow = /* @__PURE__ */ new WeakMap();
    /** Extension popup windows - map to their parent window */
    this.popupToParentWindow = /* @__PURE__ */ new WeakMap();
    /** Set of popup windows for quick lookup */
    this.popupWindows = /* @__PURE__ */ new Set();
    /** Map of windows to their active tab. */
    this.windowToActiveTab = /* @__PURE__ */ new WeakMap();
    this.tabDetailsCache = /* @__PURE__ */ new Map();
    this.windowDetailsCache = /* @__PURE__ */ new Map();
    this.urlOverrides = {};
  }
  getWindowById(windowId) {
    return Array.from(this.windows).find(
      (window) => !window.isDestroyed() && window.id === windowId
    );
  }
  getLastFocusedWindow() {
    return this.lastFocusedWindowId ? this.getWindowById(this.lastFocusedWindowId) : null;
  }
  getCurrentWindow() {
    return this.getLastFocusedWindow();
  }
  registerPopup(popup, parentWindow) {
    this.popupWindows.add(popup);
    this.popupToParentWindow.set(popup, parentWindow);
  }
  unregisterPopup(popup) {
    this.popupWindows.delete(popup);
    this.popupToParentWindow.delete(popup);
  }
  isPopup(window) {
    return this.popupWindows.has(window);
  }
  getPopupParent(popup) {
    return this.popupToParentWindow.get(popup);
  }
  addWindow(window) {
    if (this.windows.has(window)) return;
    this.windows.add(window);
    if (typeof this.lastFocusedWindowId !== "number") {
      this.lastFocusedWindowId = window.id;
    }
    this.emit("window-added", window);
  }
  async createWindow(event, details) {
    if (typeof this.impl.createWindow !== "function") {
      throw new Error("createWindow is not implemented");
    }
    const win = await this.impl.createWindow(details);
    this.addWindow(win);
    return win;
  }
  async removeWindow(window) {
    if (!this.windows.has(window)) return;
    this.windows.delete(window);
    if (typeof this.impl.removeWindow === "function") {
      await this.impl.removeWindow(window);
    } else {
      window.destroy();
    }
  }
  getTabById(tabId) {
    return Array.from(this.tabs).find((tab) => !tab.isDestroyed() && tab.id === tabId);
  }
  addTab(tab, window) {
    if (this.tabs.has(tab)) return;
    this.tabs.add(tab);
    this.tabToWindow.set(tab, window);
    this.addWindow(window);
    const activeTab = this.getActiveTabFromWebContents(tab);
    if (!activeTab) {
      this.setActiveTab(tab);
    }
    this.emit("tab-added", tab);
  }
  removeTab(tab) {
    if (!this.tabs.has(tab)) return;
    const tabId = tab.id;
    const win = this.tabToWindow.get(tab);
    this.tabs.delete(tab);
    this.tabToWindow.delete(tab);
    const windowHasTabs = Array.from(this.tabs).find((tab2) => this.tabToWindow.get(tab2) === win);
    if (!windowHasTabs) {
      this.windows.delete(win);
    }
    if (typeof this.impl.removeTab === "function") {
      this.impl.removeTab(tab, win);
    }
    this.emit("tab-removed", tabId);
  }
  async createTab(details) {
    if (typeof this.impl.createTab !== "function") {
      throw new Error("createTab is not implemented");
    }
    if (!details.windowId) {
      details.windowId = this.lastFocusedWindowId;
    }
    const result = await this.impl.createTab(details);
    if (!Array.isArray(result)) {
      throw new Error("createTab must return an array of [tab, window]");
    }
    const [tab, window] = result;
    if (typeof tab !== "object" || !import_electron5.webContents.fromId(tab.id)) {
      throw new Error("createTab must return a WebContents");
    } else if (typeof window !== "object") {
      throw new Error("createTab must return a BrowserWindow");
    }
    this.addTab(tab, window);
    return tab;
  }
  getActiveTabFromWindow(win) {
    const activeTab = win && !win.isDestroyed() && this.windowToActiveTab.get(win);
    return activeTab && !activeTab.isDestroyed() && activeTab || void 0;
  }
  getActiveTabFromWebContents(wc) {
    const win = this.tabToWindow.get(wc) || import_electron5.BrowserWindow.fromWebContents(wc);
    const activeTab = win ? this.getActiveTabFromWindow(win) : void 0;
    return activeTab;
  }
  getActiveTabOfCurrentWindow() {
    const win = this.getCurrentWindow();
    return win ? this.getActiveTabFromWindow(win) : void 0;
  }
  setActiveTab(tab) {
    const win = this.tabToWindow.get(tab);
    if (!win) {
      throw new Error("Active tab has no parent window");
    }
    const prevActiveTab = this.getActiveTabFromWebContents(tab);
    this.windowToActiveTab.set(win, tab);
    if (tab.id !== prevActiveTab?.id) {
      this.emit("active-tab-changed", tab, win);
      if (typeof this.impl.selectTab === "function") {
        this.impl.selectTab(tab, win);
      }
    }
  }
  buildMenuItems(extensionId, menuType) {
    return [];
  }
  /**
   * Creates fresh tab details from a WebContents, bypassing cache.
   * Used by APIs that need current url/title values.
   */
  createFreshTabDetails(tab) {
    const tabId = tab.id;
    const activeTab = this.getActiveTabFromWebContents(tab);
    let win = this.tabToWindow.get(tab);
    if (win?.isDestroyed()) win = void 0;
    const [width = 0, height = 0] = win ? win.getSize?.() ?? [0, 0] : [];
    const details = {
      active: activeTab?.id === tabId,
      audible: tab.isCurrentlyAudible(),
      autoDiscardable: true,
      discarded: false,
      favIconUrl: tab.favicon || void 0,
      frozen: false,
      height,
      highlighted: false,
      id: tabId,
      incognito: false,
      index: -1,
      groupId: -1,
      mutedInfo: { muted: tab.audioMuted },
      pinned: false,
      selected: true,
      status: tab.isLoading() ? "loading" : "complete",
      title: tab.getTitle(),
      url: tab.getURL(),
      width,
      windowId: win ? win.id : -1
    };
    if (typeof this.impl.assignTabDetails === "function") {
      this.impl.assignTabDetails(details, tab);
    }
    return details;
  }
  async requestPermissions(extension, permissions) {
    if (typeof this.impl.requestPermissions !== "function") {
      return true;
    }
    const result = await this.impl.requestPermissions(extension, permissions);
    return typeof result === "boolean" ? result : false;
  }
};

// src/browser/api/context-menus.ts
var import_electron6 = require("electron");
var DEFAULT_CONTEXTS = ["page"];
var getContextTypesFromParams = (params) => {
  const contexts = /* @__PURE__ */ new Set(["all"]);
  switch (params.mediaType) {
    case "audio":
    case "video":
    case "image":
      contexts.add(params.mediaType);
  }
  if (params.pageURL) contexts.add("page");
  if (params.linkURL) contexts.add("link");
  if (params.frameURL) contexts.add("frame");
  if (params.selectionText) contexts.add("selection");
  if (params.isEditable) contexts.add("editable");
  return contexts;
};
var formatTitle = (title, params) => {
  if (params.selectionText && title.includes("%s")) {
    title = title.split("%s").join(params.selectionText);
  }
  return title;
};
var matchesConditions = (props, conditions) => {
  if (props.visible === false) return false;
  const { contextTypes, targetUrl, documentUrl } = conditions;
  const contexts = props.contexts ? Array.isArray(props.contexts) ? props.contexts : [props.contexts] : DEFAULT_CONTEXTS;
  const inContext = contexts.some((context) => contextTypes.has(context));
  if (!inContext) return false;
  if (props.targetUrlPatterns && props.targetUrlPatterns.length > 0 && targetUrl) {
    if (!props.targetUrlPatterns.some((pattern) => matchesPattern(pattern, targetUrl))) {
      return false;
    }
  }
  if (props.documentUrlPatterns && props.documentUrlPatterns.length > 0 && documentUrl) {
    if (!props.documentUrlPatterns.some((pattern) => matchesPattern(pattern, documentUrl))) {
      return false;
    }
  }
  return true;
};
var ContextMenusAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.menus = /* @__PURE__ */ new Map();
    this.buildMenuItem = (opts) => {
      const { extension, props, webContents: webContents2, params } = opts;
      let icon = opts.showIcon ? getIconImage(extension) : void 0;
      if (icon) {
        icon = icon.resize({ width: 16, height: 16 });
      }
      const menuItemOptions = {
        id: props.id,
        type: props.type,
        label: params ? formatTitle(props.title || "", params) : props.title || "",
        icon,
        enabled: props.enabled,
        click: () => {
          this.onClicked(extension.id, props.id, webContents2, params);
        }
      };
      return menuItemOptions;
    };
    this.buildMenuItemsFromTemplate = (menuItemTemplates) => {
      const itemMap = /* @__PURE__ */ new Map();
      for (const item of menuItemTemplates) {
        const menuItem = this.buildMenuItem(item);
        itemMap.set(item.props.id, menuItem);
      }
      for (const item of menuItemTemplates) {
        const menuItem = itemMap.get(item.props.id);
        if (item.props.parentId) {
          const parentMenuItem = itemMap.get(`${item.props.parentId}`);
          if (parentMenuItem) {
            const submenu = parentMenuItem.submenu || [];
            submenu.push(menuItem);
            parentMenuItem.submenu = submenu;
          }
        }
      }
      const menuItems = [];
      const buildFromTemplate = (opts) => {
        if (Array.isArray(opts.submenu)) {
          const submenu = new import_electron6.Menu();
          opts.submenu.forEach((item) => submenu.append(buildFromTemplate(item)));
          opts.submenu = submenu;
        }
        return new import_electron6.MenuItem({
          ...opts,
          // Force submenu type when submenu items are present
          type: opts.type === "normal" && opts.submenu ? "submenu" : opts.type
        });
      };
      for (const item of menuItemTemplates) {
        if (item.props.parentId) continue;
        const menuItem = itemMap.get(item.props.id);
        menuItems.push(buildFromTemplate(menuItem));
      }
      return menuItems;
    };
    this.create = ({ extension }, createProperties) => {
      const { id, type, title } = createProperties;
      if (this.menus.has(id)) {
        return;
      }
      if (!title && type !== "separator") {
        return;
      }
      this.addContextItem(extension.id, createProperties);
    };
    this.remove = ({ extension }, menuItemId) => {
      const items = this.menus.get(extension.id);
      if (items && items.has(menuItemId)) {
        items.delete(menuItemId);
        if (items.size === 0) {
          this.menus.delete(extension.id);
        }
      }
    };
    this.removeAll = ({ extension }) => {
      this.menus.delete(extension.id);
    };
    const handle = this.ctx.router.apiHandler();
    handle("contextMenus.create", this.create);
    handle("contextMenus.remove", this.remove);
    handle("contextMenus.removeAll", this.removeAll);
    const sessionExtensions = ctx.session.extensions || ctx.session;
    sessionExtensions.on("extension-unloaded", (event, extension) => {
      if (this.menus.has(extension.id)) {
        this.menus.delete(extension.id);
      }
    });
    this.ctx.store.buildMenuItems = this.buildMenuItemsForExtension.bind(this);
  }
  addContextItem(extensionId, props) {
    let contextItems = this.menus.get(extensionId);
    if (!contextItems) {
      contextItems = /* @__PURE__ */ new Map();
      this.menus.set(extensionId, contextItems);
    }
    contextItems.set(props.id, props);
  }
  buildMenuItemsForParams(webContents2, params) {
    if (webContents2.session !== this.ctx.session) return [];
    let menuItemOptions = [];
    const conditions = {
      contextTypes: getContextTypesFromParams(params),
      targetUrl: params.srcURL || params.linkURL,
      documentUrl: params.frameURL || params.pageURL
    };
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session;
    for (const [extensionId, propItems] of this.menus) {
      const extension = sessionExtensions.getExtension(extensionId);
      if (!extension) continue;
      const extensionMenuItemOptions = [];
      for (const [, props] of propItems) {
        if (matchesConditions(props, conditions)) {
          const menuItem = {
            extension,
            props,
            webContents: webContents2,
            params
          };
          extensionMenuItemOptions.push(menuItem);
        }
      }
      const topLevelItems = extensionMenuItemOptions.filter((opt) => !opt.props.parentId);
      if (topLevelItems.length > 1) {
        const groupId = `group${extension.id}`;
        const groupMenuItemOptions = {
          extension,
          webContents: webContents2,
          props: {
            id: groupId,
            title: extension.name
          },
          params,
          showIcon: true
        };
        const children = extensionMenuItemOptions.map(
          (opt) => opt.props.parentId ? opt : {
            ...opt,
            props: {
              ...opt.props,
              parentId: groupId
            }
          }
        );
        menuItemOptions = [...menuItemOptions, groupMenuItemOptions, ...children];
      } else if (extensionMenuItemOptions.length > 0) {
        const children = extensionMenuItemOptions.map((opt) => ({
          ...opt,
          showIcon: !opt.props.parentId
        }));
        menuItemOptions = [...menuItemOptions, ...children];
      }
    }
    return this.buildMenuItemsFromTemplate(menuItemOptions);
  }
  buildMenuItemsForExtension(extensionId, menuType) {
    const extensionItems = this.menus.get(extensionId);
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session;
    const extension = sessionExtensions.getExtension(extensionId);
    const activeTab = this.ctx.store.getActiveTabOfCurrentWindow();
    const menuItemOptions = [];
    if (extensionItems && extension && activeTab) {
      const conditions = {
        contextTypes: /* @__PURE__ */ new Set(["all", menuType])
      };
      for (const [, props] of extensionItems) {
        if (matchesConditions(props, conditions)) {
          const menuItem = { extension, props, webContents: activeTab };
          menuItemOptions.push(menuItem);
        }
      }
    }
    return this.buildMenuItemsFromTemplate(menuItemOptions);
  }
  onClicked(extensionId, menuItemId, webContents2, params) {
    if (webContents2.isDestroyed()) return;
    const tab = this.ctx.store.createFreshTabDetails(webContents2);
    const data = {
      selectionText: params?.selectionText,
      checked: false,
      // TODO
      menuItemId,
      frameId: -1,
      // TODO: match frameURL with webFrameMain in Electron 12
      frameUrl: params?.frameURL,
      editable: params?.isEditable || false,
      // TODO(mv3): limit possible string enums
      mediaType: params?.mediaType,
      wasChecked: false,
      // TODO
      pageUrl: params?.pageURL,
      // types are inaccurate
      linkUrl: params?.linkURL,
      parentMenuItemId: -1,
      // TODO
      srcUrl: params?.srcURL
    };
    this.ctx.router.sendEvent(extensionId, "contextMenus.onClicked", data, tab);
  }
};

// src/browser/api/runtime.ts
var import_node_crypto = require("node:crypto");
var import_node_events3 = require("node:events");
var import_electron8 = require("electron");

// src/browser/api/lib/native-messaging-host.ts
var import_node_child_process = require("node:child_process");
var import_node_fs2 = require("node:fs");
var os = __toESM(require("node:os"));
var path2 = __toESM(require("node:path"));
var import_electron7 = require("electron");
var import_debug7 = __toESM(require("debug"));

// src/browser/api/lib/winreg.ts
var import_child_process = require("child_process");
var import_debug6 = __toESM(require("debug"));
var d6 = (0, import_debug6.default)("electron-chrome-extensions:winreg");
function readRegistryKey(hive, path5, key) {
  if (process.platform !== "win32") {
    return Promise.reject("Unsupported platform");
  }
  return new Promise((resolve, reject) => {
    const args = ["query", `${hive}\\${path5}`, ...key ? ["/v", key] : []];
    d6("reg %s", args.join(" "));
    const child = (0, import_child_process.spawn)("reg", args);
    let output = "";
    let error = "";
    child.stdout.on("data", (data) => {
      output += data.toString();
    });
    child.stderr.on("data", (data) => {
      error += data.toString();
    });
    child.on("close", (code) => {
      if (code !== 0 || error) {
        return reject(new Error(`Failed to read registry: ${error}`));
      }
      const lines = output.trim().split("\n");
      const resultLine = lines.find(
        (line) => key ? line.includes(key) : line.includes("(Default)")
      );
      if (resultLine) {
        const parts = resultLine.trim().split(/\s{2,}/);
        resolve(parts.pop() || null);
      } else {
        resolve(null);
      }
    });
  });
}

// src/browser/api/lib/native-messaging-host.ts
var d7 = (0, import_debug7.default)("electron-chrome-extensions:nativeMessaging");
function isValidConfig(config) {
  return typeof config === "object" && config !== null && typeof config.name === "string" && typeof config.description === "string" && typeof config.path === "string" && config.type === "stdio" && Array.isArray(config.allowed_origins);
}
async function getConfigSearchPaths(application) {
  const appJson = `${application}.json`;
  let searchPaths;
  switch (process.platform) {
    case "darwin":
      searchPaths = [
        path2.join("/Library/Google/Chrome/NativeMessagingHosts", appJson),
        // Also look under Chrome's directory since some apps only install their
        // config there
        path2.join(
          os.homedir(),
          "Library",
          "Application Support",
          "Google/Chrome/NativeMessagingHosts",
          appJson
        ),
        path2.join(import_electron7.app.getPath("userData"), "NativeMessagingHosts", appJson)
      ];
      break;
    case "linux":
      searchPaths = [
        path2.join("/etc/opt/chrome/native-messaging-hosts/", appJson),
        path2.join(os.homedir(), ".config/google-chrome/NativeMessagingHosts/", appJson),
        path2.join(import_electron7.app.getPath("userData"), "NativeMessagingHosts", appJson)
      ];
      break;
    case "win32": {
      searchPaths = (await Promise.allSettled([
        readRegistryKey("HKLM", `Software\\Google\\Chrome\\NativeMessagingHosts\\${application}`),
        readRegistryKey("HKCU", `Software\\Google\\Chrome\\NativeMessagingHosts\\${application}`)
      ])).map((result) => result.status === "fulfilled" ? result.value : void 0).filter(Boolean);
      break;
    }
    default:
      throw new Error("Unsupported platform");
  }
  return searchPaths;
}
async function readNativeMessagingHostConfig(application) {
  const searchPaths = await getConfigSearchPaths(application);
  d7("searching", searchPaths);
  for (const filePath of searchPaths) {
    try {
      const data = await import_node_fs2.promises.readFile(filePath);
      const config = JSON.parse(data.toString());
      if (isValidConfig(config)) {
        d7("read config in %s", filePath, config);
        return config;
      } else {
        d7("%s contained invalid config", filePath, config);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        d7("unable to read %s", filePath);
      } else {
        d7("unknown error", error);
      }
      continue;
    }
  }
}
var NativeMessagingHost = class {
  constructor(extensionId, sender, connectionId, application, keepAlive = true) {
    this.connected = false;
    this.receiveExtensionMessage = (_event, message) => {
      this.send(message);
    };
    this.receive = (data) => {
      const length = data.readUInt32LE(0);
      const message = JSON.parse(data.subarray(4, 4 + length).toString());
      d7("receive: %s", message);
      if (this.keepAlive && this.sender) {
        this.sender.send(`crx-native-msg-${this.connectionId}`, message);
      } else {
        this.resolveResponse?.(message);
      }
    };
    this.keepAlive = keepAlive;
    this.sender = sender;
    if (keepAlive) {
      this.sender.ipc.on(`crx-native-msg-${connectionId}`, this.receiveExtensionMessage);
    }
    this.connectionId = connectionId;
    this.ready = this.launch(application, extensionId);
  }
  destroy() {
    this.connected = false;
    if (this.process) {
      this.process.kill();
      this.process = void 0;
    }
    if (this.keepAlive && this.sender) {
      this.sender.ipc.off(`crx-native-msg-${this.connectionId}`, this.receiveExtensionMessage);
      this.sender.send(`crx-native-msg-${this.connectionId}-disconnect`);
    }
    this.sender = void 0;
  }
  async launch(application, extensionId) {
    const config = await readNativeMessagingHostConfig(application);
    if (!config) {
      d7("launch: unable to find %s for %s", application, extensionId);
      this.destroy();
      return;
    }
    const extensionUrl = `chrome-extension://${extensionId}/`;
    if (!config.allowed_origins?.includes(extensionUrl)) {
      d7("launch: %s not in allowed origins", extensionId);
      this.destroy();
      return;
    }
    let isFile = false;
    try {
      const stat = await import_node_fs2.promises.stat(config.path);
      isFile = stat.isFile();
    } catch (error) {
      d7("launch: unable to find %s", config.path, error);
    }
    if (!isFile) {
      this.destroy();
      return;
    }
    d7("launch: spawning %s for %s", config.path, extensionId);
    this.process = (0, import_node_child_process.spawn)(config.path, [extensionUrl], {
      shell: false
    });
    this.process.stdout.on("data", this.receive);
    this.process.stderr.on("data", (data) => {
      d7("stderr: %s", data.toString());
    });
    this.process.on("error", (err) => {
      d7("error: %s", err);
      this.destroy();
    });
    this.process.on("exit", (code) => {
      d7("exited %d", code);
      this.destroy();
    });
    this.connected = true;
    if (this.pending && this.pending.length > 0) {
      d7("sending %d pending messages", this.pending.length);
      this.pending.forEach((msg) => this.send(msg));
      this.pending = [];
    }
  }
  send(json) {
    d7("send", json);
    if (!this.connected) {
      const pending = this.pending || (this.pending = []);
      pending.push(json);
      d7("send: pending");
      return;
    }
    const message = JSON.stringify(json);
    const buffer = Buffer.alloc(4 + message.length);
    buffer.writeUInt32LE(message.length, 0);
    buffer.write(message, 4);
    this.process.stdin.write(buffer);
  }
  sendAndReceive(message) {
    this.send(message);
    return new Promise((resolve) => {
      this.resolveResponse = resolve;
    });
  }
};

// src/browser/api/runtime.ts
var import_debug8 = __toESM(require("debug"));
var d8 = (0, import_debug8.default)("electron-chrome-extensions:runtime");
var RuntimeAPI = class extends import_node_events3.EventEmitter {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.hostMap = {};
    // Pending message responses: messageId -> { resolve, reject, timeout }
    this.pendingResponses = /* @__PURE__ */ new Map();
    this.sendMessage = async (event, message, options) => {
      const extensionId = event.extension.id;
      const messageId = (0, import_node_crypto.randomUUID)();
      d8("sendMessage from %s: messageId=%s, message=%o", extensionId, messageId, message);
      const sender = {
        id: extensionId,
        url: event.type === "frame" ? event.sender.getURL() : `chrome-extension://${extensionId}/`
      };
      if (event.type === "frame") {
        const tab = this.ctx.store.getTabById(event.sender.id);
        if (tab) {
          const tabDetails = this.ctx.store.tabDetailsCache.get(tab.id);
          if (tabDetails) {
            sender.tab = tabDetails;
          }
        }
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingResponses.delete(messageId);
          d8("sendMessage timeout for %s", messageId);
          resolve(void 0);
        }, 3e4);
        this.pendingResponses.set(messageId, { resolve, reject, timeout });
        const scope = `chrome-extension://${extensionId}/`;
        this.ctx.session.serviceWorkers.startWorkerForScope(scope).then((serviceWorker) => {
          d8("sending message to service worker: %s", scope);
          serviceWorker.send("crx-runtime.onMessage", messageId, message, sender);
        }).catch((error) => {
          d8("failed to send message to service worker: %s", error);
          this.ctx.router.sendEvent(extensionId, "runtime.onMessage", messageId, message, sender);
        });
      });
    };
    this.connectNative = async (event, connectionId, application) => {
      const host = new NativeMessagingHost(
        event.extension.id,
        event.sender,
        connectionId,
        application
      );
      this.hostMap[connectionId] = host;
    };
    this.disconnectNative = (event, connectionId) => {
      this.hostMap[connectionId]?.destroy();
      this.hostMap[connectionId] = void 0;
    };
    this.sendNativeMessage = async (event, application, message) => {
      const connectionId = (0, import_node_crypto.randomUUID)();
      const host = new NativeMessagingHost(
        event.extension.id,
        event.sender,
        connectionId,
        application,
        false
      );
      await host.ready;
      return await host.sendAndReceive(message);
    };
    this.openOptionsPage = async ({ extension }) => {
      const manifest = getExtensionManifest(extension);
      if (manifest.options_ui) {
        const url = `chrome-extension://${extension.id}/${manifest.options_ui.page}`;
        await this.ctx.store.createTab({ url, active: true });
      } else if (manifest.options_page) {
        const url = `chrome-extension://${extension.id}/${manifest.options_page}`;
        await this.ctx.store.createTab({ url, active: true });
      }
    };
    const handle = this.ctx.router.apiHandler();
    handle("runtime.connectNative", this.connectNative, { permission: "nativeMessaging" });
    handle("runtime.disconnectNative", this.disconnectNative, { permission: "nativeMessaging" });
    handle("runtime.openOptionsPage", this.openOptionsPage);
    handle("runtime.sendNativeMessage", this.sendNativeMessage, { permission: "nativeMessaging" });
    handle("runtime.sendMessage", this.sendMessage.bind(this));
    this.setupResponseHandler();
  }
  setupResponseHandler() {
    const handler = (_event, messageId, response) => {
      d8("received response for message %s: %o", messageId, response);
      const pending = this.pendingResponses.get(messageId);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingResponses.delete(messageId);
        pending.resolve(response);
      }
    };
    import_electron8.ipcMain.on("crx-runtime-response", handler);
    this.ctx.session.serviceWorkers.on("running-status-changed", ({ runningStatus, versionId }) => {
      if (runningStatus !== "starting") return;
      const sw = this.ctx.session.serviceWorkers.getWorkerFromVersionID(versionId);
      if (sw?.scope?.startsWith("chrome-extension://")) {
        sw.ipc.on("crx-runtime-response", handler);
      }
    });
  }
};

// src/browser/api/cookies.ts
var onChangedCauseTranslation = {
  "expired-overwrite": "expired_overwrite"
};
var createCookieDetails = (cookie) => ({
  ...cookie,
  domain: cookie.domain || "",
  hostOnly: Boolean(cookie.hostOnly),
  session: Boolean(cookie.session),
  path: cookie.path || "",
  httpOnly: Boolean(cookie.httpOnly),
  secure: Boolean(cookie.secure),
  storeId: "0" /* Default */
});
var CookiesAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.onChanged = (event, cookie, cause, removed) => {
      const changeInfo = {
        cause: onChangedCauseTranslation[cause] || cause,
        cookie: createCookieDetails(cookie),
        removed
      };
      this.ctx.router.broadcastEvent("cookies.onChanged", changeInfo);
    };
    const handle = this.ctx.router.apiHandler();
    handle("cookies.get", this.get.bind(this));
    handle("cookies.getAll", this.getAll.bind(this));
    handle("cookies.set", this.set.bind(this));
    handle("cookies.remove", this.remove.bind(this));
    handle("cookies.getAllCookieStores", this.getAllCookieStores.bind(this));
    this.cookies.addListener("changed", this.onChanged);
  }
  get cookies() {
    return this.ctx.session.cookies;
  }
  async get(event, details) {
    const cookies = await this.cookies.get({
      url: details.url,
      name: details.name
    });
    return cookies.length > 0 ? createCookieDetails(cookies[0]) : null;
  }
  async getAll(event, details) {
    const cookies = await this.cookies.get({
      url: details.url,
      name: details.name,
      domain: details.domain,
      path: details.path,
      secure: details.secure,
      session: details.session
    });
    return cookies.map(createCookieDetails);
  }
  async set(event, details) {
    await this.cookies.set(details);
    const cookies = await this.cookies.get(details);
    return cookies.length > 0 ? createCookieDetails(cookies[0]) : null;
  }
  async remove(event, details) {
    try {
      await this.cookies.remove(details.url, details.name);
    } catch {
      return null;
    }
    return details;
  }
  async getAllCookieStores(event) {
    const tabIds = Array.from(this.ctx.store.tabs).map((tab) => tab.isDestroyed() ? void 0 : tab.id).filter(Boolean);
    return [{ id: "0" /* Default */, tabIds }];
  }
};

// src/browser/api/notifications.ts
var import_electron9 = require("electron");
var getBody = (opts) => {
  const { type = "basic" /* Basic */ } = opts;
  switch (type) {
    case "list" /* List */: {
      if (!Array.isArray(opts.items)) {
        throw new Error("List items must be provided for list type");
      }
      return opts.items.map((item) => `${item.title} - ${item.message}`).join("\n");
    }
    default:
      return opts.message || "";
  }
};
var getUrgency = (priority) => {
  if (typeof priority !== "number") {
    return "normal";
  } else if (priority >= 2) {
    return "critical";
  } else if (priority < 0) {
    return "low";
  } else {
    return "normal";
  }
};
var createScopedIdentifier = (extension, id) => `${extension.id}-${id}`;
var stripScopeFromIdentifier = (id) => {
  const index = id.indexOf("-");
  return id.substr(index + 1);
};
var NotificationsAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.registry = /* @__PURE__ */ new Map();
    this.clear = ({ extension }, id) => {
      const notificationId = createScopedIdentifier(extension, id);
      if (this.registry.has(notificationId)) {
        this.registry.get(notificationId)?.close();
      }
    };
    this.create = async ({ extension }, arg1, arg2) => {
      let id;
      let opts;
      if (typeof arg1 === "object") {
        id = "guid";
        opts = arg1;
      } else if (typeof arg1 === "string") {
        id = arg1;
        opts = arg2;
      } else {
        throw new Error("Invalid arguments");
      }
      if (typeof opts !== "object" || !opts.type || !opts.iconUrl || !opts.title || !opts.message) {
        throw new Error("Missing required notification options");
      }
      const notificationId = createScopedIdentifier(extension, id);
      if (this.registry.has(notificationId)) {
        this.registry.get(notificationId)?.close();
      }
      let icon;
      if (opts.iconUrl) {
        let url;
        try {
          url = new URL(opts.iconUrl);
        } catch {
        }
        if (url?.protocol === "data:") {
          icon = opts.iconUrl;
        } else {
          icon = await validateExtensionResource(extension, opts.iconUrl);
        }
        if (!icon) {
          throw new Error("Invalid iconUrl");
        }
      }
      const notification = new import_electron9.Notification({
        title: opts.title,
        subtitle: import_electron9.app.name,
        body: getBody(opts),
        silent: opts.silent,
        icon,
        urgency: getUrgency(opts.priority),
        timeoutType: opts.requireInteraction ? "never" : "default"
      });
      this.registry.set(notificationId, notification);
      notification.on("click", () => {
        this.ctx.router.sendEvent(extension.id, "notifications.onClicked", id);
      });
      notification.once("close", () => {
        const byUser = true;
        this.ctx.router.sendEvent(extension.id, "notifications.onClosed", id, byUser);
        this.registry.delete(notificationId);
      });
      notification.show();
      return id;
    };
    this.getAll = ({ extension }) => {
      return Array.from(this.registry.keys()).filter((key) => key.startsWith(extension.id)).map(stripScopeFromIdentifier);
    };
    this.getPermissionLevel = (event) => {
      return import_electron9.Notification.isSupported() ? "granted" : "denied";
    };
    this.update = ({ extension }, id, opts) => {
      const notificationId = createScopedIdentifier(extension, id);
      const notification = this.registry.get(notificationId);
      if (!notification) {
        return false;
      }
      if (opts.priority) notification.urgency = getUrgency(opts.priority);
      if (opts.silent) notification.silent = opts.silent;
    };
    const handle = this.ctx.router.apiHandler();
    handle("notifications.clear", this.clear);
    handle("notifications.create", this.create);
    handle("notifications.getAll", this.getAll);
    handle("notifications.getPermissionLevel", this.getPermissionLevel);
    handle("notifications.update", this.update);
    const sessionExtensions = ctx.session.extensions || ctx.session;
    sessionExtensions.on("extension-unloaded", (event, extension) => {
      for (const [key, notification] of this.registry) {
        if (key.startsWith(extension.id)) {
          notification.close();
        }
      }
    });
  }
};

// src/browser/api/commands.ts
var CommandsAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.commandMap = /* @__PURE__ */ new Map();
    this.getAll = ({ extension }) => {
      return this.commandMap.get(extension.id) || [];
    };
    const handle = this.ctx.router.apiHandler();
    handle("commands.getAll", this.getAll);
    const sessionExtensions = ctx.session.extensions || ctx.session;
    sessionExtensions.on("extension-loaded", (_event, extension) => {
      this.processExtension(extension);
    });
    sessionExtensions.on("extension-unloaded", (_event, extension) => {
      this.removeCommands(extension);
    });
  }
  processExtension(extension) {
    const manifest = extension.manifest;
    if (!manifest.commands) return;
    if (!this.commandMap.has(extension.id)) {
      this.commandMap.set(extension.id, []);
    }
    const commands = this.commandMap.get(extension.id);
    for (const [name, details] of Object.entries(manifest.commands)) {
      commands.push({
        name,
        description: details.description,
        shortcut: ""
      });
    }
  }
  removeCommands(extension) {
    this.commandMap.delete(extension.id);
  }
};

// src/browser/router.ts
var import_electron11 = require("electron");
var import_debug9 = __toESM(require("debug"));

// src/browser/partition.ts
var import_electron10 = require("electron");
var resolvePartitionImpl = (partition) => import_electron10.session.fromPartition(partition);
function setSessionPartitionResolver(resolver) {
  resolvePartitionImpl = resolver;
}
function resolvePartition(partition) {
  return resolvePartitionImpl(partition);
}

// src/browser/router.ts
var shortenValues = (k, v) => typeof v === "string" && v.length > 128 ? v.substr(0, 128) + "..." : v;
import_debug9.default.formatters.r = (value) => {
  return value ? JSON.stringify(value, shortenValues, "  ") : value;
};
var getSessionFromEvent = (event) => {
  if (event.type === "service-worker") {
    return event.session;
  } else {
    return event.sender.session;
  }
};
var d9 = (0, import_debug9.default)("electron-chrome-extensions:router");
var DEFAULT_SESSION = "_self";
var gRoutingDelegate;
var RoutingDelegate = class _RoutingDelegate {
  constructor() {
    this.sessionMap = /* @__PURE__ */ new WeakMap();
    this.workers = /* @__PURE__ */ new WeakSet();
    this.onRouterMessage = async (event, extensionId, handlerName, ...args) => {
      d9(`received '${handlerName}'`, args);
      const observer = this.sessionMap.get(getSessionFromEvent(event));
      return observer?.onExtensionMessage(event, extensionId, handlerName, ...args);
    };
    this.onRemoteMessage = async (event, sessionPartition, handlerName, ...args) => {
      d9(`received remote '${handlerName}' for '${sessionPartition}'`, args);
      const ses = sessionPartition === DEFAULT_SESSION ? getSessionFromEvent(event) : resolvePartition(sessionPartition);
      const observer = this.sessionMap.get(ses);
      return observer?.onExtensionMessage(event, void 0, handlerName, ...args);
    };
    this.onAddListener = (event, extensionId, eventName) => {
      const observer = this.sessionMap.get(getSessionFromEvent(event));
      const listener = event.type === "frame" ? {
        type: event.type,
        extensionId,
        host: event.sender
      } : {
        type: event.type,
        extensionId
      };
      return observer?.addListener(listener, extensionId, eventName);
    };
    this.onRemoveListener = (event, extensionId, eventName) => {
      const observer = this.sessionMap.get(getSessionFromEvent(event));
      const listener = event.type === "frame" ? {
        type: event.type,
        extensionId,
        host: event.sender
      } : {
        type: event.type,
        extensionId
      };
      return observer?.removeListener(listener, extensionId, eventName);
    };
    import_electron11.ipcMain.handle("crx-msg", this.onRouterMessage);
    import_electron11.ipcMain.handle("crx-msg-remote", this.onRemoteMessage);
    import_electron11.ipcMain.on("crx-add-listener", this.onAddListener);
    import_electron11.ipcMain.on("crx-remove-listener", this.onRemoveListener);
  }
  static get() {
    return gRoutingDelegate || (gRoutingDelegate = new _RoutingDelegate());
  }
  addObserver(observer) {
    this.sessionMap.set(observer.session, observer);
    const maybeListenForWorkerEvents = ({
      runningStatus,
      versionId
    }) => {
      if (runningStatus !== "starting") return;
      const serviceWorker = observer.session.serviceWorkers.getWorkerFromVersionID(
        versionId
      );
      if (serviceWorker?.scope?.startsWith("chrome-extension://") && !this.workers.has(serviceWorker)) {
        d9(`listening to service worker [versionId:${versionId}, scope:${serviceWorker.scope}]`);
        this.workers.add(serviceWorker);
        serviceWorker.ipc.handle("crx-msg", this.onRouterMessage);
        serviceWorker.ipc.handle("crx-msg-remote", this.onRemoteMessage);
        serviceWorker.ipc.on("crx-add-listener", this.onAddListener);
        serviceWorker.ipc.on("crx-remove-listener", this.onRemoveListener);
      }
    };
    observer.session.serviceWorkers.on("running-status-changed", maybeListenForWorkerEvents);
  }
};
var getHostId = (host) => host.id;
var getHostUrl = (host) => host.getURL?.();
var eventListenerEquals = (a) => (b) => {
  if (a === b) return true;
  if (a.extensionId !== b.extensionId) return false;
  if (a.type !== b.type) return false;
  if (a.type === "frame" && b.type === "frame") {
    return a.host === b.host;
  }
  return true;
};
var ExtensionRouter = class {
  constructor(session2, delegate = RoutingDelegate.get()) {
    this.session = session2;
    this.delegate = delegate;
    this.handlers = /* @__PURE__ */ new Map();
    this.listeners = /* @__PURE__ */ new Map();
    /**
     * Collection of all extension hosts in the session.
     *
     * Currently the router has no ability to wake up non-persistent background
     * scripts to deliver events. For now we just hold a reference to them to
     * prevent them from being terminated.
     */
    this.extensionHosts = /* @__PURE__ */ new Set();
    this.extensionWorkers = /* @__PURE__ */ new Set();
    this.delegate.addObserver(this);
    const sessionExtensions = session2.extensions || session2;
    sessionExtensions.on("extension-unloaded", (event, extension) => {
      this.filterListeners((listener) => listener.extensionId !== extension.id);
    });
    import_electron11.app.on("web-contents-created", (event, webContents2) => {
      if (webContents2.session === this.session && webContents2.getType() === "backgroundPage") {
        d9(`storing reference to background host [url:'${webContents2.getURL()}']`);
        this.extensionHosts.add(webContents2);
      }
    });
    session2.serviceWorkers.on(
      "running-status-changed",
      ({ runningStatus, versionId }) => {
        if (runningStatus !== "starting") return;
        const serviceWorker = session2.serviceWorkers.getWorkerFromVersionID(versionId);
        if (!serviceWorker) return;
        const { scope } = serviceWorker;
        if (!scope.startsWith("chrome-extension:")) return;
        if (this.extensionHosts.has(serviceWorker)) {
          d9("%s running status changed to %s", scope, runningStatus);
        } else {
          d9(`storing reference to background service worker [url:'${scope}']`);
          this.extensionWorkers.add(serviceWorker);
        }
      }
    );
  }
  filterListeners(predicate) {
    for (const [eventName, listeners] of this.listeners) {
      const filteredListeners = listeners.filter(predicate);
      const delta = listeners.length - filteredListeners.length;
      if (filteredListeners.length > 0) {
        this.listeners.set(eventName, filteredListeners);
      } else {
        this.listeners.delete(eventName);
      }
      if (delta > 0) {
        d9(`removed ${delta} listener(s) for '${eventName}'`);
      }
    }
  }
  observeListenerHost(host) {
    const hostId = getHostId(host);
    d9(`observing listener [id:${hostId}, url:'${getHostUrl(host)}']`);
    host.once("destroyed", () => {
      d9(`extension host destroyed [id:${hostId}]`);
      this.filterListeners((listener) => listener.type !== "frame" || listener.host !== host);
    });
  }
  addListener(listener, extensionId, eventName) {
    const { listeners, session: session2 } = this;
    const sessionExtensions = session2.extensions || session2;
    const extension = sessionExtensions.getExtension(extensionId);
    if (!extension) {
      throw new Error(`extension not registered in session [extensionId:${extensionId}]`);
    }
    if (!listeners.has(eventName)) {
      listeners.set(eventName, []);
    }
    const eventListeners = listeners.get(eventName);
    const existingEventListener = eventListeners.find(eventListenerEquals(listener));
    if (existingEventListener) {
      d9(`ignoring existing '${eventName}' event listener for ${extensionId}`);
    } else {
      d9(`adding '${eventName}' event listener for ${extensionId}`);
      eventListeners.push(listener);
      if (listener.type === "frame" && listener.host) {
        this.observeListenerHost(listener.host);
      }
    }
  }
  removeListener(listener, extensionId, eventName) {
    const { listeners } = this;
    const eventListeners = listeners.get(eventName);
    if (!eventListeners) {
      console.error(`event listener not registered for '${eventName}'`);
      return;
    }
    const index = eventListeners.findIndex(eventListenerEquals(listener));
    if (index >= 0) {
      d9(`removing '${eventName}' event listener for ${extensionId}`);
      eventListeners.splice(index, 1);
    }
    if (eventListeners.length === 0) {
      listeners.delete(eventName);
    }
  }
  getHandler(handlerName) {
    const handler = this.handlers.get(handlerName);
    if (!handler) {
      throw new Error(`${handlerName} is not a registered handler`);
    }
    return handler;
  }
  async onExtensionMessage(event, extensionId, handlerName, ...args) {
    if (handlerName === "tabs.query") {
      console.log("[router] tabs.query received:", {
        eventType: event.type,
        extensionId,
        args: JSON.stringify(args)
      });
    }
    const { session: session2 } = this;
    const eventSession = getSessionFromEvent(event);
    const eventSessionExtensions = eventSession.extensions || eventSession;
    const handler = this.getHandler(handlerName);
    if (eventSession !== session2 && !handler.allowRemote) {
      throw new Error(`${handlerName} does not support calling from a remote session`);
    }
    const extension = extensionId ? eventSessionExtensions.getExtension(extensionId) : void 0;
    if (!extension && handler.extensionContext) {
      throw new Error(`${handlerName} was sent from an unknown extension context`);
    }
    if (handler.permission) {
      const manifest = extension?.manifest;
      if (!extension || !manifest.permissions?.includes(handler.permission)) {
        throw new Error(
          `${handlerName} requires an extension with ${handler.permission} permissions`
        );
      }
    }
    const extEvent = event.type === "frame" ? { type: event.type, sender: event.sender, extension } : { type: event.type, sender: event.serviceWorker, extension };
    const result = await handler.callback(extEvent, ...args);
    d9(`${handlerName} result: %r`, result);
    return result;
  }
  handle(name, callback, opts) {
    this.handlers.set(name, {
      callback,
      extensionContext: typeof opts?.extensionContext === "boolean" ? opts.extensionContext : true,
      allowRemote: typeof opts?.allowRemote === "boolean" ? opts.allowRemote : false,
      permission: typeof opts?.permission === "string" ? opts.permission : void 0
    });
  }
  /** Returns a callback to register API handlers for the given context. */
  apiHandler() {
    return (name, callback, opts) => {
      this.handle(name, callback, opts);
    };
  }
  /**
   * Sends extension event to the host for the given extension ID if it
   * registered a listener for it.
   */
  sendEvent(targetExtensionId, eventName, ...args) {
    const { listeners } = this;
    let eventListeners = listeners.get(eventName);
    const ipcName = `crx-${eventName}`;
    if (!eventListeners || eventListeners.length === 0) {
      return;
    }
    let sentCount = 0;
    for (const listener of eventListeners) {
      const { type, extensionId } = listener;
      if (targetExtensionId && targetExtensionId !== extensionId) {
        continue;
      }
      if (type === "service-worker") {
        const scope = `chrome-extension://${extensionId}/`;
        this.session.serviceWorkers.startWorkerForScope(scope).then((serviceWorker) => {
          serviceWorker.send(ipcName, ...args);
        }).catch((error) => {
          d9("failed to send %s to %s", eventName, extensionId);
          console.error(error);
        });
      } else {
        if (listener.host.isDestroyed()) {
          console.error(`Unable to send '${eventName}' to extension host for ${extensionId}`);
          return;
        }
        listener.host.send(ipcName, ...args);
      }
      sentCount++;
    }
    d9(`sent '${eventName}' event to ${sentCount} listeners`);
  }
  /** Broadcasts extension event to all extension hosts listening for it. */
  broadcastEvent(eventName, ...args) {
    this.sendEvent(void 0, eventName, ...args);
  }
};

// src/browser/license.ts
var import_electron12 = require("electron");
var nodeCrypto = __toESM(require("node:crypto"));
var fs3 = __toESM(require("node:fs"));
var path3 = __toESM(require("node:path"));
var INTERNAL_LICENSE = "internal-license-do-not-use";
var VALID_LICENSES_CONST = ["GPL-3.0", "Patron-License-2020-11-19"];
var VALID_LICENSES = new Set(VALID_LICENSES_CONST);
var NONCOMPLIANT_PROJECTS = /* @__PURE__ */ new Set([
  "9588cd7085bc3ae89f2c9cf8b7dee35a77a6747b4717be3d7b6b8f395c9ca1d8",
  "8cf1d008c4c5d4e8a6f32de274359cf4ac02fcb82aeffae10ff0b99553c9d745"
]);
var getLicenseNotice = () => `Please select a distribution license compatible with your application.
Valid licenses include: ${Array.from(VALID_LICENSES).join(", ")}
See LICENSE.md for more details.`;
function readPackageJson() {
  const appPath = import_electron12.app.getAppPath();
  const packageJsonPath = path3.join(appPath, "package.json");
  const rawData = fs3.readFileSync(packageJsonPath, "utf-8");
  return JSON.parse(rawData);
}
function generateHash(input) {
  const hash = nodeCrypto.createHash("sha256");
  hash.update("crx" + input);
  return hash.digest("hex");
}
function checkLicense(license) {
  if (!license || typeof license !== "string") {
    throw new Error(`ElectronChromeExtensions: Missing 'license' property.
${getLicenseNotice()}`);
  }
  if (!VALID_LICENSES.has(license) && license !== INTERNAL_LICENSE) {
    throw new Error(
      `ElectronChromeExtensions: Invalid 'license' property: ${license}
${getLicenseNotice()}`
    );
  }
  let projectNameHash;
  try {
    const packageJson = readPackageJson();
    const projectName = packageJson.name.toLowerCase();
    projectNameHash = generateHash(projectName);
  } catch {
  }
  if (projectNameHash && NONCOMPLIANT_PROJECTS.has(projectNameHash)) {
    throw new Error(
      `ElectronChromeExtensions: This application is using a non-compliant license. Contact sam@samuelmaddock.com if you wish to reinstate your license.`
    );
  }
}

// src/browser/manifest.ts
async function readUrlOverrides(ctx, extension) {
  const manifest = extension.manifest;
  const urlOverrides = ctx.store.urlOverrides;
  let updated = false;
  if (typeof manifest.chrome_url_overrides === "object") {
    for (const [name, uri] of Object.entries(manifest.chrome_url_overrides)) {
      const validatedPath = await validateExtensionResource(extension, uri);
      if (!validatedPath) {
        console.error(
          `Extension ${extension.id} attempted to override ${name} with invalid resource: ${uri}`
        );
        continue;
      }
      const url = getExtensionUrl(extension, uri);
      const currentUrl = urlOverrides[name];
      if (currentUrl !== url) {
        urlOverrides[name] = url;
        updated = true;
      }
    }
  }
  if (updated) {
    ctx.emit("url-overrides-updated", urlOverrides);
  }
}
function readLoadedExtensionManifest(ctx, extension) {
  readUrlOverrides(ctx, extension);
}

// src/browser/api/permissions.ts
var PermissionsAPI = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.permissionMap = /* @__PURE__ */ new Map();
    this.contains = ({ extension }, permissions) => {
      const currentPermissions = this.permissionMap.get(extension.id);
      const hasPermissions = permissions.permissions ? permissions.permissions.every(
        (permission) => currentPermissions.permissions.includes(permission)
      ) : true;
      const hasOrigins = permissions.origins ? permissions.origins.every((origin) => currentPermissions.origins.includes(origin)) : true;
      return hasPermissions && hasOrigins;
    };
    this.getAll = ({ extension }) => {
      return this.permissionMap.get(extension.id);
    };
    this.remove = ({ extension }, permissions) => {
      return true;
    };
    this.request = async ({ extension }, request) => {
      const declaredPermissions = /* @__PURE__ */ new Set([
        ...extension.manifest.permissions || [],
        ...extension.manifest.optional_permissions || []
      ]);
      if (request.permissions && !request.permissions.every((p) => declaredPermissions.has(p))) {
        throw new Error("Permissions request includes undeclared permission");
      }
      const granted = await this.ctx.store.requestPermissions(extension, request);
      if (!granted) return false;
      const permissions = this.permissionMap.get(extension.id);
      if (request.origins) {
        for (const origin of request.origins) {
          if (!permissions.origins.includes(origin)) {
            permissions.origins.push(origin);
          }
        }
      }
      if (request.permissions) {
        for (const permission of request.permissions) {
          if (!permissions.permissions.includes(permission)) {
            permissions.permissions.push(permission);
          }
        }
      }
      return true;
    };
    const handle = this.ctx.router.apiHandler();
    handle("permissions.contains", this.contains);
    handle("permissions.getAll", this.getAll);
    handle("permissions.remove", this.remove);
    handle("permissions.request", this.request);
    const sessionExtensions = ctx.session.extensions || ctx.session;
    sessionExtensions.getAllExtensions().forEach((ext) => this.processExtension(ext));
    sessionExtensions.on("extension-loaded", (_event, extension) => {
      this.processExtension(extension);
    });
    sessionExtensions.on("extension-unloaded", (_event, extension) => {
      this.permissionMap.delete(extension.id);
    });
  }
  processExtension(extension) {
    const manifest = extension.manifest;
    this.permissionMap.set(extension.id, {
      permissions: manifest.permissions || [],
      origins: manifest.host_permissions || []
    });
  }
};

// src/browser/index.ts
function checkVersion() {
  const electronVersion = process.versions.electron;
  if (electronVersion && parseInt(electronVersion.split(".")[0], 10) < 35) {
    console.warn("electron-chrome-extensions requires electron@>=35.0.0");
  }
}
function resolvePreloadPath(modulePath) {
  try {
    return (0, import_node_module.createRequire)(__dirname).resolve("electron-chrome-extensions/preload");
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
  }
  const preloadFilename = "chrome-extension-api.preload.js";
  if (modulePath) {
    process.emitWarning(
      'electron-chrome-extensions: "modulePath" is deprecated and will be removed in future versions.',
      { type: "DeprecationWarning" }
    );
    return import_node_path.default.join(modulePath, "dist", preloadFilename);
  }
  return import_node_path.default.join(__dirname, preloadFilename);
}
var sessionMap = /* @__PURE__ */ new WeakMap();
var ElectronChromeExtensions = class _ElectronChromeExtensions extends import_node_events4.EventEmitter {
  constructor(opts) {
    super();
    /** Maps extension ID -> service worker script relative path */
    this.swScriptPaths = /* @__PURE__ */ new Map();
    /** Cached polyfill code */
    this.swPolyfill = generateSWPolyfill();
    const { license, session: session2 = import_electron13.session.defaultSession, ...impl } = opts || {};
    checkVersion();
    checkLicense(license);
    if (sessionMap.has(session2)) {
      throw new Error(`Extensions instance already exists for the given session`);
    }
    sessionMap.set(session2, this);
    const router = new ExtensionRouter(session2);
    const store = new ExtensionStore(impl);
    this.ctx = {
      emit: this.emit.bind(this),
      router,
      session: session2,
      store
    };
    this.api = {
      browserAction: new BrowserActionAPI(this.ctx),
      contextMenus: new ContextMenusAPI(this.ctx),
      commands: new CommandsAPI(this.ctx),
      cookies: new CookiesAPI(this.ctx),
      notifications: new NotificationsAPI(this.ctx),
      permissions: new PermissionsAPI(this.ctx),
      runtime: new RuntimeAPI(this.ctx),
      tabs: new TabsAPI(this.ctx),
      webNavigation: new WebNavigationAPI(this.ctx),
      windows: new WindowsAPI(this.ctx)
    };
    this.listenForExtensions();
    this.prependPreload(opts.modulePath);
    this.setupSWScriptInterception();
  }
  /** Retrieve an instance of this class associated with the given session. */
  static fromSession(session2) {
    return sessionMap.get(session2);
  }
  /**
   * Handles the 'crx://' protocol in the session.
   *
   * This is required to display <browser-action-list> extension icons.
   */
  static handleCRXProtocol(session2) {
    if (session2.protocol.isProtocolHandled("crx")) {
      session2.protocol.unhandle("crx");
    }
    session2.protocol.handle("crx", function handleCRXRequest(request) {
      let url;
      try {
        url = new URL(request.url);
      } catch {
        return new Response("Invalid URL", { status: 404 });
      }
      const partition = url?.searchParams.get("partition") || "_self";
      const remoteSession = partition === "_self" ? session2 : resolvePartition(partition);
      const extensions = _ElectronChromeExtensions.fromSession(remoteSession);
      if (!extensions) {
        return new Response(`ElectronChromeExtensions not found for "${partition}"`, {
          status: 404
        });
      }
      return extensions.api.browserAction.handleCRXRequest(request);
    });
  }
  listenForExtensions() {
    const sessionExtensions = this.ctx.session.extensions || this.ctx.session;
    sessionExtensions.addListener("extension-loaded", async (_event, extension) => {
      readLoadedExtensionManifest(this.ctx, extension);
      const manifest = extension.manifest;
      if (manifest.manifest_version === 3 && manifest.background) {
        const bg = manifest.background;
        if (bg.service_worker) {
          this.swScriptPaths.set(extension.id, bg.service_worker);
          await this.injectSWPolyfill(extension, bg.service_worker);
        }
      }
    });
    sessionExtensions.addListener("extension-unloaded", (_event, extension) => {
      this.swScriptPaths.delete(extension.id);
    });
  }
  /**
   * Injects the polyfill into an MV3 extension's service worker script file.
   * This is necessary because MV3 SW scripts bypass protocol.handle and webRequest.
   */
  async injectSWPolyfill(extension, swScriptPath) {
    const filePath = import_node_path.default.join(extension.path, swScriptPath);
    const polyfillStartMarker = ";(function __crxSWPolyfill()";
    const polyfillEndMarker = "})();\n";
    try {
      let content = (0, import_node_fs3.readFileSync)(filePath, "utf-8");
      const startIdx = content.indexOf(polyfillStartMarker);
      if (startIdx !== -1) {
        const endIdx = content.indexOf(polyfillEndMarker, startIdx);
        if (endIdx !== -1) {
          content = content.substring(endIdx + polyfillEndMarker.length);
          console.log(`[electron-chrome-extensions] Stripped old polyfill from ${extension.name}`);
        }
      }
      const modifiedContent = this.swPolyfill + "\n" + content;
      const { writeFileSync } = await import("node:fs");
      writeFileSync(filePath, modifiedContent, "utf-8");
      console.log(`[electron-chrome-extensions] Injected polyfill into ${extension.name} SW script`);
      const scope = `chrome-extension://${extension.id}/`;
      try {
        await this.ctx.session.serviceWorkers.startWorkerForScope(scope);
        console.log(`[electron-chrome-extensions] Restarted SW for ${extension.name}`);
      } catch (err) {
        console.log(`[electron-chrome-extensions] SW for ${extension.name} will load polyfill on next start`);
      }
    } catch (err) {
      console.error(`[electron-chrome-extensions] Failed to inject polyfill into ${extension.name}:`, err.message);
    }
  }
  async prependPreload(modulePath) {
    const { session: session2 } = this.ctx;
    const preloadPath = resolvePreloadPath(modulePath);
    if ("registerPreloadScript" in session2) {
      session2.registerPreloadScript({
        id: "crx-mv2-preload",
        type: "frame",
        filePath: preloadPath
      });
      session2.registerPreloadScript({
        id: "crx-mv3-preload",
        type: "service-worker",
        filePath: preloadPath
      });
    } else {
      session2.setPreloads([...session2.getPreloads(), preloadPath]);
    }
    if (!(0, import_node_fs3.existsSync)(preloadPath)) {
      console.error(
        new Error(
          `electron-chrome-extensions: Preload file not found at "${preloadPath}". See "Packaging the preload script" in the readme.`
        )
      );
    }
  }
  /**
   * Intercepts chrome-extension:// protocol to augment service worker scripts
   * with chrome.* API polyfills. This is necessary because contextBridge's
   * executeInMainWorld in SW preloads targets a separate "preload realm" V8
   * context that's different from the SW script's execution context.
   */
  setupSWScriptInterception() {
    const { session: session2 } = this.ctx;
    const getMimeType = (filePath) => {
      const ext = import_node_path.default.extname(filePath).toLowerCase();
      const mimeTypes = {
        ".js": "application/javascript",
        ".mjs": "application/javascript",
        ".json": "application/json",
        ".html": "text/html",
        ".htm": "text/html",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".wasm": "application/wasm",
        ".map": "application/json"
      };
      return mimeTypes[ext] || "application/octet-stream";
    };
    try {
      const isHandled = session2.protocol.isProtocolHandled("chrome-extension");
      console.log("[electron-chrome-extensions] chrome-extension:// protocol already handled:", isHandled);
      if (isHandled) {
        console.log("[electron-chrome-extensions] Attempting to unhandle chrome-extension://");
        session2.protocol.unhandle("chrome-extension");
        console.log("[electron-chrome-extensions] Successfully unhandled chrome-extension://");
      }
      console.log("[electron-chrome-extensions] Registering chrome-extension:// protocol handler");
      session2.webRequest.onBeforeRequest(
        { urls: ["chrome-extension://*/*"] },
        (details, callback) => {
          console.log("[electron-chrome-extensions] webRequest intercepted:", details.url, "type:", details.resourceType);
          callback({});
        }
      );
      session2.protocol.handle("chrome-extension", (request) => {
        console.log("[electron-chrome-extensions] Protocol handler called for:", request.url);
        let url;
        try {
          url = new URL(request.url);
        } catch {
          return new Response("Invalid URL", { status: 400 });
        }
        const extensionId = url.hostname;
        const requestPath = decodeURIComponent(url.pathname);
        const sessionExtensions = session2.extensions || session2;
        const extension = sessionExtensions.getExtension(extensionId);
        if (!extension) {
          return new Response("Extension not found", { status: 404 });
        }
        const filePath = import_node_path.default.join(extension.path, requestPath);
        if (!filePath.startsWith(extension.path)) {
          return new Response("Forbidden", { status: 403 });
        }
        try {
          const content = (0, import_node_fs3.readFileSync)(filePath);
          const swScript = this.swScriptPaths.get(extensionId);
          const normalizedRequest = requestPath.replace(/^\//, "");
          const isSwScript = swScript && normalizedRequest === swScript;
          if (isSwScript) {
            const augmentedContent = this.swPolyfill + content.toString("utf-8");
            return new Response(augmentedContent, {
              headers: {
                "Content-Type": "application/javascript",
                "Cache-Control": "no-cache"
              }
            });
          }
          return new Response(content, {
            headers: { "Content-Type": getMimeType(filePath) }
          });
        } catch (err) {
          if (err.code === "ENOENT") {
            return new Response("Not found", { status: 404 });
          }
          return new Response("Internal error", { status: 500 });
        }
      });
    } catch (err) {
      console.error("[electron-chrome-extensions] Failed to set up SW script interception:", err);
      console.error(
        "Service worker API augmentation will not be available. chrome.commands, chrome.contextMenus, etc. may not work in MV3 extensions."
      );
    }
  }
  checkWebContentsArgument(wc) {
    if (this.ctx.session !== wc.session) {
      throw new TypeError(
        "Invalid WebContents argument. Its session must match the session provided to ElectronChromeExtensions constructor options."
      );
    }
  }
  /** Add webContents to be tracked as a tab. */
  addTab(tab, window) {
    this.checkWebContentsArgument(tab);
    this.ctx.store.addTab(tab, window);
  }
  /** Remove webContents from being tracked as a tab. */
  removeTab(tab) {
    this.checkWebContentsArgument(tab);
    this.ctx.store.removeTab(tab);
  }
  /** Notify extension system that the active tab has changed. */
  selectTab(tab) {
    this.checkWebContentsArgument(tab);
    if (this.ctx.store.tabs.has(tab)) {
      this.api.tabs.onActivated(tab.id);
    }
  }
  /** Notify extension system that a window has been updated. */
  windowUpdated(windowId) {
    this.api.windows.onBoundsChanged(windowId);
  }
  /** Notify extension system that a tab has been updated. */
  tabUpdated(tabId) {
    this.api.tabs.onUpdated(tabId);
  }
  /** Handle a CRX protocol request. */
  handleCrxRequest(request) {
    return this.api.browserAction.handleCRXRequest(request);
  }
  /**
   * Add webContents to be tracked as an extension host which will receive
   * extension events when a chrome-extension:// resource is loaded.
   *
   * This is usually reserved for extension background pages and popups, but
   * can also be used in other special cases.
   *
   * @deprecated Extension hosts are now tracked lazily when they send
   * extension IPCs to the main process.
   */
  addExtensionHost(host) {
    console.warn("ElectronChromeExtensions.addExtensionHost() is deprecated");
  }
  /**
   * Get collection of menu items managed by the `chrome.contextMenus` API.
   * @see https://developer.chrome.com/extensions/contextMenus
   */
  getContextMenuItems(webContents2, params) {
    this.checkWebContentsArgument(webContents2);
    return this.api.contextMenus.buildMenuItemsForParams(webContents2, params);
  }
  /**
   * Gets map of special pages to extension override URLs.
   *
   * @see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/chrome_url_overrides
   */
  getURLOverrides() {
    return this.ctx.store.urlOverrides;
  }
  /**
   * Handles the 'crx://' protocol in the session.
   *
   * @deprecated Call `ElectronChromeExtensions.handleCRXProtocol(session)`
   * instead. The CRX protocol is no longer one-to-one with
   * ElectronChromeExtensions instances. Instead, it should now be handled only
   * on the sessions where <browser-action-list> extension icons will be shown.
   */
  handleCRXProtocol(session2) {
    throw new Error(
      "extensions.handleCRXProtocol(session) is deprecated, call ElectronChromeExtensions.handleCRXProtocol(session) instead."
    );
  }
  /**
   * Add extensions to be visible as an extension action button.
   *
   * @deprecated Not needed in Electron >=12.
   */
  addExtension(extension) {
    console.warn("ElectronChromeExtensions.addExtension() is deprecated");
    this.api.browserAction.processExtension(extension);
  }
  /**
   * Remove extensions from the list of visible extension action buttons.
   *
   * @deprecated Not needed in Electron >=12.
   */
  removeExtension(extension) {
    console.warn("ElectronChromeExtensions.removeExtension() is deprecated");
    this.api.browserAction.removeActions(extension.id);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ElectronChromeExtensions,
  setSessionPartitionResolver
});
//# sourceMappingURL=index.js.map
