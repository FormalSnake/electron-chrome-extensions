/**
 * Generates polyfill code to be prepended to service worker scripts.
 *
 * This code runs inside the actual SW execution context (not the preload realm),
 * so modifications to chrome.* persist. It uses the `electron` bridge exposed
 * by the preload via contextBridge.exposeInMainWorld.
 */
export function generateSWPolyfill(): string {
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

  // chrome.tabs - ALWAYS override query to use our implementation with popup window tracking
  var tabsBase = chrome.tabs || {};
  // Always use our tabs.query implementation for proper currentWindow resolution
  var ourTabsQuery = invokeExtension('tabs.query');
  console.log('[electron-chrome-extensions] SW: Overriding tabs.query with our implementation');

  if (!chrome.tabs || !chrome.tabs.onCreated) {
    chrome.tabs = Object.assign({}, tabsBase, {
      create: tabsBase.create || invokeExtension('tabs.create'),
      get: tabsBase.get || invokeExtension('tabs.get'),
      getCurrent: tabsBase.getCurrent || invokeExtension('tabs.getCurrent'),
      getAllInWindow: tabsBase.getAllInWindow || invokeExtension('tabs.getAllInWindow'),
      insertCSS: tabsBase.insertCSS || invokeExtension('tabs.insertCSS'),
      query: ourTabsQuery, // Always use our implementation
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
  } else {
    // Electron provides chrome.tabs, but we still need to override query
    chrome.tabs.query = ourTabsQuery;
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

    // Listen for messages from our IPC using the electron bridge
    electron.onIpc('crx-runtime.onMessage', function(messageId, message, sender) {
      console.log('[electron-chrome-extensions] SW received message:', messageId, message);

      var responded = false;
      var sendResponse = function(response) {
        if (!responded) {
          responded = true;
          console.log('[electron-chrome-extensions] SW sending response:', messageId, response);
          electron.sendIpc('crx-runtime-response', messageId, response);
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

    // Port-based messaging (runtime.connect / runtime.onConnect)
    var onConnectListeners = [];
    var activePorts = {}; // portId -> Port object

    // Port class for SW-side port handling
    function SWPort(portId, name, sender) {
      this.name = name || '';
      this.sender = sender;
      this._portId = portId;
      this._connected = true;
      this._messageListeners = [];
      this._disconnectListeners = [];
    }

    SWPort.prototype.postMessage = function(message) {
      if (!this._connected) return;
      console.log('[electron-chrome-extensions] SW port.postMessage:', this._portId, message);
      electron.sendIpc('crx-port-message', this._portId, message);
    };

    SWPort.prototype.disconnect = function() {
      if (!this._connected) return;
      this._connected = false;
      console.log('[electron-chrome-extensions] SW port.disconnect:', this._portId);
      electron.sendIpc('crx-port-disconnect', this._portId);
      delete activePorts[this._portId];
    };

    SWPort.prototype._receiveMessage = function(message) {
      for (var i = 0; i < this._messageListeners.length; i++) {
        try {
          this._messageListeners[i](message, this);
        } catch (e) {
          console.error('[electron-chrome-extensions] port.onMessage error:', e);
        }
      }
    };

    SWPort.prototype._handleDisconnect = function() {
      this._connected = false;
      for (var i = 0; i < this._disconnectListeners.length; i++) {
        try {
          this._disconnectListeners[i](this);
        } catch (e) {
          console.error('[electron-chrome-extensions] port.onDisconnect error:', e);
        }
      }
      delete activePorts[this._portId];
    };

    SWPort.prototype.onMessage = {
      addListener: function(callback) {
        this._messageListeners.push(callback);
      }.bind(this),
      removeListener: function(callback) {
        var idx = this._messageListeners.indexOf(callback);
        if (idx > -1) this._messageListeners.splice(idx, 1);
      }.bind(this),
      hasListener: function(callback) {
        return this._messageListeners.indexOf(callback) > -1;
      }.bind(this),
      hasListeners: function() {
        return this._messageListeners.length > 0;
      }.bind(this)
    };

    SWPort.prototype.onDisconnect = {
      addListener: function(callback) {
        this._disconnectListeners.push(callback);
      }.bind(this),
      removeListener: function(callback) {
        var idx = this._disconnectListeners.indexOf(callback);
        if (idx > -1) this._disconnectListeners.splice(idx, 1);
      }.bind(this),
      hasListener: function(callback) {
        return this._disconnectListeners.indexOf(callback) > -1;
      }.bind(this),
      hasListeners: function() {
        return this._disconnectListeners.length > 0;
      }.bind(this)
    };

    // Fix the binding issue - create proper event objects
    SWPort.prototype._initEvents = function() {
      var self = this;
      this.onMessage = {
        addListener: function(callback) {
          self._messageListeners.push(callback);
        },
        removeListener: function(callback) {
          var idx = self._messageListeners.indexOf(callback);
          if (idx > -1) self._messageListeners.splice(idx, 1);
        },
        hasListener: function(callback) {
          return self._messageListeners.indexOf(callback) > -1;
        },
        hasListeners: function() {
          return self._messageListeners.length > 0;
        }
      };
      this.onDisconnect = {
        addListener: function(callback) {
          self._disconnectListeners.push(callback);
        },
        removeListener: function(callback) {
          var idx = self._disconnectListeners.indexOf(callback);
          if (idx > -1) self._disconnectListeners.splice(idx, 1);
        },
        hasListener: function(callback) {
          return self._disconnectListeners.indexOf(callback) > -1;
        },
        hasListeners: function() {
          return self._disconnectListeners.length > 0;
        }
      };
    };

    // Listen for onConnect from main process
    electron.onIpc('crx-runtime.onConnect', function(portId, name, sender) {
      console.log('[electron-chrome-extensions] SW received onConnect:', portId, name);

      var port = new SWPort(portId, name, sender);
      port._initEvents();
      activePorts[portId] = port;

      // Call all registered onConnect listeners
      for (var i = 0; i < onConnectListeners.length; i++) {
        try {
          onConnectListeners[i](port);
        } catch (e) {
          console.error('[electron-chrome-extensions] onConnect listener error:', e);
        }
      }
    });

    // Listen for port messages from main process
    electron.onIpc('crx-port-message', function(portId, message) {
      console.log('[electron-chrome-extensions] SW received port message:', portId, message);
      var port = activePorts[portId];
      if (port) {
        port._receiveMessage(message);
      }
    });

    // Listen for port disconnects from main process
    electron.onIpc('crx-port-disconnect', function(portId) {
      console.log('[electron-chrome-extensions] SW received port disconnect:', portId);
      var port = activePorts[portId];
      if (port) {
        port._handleDisconnect();
      }
    });

    // Override onConnect
    chrome.runtime.onConnect = {
      addListener: function(callback) {
        console.log('[electron-chrome-extensions] SW onConnect.addListener called');
        onConnectListeners.push(callback);
      },
      removeListener: function(callback) {
        var index = onConnectListeners.indexOf(callback);
        if (index > -1) {
          onConnectListeners.splice(index, 1);
        }
      },
      hasListener: function(callback) {
        return onConnectListeners.indexOf(callback) > -1;
      },
      hasListeners: function() {
        return onConnectListeners.length > 0;
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
  // Keep existing runtime but add our implementations
  if (!globalThis.browser.runtime) {
    globalThis.browser.runtime = chrome.runtime;
  } else {
    // Always update these to use our implementations
    if (chrome.runtime.openOptionsPage) globalThis.browser.runtime.openOptionsPage = chrome.runtime.openOptionsPage;
    if (chrome.runtime.sendMessage) globalThis.browser.runtime.sendMessage = chrome.runtime.sendMessage;
    if (chrome.runtime.onMessage) globalThis.browser.runtime.onMessage = chrome.runtime.onMessage;
    if (chrome.runtime.onConnect) globalThis.browser.runtime.onConnect = chrome.runtime.onConnect;
  }

  console.log('[electron-chrome-extensions] browser.* APIs augmented, commands:', !!globalThis.browser.commands, 'onCommand:', !!globalThis.browser.commands?.onCommand, 'onConnect:', !!chrome.runtime.onConnect);

  // Note: Don't delete globalThis.electron in SW context - contextBridge makes it non-configurable
  // The electron bridge remains available but this is acceptable for trusted extension code

  console.log('[electron-chrome-extensions] SW polyfill setup complete, chrome.commands:', !!chrome.commands);

})();
`
}
