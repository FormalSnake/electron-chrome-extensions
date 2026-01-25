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

  // chrome.commands
  if (!chrome.commands || !chrome.commands.onCommand) {
    var commandsBase = chrome.commands || {};
    chrome.commands = {
      getAll: commandsBase.getAll || invokeExtension('commands.getAll'),
      onCommand: new ExtensionEvent('commands.onCommand')
    };
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

  // Remove access to internals
  delete globalThis.electron;

})();
`
}
