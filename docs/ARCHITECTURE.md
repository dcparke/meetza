# Architecture

## Design goals

Meetza is designed to minimize both authority and data exposure.

The architecture follows four rules:

1. Request only the permissions needed for the active feature.
2. Keep secrets and raw calendar data in the service worker.
3. Keep the Gmail integration too small to contain application logic.
4. Make security boundaries visible in the repository structure.

## Components

### Service worker

`background/background.js`

Responsible for:

- restricting extension storage to trusted contexts
- enabling and disabling optional Gmail access
- dynamically registering the Gmail content script
- validating message senders and payloads
- rate limiting generation requests
- cancelling active requests when a tab closes or Meetza is disabled
- obtaining OAuth tokens
- calling the FreeBusy API
- validating Google responses
- calculating free ranges
- storing settings and optional recent-person history

The service worker is the only component that sees OAuth tokens or raw busy ranges. Privileged message handling waits until local and session storage have been restricted to trusted extension contexts; initialization fails closed if that boundary cannot be established.

### Gmail content script

`content/content.js`

Responsible only for:

- finding Gmail's attachment toolbar control
- inserting a small launcher in a closed Shadow DOM
- opening an extension-origin iframe
- positioning the iframe near the compose toolbar
- removing itself when Meetza is disabled

It does not:

- read email content
- read recipients
- read subjects
- access extension storage
- call Google APIs
- receive OAuth tokens
- receive raw busy ranges
- calculate availability

### Meetza panel

`panel/`

The visible availability form runs as an extension page embedded in an iframe. This prevents Gmail page scripts from directly reading or modifying the form's DOM.

The content script creates a random per-panel token and registers it with the service worker. The iframe element begins at `about:blank`; after registration, the content script navigates the child browsing context to the extension panel with the token in the URL fragment. The token is not placed in the iframe element's `src` attribute, and the panel immediately removes the fragment from its own URL. The service worker accepts panel requests only when the token is registered for the same Gmail tab.

The panel sends explicit requests to the service worker and receives only sanitized state and final free ranges.

### Settings popup

`popup/`

The popup:

- requests optional Gmail host access from a user gesture
- enables or disables Gmail integration
- edits defaults
- clears optional recent-person history

Disabling Meetza removes the optional Gmail host permission after removing the current UI and unregistering the dynamic content script.

### Pure core

`core/`

Contains no Chrome APIs and no network access:

- `availability.js` merges busy ranges and computes free ranges
- `time.js` converts local wall-clock boundaries to instants

## Trust boundaries

```text
Gmail page
  |
  | DOM anchor only
  v
Isolated content script
  |
  | extension URL
  v
Extension-origin panel iframe
  |
  | validated runtime messages
  v
Service worker
  |
  | HTTPS + FreeBusy-only OAuth scope
  v
Google Calendar FreeBusy API
```

## Data minimization

Each selected date is queried separately, and only for the configured workday boundary.

If a user selects July 1 and October 29, Meetza sends two narrowly bounded FreeBusy requests. It does not request the dates, nights, or months between them.
