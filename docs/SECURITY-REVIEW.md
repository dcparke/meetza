# Security Review Summary

This document records the current security posture of the 2.0 architecture. It is not a third-party penetration test or certification.

## Enforced controls

### Least privilege

- Google Calendar OAuth scope is limited to `calendar.events.freebusy`.
- Required network host access is limited to `www.googleapis.com`.
- Gmail access is an optional host permission.
- Gmail access is removed when Meetza is disabled.
- No `tabs` permission is requested.
- No Gmail API or Contacts API permission is requested.

### Gmail boundary

- No static content script exists in the manifest.
- The content script is dynamically registered only while Meetza is enabled.
- The content script contains only launcher, iframe positioning, shutdown, and panel-session registration logic.
- The launcher is inside a closed Shadow DOM.
- The application form and results run in an extension-origin iframe.
- The content script has no storage access, Google API access, or availability logic.

### Panel capability

- Each panel instance gets a random UUID capability token.
- The content script registers that token for the current Gmail tab.
- Tokens are stored in trusted, ephemeral session storage.
- The token is not placed in the iframe element's `src` attribute.
- The panel removes the token fragment from its own URL immediately after startup.
- Service-worker panel messages require both the expected panel page and a token registered for the same Gmail tab.

### Calendar boundary

- OAuth tokens remain in the service worker.
- active FreeBusy requests are cancelled when the originating Gmail tab closes or Meetza is disabled
- Raw busy ranges remain in the service worker.
- Each selected date is queried only for the configured workday window.
- Google response shape and busy timestamps are validated.
- Inaccessible calendars fail closed.
- The UI receives only final free ranges.

### Abuse resistance

- one active generation request per Gmail tab
- minimum delay between requests
- request-count limit per minute
- FreeBusy workday-window cost limit per minute
- maximum dates and calendars
- API timeout
- busy-range count limit

### Storage

- privileged message handling waits for the storage boundary to be established
- `storage.local` and `storage.session` are restricted to trusted contexts.
- recent-person history defaults to off
- recent-person history is limited to 15 addresses
- disabling recent-person history clears stored addresses when settings are saved

### Extension-page hardening

- default-deny Content Security Policy
- packaged scripts and styles only
- Google API is the only allowed connection destination
- form submission, plug-in objects, and base-URL rewriting are blocked
- Gmail is the only allowed frame ancestor for the panel

### Repository controls

- no runtime dependencies
- no remotely hosted code
- no `innerHTML` writes
- no `eval` or `new Function`
- one network `fetch` call in the entire extension source
- automated manifest and security-invariant checks
- dependency-free unit tests

## Residual risks

### Content-script capability

While enabled, the content script necessarily has DOM access on Gmail because it must locate the compose toolbar. The current code does not read messages, recipients, subjects, or threads, but a malicious future update could change that behavior.

Primary mitigations are optional host access, a minimal content script, source transparency, and release controls.

### Host-page interference

Gmail page code can remove, cover, or visually interfere with the launcher or iframe. The extension-origin iframe prevents direct DOM access to the application UI, but it cannot prevent denial of service by the host page.

### Publisher compromise

A compromised publisher account could distribute malicious code. Release-account security and two-person release controls remain essential.

### Local device compromise

Extension settings and optional recent-person history are not encrypted secrets. A user or process with access to the browser profile or device may be able to inspect local data.

### Availability inference

Free/busy timestamps can reveal schedule patterns. Google sharing permissions determine which calendars the authenticated user may query. Meetza does not bypass those permissions.

## Recommended next assurance steps

Before a large organizational deployment:

1. independent source review
2. manual testing of permission removal and dynamic injection
3. adversarial testing of panel-session capabilities
4. OAuth consent and Google Cloud configuration review
5. publisher-account and release-pipeline review
6. pilot deployment with monitored API quota behavior
