(() => {
  "use strict";

  const raw = globalThis.browser || globalThis.chrome;
  const usesPromises = Boolean(globalThis.browser);

  if (!raw) {
    throw new Error("Meetza could not find the WebExtensions API.");
  }

  function call(target, method, ...args) {
    if (!target || typeof target[method] !== "function") {
      return Promise.reject(new Error(`Unsupported extension API: ${method}`));
    }

    if (usesPromises) {
      return Promise.resolve(target[method](...args));
    }

    return new Promise((resolve, reject) => {
      target[method](...args, (value) => {
        const error = raw.runtime?.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve(value);
        }
      });
    });
  }

  const api = Object.freeze({
    raw,
    call,
    url: (path) => raw.runtime.getURL(path),
    sendMessage: (message) => call(raw.runtime, "sendMessage", message),
    storageGet: (keys) => call(raw.storage.local, "get", keys),
    storageSet: (values) => call(raw.storage.local, "set", values),
    storageRemove: (keys) => call(raw.storage.local, "remove", keys),
    permissionContains: (value) => call(raw.permissions, "contains", value),
    permissionRequest: (value) => call(raw.permissions, "request", value),
    permissionRemove: (value) => call(raw.permissions, "remove", value),
    tabsQuery: (query) => call(raw.tabs, "query", query),
    tabsSendMessage: (tabId, message) => call(raw.tabs, "sendMessage", tabId, message),
    executeScript: (details) => call(raw.scripting, "executeScript", details),
    registerScripts: (scripts) => call(raw.scripting, "registerContentScripts", scripts),
    unregisterScripts: (filter) => call(raw.scripting, "unregisterContentScripts", filter)
  });

  globalThis.MeetzaPlatform = api;
})();
