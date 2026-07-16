(() => {
  "use strict";

  const { raw, call } = MeetzaPlatform;

  function getToken(interactive) {
    return new Promise((resolve, reject) => {
      raw.identity.getAuthToken({ interactive }, (result) => {
        const error = raw.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }

        const token = typeof result === "string" ? result : result?.token;
        if (!token) {
          reject(new Error("Google did not return an access token."));
          return;
        }

        resolve(token);
      });
    });
  }

  function invalidate(token) {
    return call(raw.identity, "removeCachedAuthToken", { token });
  }

  globalThis.MeetzaAuth = Object.freeze({ getToken, invalidate });
})();
