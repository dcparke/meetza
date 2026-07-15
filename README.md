# Meetza

Meetza is a browser extension that generates shareable meeting availability from Google Calendar free/busy data inside Gmail compose windows.

The project is intentionally small. It has no backend, no analytics, no runtime dependencies, and no access to calendar event details.

## Security model

Meetza is designed around data minimization and least privilege:

- Google OAuth is limited to `calendar.events.freebusy`.
- Calendar event titles, descriptions, attendees, locations, and notes are never requested.
- The OAuth token stays in the extension service worker.
- Raw busy ranges stay in the service worker.
- Gmail receives only final free ranges.
- Gmail access is optional and is removed when Meetza is disabled.
- The Gmail content script is dynamically registered only while the user has enabled Meetza.
- Persistent extension storage is restricted to trusted extension contexts.
- The Meetza form runs in an extension-origin iframe rather than directly in the Gmail DOM.
- Each selected date is queried only for its configured workday window, so unselected dates and overnight gaps are not fetched.
- Requests are validated and rate-limited in the service worker.
- Active Calendar requests are cancelled when their Gmail tab closes or Meetza is disabled.
- Extension pages use a default-deny Content Security Policy.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

## Data flow

```text
Gmail compose toolbar
        |
        | tiny launcher only
        v
Isolated content script
        |
        | opens extension-origin iframe
        v
Meetza panel
        |
        | selected dates, calendars, duration, output time zone
        v
Service worker
        |
        | OAuth token + Google FreeBusy request
        v
Google Calendar FreeBusy API
        |
        | busy timestamps only
        v
Service worker
        |
        | local availability calculation
        v
Meetza panel
        |
        | free ranges only
        v
Clipboard
```

## Permissions

| Permission | Why it is needed |
|---|---|
| `identity` | Requests a Google OAuth token for the FreeBusy scope. |
| `storage` | Stores user settings and, only when enabled, up to 15 recent email addresses for autocomplete. |
| `scripting` | Dynamically registers the minimal Gmail anchor script only while Meetza is enabled. |
| `https://www.googleapis.com/*` | Allows the service worker to call the Google Calendar FreeBusy endpoint. |
| Optional `https://mail.google.com/*` | Allows the user to enable the Meetza launcher in Gmail. This permission is removed when Meetza is disabled. |

Meetza does not request `tabs`, Gmail API access, Contacts API access, or calendar event-list access.

## Repository structure

```text
background/   OAuth, validation, permissions, rate limiting, FreeBusy calls
content/      Minimal Gmail launcher and iframe positioning only
core/         Pure availability and time conversion logic
panel/        Extension-origin availability UI embedded in Gmail
popup/        Extension settings UI
shared/       Shared configuration and constants
tests/        Dependency-free unit tests
scripts/      Repository security validation
.github/      Continuous integration
```

## Development setup

### Requirements

- Google Chrome 102 or newer
- Node.js 20 or newer for tests
- A Google Cloud project with the Google Calendar API enabled
- A Chrome Extension OAuth client for the unpacked extension ID

### Install from source

1. Clone the repository.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Select **Load unpacked** and choose the repository root.
5. Copy the extension ID shown by Chrome.
6. Create a Google OAuth client of type **Chrome Extension** using that extension ID.
7. Put the client ID in `manifest.json`.
8. Reload the extension.
9. Open the Meetza toolbar popup and enable **Enabled in Gmail**.
10. Approve the Gmail host permission when Chrome asks.

Normal users should install a published build and should not create their own OAuth client.

## Tests

Run all dependency-free tests and repository security checks:

```bash
npm run check
```

The checks verify core availability behavior, exact-day data minimization, DST conversion, manifest permissions, OAuth scope, remote-code restrictions, and dangerous DOM sinks.

## Security reporting

Do not open a public issue for a suspected vulnerability. See [SECURITY.md](SECURITY.md).

## Browser support

Chrome is the supported target today. See [docs/BROWSER-SUPPORT.md](docs/BROWSER-SUPPORT.md) for the portability plan.

## License

Apache License 2.0. See [LICENSE](LICENSE).
