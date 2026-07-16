(() => {
  "use strict";

  const raw = globalThis.browser || globalThis.chrome;
  const usesPromises = Boolean(globalThis.browser);

  if (!raw) {
    throw new Error("Meetza could not find the WebExtensions API.");
  }

  function sendMessage(message) {
    if (usesPromises) {
      return raw.runtime.sendMessage(message);
    }

    return new Promise((resolve, reject) => {
      raw.runtime.sendMessage(message, (response) => {
        const error = raw.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  globalThis.MeetzaContentApi = Object.freeze({
    raw,
    sendMessage,
    url: (path) => raw.runtime.getURL(path)
  });
})();
