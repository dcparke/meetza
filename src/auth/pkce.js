(() => {
  "use strict";

  const { raw, call } = MeetzaPlatform;
  const { GOOGLE_SCOPE } = Meetza;
  const CLIENT_ID = globalThis.MeetzaBuild?.oauthClientId || "";
  const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const TOKEN_URL = "https://oauth2.googleapis.com/token";

  let cachedToken = null;
  let expiresAt = 0;

  async function getToken(interactive) {
    if (cachedToken && Date.now() < expiresAt - 60_000) {
      return cachedToken;
    }

    if (!interactive) {
      throw new Error("Google authorization is required.");
    }

    if (!CLIENT_ID || CLIENT_ID.includes("REPLACE_ME")) {
      throw new Error("This browser build does not have a Google OAuth client ID.");
    }

    const redirectUri = getRedirectUri();
    const state = randomString(32);
    const verifier = randomString(64);
    const challenge = await sha256Base64Url(verifier);

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", CLIENT_ID);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("access_type", "online");

    const finalUrl = await call(raw.identity, "launchWebAuthFlow", {
      url: url.toString(),
      interactive: true
    });

    if (!finalUrl) {
      throw new Error("Google authorization did not complete.");
    }

    const result = new URL(finalUrl);
    const expectedRedirect = new URL(redirectUri);
    if (
      result.origin !== expectedRedirect.origin ||
      result.pathname !== expectedRedirect.pathname
    ) {
      throw new Error("Google returned an unexpected redirect.");
    }

    if (result.searchParams.get("state") !== state) {
      throw new Error("Google authorization state did not match.");
    }

    const oauthError = result.searchParams.get("error");
    if (oauthError) {
      throw new Error(`Google authorization failed: ${oauthError}.`);
    }

    const code = result.searchParams.get("code");
    if (!code) {
      throw new Error("Google did not return an authorization code.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response;

    try {
      response = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        }),
        cache: "no-store",
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`Google token exchange failed (${response.status}).`);
    }

    const body = await response.json();
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new Error("Google did not return a usable access token.");
    }

    if (typeof body.scope === "string" && !body.scope.split(/\s+/).includes(GOOGLE_SCOPE)) {
      throw new Error("Google did not grant the required Calendar scope.");
    }

    cachedToken = body.access_token;
    expiresAt = Date.now() + Math.max(60, Number(body.expires_in) || 3600) * 1000;
    return cachedToken;
  }

  async function invalidate(token) {
    if (token === cachedToken) {
      cachedToken = null;
      expiresAt = 0;
    }
  }


  function getRedirectUri() {
    const standard = raw.identity.getRedirectURL("oauth2");

    if (globalThis.MeetzaBuild?.target !== "firefox") {
      return standard;
    }

    /*
     * Firefox permits a loopback redirect derived from the extension ID.
     * Google accepts loopback redirects for desktop clients, while its
     * default Firefox extension redirect domain may fail domain validation.
     */
    const host = new URL(raw.identity.getRedirectURL()).hostname;
    const extensionId = host.split(".")[0];
    return `http://127.0.0.1/mozoauth2/${extensionId}`;
  }

  function randomString(bytes) {
    const data = crypto.getRandomValues(new Uint8Array(bytes));
    return base64Url(data);
  }

  async function sha256Base64Url(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return base64Url(new Uint8Array(digest));
  }

  function base64Url(bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  globalThis.MeetzaAuth = Object.freeze({ getToken, invalidate });
})();
