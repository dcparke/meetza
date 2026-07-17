# Meetza

Meetza does one thing. It finds open time on Google Calendar and turns it into text you can paste into an email.

It runs inside Gmail. It has no server. It does not read email. It does not ask Google for event titles, descriptions, locations, or attendees.

## The idea

Most scheduling tools become platforms. Meetza should remain a tool.

The flow is small:

1. Open a Gmail compose window.
2. Pick dates and calendars.
3. Click Generate.
4. Copy the result.

That's it! 

## Security model

Meetza asks Google for free/busy ranges only. The OAuth token and raw busy ranges stay in the background process. The Gmail content script receives final free ranges.

Gmail access is optional. Meetza starts disabled. Enabling it asks for access to `mail.google.com`. Disabling it removes that permission and unregisters the content script.

The content script uses a closed Shadow DOM. This keeps Meetza's form and results out of Gmail's ordinary DOM. It is not a perfect security boundary. A browser extension that runs on Gmail still has the technical ability to read the page. The current source does not do that, and the content script is kept small so this is easy to audit.

More detail is in [SECURITY.md](SECURITY.md).

## What Meetza stores

By default, only settings:

- Meeting Length
- Break
- Workday Boundary
- Output Time Zone
- Whether Meetza is enabled

Recent email addresses are optional and off by default. When enabled, Meetza stores at most 15 addresses in extension-local storage.

Meetza does not store availability results or Google access tokens.

## Repository

```text
src/
  background.js   Google auth, validation, FreeBusy, rate limits
  content.js      Gmail button and UI
  common.js       Settings, dates, time zones, availability math
  platform.js     Small Chrome/Firefox API wrapper
  popup.*         Extension settings
  auth/           Browser-specific Google auth

manifests/        Browser manifests
scripts/          Build and security checks
tests/            Unit tests
```

There are no runtime dependencies.

## Build

Current Release: **v1.0.0**
Node 20 or newer is required.

```bash
npm run check
```

This tests the scheduling logic, runs static security checks, and builds all browser targets.

### Chrome

Chrome uses the browser's native Google token API.

```bash
MEETZA_CHROME_CLIENT_ID="your-client-id" npm run build:chrome
```

The client must be a Google OAuth client for the published Chrome extension ID.

### Edge

Edge does not support Chrome's Google-specific `identity.getAuthToken` path. The Edge build uses OAuth Authorization Code with PKCE and keeps the access token in memory only.

```bash
MEETZA_EDGE_CLIENT_ID="your-client-id" npm run build:edge
```

Register the redirect URL returned by `identity.getRedirectURL("oauth2")` in the OAuth client. Test this flow with the final store ID before release.

### Firefox

Firefox uses the same PKCE adapter as Edge, with Firefox's extension-derived loopback redirect.

```bash
MEETZA_FIREFOX_CLIENT_ID="your-client-id" npm run build:firefox
```

Replace the placeholder Firefox extension ID in `manifests/firefox.json` before publishing. Use a Google Desktop OAuth client and test the final signed add-on ID before release. Firefox will disclose that Meetza transmits authentication data and calendar email addresses to Google, because the feature cannot work without doing so.

### Safari

Safari is not supported yet. 

## Browser support

| Browser | Status |
|---|---|
| Chrome | Production path implemented |
| Edge | Build and PKCE auth adapter included; release credentials and live testing required |
| Firefox | Build and PKCE auth adapter included; release credentials and live testing required |

Normal users should never create OAuth credentials. Maintainers create one client per published browser build!

## Permissions

Required:

- `identity` for Google authorization
- `storage` for settings
- `scripting` to add or remove Meetza from Gmail
- `www.googleapis.com` for the FreeBusy request

Optional:

- `mail.google.com`, requested only when Meetza is enabled

Edge and Firefox builds also connect to Google's token endpoint for the PKCE exchange.

## Development

Load the built folder, not the source folder.

```text
dist/chrome
dist/edge
dist/firefox
```

## Tests

```bash
npm test
npm run audit
npm run build
```

The audit rejects common regressions such as:

- static Gmail access
- `innerHTML`, `eval`, or `new Function`
- network calls from the Gmail content script
- storage access from the Gmail content script
- broad host permissions
- weak Content Security Policy
- privacy-sensitive defaults being turned on

## License

Apache License 2.0.
