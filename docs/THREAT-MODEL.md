# Threat Model

## Assets

- OAuth access token
- raw busy timestamps
- generated availability
- calendar identifiers entered by the user
- locally remembered email addresses
- extension publisher and release credentials

## Adversaries considered

### Host-page script

A script running in Gmail may try to inspect Meetza state, automate requests, or interfere with the UI.

Controls:

- content script runs in Chrome's isolated world
- launcher is contained in a closed Shadow DOM
- form and results run in an extension-origin iframe
- service worker accepts generation requests only from the panel page attached to a Gmail tab
- each panel receives an ephemeral capability token registered by the isolated content script
- the capability token is not placed in the iframe element's `src` attribute or Gmail DOM and is removed from the panel URL immediately after startup
- panel tokens are stored only in trusted session storage and expire
- content script does not receive raw calendar data

Residual risk:

- Gmail can still remove, obscure, or visually interfere with the launcher or iframe because the integration must anchor to the Gmail page
- any extension with broader browser privileges may be able to interfere with the page or extension

### Malicious or malformed extension message

Controls:

- sender ID validation
- sender page validation
- Gmail top-level tab validation for panel requests
- allowlisted payload keys
- type, length, count, and range limits
- one active request per tab
- per-tab request rate limiting

### Compromised Google API response

Controls:

- HTTPS only
- exact API endpoint constant
- response-shape validation
- busy-range count limit
- timestamp validation
- fail-closed behavior

### Local data disclosure

Controls:

- recent-person history defaults to off
- maximum 15 remembered addresses
- history can be cleared from settings
- local extension storage is restricted to trusted extension contexts
- OAuth tokens are not stored by Meetza

Residual risk:

- local extension storage is not an encrypted secret store
- users with access to the browser profile or device may be able to inspect stored settings

### Quota exhaustion

Controls:

- one active generation request per Gmail tab
- minimum interval between requests
- maximum requests per minute per tab
- request timeout
- active-request cancellation when the Gmail tab closes or Meetza is disabled
- maximum dates and calendars

### Extension-page injection or unexpected resource loading

Controls:

- default-deny extension Content Security Policy
- scripts and styles must come from the packaged extension
- network connections are limited to `www.googleapis.com`
- form submission, plug-in objects, and base-URL rewriting are disabled
- web-accessible resources are limited to the panel page and compose icon, scoped to Gmail, with dynamic resource URLs

### Supply-chain or publisher compromise

This remains one of the highest-impact risks because a malicious extension update could change the Gmail content script.

Recommended release controls:

- organization-owned publisher account
- phishing-resistant multi-factor authentication
- protected main branch
- mandatory pull-request review
- two-person release approval
- signed release tags
- archived release artifacts and hashes
- comparison of the published artifact to the tagged source

## Explicit non-goals

Meetza cannot cryptographically prove that a future malicious version of its own content script would be unable to read Gmail. Browser content scripts necessarily have page DOM capabilities on the origins where they are allowed to run.

The mitigation is to keep Gmail access optional, minimize the content script, isolate the actual application UI, and make releases auditable.
